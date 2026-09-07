# Day 2: Bridging and Interoperability on Sui

Companion repo for Day 2 of the SuiHub Lagos Production Week. How value gets into and out of
Sui, which routes are worth integrating, and how a Sui contract can act on other chains
without a bridge at all.

The spine of the day: intent-based routes first, because they are what a dApp integrates and
what a user experiences as fast. Then the settlement rails underneath them. Then the bridgeless
designs for builders.

| Path | What it is |
|---|---|
| `scripts/01-compare-routes.mjs` | Live quotes into Sui from LI.FI, which routes Sui traffic through Mayan and Allbridge. No wallet needed. |
| `scripts/02a-cctp-burn.mjs` | Burn USDC on Sepolia for a Sui recipient with Circle CCTP V1. |
| `scripts/02b-cctp-attest.mjs` | Poll Circle's attestation service. Shows not found, pending, complete. |
| `scripts/02c-cctp-receive.mjs` | Mint native USDC on Sui testnet: the five-call PTB from Circle's reference. |
| `scripts/03-sui-bridge-watch.mjs` | Read the native Sui Bridge's deposits, approvals and claims from mainnet events. |
| `scripts/04-ika-dwallet.mjs` | Create a dWallet on Ika and sign for another chain from Sui. |
| `connect-app/` | Wormhole Connect widget, Sepolia to Sui testnet, embedded in a page. |
| `docs/how-intent-bridging-works.md` | The mechanism: intent, auction, fill, proof, settlement, and who holds the risk. |
| `docs/research/` | The five sourced reports behind the class: Sui Bridge internals, CCTP on Sui, builder interop (Ika, Hashi, messaging), bridge security, intent bridging. Every claim dated and linked. |

## Quick start

```bash
pnpm install
cp .env.example .env         # add an EVM key funded on Sepolia for the CCTP demo
pnpm quotes                  # live routes into Sui
pnpm bridge-watch            # what the native bridge did today
cd connect-app && pnpm install && pnpm dev    # widget on http://localhost:5174
```

CCTP, three steps because Circle waits for Ethereum finality (13 to 19 minutes on Sepolia):

```bash
pnpm cctp:burn 1000000       # 1 USDC, run this before class
pnpm cctp:attest             # poll until complete
pnpm cctp:receive            # mint on Sui, live
```

## Requirements

Node 20+, pnpm, `@mysten/sui` 2.x (gRPC client; public Sui fullnodes no longer serve JSON-RPC),
Sui CLI on testnet with gas, an EVM key with Sepolia ETH and Sepolia USDC (faucet.circle.com).

## Facts checked the night before class (2026-09-07)

- deBridge DLN and Relay do not list Sui in their public chain APIs. LI.FI does, as a Move VM
  chain, id 9270000000000000, routing through Mayan MCTP, Mayan fast MCTP, Mayan Swift where
  available, and Allbridge.
- Quotes into Sui for 100 USDC from Base, Arbitrum and Ethereum returned about 99.52 USDC,
  15 to 20 minutes, 0.25 USD fee, all via Mayan MCTP. Solana to Sui had no route.
- Circle CCTP on Sui is V1 only. Circle pauses V1 contracts on 2026-12-01 and Sui is one of two
  chains still without V2. Circle Bridge Kit does not support Sui.
- Sui Bridge: validator committee, ETH, WETH, WBTC, LBTC, USDT, limits 16M USD in and 7M USD out
  per 24 hours, no protocol fee stated. A site at bridge-sui.vercel.app imitates it and quotes a
  0.03 percent fee; it is not Sui Bridge.

MIT.
