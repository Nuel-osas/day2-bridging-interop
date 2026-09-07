# Walkthrough

Order of the day. Commands assume the repo root with `.env` in place. Sections marked
(pending research) are finalised from `production-week/research/` before class.

## Part 0: why intents (talk, 25 min)

Slides. One terminal moment: run the quotes and read the tool column.

```bash
pnpm quotes
```

Point out: every route into Sui today resolves to Mayan MCTP, not a pure fast fill. That is the
state of solver inventory on Sui in September 2026, and it is the honest opening for the
"where the market is" conversation.

## Part 1: how intent bridging works (talk, 20 min)

`docs/how-intent-bridging-works.md`. Intent, auction, fill, proof, settlement. Who holds
inventory risk. Why the user is paid before finality. Not to be confused with Sui Payment Intents.

## Part 2: integrate a route in a dApp (30 min)

LI.FI is the aggregator that answers for Sui. The quote response carries a ready-to-sign
`transactionRequest` for the source chain wallet and a `toAmountMin` for the UI.

```bash
curl -s "https://li.quest/v1/quote?fromChain=8453&toChain=9270000000000000&fromToken=0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913&toToken=0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC&fromAmount=100000000&fromAddress=<EVM>&toAddress=<SUI>&slippage=0.005" | jq '.tool, .estimate.toAmount, .estimate.executionDuration, .transactionRequest.to'
```

Then the embedded alternative: the Wormhole Connect widget.

```bash
cd connect-app && pnpm dev
```

Show that the bridge lives inside the app. Routes for Sui in Connect: wrapped token transfers
with relay, CCTP, gas drop-off.

(pending research) Mayan direct SDK example and referrer fees; deBridge status.

## Part 3: the settlement rail under the intents: CCTP (30 min)

Burn on Sepolia before class. In class, show the attestation states and receive live.

```bash
pnpm cctp:burn 1000000
pnpm cctp:attest
pnpm cctp:receive
```

Say clearly: V1, paused by Circle on 2026-12-01, Sui has no V2 yet. The five-call PTB is what
"native USDC on Sui" costs a developer without an SDK.

## Break (10 min)

## Part 4: the native bridge (20 min)

```bash
pnpm bridge-watch
```

Validator committee, ECDSA attestations, limiter, no protocol fee, 13 minutes from Ethereum.
The fake site. How to verify bridge.sui.io.

## Part 5: bridge security (20 min)

(pending research) The exploit table, the taxonomy, and the checklist.

## Part 6: interoperability for builders (35 min)

(pending research) Ika dWallets: a Sui contract that signs for Bitcoin. Hashi: BTC as
collateral without wrapping. Wormhole NTT for your own token. Messaging options.

```bash
pnpm ika
```

## Recap and open lab (10 min)

Fund a wallet on Sepolia, bring USDC into Sui with CCTP, then get a LI.FI quote to send it back.
