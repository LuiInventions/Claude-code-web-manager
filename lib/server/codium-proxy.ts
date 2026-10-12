import http from "node:http";
import net from "node:net";

/**
 * Loopback reverse proxy in front of the SSH tunnel. VS Codium's serve-web
 * binds on the server and often refuses to be framed. The iframe loads this
 * proxy, which drops those headers, and absolute paths keep working because
 * the proxy is the origin (not a path prefix on the control center).
 */
export function startCodiumProxy(targetPort: number): Promise<{ port: number; close: () => void }> {
  const server = http.createServer((req, res) => {
    const headers = { ...req.headers, host: `127.0.0.1:${targetPort}` };
    const upstream = http.request(
      {
        host: "127.0.0.1",
        port: targetPort,
        method: req.method,
        path: req.url,
        headers,
      },
      (up) => {
        const out: http.OutgoingHttpHeaders = { ...up.headers };
        delete out["x-frame-options"];
        delete out["content-security-policy"];
        delete out["content-security-policy-report-only"];
        res.writeHead(up.statusCode || 502, out);
        up.pipe(res);
      },
    );
    upstream.on("error", () => {
      if (!res.headersSent) res.writeHead(502, { "content-type": "text/plain" });
      res.end("VS Codium ist nicht erreichbar.");
    });
    req.pipe(upstream);
  });

  server.on("upgrade", (req, socket, head) => {
    const remote = net.connect(targetPort, "127.0.0.1", () => {
      let header = `${req.method} ${req.url} HTTP/1.1\r\n`;
      for (const [key, value] of Object.entries(req.headers)) {
        if (value == null || key.toLowerCase() === "host") continue;
        const v = Array.isArray(value) ? value.join(", ") : value;
        header += `${key}: ${v}\r\n`;
      }
      header += `host: 127.0.0.1:${targetPort}\r\n\r\n`;
      remote.write(header);
      if (head.length) remote.write(head);
      socket.pipe(remote);
      remote.pipe(socket);
    });
    const fail = () => {
      socket.destroy();
      remote.destroy();
    };
    remote.on("error", fail);
    socket.on("error", fail);
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      resolve({
        port,
        close: () => {
          server.close();
        },
      });
    });
  });
}
