// NEAR Intents: a real solver auction that reaches Sui. The 1Click API.
//
//   pnpm intents                       dry quotes: Base USDC -> Sui USDC, Sui USDC -> Base USDC, SUI -> Base USDC
//   pnpm intents --execute 1           send 1 SUI to the quote's deposit address on Sui, then poll to SUCCESS
//
// Flow: POST /v0/quote (dry=false) -> depositAddress on Sui -> you transfer the asset there
//       -> POST /v0/deposit/submit -> GET /v0/status: PENDING_DEPOSIT, KNOWN_DEPOSIT_TX, PROCESSING, SUCCESS
// Under the hood: your deposit is credited in the Verifier contract (intents.near), the Message Bus
// broadcasts your request to solvers over WebSocket, solvers return signed quotes, the best one is
// matched with your intent and settled atomically in the Verifier, and the withdrawal leaves through
// the destination chain's bridge. Without a JWT the API adds a 0.2 percent fee.
import { Transaction } from "@mysten/sui/transactions";
import { client, signer, explorer } from "./_sui.mjs";

const API = "https://1click.chaindefuser.com/v0";
const A = {
  suiNative: "nep141:sui.omft.near",
  suiUsdc: "nep141:sui-c1b81ecaf27933252d31a963bc5e9458f13c18ce.omft.near",
  baseUsdc: "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near",
  solUsdc: "nep141:sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near",
};
const args = process.argv.slice(2);
const execute = args.includes("--execute");
const amountSui = Number(args.find((a) => /^\d+(\.\d+)?$/.test(a)) ?? 1);
const kp = signer(); const me = kp.toSuiAddress();
const evm = process.env.EVM_ADDRESS;
const deadline = () => new Date(Date.now() + 30 * 60 * 1000).toISOString();

async function quote(body) {
  const r = await fetch(`${API}/quote`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ swapType: "EXACT_INPUT", slippageTolerance: 100, depositType: "ORIGIN_CHAIN", refundType: "ORIGIN_CHAIN", recipientType: "DESTINATION_CHAIN", deadline: deadline(), ...body }) });
  return r.json();
}
const show = (label, q) => console.log(`${label.padEnd(30)} out ${String(q.quote?.amountOutFormatted ?? "?").padEnd(12)} est ${q.quote?.timeEstimate ?? "?"} s${q.message ? "  " + q.message : ""}`);

if (!execute) {
  console.log("NEAR Intents 1Click, dry quotes\n");
  show("1 USDC Base -> Sui USDC", await quote({ dry: true, originAsset: A.baseUsdc, destinationAsset: A.suiUsdc, amount: "1000000", refundTo: evm, recipient: me }));
  show("1 USDC Solana -> Sui USDC", await quote({ dry: true, originAsset: A.solUsdc, destinationAsset: A.suiUsdc, amount: "1000000", refundTo: "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM", recipient: me }));
  show("1 USDC Sui -> Base USDC", await quote({ dry: true, originAsset: A.suiUsdc, destinationAsset: A.baseUsdc, amount: "1000000", refundTo: me, recipient: evm }));
  show("1 SUI -> Base USDC", await quote({ dry: true, originAsset: A.suiNative, destinationAsset: A.baseUsdc, amount: "1000000000", refundTo: me, recipient: evm }));
  console.log("\nCompare: Mayan MCTP into Sui quotes 15 to 20 minutes. This is a solver auction settled in the Verifier contract on NEAR.\nadd --execute 1 to send 1 SUI for real.");
  process.exit(0);
}

const amount = BigInt(Math.round(amountSui * 1e9));
const q = await quote({ dry: false, originAsset: A.suiNative, destinationAsset: A.baseUsdc, amount: amount.toString(), refundTo: me, recipient: evm });
if (!q.quote?.depositAddress) { console.error(JSON.stringify(q).slice(0, 400)); process.exit(1); }
console.log(`quote: ${amountSui} SUI -> ${q.quote.amountOutFormatted} USDC on Base, est ${q.quote.timeEstimate} s, deposit to ${q.quote.depositAddress} (Sui)`);

const tx = new Transaction(); tx.setSender(me);
const [c] = tx.splitCoins(tx.gas, [tx.pure.u64(amount)]);
tx.transferObjects([c], tx.pure.address(q.quote.depositAddress));
const t0 = Date.now();
const res = await client.signAndExecuteTransaction({ transaction: tx, signer: kp, include: { effects: true } });
const digest = res.Transaction?.digest ?? res.digest;
console.log(`deposited on Sui: ${explorer(digest)}`);
await fetch(`${API}/deposit/submit`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ depositAddress: q.quote.depositAddress, txHash: digest }) });
for (let i = 0; i < 120; i++) {
  await new Promise((r) => setTimeout(r, 3000));
  const s = await (await fetch(`${API}/status?depositAddress=${q.quote.depositAddress}`)).json();
  const secs = ((Date.now() - t0) / 1000).toFixed(0);
  console.log(`[${secs}s] ${s.status}${s.swapDetails?.destinationChainTxHashes?.length ? "  dest tx " + s.swapDetails.destinationChainTxHashes.map((x) => x.hash).join(",") : ""}`);
  if (["SUCCESS", "REFUNDED", "FAILED"].includes(s.status)) { if (s.swapDetails) console.log("amountOut", s.swapDetails.amountOutFormatted); break; }
}
