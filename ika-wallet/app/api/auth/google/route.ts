import { OAuth2Client } from "google-auth-library";
import { setSession } from "@/lib/session";
export async function POST(req: Request) {
  const { credential } = await req.json();
  const clientId = process.env.GOOGLE_CLIENT_ID; if (!clientId) return Response.json({ error: "GOOGLE_CLIENT_ID not configured" }, { status: 400 });
  const ticket = await new OAuth2Client(clientId).verifyIdToken({ idToken: credential, audience: clientId });
  const p = ticket.getPayload(); if (!p?.email) return Response.json({ error: "no email in token" }, { status: 400 });
  await setSession(p.email); return Response.json({ user: p.email });
}
