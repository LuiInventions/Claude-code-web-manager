import { describe, expect, it } from "vitest";
import {
  buildCodiumRemoteScript,
  buildRemoteCliCommand,
  codiumServeArgs,
  classifySshTail,
  parseCodiumOutput,
  parseLoginTarget,
  remoteServerId,
  shellQuote,
  sshBaseArgs,
} from "../remote-ssh";

describe("remote ssh login", () => {
  it("uses user@host as the saved server id", () => {
    expect(remoteServerId("luis", "10.0.0.8")).toBe("luis@10.0.0.8");
  });

  it("accepts an IP and a user@host paste", () => {
    expect(parseLoginTarget("10.0.0.8", "luis")).toEqual({ user: "luis", host: "10.0.0.8" });
    expect(parseLoginTarget("luis@10.0.0.8", "")).toEqual({ user: "luis", host: "10.0.0.8" });
  });

  it("builds serve-web flags only when the help text lists them", () => {
    expect(codiumServeArgs("serve-web --host --port", 43100)).toEqual([
      "serve-web",
      "--host",
      "127.0.0.1",
      "--port",
      "43100",
    ]);
    expect(codiumServeArgs("without-connection-token accept-server-license-terms", 1)).toEqual([
      "serve-web",
      "--host",
      "127.0.0.1",
      "--port",
      "1",
      "--without-connection-token",
      "--accept-server-license-terms",
    ]);
    expect(() => codiumServeArgs("serve-web", 0)).toThrow();
  });

  it("rejects option injection and a missing user", () => {
    expect(parseLoginTarget("-oProxyCommand=calc", "luis")).toEqual({ error: "IP ist ungültig." });
    expect(parseLoginTarget("10.0.0.8", "")).toEqual({ error: "Benutzer fehlt." });
    expect(parseLoginTarget("10.0.0.8", "lu is")).toEqual({ error: "Benutzer enthält ungültige Zeichen." });
    expect(parseLoginTarget("999.1.1.1", "luis")).toEqual({ error: "IP ist ungültig." });
  });

  it("classifies password, 2FA, host key, and a rejected login", () => {
    expect(classifySshTail("luis@10.0.0.8's password: ")).toBe("password");
    expect(classifySshTail("(luis@host) Verification code:")).toBe("otp");
    expect(classifySshTail("Enter a passcode or select one of the following")).toBe("otp");
    expect(classifySshTail("Are you sure you want to continue connecting (yes/no/[fingerprint])?")).toBe("hostkey");
    expect(classifySshTail("Permission denied, please try again.")).toBe("denied");
  });

  it("builds a remote CLI command without putting the prompt through a local shell", () => {
    const cmd = buildRemoteCliCommand({
      cwd: "~/src/app",
      bin: "grok",
      args: ["--permission-mode", "bypassPermissions", "fix it's bug"],
      cli: "grok",
    });
    expect(cmd).toContain(`cd "$HOME"/'src/app'`);
    expect(cmd).toContain("exec 'grok' '--permission-mode' 'bypassPermissions' 'fix it'\\''s bug'");
    expect(cmd).not.toContain("DISABLE_AUTOUPDATER");
  });

  it("quotes Claude's updater skip into the remote command only", () => {
    const cmd = buildRemoteCliCommand({
      cwd: "~",
      bin: "claude",
      args: ["--dangerously-skip-permissions"],
      cli: "claude",
    });
    expect(cmd.startsWith("export LANG=C.UTF-8 ")).toBe(true);
    expect(cmd).toContain("DISABLE_AUTOUPDATER=1 ");
    expect(cmd).not.toContain("cd ");
  });

  it("keeps the password out of ssh argv and the codium script", () => {
    const args = sshBaseArgs({ knownHosts: "/tmp/known_hosts" });
    const joined = args.join(" ");
    expect(joined).not.toContain("s3cret-value");
    expect(joined).not.toMatch(/sshpass|-pw\b/);
    expect(joined).toContain("PubkeyAuthentication=no");
    const script = buildCodiumRemoteScript(43111);
    expect(script).toContain("--port 43111");
    expect(script).toContain("CCC_CODIUM_MISSING");
    expect(() => buildCodiumRemoteScript(0)).toThrow();
  });

  it("reads the serve-web URL and a missing binary", () => {
    expect(parseCodiumOutput("Web UI available at http://127.0.0.1:43111/?tkn=abc")).toEqual({
      missing: false,
      ready: true,
      port: 43111,
      path: "/?tkn=abc",
    });
    expect(parseCodiumOutput("CCC_CODIUM_PORT 43111")).toMatchObject({ ready: false, missing: false });
    expect(parseCodiumOutput("CCC_CODIUM_MISSING\n")).toMatchObject({ missing: true });
  });

  it("shell-quotes an empty string", () => {
    expect(shellQuote("")).toBe("''");
  });
});
