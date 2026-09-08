import { getUser } from "@/lib/session";
import { getOrCreateWallet, warmPool } from "@/lib/ika";
import { evmBalances, EVM } from "@/lib/eth";
import { btcBalance } from "@/lib/btc";
import { ndjson } from "@/lib/stream";
export const maxDuration = 300;
export async function GET() {
  const user = await getUser(); if (!user) return Response.json({ error: "not signed in" }, { status: 401 });
  return ndjson(async (emit) => {
    const w = await getOrCreateWallet(user, (s) => emit({ step: s }));
    void warmPool(undefined, w);
    const [evmBal, btcBal] = await Promise.all([evmBalances(w.ethAddress), btcBalance(w.btcAddress)]);
    return { user, wallet: { dwalletId: w.dwalletId, dwalletCapId: w.dwalletCapId, ethAddress: w.ethAddress, btcAddress: w.btcAddress, createdAt: w.createdAt }, balances: { evm: evmBal, testnetBtc: btcBal }, chains: Object.fromEntries(Object.entries(EVM).map(([k, v]) => [k, { label: v.label, symbol: v.symbol, faucet: v.faucet }])) };
  });
}
