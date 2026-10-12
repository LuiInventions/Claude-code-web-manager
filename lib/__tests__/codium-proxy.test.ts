import http from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { startCodiumProxy } from "../server/codium-proxy";

function listen(server: http.Server): Promise<number> {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      resolve(typeof addr === "object" && addr ? addr.port : 0);
    });
  });
}

describe("codium proxy", () => {
  const close: Array<() => void> = [];
  afterEach(() => {
    for (const stop of close) stop();
    close.length = 0;
  });

  it("drops the headers that would block the iframe and keeps the path", async () => {
    const origin = http.createServer((req, res) => {
      res.writeHead(200, {
        "content-type": "text/plain",
        "x-frame-options": "DENY",
        "content-security-policy": "frame-ancestors 'none'",
        "content-security-policy-report-only": "default-src 'none'",
      });
      res.end(`ok ${req.url}`);
    });
    const port = await listen(origin);
    close.push(() => origin.close());
    const proxy = await startCodiumProxy(port);
    close.push(proxy.close);

    const res = await fetch(`http://127.0.0.1:${proxy.port}/?tkn=abc`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("ok /?tkn=abc");
    expect(res.headers.get("x-frame-options")).toBeNull();
    expect(res.headers.get("content-security-policy")).toBeNull();
    expect(res.headers.get("content-security-policy-report-only")).toBeNull();
  });
});
