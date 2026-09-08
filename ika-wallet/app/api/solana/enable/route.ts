import { getUser } from "@/lib/session";
import { store } from "@/lib/store";
import { ensureSolanaWallet } from "@/lib/ika";
import { ndjson } from "@/lib/stream";
export const maxDuration = 300;
export async function POST() {
  const user = await getUser(); if (!user) return Response.json({ error: "not signed in" }, { status: 401 });
  const w = store.get(user); if (!w || w.status !== "active") return Response.json({ error: "no wallet yet" }, { status: 400 });
  return ndjson(async (emit) => { const sol = await ensureSolanaWallet(w, (s) => emit({ step: s })); return { sol: { address: sol.address, dwalletId: sol.dwalletId } }; });
}
