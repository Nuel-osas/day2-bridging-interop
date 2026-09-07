// Same-chain swap on Sui through LI.FI (routes to Cetus, 7k, Aftermath, Momentum).
// LI.FI returns the PTB bytes already built against your real coin objects; you sign and send.
//   SUI_NETWORK=mainnet pnpm lifi-swap 1.5        # 1.5 SUI -> USDC on Sui
import { fromBase64 } from "@mysten/sui/utils";
import { client, signer, explorer } from "./_sui.mjs";
const SUI_USDC = "0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC";
const amount = Number(process.argv[2] ?? 1.5);
const kp = signer(); const me = kp.toSuiAddress();
const u = new URL("https://li.quest/v1/quote");
Object.entries({ fromChain: 9270000000000000, toChain: 9270000000000000, fromToken: "0x2::sui::SUI", toToken: SUI_USDC, fromAmount: String(BigInt(Math.round(amount * 1e9))), fromAddress: me, toAddress: me, slippage: "0.01" }).forEach(([k, v]) => u.searchParams.set(k, String(v)));
const q = await (await fetch(u)).json();
if (!q.estimate) { console.error(q.message ?? q); process.exit(1); }
console.log(`LI.FI: ${amount} SUI -> ${(Number(q.estimate.toAmount) / 1e6).toFixed(4)} USDC via ${q.tool} (min ${(Number(q.estimate.toAmountMin) / 1e6).toFixed(4)})`);
const bytes = fromBase64(q.transactionRequest.data);
const { signature } = await kp.signTransaction(bytes);
const res = await client.core.executeTransaction({ transaction: bytes, signatures: [signature], include: { effects: true, balanceChanges: true } });
const t = res.Transaction ?? res;
console.log(`status ${JSON.stringify(t.effects?.status)}  ${explorer(t.digest)}`);
for (const b of t.balanceChanges ?? []) console.log(`  ${b.coinType.split("::").pop()} ${b.amount}`);
