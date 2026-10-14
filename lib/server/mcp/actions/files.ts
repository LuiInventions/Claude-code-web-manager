import fs from "node:fs";
import path from "node:path";
import { getConfig } from "../../../config";
import {
  listDir,
  listDrives,
  openInExplorer,
  readPathPreview,
} from "../../../fs-explorer";
import { readViewFile, writeViewFile, type FileView } from "../../../file-view";
import { findFolder } from "../../../folder-find";
import { getProjectDetail, scanProjects } from "../../../projects";
import { cloneContainer, readGithubState } from "../../../github-store";
import { imageSetCacheRoot, listImageSetCache, removeImageSetCache } from "../../image-set-cache";
import { removeLocalImageSet, writeLocalTree } from "../../local-upload";
import { isImageSetFolder } from "../../../remote-upload-flow";
import { remoteBrokerPort } from "../../remote-session";
import { remoteRemoveSet } from "../../remote-copy";
import { ActionError, clipText } from "../errors";

const READ_CAP = 60_000;
const WRITE_CAP = 500_000;
const COPY_CAP = 64 * 1024 * 1024;

function publicFile(view: FileView) {
  const content = view.content == null ? null : clipText(view.content, READ_CAP);
  return {
    path: view.path,
    name: view.name,
    size: view.size,
    kind: view.kind,
    tooLarge: Boolean(view.tooLarge),
    truncated: content?.truncated ?? false,
    content: content?.text ?? null,
    note: view.kind === "text" ? null : "Binary and media files are not inlined. Open them in the app.",
  };
}

export async function filesList(dirPath?: string) {
  if (!dirPath?.trim()) {
    return { kind: "drives", entries: await listDrives() };
  }
  const abs = path.resolve(dirPath);
  try {
    const listed = await listDir(abs);
    return { kind: "dir", path: abs, ...listed };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    throw new ActionError(code === "ENOENT" ? `Folder not found: ${abs}` : (err as Error).message);
  }
}

export async function filesRead(filePath: string) {
  const target = filePath.trim();
  if (!target) throw new ActionError("path is required.");
  try {
    return publicFile(await readViewFile(target));
  } catch (err) {
    throw new ActionError(err instanceof Error ? err.message : String(err));
  }
}

/** Replace a UTF-8 text file on this PC. The parent folder must already exist. */
export async function filesWrite(filePath: string, content: string) {
  const target = filePath.trim();
  if (!target) throw new ActionError("path is required.");
  if (content.length > WRITE_CAP) {
    throw new ActionError(`content is ${content.length} characters. The limit is ${WRITE_CAP}.`);
  }
  try {
    await writeViewFile(target, content);
  } catch (err) {
    throw new ActionError(err instanceof Error ? err.message : String(err));
  }
  return { path: path.resolve(target), bytes: Buffer.byteLength(content, "utf8") };
}

export async function filesPreview(targetPath: string) {
  const target = targetPath.trim();
  if (!target) throw new ActionError("path is required.");
  try {
    const preview = await readPathPreview(target);
    if (preview.kind === "file" && preview.content) {
      const clipped = clipText(preview.content, READ_CAP);
      return { ...preview, content: clipped.text, truncated: clipped.truncated || preview.tooLarge };
    }
    return preview;
  } catch (err) {
    throw new ActionError(err instanceof Error ? err.message : String(err));
  }
}

export function folderRoots() {
  const { projectsDir, githubDir } = getConfig();
  const paths = readGithubState()
    .repos.filter((repo) => repo.cloneStatus === "cloned" && repo.localPath && fs.existsSync(repo.localPath))
    .map((repo) => repo.localPath);
  return {
    projectsDir,
    githubDir,
    clonesDir: cloneContainer(paths),
  };
}

export async function projectsList() {
  try {
    return await scanProjects();
  } catch (err) {
    throw new ActionError(err instanceof Error ? err.message : String(err));
  }
}

export async function projectDetail(projectPath: string) {
  const target = projectPath.trim();
  if (!target) throw new ActionError("path is required.");
  try {
    const detail = await getProjectDetail(target);
    const readme = detail.readmeFull == null ? null : clipText(detail.readmeFull, READ_CAP);
    return {
      ...detail,
      readme: detail.readme == null ? null : clipText(detail.readme, 4000).text,
      readmeFull: readme?.text ?? null,
      readmeTruncated: readme?.truncated ?? false,
    };
  } catch (err) {
    throw new ActionError(err instanceof Error ? err.message : String(err));
  }
}

export async function folderFind(query: string, limit?: number) {
  const q = query.trim();
  if (!q) throw new ActionError("query is required.");
  const cap = Math.max(1, Math.min(20, limit ?? 8));
  const matches = await findFolder(q, cap);
  return {
    query: q,
    matches,
    note: matches.length
      ? "Pass a match to session_start as cwd, or to files_list."
      : "Nothing matched. Try a shorter name, or files_list a drive.",
  };
}

export async function revealPath(targetPath: string) {
  const target = targetPath.trim();
  if (!target) throw new ActionError("path is required.");
  const abs = path.resolve(target);
  const { projectsDir, githubDir } = getConfig();
  if (abs === path.resolve(projectsDir) || abs === path.resolve(githubDir)) {
    await fs.promises.mkdir(abs, { recursive: true });
  }
  try {
    await openInExplorer(abs);
  } catch (err) {
    throw new ActionError(err instanceof Error ? err.message : String(err));
  }
  return { path: abs, opened: true };
}

/** Copy one local file into a folder on this PC. The relative name cannot contain `..`. */
export async function localCopyFile(sourcePath: string, dir: string, name?: string) {
  const source = path.resolve(sourcePath.trim());
  const destDir = path.resolve(dir.trim());
  if (!sourcePath.trim() || !dir.trim()) throw new ActionError("source and dir are required.");
  let st: fs.Stats;
  try {
    st = await fs.promises.stat(source);
  } catch {
    throw new ActionError(`File not found: ${source}`);
  }
  if (!st.isFile()) throw new ActionError("source is not a file.");
  if (st.size > COPY_CAP) {
    throw new ActionError(`File is ${st.size} bytes. MCP copies at most 64 MB. Use the upload dialog for larger files.`);
  }
  const rel = (name?.trim() || path.basename(source)).replace(/\\/g, "/");
  try {
    const result = await writeLocalTree({
      dir: destDir,
      items: [{ rel, size: st.size, source }],
    });
    return { ...result, dest: path.join(destDir, rel) };
  } catch (err) {
    throw new ActionError(err instanceof Error ? err.message : String(err));
  }
}

export async function imageSetsList() {
  const root = imageSetCacheRoot();
  let names: string[] = [];
  try {
    names = (await fs.promises.readdir(root)).filter((name) => isImageSetFolder(name));
  } catch {
    names = [];
  }
  const sets = [];
  for (const name of names) {
    const images = await listImageSetCache(name);
    sets.push({
      name,
      images: images.map((image) => ({ name: image.name, size: image.size })),
    });
  }
  return { root, sets };
}

export async function imageSetDelete(kind: "local" | "remote", dir: string, name: string) {
  const folder = name.trim();
  const parent = dir.trim();
  if (!parent || !isImageSetFolder(folder)) {
    throw new ActionError("Only a folder whose name is image_set plus letters can be deleted.");
  }
  if (kind === "local") await removeLocalImageSet(parent, folder);
  else {
    const port = remoteBrokerPort();
    if (!port) throw new ActionError("Not connected to the server. Call remote_connect first.");
    await remoteRemoveSet(port, parent, folder);
  }
  await removeImageSetCache(folder);
  return { kind, dir: parent, name: folder, deleted: true };
}
