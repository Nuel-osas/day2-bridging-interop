import { setSession } from "@/lib/session";
export async function POST(req: Request) { const { email } = await req.json(); if (!/^[^@\s]+@[^@\s]+$/.test(email ?? "")) return Response.json({ error: "enter an email" }, { status: 400 }); await setSession(email.toLowerCase()); return Response.json({ user: email.toLowerCase() }); }
