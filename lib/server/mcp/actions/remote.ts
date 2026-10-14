import fs from "node:fs";
import path from "node:path";
import { tailText } from "../../../console-read";
import { remoteReadFile, remoteWriteFile, remoteFind, remoteList } from "../../remote-broker";
import {
  beginRemote,
  disconnectRemote,
  remoteBrokerPort,
  remoteLoginSnapshot,
  remoteStatus,
  setRemoteDir,
  submitRemoteOtp,
  submitRemotePassword,
  type RemotePublicStatus,
} from "../../remote-session";
import { remoteMkdir, remotePut, remoteWalk, saveRemoteTree } from "../../remote-copy";
import { joinRemote, planTransfer, remoteBaseName, remoteRelative } from "../../../remote-transfer";
import { saveImageSetFile } from "../../image-set-cache";
import { imageSetFolderName, isImageFile, isImageSetFolder } from "../../../remote-upload-flow";
import { enqueueUiCommand } from "../../ui-commands";
import { sessionStartMany } from "./sessions";
import { queueCopy, queueReload } from "./ui";
import {
  assertTransferFits,
  collectUpload,
  imageResult,
  prepareImages,
} from "./transfer";
import { ActionError, clipText } from "../errors";

const TEXT_CAP = 60_000;
const WRITE_CAP = 100_000;
const TRANSFER_CAP = 64 * 1024 * 1024;

function requirePort(): number {
  const port = remoteBrokerPort();
  if (!port) throw new ActionError("Not connected to the server. Call remote_connect, then remote_submit_password or remote_submit_otp if asked.");
  return port;
}

function statusView(status: RemotePublicStatus, extra: Record<string, unknown> = {}) {
  return {
    connected: status.connected,
    connecting: status.connecting,
    host: status.host,
    user: status.user,
    dir: status.dir,
    serverId: status.serverId,
    servers: status.servers,
    saveLogin: status.saveLogin,
    hasSavedPassword: status.hasSavedPassword,
    needsPassword: status.needsPassword,
    needsOtp: status.needsOtp,
    error: status.error || null,
    detail: status.detail || null,
    ...extra,
  };
}

export function remoteGetStatus() {
  const status = remoteStatus();
  return {
    ...statusView(status),
    loginTail: clipText(tailText(remoteLoginSnapshot(), 40, 2000), 2000).text,
    next: status.needsPassword
      ? "Call remote_submit_password."
      : status.needsOtp
        ? "Call remote_submit_otp with the current 2FA code. The code is not stored."
        : status.connected
          ? "Use remote_list, remote_read_file, or session_start with where remote."
          : "Call remote_connect with host and user.",
  };
}

export async function remoteConnect(input: { host: string; user: string; dir?: string }) {
  const now = remoteStatus();
  if (now.connecting || now.connected) {
    return statusView(now, {
      already: true,
      hint: "Already connected or still connecting. Call remote_disconnect first to switch servers.",
    });
  }
  const status = await beginRemote({
    host: input.host,
    user: input.user,
    dir: input.dir ?? "",
  });
  if (status.error && !status.connecting) throw new ActionError(status.error);
  return statusView(status, {
    hint: status.needsPassword
      ? "Next: remote_submit_password."
      : status.needsOtp
        ? "Next: remote_submit_otp."
        : "Connection started. Poll remote_status until connected is true.",
  });
}

export function remotePassword(input: { password?: string; saveLogin?: boolean; useSaved?: boolean }) {
  const status = submitRemotePassword({
    password: input.password ?? "",
    saveLogin: input.saveLogin === true,
    useSaved: input.useSaved === true,
  });
  if (status.error && !status.needsPassword) throw new ActionError(status.error);
  return statusView(status, {
    hint: "The password is not included in this result. Poll remote_status. A 2FA prompt needs remote_submit_otp.",
  });
}

export function remoteOtp(otp: string) {
  const status = submitRemoteOtp(otp);
  if (status.error && !status.needsOtp) throw new ActionError(status.error);
  return statusView(status, {
    hint: "The code is not stored. Poll remote_status until connected is true.",
  });
}

export async function remoteDisconnect() {
  await disconnectRemote();
  return statusView(remoteStatus());
}

export function remoteDir(dir: string) {
  const folder = dir.trim() || "~";
  setRemoteDir(folder);
  const command = enqueueUiCommand("remote", { kind: "set-cwd", cwd: folder });
  return statusView(remoteStatus(), {
    dir: folder,
    ui: { commandId: command.id },
    note: "The Remote Ordner field follows this folder. It does not create the folder.",
  });
}

/** Saved SSH servers. Passwords are never included. */
export function remoteSavedServers() {
  const servers = remoteStatus().servers.map((server) => ({
    id: server.id,
    host: server.host,
    user: server.user,
    dir: server.dir,
    hasPassword: server.hasPassword,
  }));
  return {
    servers,
    note: servers.length
      ? "Start one with remote_start_saved. A stored password is sent later with remote_submit_password and useSaved true. The password itself is not in this result."
      : "No saved server. Call remote_connect with host and user, then remote_submit_password with saveLogin true.",
  };
}

export function findSavedServer(idOrHost: string) {
  const key = idOrHost.trim();
  if (!key) throw new ActionError("id is required. Call remote_saved_servers.");
  const servers = remoteStatus().servers;
  const exact = servers.find((server) => server.id === key);
  if (exact) return exact;
  const matches = servers.filter((server) => server.host === key || `${server.user}@${server.host}` === key);
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) {
    throw new ActionError(`Several saved servers match "${key}". Pass an id from remote_saved_servers.`);
  }
  throw new ActionError(`No saved server "${key}". Call remote_saved_servers.`);
}

/** Begin SSH with a saved server. The password is a separate step. */
export async function remoteStartSaved(id: string) {
  const saved = findSavedServer(id);
  enqueueUiCommand("remote", { kind: "navigate" });
  const started = await remoteConnect({ host: saved.host, user: saved.user, dir: saved.dir });
  if ("already" in started && started.already) return started;
  return {
    ...started,
    server: {
      id: saved.id,
      host: saved.host,
      user: saved.user,
      dir: saved.dir,
      hasPassword: saved.hasPassword,
    },
    hint: saved.hasPassword
      ? "If needsPassword is true, call remote_submit_password with useSaved true. Do not send the password."
      : "If needsPassword is true, call remote_submit_password. A 2FA prompt needs remote_submit_otp.",
  };
}

/** Start 1 to 6 remote CLI sessions in one folder. SSH must already be connected. */
export function remoteSessionStart(input: {
  path?: string;
  count?: number;
  prompt?: string;
  cli?: string;
  model?: string;
  effort?: string;
}) {
  const status = remoteStatus();
  if (!status.connected) {
    throw new ActionError(
      "Not connected to the server. Call remote_start_saved or remote_connect, then the password or 2FA tool if asked.",
    );
  }
  const folder = input.path?.trim() || status.dir || "~";
  remoteDir(folder);
  return sessionStartMany({
    where: "remote",
    cwd: folder,
    count: input.count,
    prompt: input.prompt,
    cli: input.cli,
    model: input.model,
    effort: input.effort,
    projectName: folder,
  });
}

/** Search file and folder names under a remote folder. `path` defaults to the chosen remote folder. */
export async function remoteSearch(query: string, dirPath?: string) {
  const q = query.trim();
  if (!q) throw new ActionError("query is required.");
  const root = dirPath?.trim() || remoteStatus().dir || "~";
  const listed = await remoteLs(root, q);
  return {
    ...listed,
    note: "Matches are name substrings under this folder. The broker skips node_modules, .git, .next, dist, build, and __pycache__.",
  };
}

export function remoteCopyPath(target: string) {
  return queueCopy("remote", target);
}

/** Upload files and folders from this PC into the remote folder. At most 64 MB. */
export async function remoteUploadPaths(dir: string | undefined, sources: string[]) {
  const port = requirePort();
  const root = dir?.trim() || remoteStatus().dir || "~";
  const items = await collectUpload(sources);
  assertTransferFits(items);
  const planned = planTransfer(items);
  if (!planned.ok) throw new ActionError(planned.error);
  const sourceByRel = new Map<string, string>();
  for (const item of items) {
    if (item.dir || !item.source) continue;
    const rel = remoteRelative(item.rel);
    if (rel) sourceByRel.set(rel, item.source);
  }
  try {
    for (const rel of planned.plan.dirs) await remoteMkdir(port, root, rel);
    for (const file of planned.plan.files) {
      const source = sourceByRel.get(file.rel);
      if (!source) throw new ActionError("A file in the upload disappeared.");
      const bytes = await fs.promises.readFile(source);
      await remotePut(port, root, file.rel, (async function* () { yield bytes; })(), bytes.length);
    }
  } catch (err) {
    if (err instanceof ActionError) throw err;
    throw new ActionError(err instanceof Error ? err.message : String(err));
  }
  const reload = queueReload("remote");
  return {
    dir: root,
    files: planned.plan.files.length,
    dirs: planned.plan.dirs.length,
    bytes: planned.plan.total,
    ui: { commandId: reload },
  };
}

/**
 * Upload images into a new image_set folder, or into `setName` when that is an existing set.
 * At most 10 images and 64 MB. Returns the CLI paste sentence.
 */
export async function remoteUploadImages(dir: string | undefined, sources: string[], setName?: string) {
  const port = requirePort();
  const root = dir?.trim() || remoteStatus().dir || "~";
  const folder = setName?.trim() || imageSetFolderName();
  if (!isImageSetFolder(folder)) {
    throw new ActionError("folder must be an existing image_set name. Omit it to create a new set.");
  }
  let used: string[] = [];
  if (setName?.trim()) {
    const target = joinRemote(root, folder);
    try {
      const listing = await remoteList(port, target || folder);
      used = listing.entries.filter((entry) => !entry.dir && isImageFile({ name: entry.name })).map((entry) => entry.name);
    } catch {
      await remoteMakeDir(root, folder);
    }
  } else {
    await remoteMakeDir(root, folder);
  }
  const prepared = await prepareImages(sources, used);
  try {
    for (const file of prepared.files) {
      const bytes = await fs.promises.readFile(file.source);
      await remotePut(port, root, `${folder}/${file.name}`, (async function* () { yield bytes; })(), bytes.length);
      await saveImageSetFile(folder, file.name, file.source);
    }
  } catch (err) {
    if (err instanceof ActionError) throw err;
    throw new ActionError(err instanceof Error ? err.message : String(err));
  }
  const folderPath = joinRemote(root, folder) || `${root.replace(/\/+$/, "")}/${folder}`;
  queueReload("remote");
  return imageResult(folder, folderPath, prepared);
}

export function remoteLoginTail(maxChars?: number) {
  const cap = Math.max(200, Math.min(8000, maxChars ?? 2000));
  return {
    ...statusView(remoteStatus()),
    output: tailText(remoteLoginSnapshot(), 80, cap),
  };
}

export async function remoteLs(dirPath?: string, query?: string) {
  const port = requirePort();
  const target = dirPath?.trim() || "~";
  const q = query?.trim() || "";
  try {
    const listing = q ? await remoteFind(port, target, q) : await remoteList(port, target);
    return { ...listing, path: target, query: q || null };
  } catch (err) {
    throw new ActionError(err instanceof Error ? err.message : "Listing failed.");
  }
}

export async function remoteRead(filePath: string) {
  const port = requirePort();
  const target = filePath.trim();
  if (!target) throw new ActionError("path is required.");
  try {
    const view = await remoteReadFile(port, target);
    const content = view.content == null ? null : clipText(view.content, TEXT_CAP);
    return {
      path: view.path,
      name: view.name,
      size: view.size,
      kind: view.kind,
      tooLarge: Boolean(view.tooLarge),
      truncated: content?.truncated ?? false,
      content: content?.text ?? null,
    };
  } catch (err) {
    throw new ActionError(err instanceof Error ? err.message : String(err));
  }
}

export async function remoteWrite(filePath: string, content: string) {
  const port = requirePort();
  const target = filePath.trim();
  if (!target) throw new ActionError("path is required.");
  if (content.length > WRITE_CAP) {
    throw new ActionError(`content is ${content.length} characters. The limit is ${WRITE_CAP}. Use remote_upload_file for a larger file.`);
  }
  try {
    await remoteWriteFile(port, target, content);
  } catch (err) {
    throw new ActionError(err instanceof Error ? err.message : String(err));
  }
  return { path: target, bytes: Buffer.byteLength(content, "utf8") };
}

/** Create one folder inside `dir`. `rel` is not allowed to contain `..`. Parents are not created recursively. */
export async function remoteMakeDir(dir: string, rel: string) {
  const port = requirePort();
  try {
    await remoteMkdir(port, dir.trim() || "~", rel.trim());
  } catch (err) {
    throw new ActionError(err instanceof Error ? err.message : String(err));
  }
  return { dir: dir.trim() || "~", rel: rel.trim(), created: true };
}

/** Upload one local file into the remote folder. At most 64 MB. */
export async function remoteUploadFile(localPath: string, dir: string, name?: string) {
  const port = requirePort();
  const source = path.resolve(localPath.trim());
  if (!localPath.trim()) throw new ActionError("localPath is required.");
  let st: fs.Stats;
  try {
    st = await fs.promises.stat(source);
  } catch {
    throw new ActionError(`File not found: ${source}`);
  }
  if (!st.isFile()) throw new ActionError("localPath is not a file.");
  if (st.size > TRANSFER_CAP) {
    throw new ActionError(`File is ${st.size} bytes. MCP uploads at most 64 MB. Use the upload dialog for larger files.`);
  }
  const rel = (name?.trim() || path.basename(source)).replace(/\\/g, "/");
  const bytes = await fs.promises.readFile(source);
  try {
    await remotePut(port, dir.trim() || "~", rel, (async function* () { yield bytes; })(), bytes.length);
  } catch (err) {
    throw new ActionError(err instanceof Error ? err.message : String(err));
  }
  return { localPath: source, dir: dir.trim() || "~", rel, bytes: bytes.length };
}

/**
 * Download a remote file, or a remote folder when directory is true, into a local folder.
 * At most 64 MB.
 */
export async function remoteDownload(input: { remotePath: string; localDir: string; directory?: boolean }) {
  const port = requirePort();
  const remotePath = input.remotePath.trim();
  const localDir = path.resolve(input.localDir.trim());
  if (!remotePath || !input.localDir.trim()) throw new ActionError("remotePath and localDir are required.");
  if (input.directory) {
    const walked = await remoteWalk(port, remotePath);
    if (walked.total > TRANSFER_CAP) {
      throw new ActionError(`Folder is ${walked.total} bytes. MCP downloads at most 64 MB.`);
    }
  }
  try {
    const saved = await saveRemoteTree({
      port,
      remotePath,
      localDir,
      directory: input.directory === true,
    });
    if (saved.bytes > TRANSFER_CAP) {
      if (!input.directory) {
        await fs.promises.rm(path.join(localDir, remoteBaseName(remotePath)), { force: true });
      }
      throw new ActionError(`Download is ${saved.bytes} bytes, over the 64 MB MCP limit.`);
    }
    return saved;
  } catch (err) {
    if (err instanceof ActionError) throw err;
    throw new ActionError(err instanceof Error ? err.message : String(err));
  }
}
