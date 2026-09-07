// Watch the native Sui Bridge from the outside: recent deposits, approvals and
// claims, read straight from mainnet events. No SDK needed, just GraphQL.
//
// Chain ids used by the bridge: 0 Sui mainnet, 1 Sui testnet, 10 Ethereum mainnet, 11 Sepolia.
// Token ids: 1 BTC, 2 ETH, 3 USDC, 4 USDT (amounts are in the bridge's 8-decimal units).
const NET = process.env.SUI_NETWORK === "testnet" ? "testnet" : "mainnet";
const GQL = `https://graphql.${NET}.sui.io/graphql`;
const CHAIN = { 0: "Sui", 1: "Sui-testnet", 10: "Ethereum", 11: "Sepolia" };
const TOKEN = { 1: "BTC", 2: "ETH", 3: "USDC", 4: "USDT", 5: "LBTC" };

async function events(type, n = 8) {
  const r = await fetch(GQL, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ query: `{ events(last: ${n}, filter: { type: "${type}" }) { nodes { timestamp transaction { digest } contents { json } } } }` }) });
  const d = await r.json();
  return d.data?.events?.nodes ?? [];
}

console.log(`Sui Bridge on ${NET}. Package 0xb, shared bridge object 0x9.\n`);

const deposits = await events("0xb::bridge::TokenDepositedEvent");
console.log(`Deposits leaving Sui (TokenDepositedEvent): ${deposits.length}`);
for (const e of deposits) {
  const j = e.contents.json;
  console.log(`  ${e.timestamp.slice(0, 19)}  seq ${j.seq_num}  ${CHAIN[j.source_chain] ?? j.source_chain} -> ${CHAIN[j.target_chain] ?? j.target_chain}  ${TOKEN[j.token_type] ?? j.token_type} ${(Number(j.amount_sui_adjusted ?? j.amount) / 1e8).toFixed(6)}  ${e.transaction.digest.slice(0, 10)}`);
}

const approved = await events("0xb::bridge::TokenTransferApproved");
console.log(`\nApproved by the validator committee (TokenTransferApproved): ${approved.length}`);
for (const e of approved) {
  const k = e.contents.json.message_key;
  console.log(`  ${e.timestamp.slice(0, 19)}  from ${CHAIN[k.source_chain] ?? k.source_chain}  seq ${k.bridge_seq_num}  ${e.transaction.digest.slice(0, 10)}`);
}

const claimed = await events("0xb::bridge::TokenTransferClaimed");
console.log(`\nClaimed on Sui (TokenTransferClaimed): ${claimed.length}`);
for (const e of claimed) {
  const k = e.contents.json.message_key;
  console.log(`  ${e.timestamp.slice(0, 19)}  from ${CHAIN[k.source_chain] ?? k.source_chain}  seq ${k.bridge_seq_num}  ${e.transaction.digest.slice(0, 10)}`);
}
console.log("\nRead it as: Ethereum deposit -> committee approval on Sui -> claim mints on Sui. Sui deposit -> approval -> user claims on Ethereum.");
