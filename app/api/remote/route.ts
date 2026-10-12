import type { NextRequest } from "next/server";
import {
  beginRemote,
  disconnectRemote,
  remoteStatus,
  setRemoteDir,
  submitRemoteOtp,
  submitRemotePassword,
} from "@/lib/server/remote-session";

export const dynamic = "force-dynamic";

/** Status only. The password and the 2FA code are never part of this JSON. */
export async function GET() {
  return Response.json(remoteStatus());
}

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Ungültige Anfrage." }, { status: 400 });
  }
  // Do not log `body`: it can contain the SSH password and a 2FA code.
  const action = typeof body.action === "string" ? body.action : "";

  if (action === "disconnect") {
    await disconnectRemote();
    return Response.json(remoteStatus());
  }
  if (action === "dir") {
    const dir = typeof body.dir === "string" && body.dir.trim() ? body.dir.trim() : "~";
    setRemoteDir(dir);
    return Response.json(remoteStatus());
  }
  if (action === "otp") {
    const status = submitRemoteOtp(typeof body.otp === "string" ? body.otp : "");
    if (status.error && !status.needsOtp) return Response.json(status, { status: 400 });
    return Response.json(status);
  }
  if (action === "password") {
    const status = submitRemotePassword({
      password: typeof body.password === "string" ? body.password : "",
      saveLogin: body.saveLogin === true,
      useSaved: body.useSaved === true,
    });
    if (status.error && !status.needsPassword) return Response.json(status, { status: 400 });
    return Response.json(status);
  }
  if (action !== "begin") {
    return Response.json({ error: "Unbekannte Aktion." }, { status: 400 });
  }

  const now = remoteStatus();
  if (now.connecting || now.connected) {
    return Response.json(now, { status: 409 });
  }
  const status = await beginRemote({
    host: typeof body.host === "string" ? body.host : "",
    user: typeof body.user === "string" ? body.user : "",
    dir: typeof body.dir === "string" ? body.dir : "",
  });
  if (status.error && !status.connecting) return Response.json(status, { status: 400 });
  return Response.json(status);
}
