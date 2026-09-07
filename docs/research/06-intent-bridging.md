# 06. Intent-based bridging into and out of Sui

Research date: 2026-09-07 (day before the SuiHub Lagos workshop on 2026-09-08).
Method: every "supported today" claim below was checked against a live API call, an npm registry lookup, a GitHub raw file, or the protocol's own docs on 2026-09-07. Exact API responses are reproduced where they matter. Anything not verified that way is listed at the end under "Unverified claims".

## 0. The one-paragraph answer

As of today, exactly one intent-style protocol has native, working Sui support in both directions: Mayan. But the route Mayan actually returns for every Sui pair is MCTP (Circle CCTP plus a Wormhole message, with Mayan "drivers" competing on Solana to do the destination swap), not Swift (Mayan's true solver auction that pays the user in about 2 seconds). Swift is deployed on Solana and eleven EVM chains and not on Sui. LI.FI wraps that same Mayan MCTP route with a fee layer, a Sui wallet-aware SDK and a React widget. deBridge DLN, Relay and Across, the three intent bridges a class would normally lead with, do not list Sui at all and reject a Sui chain id at the API. Squid, Socket (Bungee), Rango and Orbiter list Sui in their chain tables but returned no route, an error, or could not be reached today. The practical consequence for a Sui dApp: integrate Mayan (direct SDK, referrer fees, both directions) or LI.FI (widget, aggregation, 0.25 percent fixed fee), understand you are getting CCTP-speed settlement into Sui from EVM (15 to 20 minute ETA in the quote) and roughly one minute from Solana, and watch for Swift landing on Sui, which would turn this into a 2 second flow.

## 1. Glossary the instructor should fix before class

- Intent bridge: user signs an order ("I want at least X of token T on chain D, delivered to address A, by deadline t"). A solver (also called filler, driver, taker, relayer) pays out on the destination from its own inventory within seconds. The protocol later verifies the fill and releases the user's locked source funds to the solver. The user is paid before the cross-chain message is verified. Examples: deBridge DLN, Across, Relay, Mayan Swift, Eco Routes, Squid Intents (Coral).
- Fast burn-and-mint: source burns, an attestation service signs, destination mints. Speed is bounded by the attester's finality policy. Circle CCTP is the canonical example. Mayan MCTP and Fast MCTP are wrappers around CCTP with a competitive destination swap. These are not solver-inventory intents even when the front end calls them "intents".
- Lock-and-mint / liquidity pool bridges: Wormhole Token Bridge, Portal, Allbridge, Stargate style. Slowest, most trust in the messaging layer.
- Sui "Payment Intents": unrelated to bridging. See section 8.4.

## 2. deBridge DLN

Status for Sui today: NOT SUPPORTED, as source or destination. There is no deBridge chain id for Sui.

Evidence, live API 2026-09-07:

```
GET https://dln.debridge.finance/v1.0/supported-chains-info
{"chains":[
 {"chainId":1,"chainName":"Ethereum"},{"chainId":10,"chainName":"Optimism"},
 {"chainId":56,"chainName":"BSC"},{"chainId":137,"chainName":"Polygon"},
 {"chainId":4663,"chainName":"Robinhood"},{"chainId":8453,"chainName":"Base"},
 {"chainId":42161,"chainName":"Arbitrum"},{"chainId":43114,"chainName":"Avalanche"},
 {"chainId":59144,"chainName":"Linea"},{"chainId":7565164,"chainName":"Solana"},
 {"chainId":100000013,"originalChainId":1514,"chainName":"Story"},
 {"chainId":100000019,"originalChainId":25,"chainName":"Cronos"},
 {"chainId":100000022,"originalChainId":999,"chainName":"HyperEVM"},
 {"chainId":100000026,"originalChainId":728126428,"chainName":"Tron"},
 {"chainId":100000029,"originalChainId":1776,"chainName":"Injective"},
 {"chainId":100000030,"originalChainId":143,"chainName":"Monad"},
 {"chainId":100000031,"originalChainId":4326,"chainName":"Megaeth"}]}
```

Attempted create-tx with a guessed Sui id (recorded so nobody repeats it):

```
GET https://dln.debridge.finance/v1.0/dln/order/create-tx?srcChainId=8453&...&dstChainId=100000020&...
{"errorCode":2,"errorId":"INVALID_QUERY_PARAMETERS",
 "errorMessage":"dstChainId must be one of the following values: 1, 10, 56, 137, 4663, 8453, 42161, 43114, 59144, 7565164, 100000013, 100000019, 100000022, 100000026, 100000029, 100000030, 100000031"}
```

The docs supported-chains pages (home/architecture/supported-chains and dln-details/overview/fees-supported-chains) list the same 17 chains and mention neither Sui nor any Move chain. The docs llms.txt index has no Sui page.

Architecture in five lines:
1. Maker calls DlnSource.createOrder on the source chain; input tokens are locked in the contract.
2. Takers (solvers) watch orders and call DlnDestination.fulfillOrder on the destination, paying the recipient from their own liquidity. The API auto-inserts about 4 bps taker margin so the order is profitable.
3. The first taker to flip the order to Fulfilled calls sendUnlock, which sends a deBridge message back to the source chain to release the locked input to the taker.
4. Inventory risk: taker, between fulfil and unlock (source reorg risk, messaging risk). Maker risk: only from createOrder to fulfil, "typically seconds".
5. Cancel: maker calls sendCancel on the destination if unfilled; funds return via message.

Fee model (docs, fee-structure page): flat native fee per source chain (0.001 ETH on Base, Ethereum, Arbitrum, Optimism, Linea; 0.015 SOL on Solana; queried via DlnSource.globalFixedNativeFee()), plus 4 bps protocol fee on input (DlnSource.percentFeeBps()), plus about 4 bps taker margin, plus operating expenses (three solver transactions) when prependOperatingExpenses=true. Optional affiliateFeePercent and affiliateFeeRecipient (paid to the affiliate on the source chain at ClaimedUnlock).

Control quote so the class can see what a real DLN order looks like (Base USDC to Solana USDC, 100 USDC, live 2026-09-07):

```
GET https://dln.debridge.finance/v1.0/dln/order/create-tx?srcChainId=8453&srcChainTokenIn=0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913&srcChainTokenInAmount=100000000&dstChainId=7565164&dstChainTokenOut=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v&dstChainTokenOutAmount=auto&dstChainTokenOutRecipient=<solana addr>&senderAddress=<evm addr>&srcChainOrderAuthorityAddress=<evm addr>&dstChainOrderAuthorityAddress=<solana addr>&prependOperatingExpenses=true

estimation.srcChainTokenIn.amount = 100970460   (100 USDC + prepended operating expenses)
estimation.dstChainTokenOut.amount = 99920016   (99.92 USDC)
costsDetails: DlnProtocolFee 40388 (4 bps), TakerMargin 40372 (4 bps), EstimatedOperatingExpenses 969684
fixFee = 1000000000000000 wei (0.001 ETH)
order.approximateFulfillmentDelay = 1   (seconds)
```

Fill time: the API returned approximateFulfillmentDelay 1 second for that pair. Docs describe fulfilment as near-instant after source finality.

Limits: not fixed per order; the taker has to have inventory, so very large orders can sit until a taker picks them up.

Integration surface: REST (dln.debridge.finance/v1.0, docs under api-reference/dln), npm @debridge-finance/dln-client 17.6.2 (published 2026-04-10), widget script https://app.debridge.com/assets/scripts/widget.js with deBridge.widget(config) and setAffiliateFee, visual builder at app.debridge.com/widget. No Sui in any of them.

Testnet: no public DLN testnet documented (unverified negative).

How a Sui address would be passed if support arrives: DLN uses dstChainTokenOutRecipient as an opaque string per chain (Solana base58, EVM hex), so a 32-byte Sui hex address would fit the same slot. This is a projection, not a documented fact.

## 3. Mayan (Swift and MCTP, the engine behind Wormhole Settlement)

Status for Sui today: SUPPORTED as source and destination, but only through MCTP. Swift (the real solver auction) returns ROUTE_NOT_FOUND for every Sui pair tested.

### 3.1 Identity of Sui in the Mayan API

From https://price-api.mayan.finance/v3/tokens?chain=sui and https://sia.mayan.finance/v10/init:

- API chain name: sui
- Mayan internal chainId: 1999
- Wormhole chain id (wChainId): 21
- originActive: true, destinationActive: true
- Native SUI: 0x2::sui::SUI (decimals 9)
- Native USDC: 0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC (decimals 6)
- Also listed: xBTC, LBTC, WETH (Portal), and others

### 3.2 Why "Ethereum USDC to Sui USDC" returned ROUTE_NOT_FOUND yesterday

Three things bite when you call the price API by hand rather than through the SDK:

1. The raw API defaults every route flag to false. The SDK sends wormhole=true, swift=true, mctp=true, fastMctp=true, shuttle=false, monoChain=true. If your curl omits mctp=true you only ask for Swift, and Sui has no Swift route, so the answer is ROUTE_NOT_FOUND. Verified today:

```
# no route flags at all
GET /v3/quote?amountIn=100&fromToken=0xA0b8...eB48&fromChain=ethereum&toToken=0xdba3...::usdc::USDC&toChain=sui&slippageBps=auto&sdkVersion=15_2_2
{"code":"ROUTE_NOT_FOUND","msg":"Route not found"}

# swift only
...&swift=true&mctp=false&fastMctp=false&shuttle=false&monoChain=false&sdkVersion=15_2_2
{"code":"ROUTE_NOT_FOUND","msg":"Route not found"}      (same for base->sui, solana->sui, sui->base, sui->solana)

# fastMctp only
...&fastMctp=true&sdkVersion=15_2_2
{"code":"ROUTE_NOT_FOUND","msg":"Route not found"}

# mctp=true
...&swift=true&mctp=true&fastMctp=true&shuttle=true&monoChain=true&sdkVersion=15_2_2
{"quotes":[{"type":"MCTP", ...}]}
```

2. sdkVersion is effectively required and must use underscores. Without it: {"code":"SDK_VERSION_TOO_OLD","msg":"Upgrade sdk and set sdkVersion in quote requests"}. With sdkVersion=15.2.2 (dots): {"code":"SDK_VERSION_TOO_OLD","msg":"Please upgrade sdk to use mctp routes"}. Use sdkVersion=15_2_2.

3. Chain name is case sensitive. toChain=Sui returned {"statusCode":500,"message":"Internal server error"}.

The token address was not the problem. Even the Wormhole-wrapped USDC on Sui (0x5d4b...::coin::COIN) returned a quote. Native USDC 0xdba3...::usdc::USDC is the right target.

### 3.3 Quotes into Sui recorded today (all type MCTP)

Request shape (GET, all on one line in practice):

```
https://price-api.mayan.finance/v3/quote
  ?amountIn=100
  &fromToken=0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913        (Base USDC)
  &fromChain=base
  &toToken=0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC
  &toChain=sui
  &slippageBps=auto
  &swift=true&mctp=true&fastMctp=true&shuttle=true&monoChain=true
  &referrer=<your Solana address>&referrerBps=10
  &sdkVersion=15_2_2
```

Results (expectedAmountOut, ETA from the quote):

| From | In | To (Sui) | Out | Type | etaSeconds |
|---|---|---|---|---|---|
| Ethereum USDC | 100 | USDC | 99.769902 | MCTP | 900 (15 min) |
| Base USDC | 100 | USDC | 99.769902 | MCTP | 1200 (20 min) |
| Arbitrum USDC | 100 | USDC | 99.769902 | MCTP | 1200 |
| Solana USDC | 100 | USDC | 99.769902 | MCTP | 60 (1 min) |
| Base USDC | 100 | SUI | 121.037614 | MCTP | 1200 |
| Solana USDC | 100 | SUI | 121.220528 | MCTP | 60 |
| Ethereum ETH | 0.05 | SUI | 150.957190 | MCTP | 900 |
| Base ETH | 0.05 | SUI | 150.995348 | MCTP | 1200 |
| Base ETH | 0.05 | USDC | 124.297810 | MCTP | 1200 |
| Solana SOL | 1 | SUI | 125.954245 | MCTP | 60 |
| Solana SOL | 1 | USDC | 103.638521 | MCTP | 60 |
| Sui USDC (out) | 100 | Base USDC | 99.963201 | MCTP | 60 |

Key fields of the Base USDC to Sui USDC quote:

```
"type":"MCTP", "effectiveAmountIn":100, "expectedAmountOut":99.769902, "minAmountOut":99.769901,
"redeemRelayerFee":0.230098, "refundRelayerFee":0.230098, "clientRelayerFeeSuccess":0.2300984274,
"protocolBps":0, "protocolFeeUsd":0, "referrerBps":10 (echoed when passed), "referrerFeeUsd":0,
"eta":20, "etaSeconds":1200, "clientEta":"20 min", "hasAuction":false, "onlyBridging":true,
"mctpMayanContract":"0x875d6d37EC55c8cF220B9E5080717549d8Aa8EcA",
"mctpOutputContract":"0xdba3...::usdc::USDC", "deadline64":"1788806029", "signature":"0x5fcb..."
```

Interpretation: the only cost on a USDC to USDC transfer into Sui is the redeem relayer fee (0.23 USDC on 100). protocolBps is 0 for USDC output (docs: MCTP protocol fee is zero if output is USDC, 3 bps otherwise). referrerFeeUsd is 0 on a pure bridge; docs confirm referrer fees are not earned on MCTP transfers without a destination swap.

### 3.4 Real fills observed today (Mayan explorer API, last two hours, 1500 swaps scanned, 21 touched Sui)

All 21 were MCTP variants. No Swift order touched Sui. Time from initiatedAt to statusUpdatedAt:

- Sui USDC to Solana USDC 35.7: REDEEMED_ON_SOL_WITH_FEE in 13.4 s
- Sui SUI to Solana USDC 53.35: 11.3 s
- Sui USDC to Base USDC 2053.51: REDEEMED_ON_EVM_WITH_FEE in 19.7 s
- Sui USDC to Base USDC 100.0: 20.7 s
- Sui USDC to Arbitrum USDC 163.33: 16.3 s
- Solana SOL to Sui USDC 0.19: REDEEMED_ON_SUI_WITH_FEE in 34.3 s
- Sui SUI to Solana SOL (with destination swap): 62 to 231 s
- Solana SOL to Sui SUI 0.05: REFUNDED_ON_SUI_MCTP after 1135 s (a refund path, worth mentioning in class)
- Sui SUI to Ethereum USDC 63.0: MCTP_FEE_UNLOCKED after 1005 s

So Sui to Solana, Base or Arbitrum settles in roughly 11 to 20 seconds in practice because Sui finality is fast and CCTP attests quickly, while EVM to Sui is bounded by Ethereum-side finality and the quote honestly says 15 to 20 minutes.

### 3.5 Architecture in five lines

Swift (not on Sui):
1. User's input is locked in the Swift contract on the source chain (swapped first into the chain's primary locked asset if needed).
2. An English auction runs on Solana; "the auction ends three seconds after the initial bid"; drivers bid the output they will deliver.
3. Winner pays the user on the destination from its own inventory, "settles in as little as 2 seconds".
4. Fulfilment proof travels via Wormhole VAA to the source chain and unlocks the user's funds to the driver. Drivers can batch unlocks.
5. Inventory risk sits with the driver until unlock; user trusts the Swift contracts plus Wormhole guardians. No protocol fee.

MCTP (what Sui gets):
1. Input is swapped to USDC on the source chain and burned through Circle CCTP; a Wormhole message carries Mayan's order data.
2. Circle attests; drivers compete on Solana for the right to do the destination swap; the winning driver mints and swaps USDC to the requested token on the destination and gets a fee.
3. Users trust Circle's attestation and Wormhole for the payload; drivers do not front the principal, so inventory risk is minimal and speed is CCTP speed.
4. Fast MCTP uses CCTPv2 fast finality ("as little as 5 seconds"); the docs list Fast MCTP chains without Sui, and the API confirms fastMctp alone returns no Sui route.
5. Refund path exists (REFUNDED_ON_SUI_MCTP status observed).

### 3.6 Fee model and dApp monetization

- Swift: no protocol fee. MCTP: 0 for USDC output, 3 bps otherwise. Fast MCTP: 3 bps. Read protocolBps from the quote.
- Referrer fee: pass referrer (always a Solana address, even for EVM to EVM) and referrerBps on the quote, and pass referrerAddresses {evm, solana, sui} at execution. Caps: Swift 200 bps, MCTP 100 bps from Solana or 50 bps from other chains, Fast MCTP 100 bps. MCTP referrer fees are paid on the destination in the minted stablecoin. The Solana referrer address needs USDC, USDT and WETH associated token accounts or the fee can be lost.
- Limits: Swift about 1M USD per transfer, MCTP and Fast MCTP about 10M USD. minBridgeUSD for SWIFT is 1 (from sia init).
- Rate limits: optional apiKey on the quote raises the per-IP limit.

### 3.7 SDK and widget

- npm @mayanfinance/swap-sdk 15.2.2 (published 2026-08-31). Dependencies include @mysten/sui ^2.17.0 (2.29.0 was installed today), ethers ^6, @solana/web3.js ^1.87. ESM only; Node 20.19+ or 22.12+ required for CJS consumers. Ran fine on Node 26.4.0 today.
- Sui requires a @mysten/sui v2 Core API client; v1 SuiClient fails with core.listCoins is not a function. SuiGrpcClient is recommended.
- Sui source: createSwapFromSuiMoveCalls(quote, originWalletAddress, destinationWalletAddress, referrerAddresses, customPayload, suiClient, options) returns a Transaction you sign with dapp-kit. Source files src/sui/suiMctp.ts (createMctpFromSuiMoveCalls) and src/sui/suiSwift.ts (createSwiftFromSuiMoveCalls, referencing SUI_SWIFT_STATE 0x7ac01a7c...) both exist, so Swift-from-Sui code is shipped even though the quote API returns no Swift route for Sui today.
- Sui to HyperCore is temporarily disabled (SDK README).
- Into Sui from EVM or Solana: use swapFromEvm or swapFromSolana with destinationWalletAddress set to the 0x Sui address; the SDK passes it through unchanged.
- Widget: CDN script https://cdn.mayan.finance/widget/1_8_0/main.js, configured through the Mayan dashboard (chains, tokens, referrer fees, colors). Not an npm React component.
- Explorer API: https://explorer-api.mayan.finance/v3/swaps (also /v3/swap/trx/<hash>), swagger at https://price-api.mayan.finance/swagger.
- Testnet: none. The SDK addresses file contains no testnet entries and the docs never mention one (unverified negative).

### 3.8 Verified TypeScript (ran today, 3.8 s latency)

```ts
// package.json: { "type": "module" }, npm i @mayanfinance/swap-sdk@15.2.2
import { fetchQuote } from "@mayanfinance/swap-sdk";

const SUI_USDC = "0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC";

const quotes = await fetchQuote({
  amountIn64: "100000000",                                   // 100 USDC
  fromToken: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",  // Base USDC
  toToken: SUI_USDC,
  fromChain: "base",
  toChain: "sui",
  slippageBps: "auto",
  referrer: "<your Solana address>",
  referrerBps: 10,
});
for (const q of quotes) {
  console.log(q.type, q.expectedAmountOut, q.minAmountOut, q.etaSeconds, q.clientEta, q.protocolBps, q.redeemRelayerFee);
}
// Output today: MCTP 99.769901 99.769901 1200 "20 min" 0 0.230099
// Solana USDC -> Sui USDC: MCTP 99.769901 eta 60
// Sui USDC -> Base USDC:   MCTP 99.963206 eta 60
```

## 4. Relay (relay.link)

Status for Sui today: NOT SUPPORTED.

Evidence: GET https://api.relay.link/chains returned 61 chains with vmType values evm, svm, bvm (bitcoin), tvm (tron), tonvm, xrpvm, hypevm (hyperliquid), lvm (lighter). No Move VM, no Sui. GET https://api.testnets.relay.link/chains has no non-EVM chain at all. The docs supported-chains page says "Relay can easily be added to any EVM-chain" and never mentions Sui.

Quote attempt recorded:

```
POST https://api.relay.link/quote
{"user":"0x5520...","originChainId":8453,"destinationChainId":9270000000000000,
 "originCurrency":"0x8335...2913","destinationCurrency":"0xdba3...::usdc::USDC",
 "amount":"100000000","tradeType":"EXACT_INPUT","recipient":"0x7d20...b58e"}
-> {"message":"Invalid recipient address 0x7d20...b58e for chain 9270000000000000","errorCode":"INVALID_ADDRESS"}
```

Control (Base USDC to Solana USDC, 100 USDC): out 99.718189, fees relayer 0.28 USD (relayerGas 0.23, relayerService 0.05), app 0, details.timeEstimate 1.

Architecture in five lines: user deposits to a Relay solver's address with an order hash; the solver (Relay's own solver network) pays on the destination in one to a few seconds; settlement is off-chain accounting plus periodic rebalancing; user trusts the solver to fill or refund; app fees are added on top via appFees [{recipient, fee bps}].
Fee model: 0.02 USD flat execution cost plus destination gas, platform fee 0 percent for bridges, 0.01 percent stable swaps, 0.06 percent major swaps, 0.15 percent minor swaps; revenue share for partners above 10M USD per 30 days.
SDK: @relayprotocol/relay-sdk 7.0.3 (2026-09-03); older @reservoir0x/relay-sdk 2.4.0. Testnet API exists (api.testnets.relay.link), EVM only.

## 5. LI.FI (li.quest, chainType MVM)

Status for Sui today: SUPPORTED as destination via Mayan MCTP; supported as source in the route planner but transaction generation requires a wallet that actually holds the coin; Fast MCTP from Sui is refused; Allbridge is disabled.

Identity: chain key sui, id 9270000000000000, chainType MVM, native token 0x2::sui::SUI (LI.FI writes the long form 0x000...002::sui::SUI).

Tools for Sui (GET /v1/tools?chains=9270000000000000): bridges allbridge, mayan, mayanMCTP, gasZipBridge, mayanFastMCTP; exchanges aftermath, bluefin7k, momentum, cetus. So the only intent-adjacent path into Sui inside LI.FI is Mayan.

Quote into Sui (live, 2026-09-07):

```
GET https://li.quest/v1/quote?fromChain=8453&toChain=9270000000000000
  &fromToken=0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913
  &toToken=0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC
  &fromAmount=100000000
  &fromAddress=0x552008c0f6870c2f77e5cC1d2eb9bdff03e30Ea0
  &toAddress=0x7d20dcdb2bca4f508ea9613994683eb4e76e9c4ed371169677c1be02aaf0b58e

tool: mayanMCTP ("CCTP + Mayan")
estimate.toAmount 99519976, toAmountMin 99420685, executionDuration 1200 s
feeCosts: LIFI Fixed Fee 250000 (0.25 USDC, 0.25 percent, included, integratorFee 0)
gasCosts: 0.0096 USD on Base
includedSteps: feeCollection (protocol) then mayanMCTP (cross)
transactionRequest.to: 0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE (LiFiDiamond on Base), approvalAddress same
```

Other results: Ethereum USDC to Sui USDC 900 s; Arbitrum USDC 1200 s; Base USDC to native SUI 120.667570320 SUI. /v1/advanced/routes for Base to Sui returned a single route tagged RECOMMENDED, CHEAPEST, FASTEST, all mayanMCTP. Compared with Mayan direct (99.769902 out), LI.FI's 0.25 USDC fixed fee is the difference.

Out of Sui, recorded failures and the reason:

```
GET /v1/quote?fromChain=9270000000000000&toChain=8453&fromToken=<Sui USDC>&toToken=<Base USDC>&fromAmount=100000000&fromAddress=<sui addr>&toAddress=<evm addr>
-> {"message":"None of the available routes could successfully generate a tx","code":1001}

POST /v1/advanced/routes (same pair) -> 1 route: mayanMCTP, executionDuration 60, toAmount 99713278
  unavailableRoutes.filteredOut: allbridge "Tool allbridge is currently disabled for this action."
  unavailableRoutes.failed: mayanFastMCTP NO_POSSIBLE_ROUTE "source chain not supported for fast-mctp"
POST /v1/advanced/stepTransaction (that step)
-> {"message":"[sui] No coin object found for type 0xdba3...::usdc::USDC for address 0x69b7...2ec6","code":1001}
```

So LI.FI builds the Sui PTB server side against the sender's real coin objects. In the class, quoting out of Sui only works with the connected wallet's address, which is how the widget behaves anyway.

Solana to Sui failed today only because the sample Solana address had no SOL: "SOL balance insufficient to cover temporary token account creation". Also note "Implicit source swaps are currently not supported for non-EVM chains".

Integrator fee: passing integrator=<name>&fee=0.003 returned {"code":1011,"message":"Integrator \"suihub-lagos\" is not configured for collecting fees. Please sign up on https://portal.li.fi/ ..."}. Docs: fees on Sui and Solana are sent straight to the integrator's fee wallet, no claim step; LI.FI takes a share.

SDK and widget (npm, checked today):
- @lifi/sdk 4.6.1 (2026-08-28). v4 API is createClient({ integrator }) then getQuote(client, params). Verified run today: tool mayanMCTP, toAmount 99519976, duration 1200, latency 4.3 s.
- Sui provider: @lifi/sdk-provider-sui, SuiProvider({ getClient: () => dAppKit.getClient(), getSigner: () => new CurrentAccountSigner(dAppKit) }) using @mysten/dapp-kit-react (createDAppKit, DAppKitProvider). Legacy @mysten/dapp-kit is called out as deprecated.
- @lifi/widget 4.6.0 (2026-09-04) with @lifi/widget-provider-sui; peer @mysten/dapp-kit-react ^2.0.0; the widget reuses an existing DAppKitContext if present.
- Testnet: staging.li.quest requires permission ("You do not have permissions to access staging.li.quest").

Verified TypeScript (ran today):

```ts
import { createClient, getQuote } from "@lifi/sdk"; // 4.6.1
const client = createClient({ integrator: "suihub-lagos-class" });
const q = await getQuote(client, {
  fromChain: 8453, toChain: 9270000000000000,
  fromToken: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  toToken: "0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC",
  fromAmount: "100000000",
  fromAddress: "<evm sender>", toAddress: "<sui recipient 0x...>",
});
console.log(q.tool, q.estimate.toAmount, q.estimate.executionDuration, q.transactionRequest?.to);
// mayanMCTP 99519976 1200 0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE
```

## 6. Across

Status for Sui today: NOT SUPPORTED, no roadmap mention found.

Evidence: GET https://app.across.to/api/chains returned 21 chains (Ethereum, MegaETH, Optimism, Polygon, Arbitrum, Avalanche, zkSync, Base, Linea, World Chain, Ink, Soneium, Unichain, BSC, Solana, HyperEVM, Plasma, Monad, Tempo, TRON, Robinhood). available-routes: 1006 routes, none with a Sui chain id. suggested-fees with a Sui token address returned {"type":"AcrossApiError","code":"INVALID_PARAM","status":400,"message":"Invalid parameter at path 'outputToken'. Expected type 'union'"}. Docs supported-chains: Solana is the only non-EVM chain; ARC (5042) "coming soon"; Sui absent.

Architecture in five lines: depositor locks in SpokePool; relayers fill from own capital on destination; fills are bundled by the Dataworker about every 1.5 hours and proposed to the HubPool with a bond; UMA optimistic oracle accepts unless disputed ("only a single honest actor needs to dispute"); relayers are repaid from LP pools. Mainnet fills "sub-two second"; testnet about 1 minute.

## 7. The rest of the field, one line each

| Protocol | Intent-based? | Sui status today | Evidence |
|---|---|---|---|
| Squid (Axelar) | Squid Intents (Coral) is intent-based, EVM only ("Bitcoin and Solana support is coming soon") | Sui is in the chain list (chainId "sui-mainnet", chainType "sui") with a token list, but POST /v2/route into or out of Sui returned 500 {"message":"Cannot read properties of undefined (reading 'isEvmos')"} with toChain "sui" and 403 {"message":"Apologies, swaps are currently unavailable."} with "sui-mainnet" under the public widget integrator id. Sui path would be Axelar GMP or ITS, not intents. | apiplus.squidrouter.com/v2/chains, /v2/route, docs coral pages |
| Bungee / Socket | Bungee Auto is intent-based (solvers); Manual routes are bridges | Socket V3 lists Sui, chain id 1110006 (GET public-backend.socket.tech/v3/swap/supported-chains, 39 chains). A live quote Base USDC to Sui USDC returned 200 with routes: [] and quoteRejections gaszip "disabled by admin rule" and changenow "Temporarily disabled". No solver route. Old Bungee v1 API returns 410 Gone. | docs.socket.tech/about/chain-support, live quote |
| Rango | Aggregator, not intent | Sui listed as a blockchain ("SUI", type sui-mainnet) but no bridge row in the integrations tables lists Sui; deBridge marked pending; Mayan not listed | docs.rango.exchange/integrations |
| Symbiosis | Pool-based | No Sui in GET api.symbiosis.finance/crosschain/v1/chains (58 chains) | live API |
| Eco Routes | Intent-based (publish and fund intent, solver fills, prover carries proof, Portal releases), 20 to 40 s | No Sui; supported chains Ethereum, OP, Unichain, Polygon, HyperEVM, Ronin, Base, Arbitrum, Tron, Solana | docs.eco.com/resources/supported-chains-tokens |
| Owlto | Maker liquidity, "intent-driven execution" marketing | No Sui in the 19-chain table | docs.owlto.finance/basics/supported-networks-and-tokens |
| Orbiter | Maker model (makers hold inventory, dealers run front ends); not an auction | Sui listed as SUI_MAIN, VM type SUIVM, in supported-chains; REST is POST /quote with sourceChainId, destChainId, sourceToken, destToken, amount, userAddress, targetRecipient at https://api.orbiter.finance (docs). The API was unreachable from Lagos today (empty responses, nginx 404 on openapi host), so no live quote. | docs.orbiter.finance |
| rhino.fi | Fast bridge with rhino as liquidity provider | No Sui in GET api.rhino.fi/bridge/configs (27 chains, includes Solana, Starknet, TON, Tron, Stellar) | live API |

## 8. Sui-native and Sui-first options

### 8.1 Cetus and 7k

- Cetus developer docs list CLMM, DLMM, vaults, farms, limit orders and the Cetus Aggregator; no bridge or cross-chain SDK. The app's bridge page did not expose any Wormhole or Mayan identifiers to a plain fetch. Treat any "Cetus Bridge" claim as unverified.
- 7k docs sitemap has aggregator, LP Pro and SDK pages only; no bridge page.
- Both matter for intent bridging in a different way: LI.FI uses cetus, bluefin7k, aftermath and momentum as the destination-side DEXes when a route ends in a non-USDC Sui token, and Mayan drivers do the same job on their side.

### 8.2 Is there a Sui-native intent bridge?

None found. Mayan's Swift package is on Sui (SUI_SWIFT_STATE 0x7ac01a7c14c53098a41593c7623823bb677b5201fb3ee35b75b47cfc6c6c6f40, fee manager 0xe42174b6d742f40bd2b67b967542b21e6d7433f2d277a80bb59866ac73ff3f52, from the SDK addresses file) and the SDK ships createSwiftFromSuiMoveCalls, but the quote service returns no Swift route touching Sui and the Swift docs list twelve deployed chains without Sui. That is the thing to watch; when Sui appears in the Swift list, the same SDK call flips from a 20 minute CCTP route to a 2 second auction.

### 8.3 Wormhole Settlement and Sui

Wormhole Settlement is Mayan Swift (primary, intent auction on Solana) plus Mayan MCTP (CCTP fallback "for chains that aren't supported by Swift"). Sui is exactly that fallback case today: Settlement into Sui equals MCTP. Wormhole's own Settlement pages do not list chains; the Mayan chain table is the source of truth.

### 8.4 Do not conflate: Sui "Payment Intents" versus bridging intents

Sui's docs (docs.sui.io/onchain-finance/payment-intents) define a payment intent as "a single atomic transaction that bundles multiple, heterogeneous payment operations" and state plainly that "a payment intent is a form of programmable transaction block (PTB)": an app resolves context, plans the operations (swap, deposit, transfer, balance read), the user signs once, "all operations execute as a unit. If any operation fails, the entire batch reverts", and a sponsor can pay gas. Everything happens on Sui, inside one transaction, with no solver, no auction, no other chain and no settlement step. The word "intent" there means "the user's declared outcome, compiled into one PTB", and the related Payment Kit (@mysten/payment-kit, PaymentRegistry, process_registry_payment, ephemeral payments) is a receipts and duplicate-prevention library, also single chain. Two more Sui uses of the word exist and are also unrelated to bridging: intent signing (the 3-byte IntentScope, IntentVersion, AppId domain separator every Sui signature commits to) and the TypeScript SDK's transaction intents such as coinWithBalance, which the client-side resolver replaces with concrete commands at build time. A bridging intent, by contrast, is an order that a third party fills on a different chain from its own inventory and gets repaid later; the "atomicity" is economic (fill or refund), not transactional. In class: Sui Payment Intents are how you compose the destination-side action; Mayan or LI.FI are how the money arrives.

## 9. Ranking for a Sui dApp today

1. Mayan direct (@mayanfinance/swap-sdk 15.2.2). Only protocol with native Sui in both directions, real fills every few minutes, a Sui-aware referrer fee mechanism (referrerAddresses.sui), composable Move calls (builtTransaction and inputCoin options), no protocol fee on USDC, and the Swift upgrade path already in the SDK. Downsides: no testnet, EVM to Sui is 15 to 20 minutes, widget is a CDN script not a React package, referrer must hold Solana ATAs.
2. LI.FI (@lifi/sdk 4.6.1 plus @lifi/widget 4.6.0 with the Sui providers). Best developer experience: one API for 60 plus chains, a drop-in widget that already speaks @mysten/dapp-kit-react, destination swaps through Cetus, 7k, Aftermath and Momentum, integrator fees paid straight to a Sui wallet. Downsides: 0.25 percent fixed fee on top of Mayan, same MCTP speed, Sui-as-source only quotes for a funded wallet, integrator fee needs portal registration, no testnet access without approval.
3. Socket V3 and Squid. Sui is in their chain tables so the code paths exist, but neither produced a route today (Socket: zero routes, only disabled gaszip and changenow providers considered; Squid: 403 and 500). Worth a retry before recommending.
4. Orbiter and Rango. Sui listed, maker or aggregator models rather than auctions, unreachable or route-less today.
5. deBridge DLN, Relay, Across, Eco. The best pure intent bridges in the industry and none supports Sui. Teach them as the reference architecture, demo one with a Base to Solana quote, and be explicit that Sui is missing.

## 10. Demo recommendation for tomorrow (under ten minutes, verified today)

Do this:

1. Terminal, 2 minutes: run the Mayan fetchQuote script from 3.8 three times: Base USDC to Sui USDC (shows type MCTP, 20 min ETA, 0 protocol bps, 0.23 relayer fee), Solana USDC to Sui USDC (60 s), Sui USDC to Base USDC (60 s). Then run the swift-only curl and show ROUTE_NOT_FOUND. That single contrast is the lesson: Sui is reachable, but not yet by the auction.
2. Terminal, 1 minute: run the deBridge control quote (Base USDC to Solana USDC) and point at TakerMargin, DlnProtocolFee and approximateFulfillmentDelay: 1. That is what a solver auction quote looks like. Then run the same call with any Sui id and show the "dstChainId must be one of" rejection.
3. Live fill, 3 to 4 minutes, mainnet, small: from a Sui wallet with about 5 USDC and a little SUI, send Sui USDC to Solana USDC or Base USDC through swap.mayan.finance or through createSwapFromSuiMoveCalls signed by dapp-kit. Observed today: 11 to 20 seconds to REDEEMED. Poll https://explorer-api.mayan.finance/v3/swap/trx/<sui digest> on the projector. Do not demo EVM to Sui live; the quote itself says 15 to 20 minutes and a refund path exists.
4. Optional, 2 minutes: open a Vite page with LiFiWidget and providers: [SuiProvider()], pick Base USDC to Sui USDC, show the same mayanMCTP route with the 0.25 USDC LI.FI fee added, and show the Sui wallet connect coming from @mysten/dapp-kit-react.

There is no testnet for any of this. Mayan has none, LI.FI staging is gated, Relay and Across testnets are EVM only, DLN has none documented. Budget about 1 USD in fees for the mainnet fill.

Backup if the venue network is bad: the JSON responses in this document are complete enough to read aloud.

## 11. Unverified claims (state them as such if used)

- That deBridge, Relay or Across have Sui on a roadmap. No document found either way; web search was unavailable this session so announcements after the docs were not checked.
- That Mayan Swift will enable Sui soon. Inferred only from the presence of SUI_SWIFT_STATE and createSwiftFromSuiMoveCalls in the SDK; no date or announcement found.
- That Mayan has no testnet. Inferred from absence in SDK addresses and docs.
- That DLN has no testnet. Inferred from absence in the docs index.
- Squid's Sui path being Axelar GMP or ITS specifically. The chain list proves Sui is configured; the route error hides the mechanism.
- Orbiter Sui routes and fees. Docs list SUI_MAIN and a maker model; the API could not be reached from this network.
- Cetus offering any bridge product. Nothing in developer docs; the app page could not be inspected.
- Real Solana to Sui fill time being consistently about 34 seconds. One observation plus one 1135 second refund; the quote says 60 seconds.
- Relay details.timeEstimate unit (assumed seconds).
- Across "sub-two second" mainnet fills is the docs' claim, not measured here.

## Sources (all read 2026-09-07)

deBridge
- https://dln.debridge.finance/v1.0/supported-chains-info (live)
- https://dln.debridge.finance/v1.0/dln/order/create-tx (live, Base to Solana control and Sui rejection)
- https://docs.debridge.com/llms.txt
- https://docs.debridge.com/home/architecture/supported-chains.md
- https://docs.debridge.com/dln-details/overview/fees-supported-chains.md
- https://docs.debridge.com/dln-details/overview/fee-structure.md
- https://docs.debridge.com/dln-details/overview/protocol-overview.md
- https://docs.debridge.com/dln-details/affiliates/affiliate-fees.md
- https://docs.debridge.com/api-reference/dln/this-endpoint-returns-the-data-for-a-transaction-to-place-a-cross-chain-dln-order.md
- https://docs.debridge.com/dln-details/widget/deBridge-widget.md
- npm view @debridge-finance/dln-client (17.6.2, 2026-04-10)

Mayan
- https://price-api.mayan.finance/v3/quote (live, all quotes in section 3)
- https://price-api.mayan.finance/v3/tokens?chain=sui (live)
- https://sia.mayan.finance/v10/init (live, Sui chain config)
- https://explorer-api.mayan.finance/v3/swaps?limit=100&offset=N (live, 15 pages)
- https://docs.mayan.finance/llms.txt
- https://docs.mayan.finance/integration/quote-api.md
- https://docs.mayan.finance/architecture/swift.md
- https://docs.mayan.finance/architecture/mctp.md
- https://docs.mayan.finance/how-mayan-works/intent-based-swaps.md
- https://docs.mayan.finance/build/fees-earning.md
- https://docs.mayan.finance/build/sdk/fetching-quotes.md
- https://docs.mayan.finance/build/sdk/executing-swaps.md
- https://docs.mayan.finance/resources/chains-contracts.md
- https://docs.mayan.finance/resources/technical-faq.md
- https://docs.mayan.finance/integration/swap-widget.md
- https://raw.githubusercontent.com/mayan-finance/swap-sdk/main/README.md
- https://raw.githubusercontent.com/mayan-finance/swap-sdk/main/src/api.ts
- https://raw.githubusercontent.com/mayan-finance/swap-sdk/main/src/types.ts
- https://raw.githubusercontent.com/mayan-finance/swap-sdk/main/src/addresses.ts
- https://raw.githubusercontent.com/mayan-finance/swap-sdk/main/src/sui/suiMctp.ts and suiSwift.ts
- npm view @mayanfinance/swap-sdk (15.2.2, 2026-08-31); local install and run on Node 26.4.0
- https://wormhole.com/docs/products/settlement/overview/
- https://wormhole.com/docs/products/settlement/concepts/architecture/

Relay
- https://api.relay.link/chains and https://api.testnets.relay.link/chains (live)
- https://api.relay.link/quote (live, Sui rejection and Base to Solana control)
- https://docs.relay.link/resources/supported-chains
- https://docs.relay.link/how-it-works/fees
- https://docs.relay.link/references/api/get-quote
- npm view @relayprotocol/relay-sdk (7.0.3, 2026-09-03)

LI.FI
- https://li.quest/v1/chains?chainTypes=MVM, /v1/tools?chains=9270000000000000, /v1/connections, /v1/quote, /v1/advanced/routes, /v1/advanced/stepTransaction (live)
- https://docs.li.fi/llms.txt
- https://docs.li.fi/introduction/lifi-architecture/sui-overview
- https://docs.li.fi/sdk/configure-sdk-providers
- https://docs.li.fi/widget/wallet-management
- https://docs.li.fi/introduction/integrating-lifi/monetizing-integration
- https://docs.li.fi/api-reference/get-a-quote-for-a-token-transfer
- npm view @lifi/sdk (4.6.1, 2026-08-28), @lifi/widget (4.6.0, 2026-09-04); local install and run

Across
- https://app.across.to/api/chains, /api/available-routes, /api/suggested-fees (live)
- https://docs.across.to/reference/supported-chains
- https://docs.across.to/concepts/intents-architecture-in-across

Others
- https://apiplus.squidrouter.com/v2/chains, /v2/tokens?chainId=sui-mainnet, /v2/route (live)
- https://docs.squidrouter.com/llms.txt, chains-and-tokens/get-supported-tokens-and-chains.md, api-and-sdk-integration/coral-intent-swaps/integrating-squid-intents.md, key-concepts/squid-aggregator/squid-intents.md
- https://public-backend.socket.tech/v3/swap/supported-chains and /v3/swap/quote (live); https://docs.socket.tech/about/chain-support.md; https://docs.socket.tech/api-reference/swap/get-quotes.md
- https://docs.rango.exchange/integrations.md
- https://api.symbiosis.finance/crosschain/v1/chains (live)
- https://docs.eco.com/llms.txt and https://docs.eco.com/resources/supported-chains-tokens.md
- https://docs.owlto.finance/llms.txt and https://docs.owlto.finance/basics/supported-networks-and-tokens.md
- https://docs.orbiter.finance/llms.txt, supported-chains.md, developer/rest-api/api-reference.md, welcome/maker-system.md
- https://api.rhino.fi/bridge/configs (live); https://docs.rhino.fi/llms.txt
- https://cetus-1.gitbook.io/cetus-developer-docs and https://cetus-1.gitbook.io/cetus-docs
- https://docs.7k.ag/sitemap.md

Sui
- https://docs.sui.io/onchain-finance/payment-intents
- https://docs.sui.io/onchain-finance/choose-payments-model
- https://docs.sui.io/standards/payment-kit
- https://sdk.mystenlabs.com/payment-kit
- https://sdk.mystenlabs.com/sui/transactions/coins-and-balances
- https://docs.sui.io/develop/transactions/transaction-auth/intent-signing
