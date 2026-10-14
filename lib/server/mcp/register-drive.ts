import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { githubClonedRepos, githubSelectRepo } from "./actions/github";
import {
  remoteCopyPath,
  remoteSavedServers,
  remoteSearch,
  remoteSessionStart,
  remoteStartSaved,
  remoteUploadImages,
  remoteUploadPaths,
} from "./actions/remote";
import { listActiveSessions, sessionInfoByNumber } from "./actions/sessions";
import {
  githubCopyPath,
  githubReadFile,
  githubSaveFile,
  githubSearch,
  githubSessionStart,
  githubUpload,
  githubUploadImages,
  localCopyPath,
  localGetPath,
  localReadFile,
  localSaveFile,
  localSearch,
  localSelectPath,
  localSessionStart,
  localSetProjectsDir,
  localUpload,
  localUploadImages,
} from "./actions/workspace";

type Run = (fn: () => Promise<unknown> | unknown) => Promise<{
  content: { type: "text"; text: string }[];
  isError?: boolean;
}>;

const count = z.number().int().min(1).max(6).optional().describe("How many sessions to open. Integer from 1 to 6. Default 1.");
const prompt = z.string().optional().describe("Opening prompt passed to each CLI. Omit for an empty session.");
const model = z.string().optional().describe("Model flag from settings_get for this CLI. Omit for the CLI default.");
const effort = z.string().optional().describe("Effort flag from settings_get for this CLI. Omit for the CLI default.");
const sources = z.array(z.string()).min(1).max(200).describe("Absolute files or folders on this PC.");
const images = z.array(z.string()).min(1).max(10).describe("Absolute image files on this PC. At most 10.");

/** Tools that match the Remote, GitHub, Local, and file-browser actions. */
export function registerDriveTools(server: McpServer, run: Run): void {
  server.registerTool(
    "remote_saved_servers",
    {
      title: "Get saved servers",
      description:
        "List saved SSH servers: id, host, user, remote folder, and whether a password is stored. Passwords are never returned. Start one with remote_start_saved. Read-only.",
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => run(() => remoteSavedServers()),
  );

  server.registerTool(
    "remote_start_saved",
    {
      title: "Start with a saved server",
      description:
        "Begin SSH to a saved server from remote_saved_servers. id is the server id, usually user@host. The password is not accepted here. If the result says needsPassword and the server hasPassword, call remote_submit_password with useSaved true. A 2FA prompt needs remote_submit_otp. If a connection is already up, call remote_disconnect first.",
      inputSchema: { id: z.string().describe("Saved server id from remote_saved_servers.") },
      annotations: { destructiveHint: false, openWorldHint: true },
    },
    async ({ id }) => run(() => remoteStartSaved(id)),
  );

  server.registerTool(
    "remote_session_start",
    {
      title: "Start remote sessions",
      description:
        "Open 1 to 6 code CLI sessions on the connected SSH server, in path. path becomes the Remote Ordner. Omit path to use the folder already chosen. cli is claude, grok, or codex and defaults to the Settings CLI. Requires remote_status.connected. The same prompt is passed to every session.",
      inputSchema: {
        path: z.string().optional().describe("Remote folder. ~ is home. Default is the chosen remote folder."),
        count,
        prompt,
        cli: z.enum(["claude", "grok", "codex"]).optional().describe("CLI on the server. Default is Settings."),
        model,
        effort,
      },
      annotations: { destructiveHint: false, openWorldHint: true },
    },
    async (args) => run(() => remoteSessionStart(args)),
  );

  server.registerTool(
    "remote_search",
    {
      title: "Search a remote file or folder",
      description:
        "Search file and folder names under a remote folder. query is a substring. path defaults to the chosen remote folder. Skips node_modules, .git, .next, dist, build, and __pycache__. Requires SSH. Read-only.",
      inputSchema: {
        query: z.string().describe("Name substring."),
        path: z.string().optional().describe("Remote folder to search. Default is the chosen folder."),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ query, path }) => run(() => remoteSearch(query, path)),
  );

  server.registerTool(
    "remote_copy_path",
    {
      title: "Copy a remote path",
      description:
        "Copy a remote file or folder path to the clipboard, the same as Pfad kopieren. The path is also returned. Does not copy the file itself.",
      inputSchema: { path: z.string().describe("Remote file or folder path.") },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ path }) => run(() => remoteCopyPath(path)),
  );

  server.registerTool(
    "remote_upload",
    {
      title: "Upload files or folders",
      description:
        "Copy files and folders from this PC into the remote folder dir. Omit dir to use the chosen remote folder. Parents are created shallow-first. At most 64 MB. Requires SSH. A symlink is refused. Larger copies belong in the upload dialog.",
      inputSchema: {
        paths: sources,
        dir: z.string().optional().describe("Remote destination folder. Default is the chosen folder."),
      },
      annotations: { destructiveHint: true, openWorldHint: true },
    },
    async ({ paths, dir }) => run(() => remoteUploadPaths(dir, paths)),
  );

  server.registerTool(
    "remote_upload_images",
    {
      title: "Upload images",
      description:
        "Copy images from this PC into a new image_set folder on the server, or into folder when that is an existing image_set name. dir is the remote parent and defaults to the chosen folder. At most 10 images and 64 MB. The result prompt is the sentence to paste into the CLI. Requires SSH.",
      inputSchema: {
        paths: images,
        dir: z.string().optional().describe("Remote parent folder. Default is the chosen folder."),
        folder: z.string().optional().describe("Existing image_set name. Omit to create a new set."),
      },
      annotations: { destructiveHint: true, openWorldHint: true },
    },
    async ({ paths, dir, folder }) => run(() => remoteUploadImages(dir, paths, folder)),
  );

  server.registerTool(
    "github_cloned_repos",
    {
      title: "Get cloned repos",
      description:
        "List GitHub repos whose clone is already on disk, with fullName and localPath. This is the GitHub launcher list. github_status is every repo on the account, including ones still cloning. Read-only.",
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => run(() => githubClonedRepos()),
  );

  server.registerTool(
    "github_select_repo",
    {
      title: "Select a cloned repo",
      description:
        "Show one cloned repo in the GitHub tab and remember it. fullName is owner/repo from github_cloned_repos. Does not start a CLI. Later github_search, github_read_file, github_save_file, github_upload, and github_session_start use this repo unless they pass fullName.",
      inputSchema: { fullName: z.string().describe("owner/repo from github_cloned_repos.") },
      annotations: { destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ fullName }) => run(() => githubSelectRepo(fullName)),
  );

  server.registerTool(
    "github_session_start",
    {
      title: "Start sessions in a repo",
      description:
        "Open 1 to 6 code CLI sessions in a cloned repo. Uses the repo from github_select_repo, or fullName when passed. The CLI is the one in Settings. The same prompt is passed to every session. The repo must already be cloned.",
      inputSchema: { fullName: z.string().optional().describe("owner/repo. Default is the selected clone."), count, prompt, model, effort },
      annotations: { destructiveHint: false, openWorldHint: false },
    },
    async (args) => run(() => githubSessionStart(args)),
  );

  server.registerTool(
    "github_search",
    {
      title: "Search a repo file or folder",
      description:
        "Search file and folder names inside the selected clone, or inside path when that is a subfolder. query is a substring. Skips node_modules, .git, .next, dist, build, and __pycache__. Read-only.",
      inputSchema: {
        query: z.string().describe("Name substring."),
        fullName: z.string().optional().describe("owner/repo. Default is the selected clone."),
        path: z.string().optional().describe("Subfolder inside the clone. Default is the clone root."),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ query, fullName, path }) => run(() => githubSearch(query, fullName, path)),
  );

  server.registerTool(
    "github_read_file",
    {
      title: "Read a repo file",
      description:
        "Read a text file inside the selected clone. path may be relative to the clone or an absolute path inside it. Content is capped. Read-only.",
      inputSchema: {
        path: z.string().describe("File path inside the clone."),
        fullName: z.string().optional().describe("owner/repo. Default is the selected clone."),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ path, fullName }) => run(() => githubReadFile(path, fullName)),
  );

  server.registerTool(
    "github_save_file",
    {
      title: "Save a repo file",
      description:
        "Replace a UTF-8 text file inside the selected clone, the same as Speichern. path may be relative to the clone. The parent folder must already exist. content is the full new contents. This does not commit or push. Use github_update_repo for that.",
      inputSchema: {
        path: z.string().describe("File path inside the clone."),
        content: z.string().describe("Full new UTF-8 contents."),
        fullName: z.string().optional().describe("owner/repo. Default is the selected clone."),
      },
      annotations: { destructiveHint: true, openWorldHint: false },
    },
    async ({ path, content, fullName }) => run(() => githubSaveFile(path, content, fullName)),
  );

  server.registerTool(
    "github_copy_path",
    {
      title: "Copy a repo path",
      description:
        "Copy a file or folder path inside the selected clone to the clipboard, the same as Pfad kopieren. Omit path to copy the clone folder itself. The path is also returned.",
      inputSchema: {
        path: z.string().optional().describe("File or folder inside the clone. Omit for the clone root."),
        fullName: z.string().optional().describe("owner/repo. Default is the selected clone."),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ path, fullName }) => run(() => githubCopyPath(path, fullName)),
  );

  server.registerTool(
    "github_upload",
    {
      title: "Upload files or folders into a repo",
      description:
        "Copy files and folders from this PC into the selected clone. dir is a subfolder of the clone and defaults to the clone root. At most 64 MB. A symlink is refused. This does not commit or push.",
      inputSchema: {
        paths: sources,
        dir: z.string().optional().describe("Subfolder inside the clone. Default is the clone root."),
        fullName: z.string().optional().describe("owner/repo. Default is the selected clone."),
      },
      annotations: { destructiveHint: true, openWorldHint: false },
    },
    async ({ paths, dir, fullName }) => run(() => githubUpload(paths, dir, fullName)),
  );

  server.registerTool(
    "github_upload_images",
    {
      title: "Upload images into a repo",
      description:
        "Copy images from this PC into a new image_set folder in the selected clone, or into folder when that is an existing image_set name. dir is the parent inside the clone. At most 10 images and 64 MB. The result prompt is the sentence to paste into the CLI.",
      inputSchema: {
        paths: images,
        dir: z.string().optional().describe("Parent folder inside the clone. Default is the clone root."),
        folder: z.string().optional().describe("Existing image_set name. Omit to create a new set."),
        fullName: z.string().optional().describe("owner/repo. Default is the selected clone."),
      },
      annotations: { destructiveHint: true, openWorldHint: false },
    },
    async ({ paths, dir, folder, fullName }) => run(() => githubUploadImages(paths, dir, folder, fullName)),
  );

  server.registerTool(
    "local_get_path",
    {
      title: "Get the local path",
      description:
        "The folder selected in the Local tab (the Ordner). Until one is selected, this is the projects folder from Settings. Read-only. local_set_projects_dir changes the projects folder, not this path.",
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => run(() => localGetPath()),
  );

  server.registerTool(
    "local_select_path",
    {
      title: "Select a local path",
      description:
        "Choose the Local Ordner. path must be an existing folder on this PC. Shows it in the Local tab and remembers it. Does not start a CLI. Call local_session_start afterwards.",
      inputSchema: { path: z.string().describe("Existing folder on this PC.") },
      annotations: { destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ path }) => run(() => localSelectPath(path)),
  );

  server.registerTool(
    "local_set_projects_dir",
    {
      title: "Change the local projects folder",
      description:
        "Change the projects folder in Settings. path must already exist. This does not change the Local Ordner. Use local_select_path for the folder a local session starts in.",
      inputSchema: { path: z.string().describe("Existing projects folder on this PC.") },
      annotations: { destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ path }) => run(() => localSetProjectsDir(path)),
  );

  server.registerTool(
    "local_session_start",
    {
      title: "Start sessions in the local path",
      description:
        "Open 1 to 6 code CLI sessions in the selected Local folder. path, when set, must stay inside that folder. The CLI is the one in Settings. The same prompt is passed to every session.",
      inputSchema: {
        path: z.string().optional().describe("Subfolder of the selected Local path. Default is the selected path."),
        count,
        prompt,
        model,
        effort,
      },
      annotations: { destructiveHint: false, openWorldHint: false },
    },
    async (args) => run(() => localSessionStart(args)),
  );

  server.registerTool(
    "local_search",
    {
      title: "Search a local file or folder",
      description:
        "Search file and folder names under the selected Local path. query is a substring. path is an optional subfolder. Skips node_modules, .git, .next, dist, build, and __pycache__. Read-only.",
      inputSchema: {
        query: z.string().describe("Name substring."),
        path: z.string().optional().describe("Subfolder of the selected Local path."),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ query, path }) => run(() => localSearch(query, path)),
  );

  server.registerTool(
    "local_read_file",
    {
      title: "Read a local file",
      description:
        "Read a text file inside the selected Local path. path may be relative to that folder or an absolute path inside it. Content is capped. Read-only.",
      inputSchema: { path: z.string().describe("File path inside the selected Local folder.") },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ path }) => run(() => localReadFile(path)),
  );

  server.registerTool(
    "local_save_file",
    {
      title: "Save a local file",
      description:
        "Replace a UTF-8 text file inside the selected Local path, the same as Speichern. path may be relative. The parent folder must already exist. content is the full new contents.",
      inputSchema: {
        path: z.string().describe("File path inside the selected Local folder."),
        content: z.string().describe("Full new UTF-8 contents."),
      },
      annotations: { destructiveHint: true, openWorldHint: false },
    },
    async ({ path, content }) => run(() => localSaveFile(path, content)),
  );

  server.registerTool(
    "local_copy_path",
    {
      title: "Copy a local path",
      description:
        "Copy a file or folder path inside the selected Local folder to the clipboard, the same as Pfad kopieren. Omit path to copy the selected folder itself. The path is also returned.",
      inputSchema: { path: z.string().optional().describe("File or folder inside the selected Local path. Omit for that folder.") },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ path }) => run(() => localCopyPath(path)),
  );

  server.registerTool(
    "local_upload",
    {
      title: "Upload files or folders locally",
      description:
        "Copy files and folders from this PC into the selected Local folder. dir is a subfolder and defaults to the selected folder. At most 64 MB. A symlink is refused.",
      inputSchema: {
        paths: sources,
        dir: z.string().optional().describe("Subfolder of the selected Local path. Default is that path."),
      },
      annotations: { destructiveHint: true, openWorldHint: false },
    },
    async ({ paths, dir }) => run(() => localUpload(dir, paths)),
  );

  server.registerTool(
    "local_upload_images",
    {
      title: "Upload images locally",
      description:
        "Copy images from this PC into a new image_set folder in the selected Local path, or into folder when that is an existing image_set name. dir is the parent and defaults to the selected path. At most 10 images and 64 MB. The result prompt is the sentence to paste into the CLI.",
      inputSchema: {
        paths: images,
        dir: z.string().optional().describe("Parent folder. Default is the selected Local path."),
        folder: z.string().optional().describe("Existing image_set name. Omit to create a new set."),
      },
      annotations: { destructiveHint: true, openWorldHint: false },
    },
    async ({ paths, dir, folder }) => run(() => localUploadImages(dir, paths, folder)),
  );

  server.registerTool(
    "list_active_github_sessions",
    {
      title: "List active GitHub sessions",
      description:
        "List code CLI sessions running in a cloned GitHub repo. Each running session gets a stable number: session 1 is the oldest, session 2 the next, and so on. A session that has exited is omitted. Read one with get_session_x_info where github and x set to that number. Read-only.",
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => run(() => listActiveSessions("github")),
  );

  server.registerTool(
    "list_active_local_sessions",
    {
      title: "List active Local sessions",
      description:
        "List code CLI sessions running in the Local folder on this PC. Each running session gets a stable number: session 1 is the oldest, session 2 the next, and so on. A session that has exited is omitted. Read one with get_session_x_info where local and x set to that number. Read-only.",
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => run(() => listActiveSessions("local")),
  );

  server.registerTool(
    "list_active_remote_sessions",
    {
      title: "List active Remote sessions",
      description:
        "List code CLI sessions running on the connected SSH server. Each running session gets a stable number: session 1 is the oldest, session 2 the next, and so on. A session that has exited is omitted. Read one with get_session_x_info where remote and x set to that number. Read-only.",
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => run(() => listActiveSessions("remote")),
  );

  server.registerTool(
    "get_session_x_info",
    {
      title: "Read session command window",
      description:
        "Read one running session by its number. where is github, local, or remote. x is the number from list_active_github_sessions, list_active_local_sessions, or list_active_remote_sessions. Session 1 is the oldest running session in that area. output is the command-window scrollback with ANSI codes removed. The open window also copies that text. Read-only.",
      inputSchema: {
        where: z.enum(["github", "local", "remote"]).describe("github, local, or remote. Must match the list the number came from."),
        x: z.number().int().min(1).describe("Session number. Session 1 is the oldest running session in that area."),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ where, x }) => run(() => sessionInfoByNumber(where, x)),
  );
}
