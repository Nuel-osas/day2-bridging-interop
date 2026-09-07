// Live quotes into and out of Sui, on the projector, no wallet needed.
//
// Three views of the same market:
//   A. Mayan direct (the only intent protocol with native Sui both ways today)
//   B. Mayan with Swift only (the 2-second auction): Sui is not there yet
//   C. LI.FI (aggregator; wraps Mayan for Sui) and deBridge DLN (best-in-class intents, no Sui)
import { readFileSync, existsSync } from "node:fs";
import { fetchQuote } from "@mayanfinance/swap-sdk";
if (existsSync(".env")) for (const l of readFileSync(".env", "utf8").split("\n")) { const m = l.match(/^([A-Z_]+)=(.*)$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2]; }

const SUI_USDC = "0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC";
const BASE_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const SOL_USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const evm = process.env.EVM_ADDRESS ?? "0x000000000000000000000000000000000000dEaD";
const sui = process.env.SUI_RECIPIENT ?? "0x9a5b0ad3a18964ab7c0dbf9ab4cdecfd6b3899423b47313ae6e78f4b801022a3";
const pad = (s, n) => String(s).padEnd(n);

console.log(`\nA. Mayan direct, ${new Date().toISOString().slice(0, 16)}Z`);
console.log(pad("route", 30), pad("type", 6), pad("out", 16), pad("eta", 8), "relayer fee  protocol bps");
const mayanRoutes = [
  ["100 USDC Base -> Sui USDC", { amountIn64: "100000000", fromToken: BASE_USDC, fromChain: "base", toToken: SUI_USDC, toChain: "sui" }],
  ["100 USDC Solana -> Sui USDC", { amountIn64: "100000000", fromToken: SOL_USDC, fromChain: "solana", toToken: SUI_USDC, toChain: "sui" }],
  ["0.05 ETH Base -> SUI", { amountIn64: "50000000000000000", fromToken: "0x0000000000000000000000000000000000000000", fromChain: "base", toToken: "0x2::sui::SUI", toChain: "sui" }],
  ["100 USDC Sui -> Base USDC", { amountIn64: "100000000", fromToken: SUI_USDC, fromChain: "sui", toToken: BASE_USDC, toChain: "base" }],
  ["2 SUI Sui -> Base USDC", { amountIn64: "2000000000", fromToken: "0x2::sui::SUI", fromChain: "sui", toToken: BASE_USDC, toChain: "base" }],
];
for (const [label, p] of mayanRoutes) {
  try {
    const qs = await fetchQuote({ ...p, slippageBps: "auto" });
    const q = qs[0];
    if (!q) { console.log(pad(label, 30), "no quote"); continue; }
    console.log(pad(label, 30), pad(q.type, 6), pad(q.expectedAmountOut, 16), pad(q.clientEta ?? q.etaSeconds + "s", 8), pad(q.redeemRelayerFee, 12), q.protocolBps);
  } catch (e) { console.log(pad(label, 30), "error:", (e.message ?? e).toString().slice(0, 80)); }
}

console.log("\nB. Same routes, Swift only (the pure solver auction):");
for (const [label, p] of mayanRoutes.slice(0, 2)) {
  const u = new URL("https://price-api.mayan.finance/v3/quote");
  Object.entries({ amountIn64: p.amountIn64, fromToken: p.fromToken, fromChain: p.fromChain, toToken: p.toToken, toChain: p.toChain, slippageBps: "auto", swift: "true", mctp: "false", fastMctp: "false", shuttle: "false", monoChain: "false", sdkVersion: "15_2_2" }).forEach(([k, v]) => u.searchParams.set(k, v));
  const d = await (await fetch(u)).json();
  console.log(pad(label, 30), d.quotes?.[0]?.type ?? `${d.code}: ${d.msg}`);
}
console.log("Sui is reachable by MCTP (Circle CCTP underneath, 15 to 20 min from EVM, 1 min from Solana), not yet by the auction.");

console.log("\nC. LI.FI (aggregator) into Sui, and deBridge DLN (intents) control:");
{
  const u = new URL("https://li.quest/v1/quote");
  Object.entries({ fromChain: 8453, toChain: 9270000000000000, fromToken: BASE_USDC, toToken: SUI_USDC, fromAmount: "100000000", fromAddress: evm, toAddress: sui, slippage: "0.005" }).forEach(([k, v]) => u.searchParams.set(k, String(v)));
  const d = await (await fetch(u)).json();
  if (d.estimate) console.log(pad("LI.FI 100 USDC Base -> Sui", 30), pad(d.tool, 12), pad((Number(d.estimate.toAmount) / 1e6).toFixed(6) + " USDC", 16), pad(Math.round(d.estimate.executionDuration / 60) + " min", 8), "LI.FI fee", d.estimate.feeCosts?.[0]?.amountUSD, "USD");
  else console.log(pad("LI.FI 100 USDC Base -> Sui", 30), d.message);
}
{
  const ctl = new URL("https://dln.debridge.finance/v1.0/dln/order/create-tx");
  Object.entries({ srcChainId: 8453, srcChainTokenIn: BASE_USDC, srcChainTokenInAmount: "100000000", dstChainId: 7565164, dstChainTokenOut: SOL_USDC, dstChainTokenOutAmount: "auto", dstChainTokenOutRecipient: "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM", senderAddress: evm, srcChainOrderAuthorityAddress: evm, dstChainOrderAuthorityAddress: "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM", prependOperatingExpenses: "true" }).forEach(([k, v]) => ctl.searchParams.set(k, String(v)));
  const d = await (await fetch(ctl)).json();
  const e = d.estimation;
  if (e) console.log(pad("deBridge 100 USDC Base -> Solana", 30), pad("DLN", 12), pad((Number(e.dstChainTokenOut?.amount) / 1e6).toFixed(6) + " USDC", 16), pad((d.order?.approximateFulfillmentDelay ?? "?") + " s", 8), "protocol", e.costsDetails?.find((c) => c.type === "DlnProtocolFee")?.payload?.feeBps ?? "?", "bps, taker", e.costsDetails?.find((c) => c.type === "TakerMargin")?.payload?.feeBps ?? "?", "bps");
  else console.log(pad("deBridge control", 30), JSON.stringify(d).slice(0, 120));
  const chains = await (await fetch("https://dln.debridge.finance/v1.0/supported-chains-info")).json();
  const names = (chains.chains ?? chains).map((c) => c.chainName);
  console.log(pad("deBridge chains with Sui?", 30), names.some((n) => /sui/i.test(n)) ? "yes" : `no (${names.length} chains, none is Sui)`);
}
console.log("\nLesson: the fastest intent bridges do not reach Sui yet. What reaches Sui is Mayan MCTP, which every aggregator wraps. Out of Sui is already fast: about a minute quoted, 11 to 20 s observed.");
