import { getUser } from "@/lib/session";
export const GET = async () => Response.json({ user: await getUser() });
