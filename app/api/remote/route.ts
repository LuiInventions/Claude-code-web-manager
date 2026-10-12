import type { NextRequest } from "next/server";
import {
  connectRemote,
  disconnectRemote,
  remoteStatus,
  retryCodium,
  setRemoteDir,
  submitRemoteOtp,
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
  if (action === "codium") {
    return Response.json(await retryCodium());
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
  if (action !== "connect") {
    return Response.json({ error: "Unbekannte Aktion." }, { status: 400 });
  }

  const now = remoteStatus();
  if (now.connecting || now.connected) {
    return Response.json(now, { status: 409 });
  }
  const status = await connectRemote({
    host: typeof body.host === "string" ? body.host : "",
    user: typeof body.user === "string" ? body.user : "",
    password: typeof body.password === "string" ? body.password : "",
    otp: typeof body.otp === "string" ? body.otp : "",
    saveLogin: body.saveLogin === true,
    dir: typeof body.dir === "string" ? body.dir : "",
  });
  if (!status.connected) return Response.json(status, { status: 400 });
  return Response.json(status);
}
