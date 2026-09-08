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
| `scripts/08-near-intents.mjs` | NEAR Intents 1Click: a real solver auction that reaches Sui. Dry quotes, then 1 SUI to USDC on Base. Measured: 23 seconds. |
| `scripts/06-mayan-out-of-sui.mjs` | The live intent fill: USDC on Sui to USDC on Base through Mayan, polling the explorer. Measured: 20 seconds. |
| `scripts/07-lifi-swap-on-sui.mjs` | Same-chain swap on Sui through LI.FI; it returns PTB bytes you sign. |
| `scripts/03-sui-bridge-watch.mjs` | Read the native Sui Bridge's deposits, approvals and claims from mainnet events. |
| `scripts/04-ika-dwallet.mjs` | Ika read-only view: coordinator, epoch, encryption key, the write path as a list. |
| `scripts/09-ika-eth-wallet.mjs` | Ika end to end on testnet: shared dWallet, Ethereum address, presign, sign, address recovery. Verified. |
| `docs/ika-on-testnet.md` | How to get IKA (the faucet is an on-chain exchange), fees observed, and the gotchas. |
| `ika-wallet/` | The Ika dApp: sign in (Google, or an email box for demos), get an Ethereum and a Bitcoin address from one Ika dWallet controlled from Sui, receive on either, send ETH on Sepolia signed by the Ika network. Next.js. |
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

- NEAR Intents lists Sui (SUI and USDC) among 35 chains. Dry quotes: Base to Sui 50 s, Solana to Sui
  35 s, Sui to Base 27 s. A real 1 SUI to Base USDC finished in 23 s. Fee into Sui about 2 percent today.
- deBridge DLN and Relay do not list Sui in their public chain APIs. Garden and Chainflip do not either. LI.FI does, as a Move VM
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
