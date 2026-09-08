import { clearSession } from "@/lib/session";
export const POST = async () => { await clearSession(); return Response.json({ ok: true }); };
