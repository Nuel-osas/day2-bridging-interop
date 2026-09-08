import { getUser } from "@/lib/session";
import { getOrCreateWallet, warmPool } from "@/lib/ika";
import { ethBalance } from "@/lib/eth";
import { btcBalance } from "@/lib/btc";
export const maxDuration = 300;
export async function GET() {
  const user = await getUser(); if (!user) return Response.json({ error: "not signed in" }, { status: 401 });
  const steps: string[] = []; const t0 = Date.now(); const stamp = (s: string) => steps.push(`+${((Date.now() - t0) / 1000).toFixed(1)}s  ${s}`);
  try {
    const w = await getOrCreateWallet(user, stamp);
    void warmPool(undefined, w);
    const [ethBal, btcBal] = await Promise.all([ethBalance(w.ethAddress), btcBalance(w.btcAddress)]);
    return Response.json({ user, wallet: { dwalletId: w.dwalletId, dwalletCapId: w.dwalletCapId, ethAddress: w.ethAddress, btcAddress: w.btcAddress, createdAt: w.createdAt }, balances: { sepoliaEth: ethBal, testnetBtc: btcBal }, steps });
  } catch (e: any) { return Response.json({ error: String(e.message ?? e), steps }, { status: 500 }); }
}
