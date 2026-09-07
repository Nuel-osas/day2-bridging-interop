// The live intent fill: send from Sui to Base through Mayan and watch it redeem in seconds.
//
//   pnpm mayan                       quote only (Sui USDC -> Base USDC, or SUI -> Base USDC with --sui)
//   pnpm mayan --execute 2           send 2 units for real (mainnet, small), then poll the explorer
//
// Needs: SUI_NETWORK=mainnet, a Sui wallet with the input token plus a little SUI for gas,
// and an EVM address to receive on Base (EVM_ADDRESS in .env or --to 0x...).
import { fetchQuote, createSwapFromSuiMoveCalls } from "@mayanfinance/swap-sdk";
import { client, signer, explorer } from "./_sui.mjs";

const args = process.argv.slice(2);
const execute = args.includes("--execute");
const useSui = args.includes("--sui");
const amountArg = args.find((a) => /^\d+(\.\d+)?$/.test(a));
const to = args[args.indexOf("--to") + 1] && args.includes("--to") ? args[args.indexOf("--to") + 1] : process.env.EVM_ADDRESS;

const SUI_USDC = "0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC";
const BASE_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const fromToken = useSui ? "0x2::sui::SUI" : SUI_USDC;
const decimals = useSui ? 9 : 6;
const amount = Number(amountArg ?? (useSui ? 2 : 5));
const kp = signer();
const me = kp.toSuiAddress();

if (process.env.SUI_NETWORK !== "mainnet") { console.error("Mayan has no testnet. Run with SUI_NETWORK=mainnet."); process.exit(1); }

const quotes = await fetchQuote({ amountIn64: BigInt(Math.round(amount * 10 ** decimals)).toString(), fromToken, fromChain: "sui", toToken: BASE_USDC, toChain: "base", slippageBps: "auto" });
const q = quotes[0];
if (!q) { console.error("no quote"); process.exit(1); }
console.log(`quote: ${amount} ${useSui ? "SUI" : "USDC"} on Sui -> ${q.expectedAmountOut} USDC on Base   type ${q.type}   eta ${q.clientEta ?? q.etaSeconds + "s"}   relayer fee ${q.redeemRelayerFee} USDC   min out ${q.minAmountOut}`);
console.log(`from ${me} to ${to}`);
if (!execute) { console.log("\nquote only. add --execute to send."); process.exit(0); }

const tx = await createSwapFromSuiMoveCalls(q, me, to, null, null, client);
tx.setSender(me);
const res = await client.signAndExecuteTransaction({ transaction: tx, signer: kp, include: { effects: true } });
const digest = res.Transaction?.digest ?? res.digest;
console.log(`sent on Sui: ${explorer(digest)}`);
console.log("polling Mayan explorer...");
const t0 = Date.now();
for (let i = 0; i < 120; i++) {
  await new Promise((r) => setTimeout(r, 3000));
  const r = await fetch(`https://explorer-api.mayan.finance/v3/swap/trx/${digest}`);
  if (r.status !== 200) { process.stdout.write("."); continue; }
  const s = await r.json();
  const secs = ((Date.now() - t0) / 1000).toFixed(0);
  console.log(`[${secs}s] ${s.clientStatus ?? s.status}  ${s.fulfillTxHash ? "fill tx " + s.fulfillTxHash : ""}${s.redeemTxHash ? " redeem tx " + s.redeemTxHash : ""}`);
  if (["COMPLETED", "REFUNDED"].includes(s.clientStatus)) { console.log(`https://explorer.mayan.finance/swap/${digest}`); break; }
}
