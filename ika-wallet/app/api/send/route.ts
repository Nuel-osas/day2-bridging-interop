import { getUser } from "@/lib/session";
import { store } from "@/lib/store";
import { sendNative, EVM, type EvmKey } from "@/lib/eth";
export const maxDuration = 300;
export async function POST(req: Request) {
  const user = await getUser(); if (!user) return Response.json({ error: "not signed in" }, { status: 401 });
  const w = store.get(user); if (!w || w.status !== "active") return Response.json({ error: "no wallet yet" }, { status: 400 });
  const { to, amount, chain = "sepolia" } = await req.json(); if (!(chain in EVM)) return Response.json({ error: "unknown chain" }, { status: 400 });
  const steps: string[] = []; const t0 = Date.now(); const stamp = (s: string) => steps.push(`+${((Date.now() - t0) / 1000).toFixed(1)}s  ${s}`);
  try { const { hash, explorer } = await sendNative(w, chain as EvmKey, to, String(amount), stamp); return Response.json({ hash, explorer, steps }); }
  catch (e: any) { const detail = e?.details ?? e?.cause?.details ?? e?.cause?.message ?? ""; return Response.json({ error: [e.shortMessage ?? e.message ?? String(e), detail].filter(Boolean).join(": "), steps }, { status: 500 }); }
}
