import net from "node:net";
import { viewFromBuffer, type FileView } from "../file-view";

/**
 * One Python process on the server, started from the already authenticated ssh
 * shell. Later code CLIs attach to it through a local forward on that same ssh
 * client. A second `ssh` would be rejected: this server asks for
 * keyboard-interactive again and BatchMode exits 255.
 */

const BROKER_PY = `
import base64, json, fcntl, os, pty, re, select, shutil, signal, socket, stat, struct, termios, threading
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

def do_read(raw):
    path = safe_path(raw)
    if not os.path.isfile(path):
        return {"error": "Keine Datei.", "path": path}
    size = os.path.getsize(path)
    name = os.path.basename(path)
    if size > 8 * 1024 * 1024:
        return {"path": path, "name": name, "size": size, "tooLarge": True}
    with open(path, "rb") as handle:
        data = handle.read()
    return {"path": path, "name": name, "size": size, "b64": base64.b64encode(data).decode("ascii")}

def do_write(raw, payload):
    path = safe_path(raw)
    if os.path.isdir(path):
        return {"error": "Ordner kann nicht gespeichert werden.", "path": path}
    try:
        data = base64.b64decode(payload)
    except Exception:
        return {"error": "Inhalt ungueltig.", "path": path}
    if len(data) > 2 * 1024 * 1024:
        return {"error": "Datei zu gross.", "path": path}
    parent = os.path.dirname(path)
    if parent and not os.path.isdir(parent):
        return {"error": "Ordner fehlt.", "path": path}
    with open(path, "wb") as handle:
        handle.write(data)
    return {"ok": True, "path": path}

MAX_TRANSFER = 10 * 1024 * 1024 * 1024

def split_rel(rel):
    text = rel or ""
    if "\\x00" in text:
        return None
    text = text.replace("\\\\", "/")
    parts = []
    for part in text.split("/"):
        if part in ("", "."):
            continue
        if part == "..":
            return None
        parts.append(part)
    return parts

def inside(root, probe):
    sep = os.sep
    base = root.rstrip(sep) or sep
    if probe == base:
        return True
    prefix = sep if base == sep else base + sep
    return probe.startswith(prefix)

def dest_under(root_raw, rel, allow_empty):
    root = safe_path(root_raw)
    if not os.path.isdir(root):
        return None
    root = os.path.realpath(root)
    parts = split_rel(rel)
    if parts is None:
        return None
    if not parts:
        return root if allow_empty else None
    parent = root
    for part in parts[:-1]:
        nxt = os.path.join(parent, part)
        if os.path.islink(nxt):
            return None
        if not os.path.isdir(nxt):
            try:
                os.mkdir(nxt, 0o755)
            except OSError:
                if not os.path.isdir(nxt) or os.path.islink(nxt):
                    return None
        parent = os.path.realpath(nxt)
        if not inside(root, parent):
            return None
    dest = os.path.join(parent, parts[-1])
    if os.path.islink(dest) or not inside(root, dest):
        return None
    return dest

def discard_exact(conn, n, rest):
    left = n
    if rest:
        take = min(len(rest), left)
        left -= take
    while left > 0:
        chunk = conn.recv(min(1024 * 1024, left))
        if not chunk:
            return False
        left -= len(chunk)
    return True

def write_exact(conn, n, rest, handle):
    left = n
    if rest:
        take = rest[:left]
        if take:
            handle.write(take)
            left -= len(take)
    while left > 0:
        chunk = conn.recv(min(1024 * 1024, left))
        if not chunk:
            return False
        handle.write(chunk)
        left -= len(chunk)
    return True

def do_rmset(root_raw, rel):
    if not re.match(r"^image_set[A-Za-z]+$", rel or ""):
        return {"error": "Nur Bildordner."}
    dest = dest_under(root_raw, rel, False)
    if not dest or os.path.islink(dest) or not os.path.isdir(dest):
        return {"error": "Ordner fehlt."}
    root = os.path.realpath(safe_path(root_raw))
    probe = os.path.realpath(dest)
    if probe == root or not inside(root, probe):
        return {"error": "Pfad ungueltig."}
    try:
        shutil.rmtree(probe)
    except OSError as exc:
        return {"error": str(exc)}
    return {"ok": True}

def do_mkdir(root_raw, rel):
    dest = dest_under(root_raw, rel, False)
    if not dest:
        return {"error": "Pfad ungueltig."}
    try:
        if not os.path.isdir(dest):
            os.mkdir(dest, 0o755)
    except OSError as exc:
        return {"error": str(exc)}
    return {"ok": True, "path": dest}

def do_put(conn, root_raw, rel, size, rest):
    if size < 0 or size > MAX_TRANSFER:
        try:
            conn.sendall(b"ERR Maximal 10 GB.\\n")
            conn.close()
        except Exception:
            pass
        return
    dest = dest_under(root_raw, rel, False)
    if not dest:
        discard_exact(conn, size, rest)
        try:
            conn.sendall(b"ERR Pfad ungueltig.\\n")
            conn.close()
        except Exception:
            pass
        return
    flags = os.O_WRONLY | os.O_CREAT | os.O_TRUNC
    if hasattr(os, "O_NOFOLLOW"):
        flags |= os.O_NOFOLLOW
    ok = False
    try:
        fd = os.open(dest, flags, 0o644)
    except OSError as exc:
        discard_exact(conn, size, rest)
        try:
            conn.sendall(("ERR %s\\n" % exc).encode())
            conn.close()
        except Exception:
            pass
        return
    try:
        with os.fdopen(fd, "wb") as handle:
            ok = write_exact(conn, size, rest, handle)
    except Exception:
        ok = False
    if not ok:
        try:
            os.remove(dest)
        except OSError:
            pass
        try:
            conn.sendall(b"ERR Uebertragung unvollstaendig.\\n")
            conn.close()
        except Exception:
            pass
        return
    send_json(conn, {"ok": True, "path": dest, "size": size})

def send_file(conn, path):
    if not os.path.isfile(path):
        conn.sendall(b"ERR Keine Datei.\\n")
        conn.close()
        return
    try:
        size = os.path.getsize(path)
    except OSError as exc:
        conn.sendall(("ERR %s\\n" % exc).encode())
        conn.close()
        return
    if size > MAX_TRANSFER:
        conn.sendall(b"ERR Maximal 10 GB.\\n")
        conn.close()
        return
    conn.sendall(("OK %d\\n" % size).encode())
    try:
        with open(path, "rb") as handle:
            left = size
            while left > 0:
                chunk = handle.read(min(1024 * 1024, left))
                if not chunk:
                    break
                conn.sendall(chunk)
                left -= len(chunk)
    except Exception:
        pass
    try:
        conn.close()
    except Exception:
        pass

def b64s(text):
    return base64.b64encode(text.encode("utf-8")).decode("ascii")

def send_walk(conn, raw):
    root = safe_path(raw)
    if os.path.isfile(root):
        try:
            size = os.path.getsize(root)
        except OSError as exc:
            conn.sendall(("ERR %s\\n" % exc).encode())
            conn.close()
            return
        if size > MAX_TRANSFER:
            conn.sendall(b"ERR Maximal 10 GB.\\n")
            conn.close()
            return
        name = os.path.basename(root) or "download"
        conn.sendall(("FILE %d %s\\n" % (size, b64s(name))).encode())
        conn.sendall(("END 1 %d\\n" % size).encode())
        conn.close()
        return
    if not os.path.isdir(root):
        conn.sendall(b"ERR Kein Ordner.\\n")
        conn.close()
        return
    root_real = os.path.realpath(root)
    total = 0
    count = 0
    for dirpath, dirnames, filenames in os.walk(root):
        kept = []
        for name in sorted(dirnames):
            full = os.path.join(dirpath, name)
            if os.path.islink(full):
                continue
            if inside(root_real, os.path.realpath(full)):
                kept.append(name)
        dirnames[:] = kept
        here = os.path.realpath(dirpath)
        if here != root_real:
            conn.sendall(("DIR %s\\n" % b64s(os.path.relpath(dirpath, root))).encode())
        for name in sorted(filenames):
            full = os.path.join(dirpath, name)
            try:
                lst = os.lstat(full)
            except OSError:
                continue
            if stat.S_ISLNK(lst.st_mode):
                try:
                    st = os.stat(full)
                    real = os.path.realpath(full)
                except OSError:
                    continue
                if not stat.S_ISREG(st.st_mode) or not inside(root_real, real):
                    continue
                size = st.st_size
            elif stat.S_ISREG(lst.st_mode):
                if not inside(root_real, os.path.realpath(full)):
                    continue
                size = lst.st_size
            else:
                continue
            total += size
            if total > MAX_TRANSFER:
                conn.sendall(b"ERR Maximal 10 GB.\\n")
                conn.close()
                return
            conn.sendall(("FILE %d %s\\n" % (size, b64s(os.path.relpath(full, root)))).encode())
            count += 1
    conn.sendall(("END %d %d\\n" % (count, total)).encode())
    conn.close()

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
        if len(buf) > 12000000:
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
        if op == "READ" and len(parts) == 2:
            raw = base64.b64decode(parts[1]).decode("utf-8", "replace")
            send_json(conn, do_read(raw))
            return
        if op == "WRITE" and len(parts) == 3:
            raw = base64.b64decode(parts[1]).decode("utf-8", "replace")
            send_json(conn, do_write(raw, parts[2]))
            return

        if op == "PUT" and len(parts) == 4:
            root = base64.b64decode(parts[1]).decode("utf-8", "replace")
            rel = base64.b64decode(parts[2]).decode("utf-8", "replace")
            if len(parts[3]) > 20:
                conn.sendall(b"ERR Groesse ungueltig.\\n")
                conn.close()
                return
            try:
                size = int(parts[3])
            except ValueError:
                conn.sendall(b"ERR Groesse ungueltig.\\n")
                conn.close()
                return
            do_put(conn, root, rel, size, rest)
            return
        if op == "MKDIR" and len(parts) == 3:
            root = base64.b64decode(parts[1]).decode("utf-8", "replace")
            rel = base64.b64decode(parts[2]).decode("utf-8", "replace")
            send_json(conn, do_mkdir(root, rel))
            return
        if op == "RMSET" and len(parts) == 3:
            root = base64.b64decode(parts[1]).decode("utf-8", "replace")
            rel = base64.b64decode(parts[2]).decode("utf-8", "replace")
            send_json(conn, do_rmset(root, rel))
            return
        if op == "GET" and len(parts) == 2:
            raw = base64.b64decode(parts[1]).decode("utf-8", "replace")
            send_file(conn, safe_path(raw))
            return
        if op == "WALK" and len(parts) == 2:
            raw = base64.b64decode(parts[1]).decode("utf-8", "replace")
            send_walk(conn, raw)
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
export function brokerRequest(port: number, line: string, timeoutMs = 8000): Promise<string> {
  return new Promise((resolve, reject) => {
    const sock = net.connect(port, "127.0.0.1");
    const timer = setTimeout(() => {
      sock.destroy();
      reject(new Error("Zeitüberschreitung."));
    }, timeoutMs);
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

interface RemoteFilePayload {
  path?: string;
  name?: string;
  size?: number;
  b64?: string;
  tooLarge?: boolean;
  error?: string;
  ok?: boolean;
}

function parseBrokerPayload<T>(line: string): T {
  if (!line.startsWith("OK ")) throw new Error(line.replace(/^ERR\s?/, "") || "Abfrage fehlgeschlagen.");
  return JSON.parse(line.slice(3)) as T;
}

export async function remoteReadFile(port: number, filePath: string): Promise<FileView> {
  const b64 = Buffer.from(filePath, "utf8").toString("base64");
  const data = parseBrokerPayload<RemoteFilePayload>(await brokerRequest(port, `READ ${b64}`, 30000));
  if (data.error) throw new Error(data.error);
  const name = data.name || filePath.split(/[\\/]/).filter(Boolean).pop() || filePath;
  const resolved = data.path || filePath;
  if (data.tooLarge) {
    return { path: resolved, name, size: data.size ?? 0, kind: "binary", tooLarge: true };
  }
  const buf = Buffer.from(data.b64 || "", "base64");
  return viewFromBuffer(resolved, name, buf);
}

export async function remoteWriteFile(port: number, filePath: string, content: string): Promise<void> {
  const pathB64 = Buffer.from(filePath, "utf8").toString("base64");
  const bodyB64 = Buffer.from(content, "utf8").toString("base64");
  const data = parseBrokerPayload<RemoteFilePayload>(
    await brokerRequest(port, `WRITE ${pathB64} ${bodyB64}`, 30000),
  );
  if (data.error || !data.ok) throw new Error(data.error || "Speichern fehlgeschlagen.");
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
