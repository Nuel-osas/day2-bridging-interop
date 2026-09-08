import { getUser } from "@/lib/session";
import { store } from "@/lib/store";
import { solAirdrop } from "@/lib/sol";
export async function POST() {
  const user = await getUser(); if (!user) return Response.json({ error: "not signed in" }, { status: 401 });
  const w = store.get(user); if (!w?.sol?.address) return Response.json({ error: "enable solana first" }, { status: 400 });
  try { const sig = await solAirdrop(w.sol.address); return Response.json({ sig, explorer: `https://explorer.solana.com/tx/${sig}?cluster=devnet` }); }
  catch (e: any) { return Response.json({ error: String(e.message ?? e).slice(0, 200) }, { status: 500 }); }
}
