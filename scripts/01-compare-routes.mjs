// Live quotes INTO Sui from the aggregators and intent protocols that actually
// answer for Sui today. No wallet needed. Run it on the projector.
//
// LI.FI lists Sui as a Move VM chain (id 9270000000000000) and routes through
// Mayan (MCTP over Circle CCTP, and Swift when available) and Allbridge.
import { readFileSync, existsSync } from "node:fs";
if (existsSync(".env")) for (const l of readFileSync(".env", "utf8").split("\n")) { const m = l.match(/^([A-Z_]+)=(.*)$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2]; }

const SUI = 9270000000000000;
const SUI_USDC = "0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC";
const SUI_NATIVE = "0x2::sui::SUI";
const evm = process.env.EVM_ADDRESS ?? "0x000000000000000000000000000000000000dEaD";
const sol = "11111111111111111111111111111111";
const sui = process.env.SUI_RECIPIENT ?? "0x9a5b0ad3a18964ab7c0dbf9ab4cdecfd6b3899423b47313ae6e78f4b801022a3";

const routes = [
  { label: "100 USDC  Base     -> Sui USDC", fromChain: 8453, fromToken: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", toToken: SUI_USDC, amount: "100000000", from: evm },
  { label: "100 USDC  Arbitrum -> Sui USDC", fromChain: 42161, fromToken: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831", toToken: SUI_USDC, amount: "100000000", from: evm },
  { label: "100 USDC  Ethereum -> Sui USDC", fromChain: 1, fromToken: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", toToken: SUI_USDC, amount: "100000000", from: evm },
  { label: "0.05 ETH  Ethereum -> SUI", fromChain: 1, fromToken: "0x0000000000000000000000000000000000000000", toToken: SUI_NATIVE, amount: "50000000000000000", from: evm },
  { label: "100 USDC  Solana   -> Sui USDC", fromChain: 1151111081099710, fromToken: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", toToken: SUI_USDC, amount: "100000000", from: sol },
];

console.log(`LI.FI quotes into Sui, ${new Date().toISOString().slice(0, 16)}Z\n`);
console.log("route".padEnd(34), "tool".padEnd(14), "you receive".padEnd(16), "eta".padEnd(8), "fee (USD)");
for (const r of routes) {
  const u = new URL("https://li.quest/v1/quote");
  Object.entries({ fromChain: r.fromChain, toChain: SUI, fromToken: r.fromToken, toToken: r.toToken, fromAmount: r.amount, fromAddress: r.from, toAddress: sui, slippage: "0.005" })
    .forEach(([k, v]) => u.searchParams.set(k, String(v)));
  try {
    const d = await (await fetch(u)).json();
    if (!d.estimate) { console.log(r.label.padEnd(34), "no route".padEnd(14), (d.message ?? "").slice(0, 60)); continue; }
    const e = d.estimate;
    const dec = d.action?.toToken?.decimals ?? 6;
    const out = (Number(e.toAmount) / 10 ** dec).toFixed(dec > 6 ? 4 : 2) + " " + (d.action?.toToken?.symbol ?? "");
    const fee = e.feeCosts?.reduce((a, f) => a + Number(f.amountUSD ?? 0), 0).toFixed(2);
    const eta = Math.round((e.executionDuration ?? 0) / 60) + " min";
    console.log(r.label.padEnd(34), String(d.tool).padEnd(14), out.padEnd(16), eta.padEnd(8), fee);
  } catch (err) { console.log(r.label.padEnd(34), "error", err.message); }
}
console.log("\nRead the tool column: mayanMCTP burns USDC via Circle CCTP and a solver delivers on Sui; mayan (Swift) is the pure intent route when it appears; allbridge is a liquidity pool.");
console.log("The same quote is what a dApp calls, then it signs the returned transactionRequest with the user's wallet. Referrer fees are a query parameter.");
