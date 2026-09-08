import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
const SECRET = () => process.env.SESSION_SECRET ?? "dev-secret";
const sign = (v: string) => createHmac("sha256", SECRET()).update(v).digest("base64url");
export async function setSession(user: string) { const c = await cookies(); c.set("ika_session", `${Buffer.from(user).toString("base64url")}.${sign(user)}`, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 7 }); }
export async function clearSession() { const c = await cookies(); c.delete("ika_session"); }
export async function getUser(): Promise<string | null> {
  const c = await cookies(); const v = c.get("ika_session")?.value; if (!v) return null;
  const [b, mac] = v.split("."); const user = Buffer.from(b, "base64url").toString();
  const good = Buffer.from(sign(user)); const given = Buffer.from(mac ?? "");
  return good.length === given.length && timingSafeEqual(good, given) ? user : null;
}
