import net from "node:net";

/**
 * One Python process on the server, started from the already authenticated ssh
 * shell. Later code CLIs attach to it through a local forward on that same ssh
 * client. A second `ssh` would be rejected: this server asks for
 * keyboard-interactive again and BatchMode exits 255.
 */

const BROKER_PY = `
import base64, json, fcntl, os, pty, select, signal, socket, struct, termios, threading
s = socket.socket()
s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
try:
    s.bind(("127.0.0.1", int(os.environ.get("CCC_PORT", "0"))))
except (OSError, ValueError):
    print("CCC_BROKER_BIND", flush=True)
    raise SystemExit(1)
s.listen(16)
print("CCC_BROKER %d" % s.getsockname()[1], flush=True)
lock = threading.Lock()
sessions = {}

def setsize(fd, cols, rows):
    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", int(rows), int(cols), 0, 0))

def spawn(cmd, cols, rows):
    pid, fd = pty.fork()
    if pid == 0:
        try:
            fcntl.ioctl(0, termios.TIOCSWINSZ, struct.pack("HHHH", int(rows), int(cols), 0, 0))
        except OSError:
            pass
        os.environ["TERM"] = "xterm-256color"
        os.environ["LANG"] = "C.UTF-8"
        os.environ["LC_ALL"] = "C.UTF-8"
        os.environ["COLORTERM"] = "truecolor"
        os.environ["COLUMNS"] = str(int(cols))
        os.environ["LINES"] = str(int(rows))
        os.execvp("bash", ["bash", "-lc", cmd])
    try:
        setsize(fd, cols, rows)
    except OSError:
        pass
    return pid, fd

def safe_path(raw):
    text = (raw or "").replace("\\x00", "").strip() or "~"
    if text == "~":
        return os.path.expanduser("~")
    if text.startswith("~/"):
        return os.path.join(os.path.expanduser("~"), text[2:])
    return os.path.abspath(os.path.expanduser(text))

def do_list(raw):
    path = safe_path(raw)
    if not os.path.isdir(path):
        return {"path": path, "parent": path, "entries": [], "error": "Kein Ordner."}
    entries = []
    try:
        names = os.listdir(path)
    except OSError as exc:
        return {"path": path, "parent": path, "entries": [], "error": str(exc)}
    for name in names:
        full = os.path.join(path, name)
        try:
            is_dir = os.path.isdir(full)
        except OSError:
            is_dir = False
        entries.append({"name": name, "path": full, "dir": is_dir})
    entries.sort(key=lambda e: (not e["dir"], e["name"].lower()))
    parent = os.path.dirname(path.rstrip("/")) or "/"
    return {"path": path, "parent": parent, "entries": entries[:2000]}

def do_find(raw, query):
    root = safe_path(raw)
    q = (query or "").strip().lower()
    hits = []
    skip = {"node_modules", ".git", ".next", "dist", "build", "__pycache__"}
    if not q or not os.path.isdir(root):
        return {"path": root, "query": query, "entries": hits}
    seen = 0
    for dirpath, dirnames, filenames in os.walk(root):
        seen += 1
        if seen > 2500:
            break
        dirnames[:] = [d for d in dirnames if d not in skip]
        for name in list(dirnames) + filenames:
            if q not in name.lower():
                continue
            hits.append({"name": name, "path": os.path.join(dirpath, name), "dir": name in dirnames})
            if len(hits) >= 200:
                return {"path": root, "query": query, "entries": hits}
    return {"path": root, "query": query, "entries": hits}

def send_json(conn, payload):
    body = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    conn.sendall(b"OK " + body + b"\\n")
    conn.close()

def relay(conn, fd, pid, sid, rest):
    try:
        if rest:
            os.write(fd, rest)
        while True:
            ready, _, _ = select.select([conn, fd], [], [], 30)
            if not ready:
                continue
            if conn in ready:
                data = conn.recv(65536)
                if not data:
                    break
                os.write(fd, data)
            if fd in ready:
                try:
                    data = os.read(fd, 65536)
                except OSError:
                    break
                if not data:
                    break
                conn.sendall(data)
    finally:
        try:
            conn.close()
        except Exception:
            pass
        try:
            os.kill(pid, signal.SIGHUP)
        except OSError:
            pass
        try:
            os.close(fd)
        except OSError:
            pass
        with lock:
            sessions.pop(sid, None)

def read_line(conn):
    buf = b""
    while b"\\n" not in buf:
        chunk = conn.recv(4096)
        if not chunk:
            return None, b""
        buf += chunk
        if len(buf) > 1000000:
            return None, b""
    line, rest = buf.split(b"\\n", 1)
    return line.decode("utf-8", "replace"), rest

def handle(conn):
    try:
        line, rest = read_line(conn)
        if not line:
            conn.close()
            return
        parts = line.split(" ")
        op = parts[0]
        if op == "PING":
            conn.sendall(b"PONG\\n")
            conn.close()
            return
        if op == "SPAWN" and len(parts) == 5:
            sid = parts[1]
            cols = int(parts[2])
            rows = int(parts[3])
            cmd = base64.b64decode(parts[4]).decode("utf-8")
            pid, fd = spawn(cmd, cols, rows)
            with lock:
                sessions[sid] = (pid, fd)
            conn.sendall(b"OK\\n")
            relay(conn, fd, pid, sid, rest)
            return
        if op == "RESIZE" and len(parts) == 4:
            sid, cols, rows = parts[1], int(parts[2]), int(parts[3])
            with lock:
                item = sessions.get(sid)
            if item:
                setsize(item[1], cols, rows)
            conn.sendall(b"OK\\n")
            conn.close()
            return
        if op == "KILL" and len(parts) == 2:
            with lock:
                item = sessions.pop(parts[1], None)
            if item:
                try:
                    os.kill(item[0], signal.SIGHUP)
                except OSError:
                    pass
            conn.sendall(b"OK\\n")
            conn.close()
            return
        if op == "LIST" and len(parts) == 2:
            raw = base64.b64decode(parts[1]).decode("utf-8", "replace")
            send_json(conn, do_list(raw))
            return
        if op == "FIND" and len(parts) == 3:
            raw = base64.b64decode(parts[1]).decode("utf-8", "replace")
            query = base64.b64decode(parts[2]).decode("utf-8", "replace")
            send_json(conn, do_find(raw, query))
            return
        conn.sendall(b"ERR bad\\n")
        conn.close()
    except Exception as exc:
        try:
            conn.sendall(("ERR %s\\n" % exc).encode())
            conn.close()
        except Exception:
            pass

while True:
    client, _addr = s.accept()
    threading.Thread(target=handle, args=(client,), daemon=True).start()
`.trim();

/** Shell command that starts the broker on a chosen loopback port. The echoed line must not contain the result markers. */
export function brokerLaunchCommand(port: number): string {
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("bad broker port");
  const b64 = Buffer.from(BROKER_PY, "utf8").toString("base64");
  const run = (bin: string) =>
    `env CCC_PORT=${port} ${bin} -c 'import base64; exec(base64.b64decode("${b64}"))'`;
  // `||` works in bash, zsh, and fish. `if/fi` does not.
  return `${run("python3")} || ${run("python")} || printf 'CCC_BROKER_%s\\n' MISSING`;
}

export function brokerSource(): string {
  return BROKER_PY;
}

export interface RemoteFsEntry {
  name: string;
  path: string;
  dir: boolean;
}

export interface RemoteFsListing {
  path: string;
  parent?: string;
  query?: string;
  entries: RemoteFsEntry[];
  error?: string;
}

/** One short request to the broker. The reply is a single line. */
export function brokerRequest(port: number, line: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const sock = net.connect(port, "127.0.0.1");
    const timer = setTimeout(() => {
      sock.destroy();
      reject(new Error("Zeitüberschreitung."));
    }, 8000);
    let buf = Buffer.alloc(0);
    sock.on("connect", () => sock.write(line.endsWith("\n") ? line : `${line}\n`));
    sock.on("data", (chunk: Buffer) => {
      buf = Buffer.concat([buf, chunk]);
      const nl = buf.indexOf(0x0a);
      if (nl < 0) return;
      clearTimeout(timer);
      const text = buf.subarray(0, nl).toString("utf8");
      sock.end();
      resolve(text);
    });
    sock.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

function parseBrokerJson(line: string): RemoteFsListing {
  if (!line.startsWith("OK ")) throw new Error(line.replace(/^ERR\s?/, "") || "Abfrage fehlgeschlagen.");
  const data = JSON.parse(line.slice(3)) as RemoteFsListing;
  return { ...data, entries: data.entries ?? [] };
}

export async function remoteList(port: number, path: string): Promise<RemoteFsListing> {
  const b64 = Buffer.from(path, "utf8").toString("base64");
  return parseBrokerJson(await brokerRequest(port, `LIST ${b64}`));
}

export async function remoteFind(port: number, path: string, query: string): Promise<RemoteFsListing> {
  const root = Buffer.from(path, "utf8").toString("base64");
  const q = Buffer.from(query, "utf8").toString("base64");
  return parseBrokerJson(await brokerRequest(port, `FIND ${root} ${q}`));
}

export interface RemoteCliHandle {
  onData(listener: (data: string) => void): void;
  onExit(listener: (event: { exitCode: number; signal?: number }) => void): void;
  write(data: string): void;
  resize(columns: number, rows: number): void;
  kill(signal?: string): void;
}

function commandLine(op: string, sid: string, extra = ""): string {
  return extra ? `${op} ${sid} ${extra}\n` : `${op} ${sid}\n`;
}

/** Attach one remote CLI to the broker listening on 127.0.0.1:`port`. */
export function openRemoteCli(opts: {
  port: number;
  command: string;
  cols: number;
  rows: number;
}): RemoteCliHandle {
  const sid = `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  let onData: (data: string) => void = () => {};
  let onExit: (event: { exitCode: number }) => void = () => {};
  let exited = false;
  let header = true;
  const queued: string[] = [];
  const exit = (code: number) => {
    if (exited) return;
    exited = true;
    onExit({ exitCode: code });
  };
  const sock = net.connect(opts.port, "127.0.0.1");
  const decoder = new TextDecoder("utf-8");
  let headerBuf = Buffer.alloc(0);
  const b64 = Buffer.from(opts.command, "utf8").toString("base64");
  sock.on("connect", () => {
    sock.write(`SPAWN ${sid} ${Math.max(2, opts.cols)} ${Math.max(1, opts.rows)} ${b64}\n`);
  });
  sock.on("data", (chunk: Buffer) => {
    if (!header) {
      const text = decoder.decode(chunk, { stream: true });
      if (text) onData(text);
      return;
    }
    headerBuf = Buffer.concat([headerBuf, chunk]);
    const nl = headerBuf.indexOf(0x0a);
    if (nl < 0) return;
    const line = headerBuf.subarray(0, nl).toString("utf8");
    const rest = headerBuf.subarray(nl + 1);
    header = false;
    headerBuf = Buffer.alloc(0);
    if (line !== "OK") {
      onData(`\r\n${line}\r\n`);
      exit(255);
      sock.destroy();
      return;
    }
    if (rest.length) {
      const text = decoder.decode(rest, { stream: true });
      if (text) onData(text);
    }
    for (const data of queued.splice(0)) sock.write(data);
  });
  sock.on("error", () => exit(255));
  sock.on("close", () => exit(0));

  const poke = (line: string) => {
    const extra = net.connect(opts.port, "127.0.0.1");
    extra.on("connect", () => extra.write(line));
    extra.on("data", () => extra.end());
    extra.on("error", () => extra.destroy());
  };

  return {
    onData(listener) {
      onData = listener;
    },
    onExit(listener) {
      onExit = listener;
    },
    write(data: string) {
      if (exited) return;
      if (header) {
        queued.push(data);
        return;
      }
      sock.write(data);
    },
    resize(columns: number, rows: number) {
      poke(commandLine("RESIZE", sid, `${Math.max(2, columns)} ${Math.max(1, rows)}`));
    },
    kill() {
      poke(commandLine("KILL", sid));
      sock.destroy();
      exit(0);
    },
  };
}
