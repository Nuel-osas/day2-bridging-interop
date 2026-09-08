import { getUser } from "@/lib/session";
import { getOrCreateWallet } from "@/lib/ika";
import { ethBalance } from "@/lib/eth";
import { btcBalance } from "@/lib/btc";
export const maxDuration = 300;
export async function GET() {
  const user = await getUser(); if (!user) return Response.json({ error: "not signed in" }, { status: 401 });
  const steps: string[] = [];
  try {
    const w = await getOrCreateWallet(user, (s) => steps.push(s));
    const [ethBal, btcBal] = await Promise.all([ethBalance(w.ethAddress), btcBalance(w.btcAddress)]);
    return Response.json({ user, wallet: { dwalletId: w.dwalletId, dwalletCapId: w.dwalletCapId, ethAddress: w.ethAddress, btcAddress: w.btcAddress, createdAt: w.createdAt }, balances: { sepoliaEth: ethBal, testnetBtc: btcBal }, steps });
  } catch (e: any) { return Response.json({ error: String(e.message ?? e), steps }, { status: 500 }); }
}
