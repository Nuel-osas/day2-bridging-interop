import { getUser } from "@/lib/session";
import { store } from "@/lib/store";
import { sendNative, EVM, type EvmKey } from "@/lib/eth";
import { ndjson } from "@/lib/stream";
import { sendSol } from "@/lib/sol";
export const maxDuration = 300;
export async function POST(req: Request) {
  const user = await getUser(); if (!user) return Response.json({ error: "not signed in" }, { status: 401 });
  const w = await store.get(user); if (!w || w.status !== "active") return Response.json({ error: "no wallet yet" }, { status: 400 });
  const { to, amount, chain = "sepolia" } = await req.json();
  if (chain === "solana") return ndjson(async (emit) => sendSol(w, to, String(amount), (s) => emit({ step: s })));
  if (!(chain in EVM)) return Response.json({ error: "unknown chain" }, { status: 400 });
  return ndjson(async (emit) => sendNative(w, chain as EvmKey, to, String(amount), (s) => emit({ step: s })));
}
