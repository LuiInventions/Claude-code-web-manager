import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { appVersion } from "../../version";
import { ActionError } from "./errors";
import { SECTION_ARG } from "./sections";
import { appNavigate, appSections, appStatus, indexRebuild, indexStatus } from "./actions/app";
import {
  promptImprove,
  promptSplit,
  sessionHistory,
  sessionHistoryDelete,
  sessionList,
  sessionRead,
  sessionResize,
  sessionReview,
  sessionSend,
  sessionStart,
  sessionStop,
  sessionWrite,
} from "./actions/sessions";
import {
  githubConnect,
  githubCreateRepo,
  githubDisconnect,
  githubRefresh,
  githubRepo,
  githubSetVisibility,
  githubStatus,
  githubUpdateRepo,
} from "./actions/github";
import {
  filesList,
  filesPreview,
  filesRead,
  filesWrite,
  folderFind,
  folderRoots,
  imageSetDelete,
  imageSetsList,
  localCopyFile,
  projectDetail,
  projectsList,
  revealPath,
} from "./actions/files";
import {
  remoteConnect,
  remoteDir,
  remoteDisconnect,
  remoteDownload,
  remoteGetStatus,
  remoteLoginTail,
  remoteLs,
  remoteMakeDir,
  remoteOtp,
  remotePassword,
  remoteRead,
  remoteUploadFile,
  remoteWrite,
} from "./actions/remote";
import {
  modelsList,
  providersTest,
  secretsGet,
  secretsSet,
  settingsGet,
  settingsUpdate,
  usageGet,
} from "./actions/settings";
import { registerDriveTools } from "./register-drive";

export const MCP_INSTRUCTIONS = `You control Jarvis Control Center, the local Windows app that runs Claude Code, Grok, or Codex on this PC, in a GitHub clone, or over one SSH login.

Call app_status first. Use ids, paths, and repo names from tool results. Do not invent them.

Sections for app_navigate: remote, github (start a CLI in a clone), local (start a CLI in a folder on this PC), repos (token, clones, commit and push), sessions, settings.

Remote: remote_saved_servers, then remote_start_saved. A new host uses remote_connect. remote_submit_password answers the password prompt (useSaved true when the server stored one). remote_submit_otp answers 2FA. remote_set_dir chooses the remote folder. remote_session_start opens 1 to 6 sessions there. remote_search, remote_read_file, remote_write_file (editor save), remote_download (save a file or folder onto this PC), remote_copy_path, remote_upload, and remote_upload_images.

GitHub launcher: github_cloned_repos, github_select_repo, then github_session_start (1 to 6). github_search, github_read_file, github_save_file, github_copy_path, github_upload, and github_upload_images stay inside that clone.

Local: local_get_path, local_select_path, local_session_start (1 to 6). local_search, local_read_file, local_save_file, local_copy_path, local_upload, and local_upload_images stay inside that folder. local_set_projects_dir changes the Settings projects folder, not the selected Ordner.

Repos: github_status lists the signed-in user's repos. github_create_repo creates one by name. github_refresh re-lists them. github_update_repo commits and pushes local changes only when confirm is true. github_set_visibility sets private or public.

A session keeps running until session_stop. session_send writes a follow-up and waits. session_read returns the readable tail. session_write is for raw keys such as Ctrl+C (\\u0003). Local and GitHub sessions use the code CLI from Settings. Remote sessions need SSH and take their own cli.

Running sessions are numbered separately for each area, oldest first. list_active_github_sessions, list_active_local_sessions, and list_active_remote_sessions return session 1, session 2, and so on. get_session_x_info reads that session's command-window scrollback and copies it. where is github, local, or remote. x is the number from that area's list. A session that has exited is not in these lists.

github_connect, secrets_set, remote_submit_password, and remote_submit_otp store or send secrets. Their results never include the secret. Do not repeat a token, key, password, or 2FA code in your reply.

Uploads and downloads through these tools are capped at 64 MB. Image uploads create an image_set folder and return a prompt sentence. Stay inside the folder the user named.`;

const INSTRUCTIONS = MCP_INSTRUCTIONS;

type ToolResult = {
  content: { type: "text"; text: string }[];
  isError?: boolean;
};

function ok(data: unknown): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

async function run(fn: () => Promise<unknown> | unknown): Promise<ToolResult> {
  try {
    return ok(await fn());
  } catch (err) {
    const message = err instanceof ActionError || err instanceof Error ? err.message : String(err);
    return { isError: true, content: [{ type: "text", text: message }] };
  }
}

const section = z.enum(SECTION_ARG).describe(
  "Sidebar entry. remote, github (GitHub launcher), local, repos (token and push), sessions, settings.",
);

/**
 * In-process MCP server. One instance per HTTP request in stateless mode.
 * Tools call the same functions the window uses.
 */
export function createJarvisMcpServer(): McpServer {
  const server = new McpServer(
    { name: "jarvis-control-center", version: appVersion() },
    { instructions: INSTRUCTIONS },
  );

  server.registerTool(
    "app_status",
    {
      title: "App status",
      description:
        "Snapshot of Jarvis Control Center: version, MCP URL, whether the window is attached, the active code CLI and which binaries are installed, project and clone folders, GitHub login, SSH state, and how many CLI sessions are live. Call this before other tools. It does not change anything and does not return secrets.",
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => run(() => appStatus()),
  );

  server.registerTool(
    "app_navigate",
    {
      title: "Show a section",
      description:
        "Ask the open window to show a sidebar section: remote, github, local, repos, sessions, or settings. The window applies it within about a second. If ui.attached is false, the command waits until the window is open. This does not start a CLI or change files.",
      inputSchema: { section },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    async ({ section: name }) => run(() => appNavigate(name)),
  );

  server.registerTool(
    "app_sections",
    {
      title: "List sections",
      description: "The six sidebar sections and what each one is for. Read-only.",
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => run(() => appSections()),
  );

  server.registerTool(
    "settings_get",
    {
      title: "Read settings",
      description:
        "Public settings: project folder, AI provider and model, code CLI, theme, voice id, and whether keys are present. Also lists allowed themes, providers, and code CLIs with their model and effort flag values. Never includes API keys.",
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => run(() => settingsGet()),
  );

  server.registerTool(
    "settings_update",
    {
      title: "Update settings",
      description:
        "Change settings. Omitted fields stay as they are. projectsDir and launcherLocalPath must already exist. codeCli is claude, grok, or codex and becomes the CLI that local session_start launches. theme is ink, dusk, moss, tide, clay, or plum. setupComplete true also requires projectsDir and marks first-run setup done for this version. Returns the public settings.",
      inputSchema: {
        projectsDir: z.string().optional().describe("Absolute folder whose children are local projects."),
        launcherLocalPath: z.string().optional().describe("Last local folder selected in the Local tab."),
        aiProvider: z.string().optional().describe("Provider id from settings_get, such as openai."),
        aiModel: z.string().optional().describe("Model id for the active provider."),
        openaiModel: z.string().optional().describe("Legacy OpenAI model id."),
        cartesiaVoice: z.string().optional().describe("Cartesia voice id for Jarvis speech."),
        codeCli: z.enum(["claude", "grok", "codex"]).optional().describe("CLI spawned by local sessions."),
        theme: z.string().optional().describe("Palette id: ink, dusk, moss, tide, clay, or plum."),
        setupComplete: z.boolean().optional().describe("Stamp this app version as set up. Requires projectsDir."),
      },
      annotations: { destructiveHint: false, openWorldHint: false },
    },
    async (args) => run(() => settingsUpdate(args)),
  );

  server.registerTool(
    "secrets_status",
    {
      title: "Which keys are set",
      description:
        "Booleans for each AI provider key, the Cartesia key, the Picovoice key, and whether an SSH password is saved. The secret values are never returned.",
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => run(() => secretsGet()),
  );

  server.registerTool(
    "secrets_set",
    {
      title: "Store an API key",
      description:
        "Store one AI provider key, the Cartesia key, or the Picovoice key. Pass provider plus apiKey for a model provider. An empty string clears that key. The result says only whether a key is now set. Do not echo the key.",
      inputSchema: {
        provider: z.string().optional().describe("Provider id from settings_get. Required with apiKey."),
        apiKey: z.string().optional().describe("Key for that provider. Empty string clears it."),
        cartesiaApiKey: z.string().optional().describe("Cartesia key. Empty string clears it."),
        picovoiceAccessKey: z.string().optional().describe("Picovoice key. Empty string clears it."),
      },
      annotations: { destructiveHint: true, openWorldHint: false },
    },
    async (args) => run(() => secretsSet(args)),
  );

  server.registerTool(
    "providers_test",
    {
      title: "Test AI provider keys",
      description:
        "Call the provider and report whether the stored key works. Pass provider to test one. Omit it to test every provider that has a key. Does not print the key.",
      inputSchema: {
        provider: z.string().optional().describe("Provider id. Omit to test every keyed provider."),
        model: z.string().optional().describe("Model id. Omit to use the provider default."),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ provider, model }) => run(() => providersTest(provider, model)),
  );

  server.registerTool(
    "models_list",
    {
      title: "List models",
      description:
        "Models for the active AI provider. The live list is merged in when a key is set. Read-only. Used by Settings, not by the code CLI.",
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async () => run(() => modelsList()),
  );

  server.registerTool(
    "usage_get",
    {
      title: "Claude usage",
      description:
        "Claude Code rate-limit windows tracked by this app. A rejected window blocks a new local Claude session until it resets. Grok, Codex, and a remote Claude login are not blocked by this.",
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => run(() => usageGet()),
  );

  server.registerTool(
    "session_list",
    {
      title: "List live CLI sessions",
      description:
        "Every code-CLI PTY still in memory, newest first, with id, status, cwd, cli, activity, and the opening prompt. These survive a window refresh and end only with session_stop. Read-only.",
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => run(() => sessionList()),
  );

  server.registerTool(
    "session_start",
    {
      title: "Start a code CLI",
      description:
        "Start Claude Code, Grok, or Codex in a PTY and ask the window to show that terminal. Local (where omitted or local) uses the Settings code CLI and requires cwd, an absolute folder on this PC. where remote runs on the connected SSH server; pass cli as claude, grok, or codex, and cwd as a remote path or ~. prompt is the opening task and is one argument to the CLI, not a shell command. model and effort must be flag values from app_status for that CLI; omit them to keep the CLI default. origin github marks a clone so it shows on the GitHub tab. Returns the session id. Then session_read.",
      inputSchema: {
        cwd: z.string().optional().describe("Local absolute path, or a remote path when where is remote."),
        prompt: z.string().optional().describe("Opening task. Omit for an empty interactive CLI."),
        where: z.enum(["local", "remote"]).optional().describe("local is this PC. remote needs SSH."),
        cli: z.enum(["claude", "grok", "codex"]).optional().describe("Remote CLI. Ignored locally; change Settings instead."),
        model: z.string().optional().describe("Model flag value from app_status.codeClis."),
        effort: z.string().optional().describe("Effort flag value from app_status.codeClis."),
        origin: z.enum(["github", "local"]).optional().describe("github shows the session on the GitHub tab."),
        repoFullName: z.string().optional().describe("owner/repo when origin is github."),
        projectName: z.string().optional().describe("Label. Defaults to the folder name."),
        cols: z.number().int().min(20).max(400).optional().describe("Columns. Default 100. The window refits later."),
        rows: z.number().int().min(5).max(200).optional().describe("Rows. Default 32."),
      },
      annotations: { destructiveHint: false, openWorldHint: false },
    },
    async (args) => run(() => sessionStart(args)),
  );

  server.registerTool(
    "session_send",
    {
      title: "Send text to a session",
      description:
        "Write text into a running session and wait until output settles or waitMs elapses. submit true (the default) appends Enter when the text does not already end in CR or LF. Use this for a follow-up prompt. waitMs defaults to 8000 and is capped at 30000. quietMs defaults to 600. The result includes settle (settled, timeout, exited) and the readable output tail. On timeout, call session_read again before sending more. Does not start a session.",
      inputSchema: {
        id: z.string().describe("Session id from session_list or session_start."),
        text: z.string().optional().describe("Text to write. Empty with submit true presses Enter."),
        submit: z.boolean().optional().describe("Append Enter. Default true."),
        waitMs: z.number().int().min(200).max(30000).optional().describe("How long to wait for output. Default 8000."),
        quietMs: z.number().int().min(100).max(5000).optional().describe("Quiet time that counts as settled. Default 600."),
        maxChars: z.number().int().min(200).max(40000).optional().describe("Tail length. Default 8000."),
      },
      annotations: { destructiveHint: false, openWorldHint: false },
    },
    async (args) => run(() => sessionSend(args)),
  );

  server.registerTool(
    "session_write",
    {
      title: "Write raw keys",
      description:
        "Write exactly the given string to a running PTY and return immediately. No Enter is added. Use this for control keys: Ctrl+C is \\u0003, Ctrl+D is \\u0004. Then session_read. For a normal prompt, use session_send.",
      inputSchema: {
        id: z.string().describe("Session id."),
        text: z.string().describe("Exact bytes to write, up to 32000 characters."),
      },
      annotations: { destructiveHint: false, openWorldHint: false },
    },
    async ({ id, text }) => run(() => sessionWrite(id, text)),
  );

  server.registerTool(
    "session_read",
    {
      title: "Read a session",
      description:
        "Readable tail of one session with ANSI and spinner redraws removed, plus status, activity, cwd, and exit code. maxChars defaults to 8000 and is capped at 40000. Read-only. Call again when activity is still working.",
      inputSchema: {
        id: z.string().describe("Session id."),
        maxChars: z.number().int().min(200).max(40000).optional(),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ id, maxChars }) => run(() => sessionRead(id, maxChars)),
  );

  server.registerTool(
    "session_resize",
    {
      title: "Resize a session",
      description: "Set the PTY grid. The window also refits when it shows the terminal. No-op on a finished session.",
      inputSchema: {
        id: z.string(),
        cols: z.number().int().min(20).max(400),
        rows: z.number().int().min(5).max(200),
      },
      annotations: { destructiveHint: false, openWorldHint: false },
    },
    async ({ id, cols, rows }) => run(() => sessionResize(id, cols, rows)),
  );

  server.registerTool(
    "session_stop",
    {
      title: "Stop a session",
      description:
        "Kill one PTY and drop it. This is permanent. The process cannot be resumed. Refreshing the window does not do this. Confirm with the user before stopping a session you did not just start.",
      inputSchema: { id: z.string().describe("Session id from session_list.") },
      annotations: { destructiveHint: true, idempotentHint: true, openWorldHint: false },
    },
    async ({ id }) => run(() => sessionStop(id)),
  );

  server.registerTool(
    "session_history",
    {
      title: "Launcher history",
      description:
        "Saved launcher history in .data, newest first. This is not the live PTY list. Use session_list for processes that are still running.",
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => run(() => sessionHistory()),
  );

  server.registerTool(
    "session_history_delete",
    {
      title: "Delete one history row",
      description: "Remove one saved launcher history row by id. Does not stop a live PTY. Use session_stop for that.",
      inputSchema: { id: z.string() },
      annotations: { destructiveHint: true, idempotentHint: true, openWorldHint: false },
    },
    async ({ id }) => run(() => sessionHistoryDelete(id)),
  );

  server.registerTool(
    "session_review",
    {
      title: "Review live sessions",
      description:
        "Ask the configured AI provider for a markdown report and a short spoken summary of live sessions. Omit ids to review every live session. Each id must exist. Requires an AI key. Read-only on the sessions themselves.",
      inputSchema: {
        ids: z.array(z.string()).optional().describe("Session ids. Omit for all live sessions."),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ ids }) => run(() => sessionReview(ids)),
  );

  server.registerTool(
    "prompt_improve",
    {
      title: "Improve a prompt",
      description:
        "Rewrite a task prompt using the folder on disk as context and the configured AI provider. Does not start a session. Pass the result to session_start if it should run.",
      inputSchema: {
        projectPath: z.string().describe("Absolute folder the prompt is about."),
        prompt: z.string().describe("The draft task."),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ projectPath, prompt }) => run(() => promptImprove(projectPath, prompt)),
  );

  server.registerTool(
    "prompt_split",
    {
      title: "Split a prompt",
      description:
        "Split one large task into 1 to 6 smaller prompts for separate CLI sessions. Does not start them. Start each with session_start.",
      inputSchema: {
        projectPath: z.string().describe("Absolute folder the task is about."),
        prompt: z.string().describe("The large task."),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ projectPath, prompt }) => run(() => promptSplit(projectPath, prompt)),
  );

  server.registerTool(
    "github_status",
    {
      title: "Get the user's repos",
      description:
        "Get the signed-in user's GitHub repositories: login, clone status, and local path. This is the Repos list, including repos that are not cloned yet. For clones that are ready to open, call github_cloned_repos. detail true also runs git status in each clone (slower) and fills pendingPush and pendingFiles. Does not return the token.",
      inputSchema: {
        detail: z.boolean().optional().describe("Include per-repo git status. Default false."),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ detail }) => run(() => githubStatus(detail === true)),
  );

  server.registerTool(
    "github_repo",
    {
      title: "Inspect one repo",
      description:
        "Local git summary and the file list the Repos Update button would commit and push for owner/repo. Read-only. Call this before github_update_repo.",
      inputSchema: { fullName: z.string().describe("owner/repo from github_status.") },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ fullName }) => run(() => githubRepo(fullName)),
  );

  server.registerTool(
    "github_connect",
    {
      title: "Connect GitHub",
      description:
        "Validate a GitHub personal access token, store it, list repos, and clone any that are missing into the clones folder. The token is not returned. Missing clones continue in the background; poll github_status. Do not echo the token.",
      inputSchema: { token: z.string().describe("GitHub personal access token.") },
      annotations: { destructiveHint: false, openWorldHint: true },
    },
    async ({ token }) => run(() => githubConnect(token)),
  );

  server.registerTool(
    "github_disconnect",
    {
      title: "Disconnect GitHub",
      description:
        "Forget the stored GitHub token and the repo list. Clones on disk stay. Confirm with the user before calling this.",
      annotations: { destructiveHint: true, idempotentHint: true, openWorldHint: false },
    },
    async () => run(() => githubDisconnect()),
  );

  server.registerTool(
    "github_refresh",
    {
      title: "Refresh repos",
      description:
        "Refresh the signed-in user's repositories from GitHub and fast-forward clones that are already on disk. New repos clone in the background. Requires a stored token. Returns immediately while pulls continue.",
      annotations: { destructiveHint: false, openWorldHint: true },
    },
    async () => run(() => githubRefresh()),
  );

  server.registerTool(
    "github_create_repo",
    {
      title: "Create a new repo",
      description:
        "Create a new repository with the given name under the connected account and publish <clones folder>/<name>. The name must match [A-Za-z0-9][A-Za-z0-9._-]{0,99}. private defaults to true; pass false for a public repo. The folder cannot already be a git repo. Requires a stored token.",
      inputSchema: {
        name: z.string().describe("Repository name, not owner/name."),
        private: z.boolean().optional().describe("Default true."),
      },
      annotations: { destructiveHint: false, openWorldHint: true },
    },
    async ({ name, private: isPrivate }) => run(() => githubCreateRepo(name, isPrivate !== false)),
  );

  server.registerTool(
    "github_update_repo",
    {
      title: "Update a repo",
      description:
        "Update a repo: upload the newest local changes to GitHub. Same as the Repos Update button. Commits all local changes with the message \"Update via Control Center\", fetches, merges, and pushes owner/repo. confirm must be true. Call github_repo first and only confirm when that file list should ship. On a merge conflict nothing is pushed and the merge is aborted.",
      inputSchema: {
        fullName: z.string().describe("owner/repo."),
        confirm: z.boolean().describe("Must be true to commit and push."),
      },
      annotations: { destructiveHint: true, openWorldHint: true },
    },
    async ({ fullName, confirm }) => run(() => githubUpdateRepo(fullName, confirm)),
  );

  server.registerTool(
    "github_set_visibility",
    {
      title: "Change repo visibility",
      description:
        "Change owner/repo to private or public on GitHub, then store that on the local repo list. private true is private, false is public. Requires a stored token.",
      inputSchema: {
        fullName: z.string().describe("owner/repo."),
        private: z.boolean().describe("true private, false public."),
      },
      annotations: { destructiveHint: true, idempotentHint: true, openWorldHint: true },
    },
    async ({ fullName, private: isPrivate }) => run(() => githubSetVisibility(fullName, isPrivate)),
  );

  server.registerTool(
    "folders_roots",
    {
      title: "Project and clone folders",
      description: "The local projects folder, the GitHub clones folder, and the directory that currently holds clones. Read-only.",
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => run(() => folderRoots()),
  );

  server.registerTool(
    "projects_list",
    {
      title: "List local projects",
      description:
        "Subfolders of the projects directory with stack, git summary, and a short README excerpt. Skips dot folders and Windows profile folders. Read-only.",
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => run(() => projectsList()),
  );

  server.registerTool(
    "project_detail",
    {
      title: "One local project",
      description: "Stack, git, manifest, and README for one project folder. path is absolute. Read-only. Large READMEs are truncated.",
      inputSchema: { path: z.string().describe("Absolute project folder.") },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ path }) => run(() => projectDetail(path)),
  );

  server.registerTool(
    "find_folder",
    {
      title: "Find a folder",
      description:
        "Search this PC for a folder by name. Starts in the home directory and widens to fixed drives. Can take a while. Returns absolute paths. Use one as session_start cwd or files_list path.",
      inputSchema: {
        query: z.string().describe("Folder name or keywords."),
        limit: z.number().int().min(1).max(20).optional().describe("Default 8."),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ query, limit }) => run(() => folderFind(query, limit)),
  );

  server.registerTool(
    "files_list",
    {
      title: "List a local folder",
      description:
        "List a folder on this PC. Omit path to list drives. Returns names, absolute paths, and whether each entry is a file or directory. A long folder is truncated. Read-only.",
      inputSchema: { path: z.string().optional().describe("Absolute folder. Omit for drives.") },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ path }) => run(() => filesList(path)),
  );

  server.registerTool(
    "files_read",
    {
      title: "Read a local file",
      description:
        "Read a text file on this PC. The result is capped. Images and other binaries are described, not inlined. tooLarge means the file is over the app preview limit. Read-only.",
      inputSchema: { path: z.string().describe("Absolute file path.") },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ path }) => run(() => filesRead(path)),
  );

  server.registerTool(
    "files_write",
    {
      title: "Write a local file",
      description:
        "Replace a UTF-8 text file on this PC. The parent folder must already exist. content is capped at 500000 characters. This overwrites the file. Pass the full new contents, not a patch.",
      inputSchema: {
        path: z.string().describe("Absolute file path."),
        content: z.string().describe("Full new UTF-8 contents."),
      },
      annotations: { destructiveHint: true, openWorldHint: false },
    },
    async ({ path, content }) => run(() => filesWrite(path, content)),
  );

  server.registerTool(
    "files_preview",
    {
      title: "Preview a local path",
      description:
        "Preview a file, or a folder's README and short summary. path may be a file or a folder. Read-only. Text is capped.",
      inputSchema: { path: z.string().describe("Absolute file or folder.") },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ path }) => run(() => filesPreview(path)),
  );

  server.registerTool(
    "local_copy_file",
    {
      title: "Copy a file into a folder",
      description:
        "Copy one file on this PC into dir. name is the file name inside that folder and cannot contain .. . At most 64 MB. Use this for the same job as Dateien hochladen of a single file.",
      inputSchema: {
        source: z.string().describe("Absolute source file."),
        dir: z.string().describe("Absolute destination folder."),
        name: z.string().optional().describe("File name inside dir. Defaults to the source name."),
      },
      annotations: { destructiveHint: true, openWorldHint: false },
    },
    async ({ source, dir, name }) => run(() => localCopyFile(source, dir, name)),
  );

  server.registerTool(
    "reveal_in_explorer",
    {
      title: "Show in Explorer",
      description: "Open a path in Windows Explorer. Creates the projects folder or the clones folder if that exact path is passed and it is missing.",
      inputSchema: { path: z.string().describe("Absolute path.") },
      annotations: { readOnlyHint: false, openWorldHint: false },
    },
    async ({ path }) => run(() => revealPath(path)),
  );

  server.registerTool(
    "image_sets_list",
    {
      title: "List image sets",
      description:
        "Local copies of image_set folders kept by the upload dialog. Each set name is image_set plus letters. Read-only.",
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => run(() => imageSetsList()),
  );

  server.registerTool(
    "image_set_delete",
    {
      title: "Delete an image set",
      description:
        "Delete one image_set folder and its local cache. kind local deletes it under dir on this PC. kind remote deletes it on the SSH server and needs a connection. name must be an image_set folder name. Other folders are refused.",
      inputSchema: {
        kind: z.enum(["local", "remote"]),
        dir: z.string().describe("Parent folder that contains the image set."),
        name: z.string().describe("image_set folder name."),
      },
      annotations: { destructiveHint: true, idempotentHint: false, openWorldHint: false },
    },
    async ({ kind, dir, name }) => run(() => imageSetDelete(kind, dir, name)),
  );

  server.registerTool(
    "remote_status",
    {
      title: "SSH status",
      description:
        "The one SSH login: connected, connecting, host, user, remote dir, saved servers (no passwords), whether a password or 2FA code is needed, and a short tail of the login terminal. Poll this after remote_connect. Read-only.",
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => run(() => remoteGetStatus()),
  );

  server.registerTool(
    "remote_connect",
    {
      title: "Start a new server",
      description:
        "Start SSH to a new server that is not necessarily in the saved list. host and user are required. dir is the remote folder and defaults to ~. If a password or 2FA prompt appears, call remote_submit_password or remote_submit_otp. To use a saved server instead, call remote_start_saved. If a connection is already up, this does not replace it; call remote_disconnect first. Does not return secrets.",
      inputSchema: {
        host: z.string().describe("Server host or host:port."),
        user: z.string().describe("SSH user."),
        dir: z.string().optional().describe("Remote folder. Default ~."),
      },
      annotations: { destructiveHint: false, openWorldHint: true },
    },
    async (args) => run(() => remoteConnect(args)),
  );

  server.registerTool(
    "remote_submit_password",
    {
      title: "Enter the SSH password",
      description:
        "Enter the SSH password when remote_status says needsPassword. password is the secret. saveLogin true stores the server for remote_saved_servers. useSaved true sends the password already stored for this server and ignores password. The result never includes the password. Do not echo it.",
      inputSchema: {
        password: z.string().optional().describe("Password. Omit when useSaved is true."),
        saveLogin: z.boolean().optional().describe("Store host, user, and password. Default false."),
        useSaved: z.boolean().optional().describe("Send the password already stored for this server."),
      },
      annotations: { destructiveHint: false, openWorldHint: true },
    },
    async (args) => run(() => remotePassword(args)),
  );

  server.registerTool(
    "remote_submit_otp",
    {
      title: "Enter the SSH 2FA code",
      description:
        "Enter the current SSH 2FA code when remote_status says needsOtp. The code is sent once and is not stored. Do not echo it. Then poll remote_status until connected is true.",
      inputSchema: { otp: z.string().describe("Current one-time code.") },
      annotations: { destructiveHint: false, openWorldHint: true },
    },
    async ({ otp }) => run(() => remoteOtp(otp)),
  );

  server.registerTool(
    "remote_disconnect",
    {
      title: "Disconnect SSH",
      description:
        "Close the SSH login and the remote broker. Remote file tools and remote CLI sessions stop working until the next remote_connect. Confirm with the user before disconnecting a session they are using.",
      annotations: { destructiveHint: true, idempotentHint: true, openWorldHint: false },
    },
    async () => run(() => remoteDisconnect()),
  );

  server.registerTool(
    "remote_set_dir",
    {
      title: "Choose the remote folder",
      description:
        "Choose the remote working folder (the Ordner field). ~ is the remote home. The Remote tab follows it. Takes effect for the connected server. Does not create the folder and does not start a session. Start sessions with remote_session_start.",
      inputSchema: { dir: z.string().describe("Remote directory. ~ is home.") },
      annotations: { destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ dir }) => run(() => remoteDir(dir)),
  );

  server.registerTool(
    "remote_login_tail",
    {
      title: "Read the SSH login",
      description:
        "Readable tail of the SSH login terminal, with password and code characters redacted by the app. Use this when remote_connect is waiting and you need to see the prompt. Read-only.",
      inputSchema: { maxChars: z.number().int().min(200).max(8000).optional() },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ maxChars }) => run(() => remoteLoginTail(maxChars)),
  );

  server.registerTool(
    "remote_list",
    {
      title: "List a remote folder",
      description:
        "List one remote folder. path defaults to ~. For a name search under that folder, call remote_search. Requires remote_status.connected. Read-only.",
      inputSchema: {
        path: z.string().optional().describe("Remote directory. Default ~."),
        query: z.string().optional().describe("Name filter. Omit to list the folder."),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ path, query }) => run(() => remoteLs(path, query)),
  );

  server.registerTool(
    "remote_read_file",
    {
      title: "Read a remote file",
      description:
        "Read a text file on the SSH server. path is the remote path. Content is capped. Binaries are described, not inlined. Read-only.",
      inputSchema: { path: z.string().describe("Remote file path.") },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ path }) => run(() => remoteRead(path)),
  );

  server.registerTool(
    "remote_write_file",
    {
      title: "Save remote text",
      description:
        "Save a UTF-8 text file on the SSH server, the same as Speichern in the editor. content is capped at 100000 characters. Pass the full new contents. To save a remote file or folder onto this PC, use remote_download. For a larger or binary upload, use remote_upload.",
      inputSchema: {
        path: z.string().describe("Remote file path."),
        content: z.string().describe("Full new UTF-8 contents."),
      },
      annotations: { destructiveHint: true, openWorldHint: true },
    },
    async ({ path, content }) => run(() => remoteWrite(path, content)),
  );

  server.registerTool(
    "remote_mkdir",
    {
      title: "Make a remote folder",
      description:
        "Create one folder inside dir on the SSH server. rel is relative to dir and cannot climb out with a parent directory. Parents are not created for you. Create them one level at a time, shallow first.",
      inputSchema: {
        dir: z.string().describe("Remote parent folder."),
        rel: z.string().describe("New folder name relative to dir."),
      },
      annotations: { destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ dir, rel }) => run(() => remoteMakeDir(dir, rel)),
  );

  server.registerTool(
    "remote_upload_file",
    {
      title: "Upload one file",
      description:
        "Copy one file from this PC into the remote folder dir. name is the remote file name and cannot climb out of that folder. At most 64 MB. Requires SSH. Larger copies belong in the upload dialog.",
      inputSchema: {
        localPath: z.string().describe("Absolute file on this PC."),
        dir: z.string().describe("Remote destination folder."),
        name: z.string().optional().describe("Remote file name. Defaults to the local name."),
      },
      annotations: { destructiveHint: true, openWorldHint: true },
    },
    async ({ localPath, dir, name }) => run(() => remoteUploadFile(localPath, dir, name)),
  );

  server.registerTool(
    "remote_download",
    {
      title: "Save a remote file or folder",
      description:
        "Save a remote file, or a remote folder when directory is true, into localDir on this PC. This is Herunterladen. At most 64 MB. localDir must already be a folder. Requires SSH. To save text back onto the server, use remote_write_file.",
      inputSchema: {
        remotePath: z.string().describe("Remote file or folder."),
        localDir: z.string().describe("Existing folder on this PC."),
        directory: z.boolean().optional().describe("True to download a folder. Default false."),
      },
      annotations: { destructiveHint: true, openWorldHint: true },
    },
    async (args) => run(() => remoteDownload(args)),
  );

  server.registerTool(
    "index_status",
    {
      title: "Project index status",
      description: "When the local project index was last built, and how many projects it holds. Read-only.",
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => run(() => indexStatus()),
  );

  server.registerTool(
    "index_rebuild",
    {
      title: "Rebuild the project index",
      description: "Rescan the projects folder and replace the local project index. Can take a while on a large tree.",
      annotations: { destructiveHint: false, openWorldHint: false },
    },
    async () => run(() => indexRebuild()),
  );

  registerDriveTools(server, run);

  server.registerPrompt(
    "drive-jarvis",
    {
      title: "Drive Jarvis",
      description: "How to operate Jarvis Control Center with these tools.",
    },
    async () => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: INSTRUCTIONS,
          },
        },
      ],
    }),
  );

  return server;
}
