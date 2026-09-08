import { getUser } from "@/lib/session";
import { store } from "@/lib/store";
import { sendEth } from "@/lib/eth";
export const maxDuration = 300;
export async function POST(req: Request) {
  const user = await getUser(); if (!user) return Response.json({ error: "not signed in" }, { status: 401 });
  const w = store.get(user); if (!w || w.status !== "active") return Response.json({ error: "no wallet yet" }, { status: 400 });
  const { to, amount } = await req.json();
  const steps: string[] = []; const t0 = Date.now(); const stamp = (s: string) => steps.push(`+${((Date.now() - t0) / 1000).toFixed(1)}s  ${s}`);
  try { const hash = await sendEth(w, to, String(amount), stamp); return Response.json({ hash, explorer: `https://sepolia.etherscan.io/tx/${hash}`, steps }); }
  catch (e: any) { const detail = e?.details ?? e?.cause?.details ?? e?.cause?.message ?? ""; return Response.json({ error: [e.shortMessage ?? e.message ?? String(e), detail].filter(Boolean).join(": "), steps }, { status: 500 }); }
}
