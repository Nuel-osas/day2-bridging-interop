# Walkthrough

Order of the day. Commands assume the repo root with `.env` in place. Every number was
measured on 2026-09-07; sources in `production-week/research/`.

## Part 0: why intents (talk, 25 min)

Slides. One terminal moment: run the quotes and read the tool column.

```bash
pnpm quotes
```

Point out: every route into Sui today resolves to Mayan MCTP, not a pure fast fill. Section B
shows the Swift-only request returning ROUTE_NOT_FOUND. Section C shows LI.FI wrapping the same
route plus 0.25 USDC, and a deBridge quote to Solana with 1 second fulfilment next to
"deBridge chains with Sui? no". That is the market in one screen.

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

Then the live fill out of Sui, mainnet, small:

```bash
SUI_NETWORK=mainnet pnpm mayan --sui 2            # quote only
SUI_NETWORK=mainnet pnpm mayan --sui 2 --execute  # send 2 SUI, receive USDC on Base, poll the explorer
```

Observed on the Mayan explorer the night before: 11 to 20 seconds to redeemed for Sui to Base
and Solana. Referrer fees: `referrerAddresses` with a `sui` entry in the SDK; not earned on
pure USDC bridging without a destination swap.

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

Validator committee (96 members, 3,334 of 10,000 to approve, 450 to pause, 5,001 to unpause),
no protocol fee, 13 minutes from Ethereum, live limits 25M in and 50M out per 24 hours, five
assets and no USDC. Testnet limits are set to one unit, so no live testnet transfer today.
The fake site at bridge-sui.vercel.app; the real one is bridge.sui.io.

## Part 5: bridge security (20 min)

Slides 20 to 22. Lead with Kelp DAO rsETH, April 2026: 292M USD, zero contract bugs, one
verifier. Then Ronin, Nomad, Wormhole, Multichain. Then the two lists: questions before
integrating, rules for your app. Full material in production-week/research/05-bridge-security.md.

## Part 6: interoperability for builders (35 min)

```bash
pnpm ika                       # read-only: coordinator, epoch, encryption key, the write path as a list
pnpm hashi address             # taproot deposit address bound to your Sui address (Signet)
pnpm hashi balance             # hBTC in sats
```

Ika writes need IKA tokens (no public faucet): `IKA_COIN_ID=<coin> pnpm ika --execute` runs
DKG for real if you have some. Hashi: deposit Signet BTC to the address, then
`pnpm hashi deposit <txid> <vout> <sats>` and `pnpm hashi wait <digest>`. Then the messaging
table: Wormhole core and NTT, LayerZero V2 OApp and OFT, Axelar, ZetaChain.

## Recap and open lab (10 min)

Fund a wallet on Sepolia, bring USDC into Sui with CCTP, then get a LI.FI quote to send it back.
