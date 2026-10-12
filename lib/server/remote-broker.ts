import net from "node:net";

/**
 * One Python process on the server, started from the already authenticated ssh
 * shell. Later code CLIs attach to it through a local forward on that same ssh
 * client. A second `ssh` would be rejected: this server asks for
 * keyboard-interactive again and BatchMode exits 255.
 */

const BROKER_PY = `
import base64, fcntl, os, pty, select, signal, socket, struct, termios, threading
s = socket.socket()
s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
s.bind(("127.0.0.1", 0))
s.listen(16)
print("CCC_BROKER %d" % s.getsockname()[1], flush=True)
lock = threading.Lock()
sessions = {}

def setsize(fd, cols, rows):
    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", int(rows), int(cols), 0, 0))

def spawn(cmd, cols, rows):
    pid, fd = pty.fork()
    if pid == 0:
        os.environ["TERM"] = "xterm-256color"
        os.execvp("bash", ["bash", "-lc", cmd])
    setsize(fd, cols, rows)
    return pid, fd

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

/** Shell command that starts the broker. The echoed line must not contain the result markers. */
export function brokerLaunchCommand(): string {
  const b64 = Buffer.from(BROKER_PY, "utf8").toString("base64");
  const py = `python3 -c 'import base64; exec(base64.b64decode("${b64}"))'`;
  const py2 = `python -c 'import base64; exec(base64.b64decode("${b64}"))'`;
  // `||` works in bash, zsh, and fish. `if/fi` does not.
  return `${py} || ${py2} || printf 'CCC_BROKER_%s\\n' MISSING`;
}

export function brokerSource(): string {
  return BROKER_PY;
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
  let pending = "";
  const queued: string[] = [];
  const exit = (code: number) => {
    if (exited) return;
    exited = true;
    onExit({ exitCode: code });
  };
  const sock = net.connect(opts.port, "127.0.0.1");
  sock.setEncoding("latin1");
  const b64 = Buffer.from(opts.command, "utf8").toString("base64");
  sock.on("connect", () => {
    sock.write(`SPAWN ${sid} ${Math.max(2, opts.cols)} ${Math.max(1, opts.rows)} ${b64}\n`, "latin1");
  });
  sock.on("data", (chunk: string) => {
    if (!header) {
      onData(chunk);
      return;
    }
    pending += chunk;
    const nl = pending.indexOf("\n");
    if (nl < 0) return;
    const line = pending.slice(0, nl);
    const rest = pending.slice(nl + 1);
    header = false;
    pending = "";
    if (line !== "OK") {
      onData(`\r\n${line}\r\n`);
      exit(255);
      sock.destroy();
      return;
    }
    if (rest) onData(rest);
    for (const data of queued.splice(0)) sock.write(data, "latin1");
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
      sock.write(data, "latin1");
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
