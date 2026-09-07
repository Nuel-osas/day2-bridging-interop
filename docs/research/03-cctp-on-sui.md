# Circle CCTP on Sui: status, IDs, interfaces, and a testnet demo plan

Research date: 2026-09-07 (for the SuiHub Lagos bridging workshop on 2026-09-08).
Scope: EVM (Ethereum Sepolia) to Sui testnet USDC transfer via CCTP, in a TypeScript script.

## 0. Bottom line

- CCTP on Sui is still CCTP V1 (Legacy) only, on both testnet and mainnet, as of today. Circle's supported-chains page lists exactly two chains as "supported only by CCTP V1 (Legacy)": Noble (domain 4) and Sui (domain 8). Aptos has moved to V2; Sui has not.
- V1 is operational today. Verified live on 2026-09-07: Sepolia V1 MessageTransmitter `paused() == false`, Sepolia V1 TokenMessenger has a remote token messenger registered for domain 8, Sui testnet MessageTransmitter State and TokenMessengerMinter State both report `paused: false`, and the Sui testnet remote_token_messengers table maps domain 0 to the Sepolia V1 TokenMessenger.
- V1 is on a hard clock. Circle's blog of 2026-08-27 says V1 burn limits start decreasing on 2026-10-31 and V1 contracts are paused on 2026-12-01. Circle previously promised "Sui will be supported by V2 before the phase out begins"; as of today there is no public V2 Sui package, no V2 route to domain 8 registered on Sepolia, and the Iris V2 fee endpoint rejects domain 8. Treat this as an open risk and tell the class.
- A testnet demo tomorrow is feasible with the V1 path. The main constraints are attestation latency on the Sepolia side (Circle waits for Ethereum hard finality, roughly 13 to 19 minutes) and faucet friction for Sepolia ETH. Pre-fund wallets and pre-burn one transfer before class.
- Circle Bridge Kit (1.14.1) does not support Sui as source or destination. It ships Sui chain definitions, but only with V1 contract IDs, and the CCTP provider only treats chains with `contracts.v2` as supported. Use raw viem + @mysten/sui instead.

## 1. V1 versus V2 status on Sui, with dates

### What Circle has said, in order

1. 2025-11-14, Circle blog "CCTP V1 deprecation: CCTP V2 is now the canonical CCTP":
   "Circle intends to launch the canonical CCTP contracts on both Aptos and Sui by the end of the first half of 2026."
   "CCTP V1 (Legacy) will remain available during a deprecation period of ~10 months" with "its manual phase-out commencing on July 31, 2026."
   The canonical contracts were, at that time, live on all V1 chains "except Aptos, Noble, and Sui."
2. Circle docs "Migrate from CCTP V1 (Legacy) to V2" (read 2026-09-07, no last-updated date shown):
   "CCTP V1 will be phased out over the course of 10 months beginning in July 2026."
   "CCTP V2 contracts are available on all CCTP V1 chains except for Noble and Sui."
   "Sui will be supported by V2 before the phase out begins."
   "The deprecation process is designed to wind down activity gradually, message limits will tighten over time until no new burns can be initiated, bringing transfer volume to zero before contracts are fully paused."
   Note: this page still carries the older July 2026 framing and has not been reconciled with the August blog below.
3. 2026-08-27, Circle blog "Migrate to CCTP V2 ahead of CCTP V1 (Legacy) deprecation":
   "CCTP V1 (Legacy) burn limits will be reduced starting October 31, 2026, and performance will gradually decrease over a one month window."
   "CCTP V1 (Legacy) contracts will be paused on December 1, 2026, and any integration still pointing at them will stop transferring USDC crosschain."
   "Migration from CCTP V1 (Legacy) to CCTP V2 is required, not just recommended."
   Also restates that `replaceDepositForBurn` stopped being supported on V1 after 2026-01-12.
   The post does not mention Sui, Aptos, or Noble by name, and does not distinguish testnet from mainnet.
4. Circle docs "CCTP Supported Chains and Domains" (read 2026-09-07):
   "The following blockchains are supported only by CCTP V1 (Legacy)." The rows are Noble (4) and Sui (8).
   Sui row: `Sui | 8 | Sui packages, Quickstart` linking to `/cctp/v1/sui-packages` and `/cctp/v1/transfer-usdc-on-testnet-from-sui-to-ethereum`.
   "If a mainnet is listed, its official testnet is also supported. For example, Ethereum includes both Ethereum Mainnet and Ethereum Sepolia."
5. Circle docs "CCTP V1 Sui Package and Object IDs" carries the banner: "This is CCTP V1 (Legacy) version. For the latest version, see CCTP."

### Independent checks I ran on 2026-09-07 (all consistent with "Sui is V1-only, V1 is live")

- Sepolia V1 `MessageTransmitter.paused()` at `0x7865fAfC2db2093669d92c0F33AeEF291086BEFD` returned 0 (not paused). `localDomain() == 0`, `version() == 0`.
- Sepolia V1 `TokenMinter.paused()` at `0xE997d7d2F6E065a9A93Fa2175E878Fb9081F1f0A` returned 0.
- Sepolia V1 `TokenMessenger.remoteTokenMessengers(8)` at `0x9f3B8679c73C2Fef8b59B4f3444d4e156fb70AA5` returned `0x09c1efc7626f6d92fcdbf4cf2b0d82cc25620ac5406f082e7f8f0537dc640ef0` (nonzero, so the Sepolia to Sui V1 route is registered; this value is a derived Sui caller identifier, not an on-chain object ID).
- Sepolia V1 `TokenMinter.burnLimitsPerMessage(USDC)` returned `1000000000000` (1,000,000 USDC per message). This is the number that Circle says will start dropping on 2026-10-31.
- Sepolia V2 `TokenMessengerV2.remoteTokenMessengers(8)` at `0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA` returned all zeros (no V2 route to Sui), while `remoteTokenMessengers(6)` (Base) is set. So V2 to Sui is not wired on testnet today.
- Iris sandbox `GET /v2/burn/USDC/fees/0/8` returned HTTP 400 `{"error":"Invalid source/destination domain id"}`; `/v2/burn/USDC/fees/0/6` returned 200. Production `/v2/burn/USDC/fees/0/8` also returned 400. V2 does not know domain 8 as a destination.
- Sui testnet MessageTransmitter State object `0x98234bd0...` (via GraphQL): type `0x4931e06d...::state::State`, `local_domain: 8`, `message_version: 0`, `signature_threshold: 2`, `paused: false`, `next_available_nonce: 465416`, `used_nonces.size: 496794` (the route has real traffic).
- Sui testnet TokenMessengerMinter State object `0x5252abd1...`: type `0x31cc14d8...::state::State`, `paused: false`, `remote_token_messengers.size: 10`, `burn_limits_per_message` contains one entry of `1000000000000`.
- Sui testnet `remote_token_messengers[0]` (domain 0) = `0x0000000000000000000000009f3b8679c73c2fef8b59b4f3444d4e156fb70aa5`, i.e. the Sepolia V1 TokenMessenger, left-padded to 32 bytes.
- Sui testnet USDC Treasury object `0x7170137d...` has type `0x346e3233...::treasury::Treasury<0xa1ec7fc0...::usdc::USDC>`.
- circlefin/sui-cctp on GitHub: branches `master`, `testnet`, `mainnet` only; no V2 branch. Last non-dependabot commit 2024-12-10. Circle has V2 repos for Aptos, Solana, Stellar, Starknet, EVM; nothing V2 for Sui.

### What I could not confirm

- Whether Circle will ship V2 on Sui before 2026-12-01, or extend V1 on Sui past that date. No Circle statement found in 2026 addresses Sui specifically. The class should hear this as "works today, unsupported after December 1 unless Circle ships V2 on Sui."
- Whether testnet V1 contracts get paused on the same schedule as mainnet. Circle's posts do not distinguish testnet and mainnet.
- Whether Sepolia testnet attestations use fewer confirmations than mainnet. Circle's V1 confirmations page only gives Ethereum at "~65 blocks, ~13 to 19 minutes" and Sui at "1 block, ~8 seconds"; there is no testnet column.

## 2. Sui package and object IDs (CCTP V1)

Source: developers.circle.com/cctp/v1/sui-packages (read 2026-09-07). The testnet package IDs also match the `Move.lock` on the `testnet` branch of circlefin/sui-cctp, and the mainnet package IDs match the `mainnet` branch.

### Sui Testnet

| Component | ID |
|---|---|
| MessageTransmitter package | `0x4931e06dce648b3931f890035bd196920770e913e43e45990b383f6486fdd0a5` |
| TokenMessengerMinter package | `0x31cc14d80c175ae39777c0238f20594c6d4869cfab199f40b69f3319956b8beb` |
| MessageTransmitterState (shared) | `0x98234bd0fa9ac12cc0a20a144a22e36d6a32f7e0a97baaeaf9c76cdc6d122d2e` |
| TokenMessengerMinterState (shared) | `0x5252abd1137094ed1db3e0d75bc36abcd287aee4bc310f8e047727ef5682e7c2` |
| USDC Treasury object (shared) | `0x7170137d4a6431bf83351ac025baf462909bffe2877d87716374fb42b9629ebe` |
| USDC coin type | `0xa1ec7fc00a6f40db9693ad1415d0c193ad3906494428cf252621037bd7117e29::usdc::USDC` |
| DenyList (system, constant) | `0x403` |

### Sui Mainnet

| Component | ID |
|---|---|
| MessageTransmitter package | `0x08d87d37ba49e785dde270a83f8e979605b03dc552b5548f26fdf2f49bf7ed1b` |
| TokenMessengerMinter package | `0x2aa6c5d56376c371f88a6cc42e852824994993cb9bab8d3e6450cbe3cb32b94e` |
| MessageTransmitterState (shared) | `0xf68268c3d9b1df3215f2439400c1c4ea08ac4ef4bb7d6f3ca6a2a239e17510af` |
| TokenMessengerMinterState (shared) | `0x45993eecc0382f37419864992c12faee2238f5cfe22b98ad3bf455baf65c8a2f` |
| USDC Treasury object (shared) | `0x57d6725e7a8b49a7b2a612f6bd66ab5f39fc95332ca48be421c3229d514a6de7` |
| USDC coin type | `0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC` |
| DenyList (system, constant) | `0x403` |

USDC coin types are from developers.circle.com/stablecoins/usdc-contract-addresses and are identical to what Circle's own `@circle-fin/provider-cctp-v2` 1.13.0 hardcodes for `Sui` and `Sui_Testnet`.

There is no V2 page for Sui. Circle's V2 "contract addresses" reference points to separate pages for Solana, Stellar, and Starknet and does not mention Sui.

Sui CCTP domain ID: 8.

## 3. Move interfaces (exact signatures from circlefin/sui-cctp master)

### Burn side (Sui to elsewhere): `token_messenger_minter::deposit_for_burn`

```move
entry fun deposit_for_burn<T: drop>(
  coins: Coin<T>,
  destination_domain: u32,
  mint_recipient: address,
  state: &State,
  message_transmitter_state: &mut MessageTransmitterState,
  deny_list: &DenyList,
  treasury: &mut Treasury<T>,
  ctx: &TxContext
): (BurnMessage, Message)
```

Doc: `coins` "Coin of type T to be burned. Full amount in coins will be burned." Circle notes it is "Intended to be called directly by EOA (rather than a dependent package)". Variant with a destination caller:

```move
entry fun deposit_for_burn_with_caller<T: drop>(
  coins: Coin<T>,
  destination_domain: u32,
  mint_recipient: address,
  destination_caller: address,
  state: &State,
  message_transmitter_state: &mut MessageTransmitterState,
  deny_list: &DenyList,
  treasury: &mut Treasury<T>,
  ctx: &TxContext
): (BurnMessage, Message)
```

PTB argument order as used in Circle's own script (`scripts/sui-scripts/depositForBurn.ts`): `[coin, pure.u32(destination_domain), pure.address(mint_recipient), object(TokenMessengerMinterState), object(MessageTransmitterState), object("0x403"), object(Treasury)]` with `typeArguments: ["<usdc_pkg>::usdc::USDC"]`. `ctx` is implicit. For an EVM recipient, `mint_recipient` is the 20-byte EVM address left-padded to 32 bytes, passed as a Sui `address`.

### Receive side (EVM to Sui): four calls in one PTB

`message_transmitter::receive_message`:

```move
public fun receive_message(
  message: vector<u8>,
  attestation: vector<u8>,
  state: &mut State,
  ctx: &TxContext
): Receipt
```

Returns a hot-potato `Receipt { caller, recipient, source_domain, sender, nonce, message_body, current_version }`.

`token_messenger_minter::handle_receive_message`:

```move
public fun handle_receive_message<T: drop>(
    receipt: Receipt,
    state: &mut State,
    deny_list: &DenyList,
    treasury: &mut Treasury<T>,
    ctx: &mut TxContext
): StampReceiptTicketWithBurnMessage
```

Its doc comment: "After calling message_transmitter::receive_message::receive_message, one should call handle_receive_message from this module, followed by message_transmitter::receive_message::stamp_receipt and message_transmitter::receive_message::complete_receive_message."

`token_messenger_minter::handle_receive_message::deconstruct_stamp_receipt_ticket_with_burn_message(ticket): StampReceiptTicket<MessageTransmitterAuthenticator>` (returns the ticket; the burn message is dropped for a plain EOA flow).

`message_transmitter::receive_message`:

```move
public fun stamp_receipt<Auth: drop>(
  stamp_receipt_ticket: StampReceiptTicket<Auth>,
  state: &State
): StampedReceipt

public fun complete_receive_message(
  stamped_receipt: StampedReceipt,
  state: &State
)
```

Type argument for `stamp_receipt` is `<token_messenger_minter_pkg>::message_transmitter_authenticator::MessageTransmitterAuthenticator`.

The exact PTB from Circle's `scripts/sui-scripts/receiveMessage.ts` (targets and argument order):

```ts
const [receipt] = tx.moveCall({
  target: `${messageTransmitterId}::receive_message::receive_message`,
  arguments: [
    tx.pure.vector("u8", messageBytes),      // message as byte array
    tx.pure.vector("u8", attestationBytes),  // attestation as byte array
    tx.object(messageTransmitterStateId),
  ],
});
const [stampReceiptTicketWithBurnMessage] = tx.moveCall({
  target: `${tokenMessengerMinterId}::handle_receive_message::handle_receive_message`,
  arguments: [
    receipt,
    tx.object(tokenMessengerMinterStateId),
    tx.object("0x403"),                       // deny list, fixed address
    tx.object(treasuryId),                    // Treasury<USDC>
  ],
  typeArguments: [`${usdcId}::usdc::USDC`],
});
const [stampReceiptTicket] = tx.moveCall({
  target: `${tokenMessengerMinterId}::handle_receive_message::deconstruct_stamp_receipt_ticket_with_burn_message`,
  arguments: [stampReceiptTicketWithBurnMessage],
});
const [stampedReceipt] = tx.moveCall({
  target: `${messageTransmitterId}::receive_message::stamp_receipt`,
  arguments: [stampReceiptTicket, tx.object(messageTransmitterStateId)],
  typeArguments: [`${tokenMessengerMinterId}::message_transmitter_authenticator::MessageTransmitterAuthenticator`],
});
tx.moveCall({
  target: `${messageTransmitterId}::receive_message::complete_receive_message`,
  arguments: [stampedReceipt, tx.object(messageTransmitterStateId)],
});
tx.setGasBudget(1_000_000_000); // Circle's script sets this explicitly for object-passing PTBs
```

Minted USDC goes to the `mint_recipient` encoded in the burn message, not to the PTB sender. Anyone can submit the receive PTB (no `destination_caller` was set), which is convenient for a demo.

## 4. Attestation API (Iris)

Base URLs (Circle API reference, read 2026-09-07):
- Sandbox (testnets): `https://iris-api-sandbox.circle.com`
- Production (mainnets): `https://iris-api.circle.com`

V1 endpoint: `GET /v1/attestations/{messageHash}` where `messageHash` matches `^0x[a-fA-F0-9]{64}$` and is `keccak256(messageBytes)` of the `MessageSent(bytes message)` event. Response `{ "attestation": "0x..." | null, "status": "complete" | "pending_confirmations" }`. The older quickstart path without `/v1` (`/attestations/{messageHash}`) still routes; both returned the same 404 body for a fake hash on 2026-09-07. Circle's V1 quickstart states "The attestation service rate limit is 35 requests per second."

V2 endpoint (works for V1 burns too): `GET /v2/messages/{sourceDomainId}?transactionHash=0x...` (or `?nonce=`; at least one is required). Response `{ "messages": [ { "message", "eventNonce", "attestation", "decodedMessage", "cctpVersion" (1 or 2), "status" ("complete" | "pending_confirmations"), ... } ], "sourceTxHash" }`. For Sepolia the path is `/v2/messages/0?transactionHash=<burnTxHash>`. This avoids decoding the event to get the hash; the migration guide says "You no longer need to extract the message from the onchain transaction to fetch an attestation." I did not run a live V1 burn to confirm the V2 endpoint returns `cctpVersion: 1` payloads; the schema documents it, so keep the V1 endpoint as a fallback in the script.

Latency: Circle waits for hard finality on the source chain. For Ethereum this is "~65 blocks, ~13 to 19 minutes". For Sui as a source it is "1 block, ~8 seconds". No separate figure is published for Sepolia; plan for up to 20 minutes on the Sepolia to Sui leg.

## 5. Circle Bridge Kit (`@circle-fin/bridge-kit`)

- Latest: 1.14.1, published 2026-09-02 (npm). Depends on `@circle-fin/provider-cctp-v2` ^1.13.0.
- README: "The Bridge Kit supports 51 chains with 1250 total bridge routes through Circle's CCTPv2", "Mainnet (25 chains)" and "Testnet (26 chains)". Sui is not in either list. "Flexible adapters: Supporting EVM (Viem, Ethers) and Solana (@solana/web3)". There is no `@circle-fin/adapter-sui` on npm (the published adapters are `adapter-viem-v2` 1.17.1, `adapter-ethers-v6`, `adapter-solana` 1.7.2, `adapter-circle-wallets` 1.7.2).
- Inside `provider-cctp-v2` 1.13.0 there are chain definitions `Blockchain.Sui` and `Blockchain.Sui_Testnet` (`type: 'sui'`, `cctp.domain: 8`) whose `contracts` block contains only `v1: { type: 'split', tokenMessenger: 0x31cc14d8..., messageTransmitter: 0x4931e06d..., confirmations: 1 }` on testnet (and the mainnet package IDs on mainnet), with `forwarderSupported: { source: false, destination: false }`. The provider's support check is `return chain.cctp?.contracts.v2 !== undefined;`, so Sui is excluded. The CHANGELOG has no Sui entry.
- Conclusion: Bridge Kit cannot do EVM to Sui or Sui to EVM today. If you show it in class, show the EVM to EVM one-liner and state that `to: { chain: 'Sui_Testnet' }` is not a supported route.

What it looks like for a supported route, so the class can compare with the raw script (from the README):

```ts
import { BridgeKit } from '@circle-fin/bridge-kit'
import { createViemAdapterFromPrivateKey } from '@circle-fin/adapter-viem-v2'

const adapter = createViemAdapterFromPrivateKey({ privateKey: process.env.EVM_PK as `0x${string}` })
const kit = new BridgeKit()
const result = await kit.bridge({
  from: { adapter, chain: 'Ethereum_Sepolia' },
  to: { adapter, chain: 'Base_Sepolia' },
  amount: '1.00',
})
// kit.getSupportedChains({ chainType: 'evm' }) lists what is actually routable; Sui is absent.
```

## 6. EVM side on Ethereum Sepolia (CCTP V1)

Source: developers.circle.com/cctp/v1/evm-smart-contracts and usdc-contract-addresses (read 2026-09-07), plus live `cast` calls.

| Item | Value |
|---|---|
| Sepolia domain | 0 |
| Sui domain | 8 |
| USDC (Sepolia) | `0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238` (symbol USDC, 6 decimals, verified on chain) |
| V1 TokenMessenger | `0x9f3B8679c73C2Fef8b59B4f3444d4e156fb70AA5` |
| V1 MessageTransmitter | `0x7865fAfC2db2093669d92c0F33AeEF291086BEFD` (also what TokenMessenger.localMessageTransmitter() returns) |
| V1 TokenMinter | `0xE997d7d2F6E065a9A93Fa2175E878Fb9081F1f0A` (TokenMessenger.localMinter()) |
| V2 TokenMessengerV2 (not usable for Sui) | `0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA` |
| V2 MessageTransmitterV2 (not usable for Sui) | `0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275` |

Function (V1):

```solidity
function depositForBurn(
  uint256 amount,
  uint32 destinationDomain,
  bytes32 mintRecipient,
  address burnToken
) external returns (uint64 nonce);
```

Selector `0x6fd3504e`. Event to read from the MessageTransmitter: `event MessageSent(bytes message)`, topic0 `0x8c5261668696ce22758910d05bab8f186d6eb247ceac2af2e82c7dc17669b036`. `messageHash = keccak256(message)`.

Do not call the V2 `depositForBurn(uint256,uint32,bytes32,address,bytes32,uint256,uint32)` (selector `0x8e0250ee`) for Sui; V2 has no remote messenger for domain 8.

Encoding a Sui address as `bytes32 mintRecipient`: a Sui address is already 32 bytes, so the normalized `0x` + 64 hex string is the `bytes32` value as is. In viem: `pad(suiAddress as Hex, { size: 32 })` is a no-op safeguard; make sure the address is normalized to full length first (`normalizeSuiAddress` from `@mysten/sui/utils`). Circle's script does `web3.utils.padLeft(destAddress, 64)` for the same reason.

## 7. Faucets

- Circle faucet, `https://faucet.circle.com/`: "Developers can request 20 USDC on testnet every 2 hours, per address, and per blockchain." Supports Ethereum Sepolia and Sui Testnet (and 40+ others). Use this for both Sepolia USDC and, if you want a Sui to EVM reverse demo, Sui testnet USDC.
- Sepolia ETH for gas:
  - Alchemy `https://www.alchemy.com/faucets/ethereum-sepolia`: "You can request 0.1 ETH once every 24 hours." Requires "at least 0.001 ETH on Ethereum Mainnet" and mainnet activity on the wallet.
  - Google Cloud `https://cloud.google.com/application/web3/faucet/ethereum/sepolia`: Google sign-in, no mainnet balance requirement (page content did not render for me; amounts unconfirmed).
  - QuickNode: roughly 0.05 ETH per 12 hours, requires 0.001 mainnet ETH (third-party summary, unconfirmed).
  Recommendation: fund one instructor Sepolia wallet tonight; a single depositForBurn plus approve costs well under 0.01 Sepolia ETH.
- Sui testnet SUI for gas: `https://faucet.sui.io/`, or `sui client faucet`, or the SDK: `requestSuiFromFaucetV2({ host: getFaucetHost('testnet'), recipient })` where `getFaucetHost('testnet')` returns `https://faucet.testnet.sui.io`.

## 8. Example repos and prior art

- `https://github.com/circlefin/sui-cctp` (official). `scripts/sui-scripts/depositForBurn.ts` (Sui to EVM), `scripts/sui-scripts/receiveMessage.ts` (EVM to Sui), `scripts/sui-scripts/helpers.ts`. These target localnet (Anvil + local Sui) and sign attestations locally with a dummy attester; on testnet you replace `attestToMessage(...)` with an Iris poll and the localnet IDs with the testnet IDs above. They use `@mysten/sui` ^1.0.3 (`SuiClient` JSON-RPC) and `web3`, so they need porting (see section 9).
- Circle docs quickstart "Transfer USDC on testnet from Sui to Ethereum" (`/cctp/v1/transfer-usdc-on-testnet-from-sui-to-ethereum`) is the same code as the repo scripts with testnet framing. It does not include an EVM to Sui walkthrough; the repo's `receiveMessage.ts` is the reference for that direction.
- `https://github.com/circlefin/circle-cctp-crosschain-transfer`: Next.js + viem sample for CCTP (V2) across EVM testnets and Solana. No Sui. Useful for the viem approve/burn/poll pattern only.
- Community TypeScript examples of EVM to Sui CCTP: I found none I could verify as primary sources within this session's search budget. Flagging as not confirmed. The repo script above is sufficient.

## 9. Script plan: Sepolia burn, attestation poll, Sui receive

SDKs: `viem` 2.56.3 (EVM), `@mysten/sui` 2.29.0 (Sui). Two important environment facts for the Sui side:

- Public Sui fullnodes no longer serve JSON-RPC. A `sui_getObject` call to `https://fullnode.testnet.sui.io:443` on 2026-09-07 returned `Method not found. JSON-RPC on public fullnodes has been deprecated. Please migrate to gRPC or GraphQL endpoints.` Sui docs: "JSON-RPC is disabled on Sui Foundation Mainnet full nodes. The shutoff took effect the week of July 27, 2026." Use `SuiGrpcClient` from `@mysten/sui/grpc` (the README calls it "the recommended client for all operations"); `@mysten/sui/jsonRpc` still exists in 2.29.0 but will not work against public nodes.
- `SuiGrpcClient` in 2.29.0 exposes `signAndExecuteTransaction({ transaction, signer, include })`, `waitForTransaction`, `getBalance`, `listCoins`, `getObject`. The `include` object takes `{ effects, events, balanceChanges }` booleans (`TransactionInclude`). `Transaction` still lives at `@mysten/sui/transactions` with `tx.pure.u32`, `tx.pure.address`, `tx.pure.vector('u8', bytes)`, `tx.object`, `tx.moveCall`, `tx.setGasBudget`.

### Files

```
cctp-demo/
  .env                # EVM_PK, SUI_PK (suiprivkey...), SEPOLIA_RPC
  src/config.ts       # the IDs from sections 2 and 6
  src/01-burn.ts      # viem: approve + depositForBurn, prints txHash
  src/02-attest.ts    # poll Iris, writes message + attestation to out/attestation.json
  src/03-receive.ts   # @mysten/sui: 5-call PTB
```

Splitting into three scripts matters for the demo: run 01 before class (or at the very start), show 02 polling, then run 03 live once `status === "complete"`.

### 01-burn.ts (viem)

```ts
import { createWalletClient, createPublicClient, http, parseAbi, parseEventLogs, keccak256, pad, type Hex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { sepolia } from 'viem/chains'
import { normalizeSuiAddress } from '@mysten/sui/utils'

const USDC = '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238'
const TOKEN_MESSENGER = '0x9f3B8679c73C2Fef8b59B4f3444d4e156fb70AA5'
const SUI_DOMAIN = 8
const amount = 1_000_000n // 1 USDC (6 decimals); under the 1,000,000 USDC per-message burn limit

const account = privateKeyToAccount(process.env.EVM_PK as Hex)
const wallet = createWalletClient({ account, chain: sepolia, transport: http(process.env.SEPOLIA_RPC) })
const pub = createPublicClient({ chain: sepolia, transport: http(process.env.SEPOLIA_RPC) })

const erc20 = parseAbi(['function approve(address spender, uint256 amount) returns (bool)'])
const tokenMessenger = parseAbi(['function depositForBurn(uint256 amount, uint32 destinationDomain, bytes32 mintRecipient, address burnToken) returns (uint64)'])
const messageSent = parseAbi(['event MessageSent(bytes message)'])

const mintRecipient = pad(normalizeSuiAddress(process.env.SUI_RECIPIENT!) as Hex, { size: 32 })

const approveHash = await wallet.writeContract({ address: USDC, abi: erc20, functionName: 'approve', args: [TOKEN_MESSENGER, amount] })
await pub.waitForTransactionReceipt({ hash: approveHash })

const burnHash = await wallet.writeContract({ address: TOKEN_MESSENGER, abi: tokenMessenger, functionName: 'depositForBurn', args: [amount, SUI_DOMAIN, mintRecipient, USDC] })
const receipt = await pub.waitForTransactionReceipt({ hash: burnHash })

const [log] = parseEventLogs({ abi: messageSent, logs: receipt.logs })
const messageBytes = log.args.message as Hex
console.log({ burnHash, messageHash: keccak256(messageBytes) })
// persist burnHash + messageBytes for step 02
```

### 02-attest.ts (poll Iris sandbox)

```ts
const IRIS = 'https://iris-api-sandbox.circle.com'

async function pollV2(burnHash: string) {
  for (;;) {
    const r = await fetch(`${IRIS}/v2/messages/0?transactionHash=${burnHash}`)
    if (r.status === 200) {
      const { messages } = await r.json()
      const m = messages?.[0]
      if (m?.status === 'complete') return { message: m.message as string, attestation: m.attestation as string }
    }
    await new Promise(res => setTimeout(res, 5000)) // stay well under 35 req/s
  }
}

// Fallback if the V2 endpoint does not return the V1 message:
async function pollV1(messageHash: string) {
  for (;;) {
    const r = await fetch(`${IRIS}/v1/attestations/${messageHash}`)
    if (r.status === 200) {
      const j = await r.json()
      if (j.status === 'complete') return j.attestation as string // pair with messageBytes from step 01
    }
    await new Promise(res => setTimeout(res, 5000))
  }
}
```

Expect roughly 13 to 19 minutes on Sepolia. Show the 404 "Message not found" then "pending_confirmations" then "complete" states as teaching moments.

### 03-receive.ts (@mysten/sui v2, gRPC)

```ts
import { SuiGrpcClient } from '@mysten/sui/grpc'
import { Transaction } from '@mysten/sui/transactions'
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import { decodeSuiPrivateKey } from '@mysten/sui/cryptography'
import { fromHex } from '@mysten/sui/utils'

const MT_PKG   = '0x4931e06dce648b3931f890035bd196920770e913e43e45990b383f6486fdd0a5'
const TMM_PKG  = '0x31cc14d80c175ae39777c0238f20594c6d4869cfab199f40b69f3319956b8beb'
const MT_STATE = '0x98234bd0fa9ac12cc0a20a144a22e36d6a32f7e0a97baaeaf9c76cdc6d122d2e'
const TMM_STATE= '0x5252abd1137094ed1db3e0d75bc36abcd287aee4bc310f8e047727ef5682e7c2'
const TREASURY = '0x7170137d4a6431bf83351ac025baf462909bffe2877d87716374fb42b9629ebe'
const USDC_TYPE= '0xa1ec7fc00a6f40db9693ad1415d0c193ad3906494428cf252621037bd7117e29::usdc::USDC'
const DENY_LIST= '0x403'

const client = new SuiGrpcClient({ network: 'testnet', baseUrl: 'https://fullnode.testnet.sui.io:443' })
const signer = Ed25519Keypair.fromSecretKey(decodeSuiPrivateKey(process.env.SUI_PK!).secretKey)

const { message, attestation } = JSON.parse(await Bun.file('out/attestation.json').text()) // or fs.readFileSync

const tx = new Transaction()
const [receipt] = tx.moveCall({
  target: `${MT_PKG}::receive_message::receive_message`,
  arguments: [tx.pure.vector('u8', fromHex(message)), tx.pure.vector('u8', fromHex(attestation)), tx.object(MT_STATE)],
})
const [ticketWithBurn] = tx.moveCall({
  target: `${TMM_PKG}::handle_receive_message::handle_receive_message`,
  arguments: [receipt, tx.object(TMM_STATE), tx.object(DENY_LIST), tx.object(TREASURY)],
  typeArguments: [USDC_TYPE],
})
const [ticket] = tx.moveCall({
  target: `${TMM_PKG}::handle_receive_message::deconstruct_stamp_receipt_ticket_with_burn_message`,
  arguments: [ticketWithBurn],
})
const [stamped] = tx.moveCall({
  target: `${MT_PKG}::receive_message::stamp_receipt`,
  arguments: [ticket, tx.object(MT_STATE)],
  typeArguments: [`${TMM_PKG}::message_transmitter_authenticator::MessageTransmitterAuthenticator`],
})
tx.moveCall({
  target: `${MT_PKG}::receive_message::complete_receive_message`,
  arguments: [stamped, tx.object(MT_STATE)],
})
tx.setGasBudget(1_000_000_000)

const result = await client.signAndExecuteTransaction({
  transaction: tx,
  signer,
  include: { effects: true, events: true, balanceChanges: true },
})
console.log(result.digest, result.balanceChanges)
console.log(await client.getBalance({ owner: process.env.SUI_RECIPIENT!, coinType: USDC_TYPE }))
```

Notes for the live run:
- The PTB sender pays gas in SUI; the USDC lands at the `mint_recipient` from the burn message regardless of who submits.
- Each message nonce can be received once; a second run fails inside `receive_message`.
- `handle_receive_message` takes `&mut State` in the source even though the docs page lists `&State`; `tx.object(TMM_STATE)` handles both since the SDK resolves shared-object mutability when building.
- If `signAndExecuteTransaction` errors on object resolution, fall back to `client.waitForTransaction({ digest })` after `executeTransaction`, or confirm the object IDs with `client.getObject({ objectId, include: { type: true } })`.

### Class-day checklist

1. Tonight: fund instructor Sepolia wallet with ETH (Alchemy or Google faucet) and 20 USDC (Circle faucet). Fund instructor Sui testnet address with SUI (faucet.sui.io).
2. Tonight: run 01 and 02 once end to end and keep `out/attestation.json`. Optionally receive it, so you know the path works. Then run 01 again in the morning so a fresh message is "pending" during the lecture.
3. In class: show the pending Iris response, explain finality, receive the pre-attested message live with 03, then receive the morning one at the end if it has completed.
4. State clearly: this is CCTP V1; Circle pauses V1 contracts on 2026-12-01; Sui is one of two chains with no V2 yet; watch Circle's supported-chains page and the `circlefin/sui-cctp` repo for a V2 release.

## 10. Feasibility verdict

Yes, a Sepolia to Sui testnet CCTP demo is feasible tomorrow with V1. Nothing on either side is paused, the route is registered in both directions, Circle's faucets cover both USDC legs, and Circle's own reference PTB for the Sui receive is public. The two things that can bite are the 13 to 19 minute attestation wait on the Sepolia leg (mitigate by pre-burning) and the JSON-RPC shutoff on public Sui nodes (mitigate by using `SuiGrpcClient`, not the older `SuiClient` used in Circle's scripts).

## Sources (all read 2026-09-07)

- Circle blog, "CCTP V1 deprecation: CCTP V2 is now the canonical CCTP" (2025-11-14): https://www.circle.com/blog/cctp-version-updates
- Circle blog, "Migrate to CCTP V2 ahead of CCTP V1 (Legacy) deprecation" (2026-08-27): https://www.circle.com/blog/migrate-to-cctp-v2-ahead-of-cctp-v1-legacy-deprecation
- Circle blog index (used to locate 2026 CCTP posts): https://www.circle.com/blog-all
- Circle docs, Migrate from CCTP V1 (Legacy) to V2: https://developers.circle.com/cctp/migration-from-v1-to-v2
- Circle docs, CCTP Supported Chains and Domains: https://developers.circle.com/cctp/cctp-supported-blockchains
- Circle docs, Supported blockchains and domains (concepts): https://developers.circle.com/cctp/concepts/supported-chains-and-domains
- Circle docs, CCTP V1 Sui Package and Object IDs: https://developers.circle.com/cctp/v1/sui-packages
- Circle docs, CCTP V1 EVM smart contracts: https://developers.circle.com/cctp/v1/evm-smart-contracts
- Circle docs, CCTP V1 supported blockchains: https://developers.circle.com/cctp/v1/cctp-supported-blockchains
- Circle docs, CCTP V1 required block confirmations: https://developers.circle.com/cctp/v1/required-block-confirmations
- Circle docs, CCTP V1 quickstart Ethereum to Avalanche (attestation flow, 35 req/s): https://developers.circle.com/cctp/v1/transfer-usdc-on-testnet-from-ethereum-to-avalanche
- Circle docs, CCTP V1 quickstart Sui to Ethereum: https://developers.circle.com/cctp/v1/transfer-usdc-on-testnet-from-sui-to-ethereum
- Circle docs, CCTP V2 contract addresses (Sepolia V2 addresses): https://developers.circle.com/cctp/references/contract-addresses
- Circle docs, USDC contract addresses (Sepolia and Sui coin types): https://developers.circle.com/stablecoins/usdc-contract-addresses
- Circle API reference, V1 Get attestation: https://developers.circle.com/api-reference/cctp/all/get-attestation
- Circle API reference, V2 Get messages: https://developers.circle.com/api-reference/cctp/all/get-messages-v2
- Circle testnet faucet: https://faucet.circle.com/
- Circle docs index: https://developers.circle.com/llms.txt
- Arc docs, App Kit Bridge (bridge-kit docs redirect target): https://docs.arc.io/app-kit/bridge
- npm, @circle-fin/bridge-kit 1.14.1 (README, CHANGELOG, tarball inspected locally): https://www.npmjs.com/package/@circle-fin/bridge-kit
- npm, @circle-fin/provider-cctp-v2 1.13.0 (tarball inspected locally for Sui chain definitions): https://www.npmjs.com/package/@circle-fin/provider-cctp-v2
- GitHub, circlefin/sui-cctp (README, branches, Move sources, scripts): https://github.com/circlefin/sui-cctp
- GitHub, circlefin/sui-cctp deposit_for_burn.move: https://github.com/circlefin/sui-cctp/blob/master/packages/token_messenger_minter/sources/deposit_for_burn.move
- GitHub, circlefin/sui-cctp handle_receive_message.move: https://github.com/circlefin/sui-cctp/blob/master/packages/token_messenger_minter/sources/handle_receive_message.move
- GitHub, circlefin/sui-cctp receive_message.move: https://github.com/circlefin/sui-cctp/blob/master/packages/message_transmitter/sources/receive_message.move
- GitHub, circlefin/sui-cctp scripts: https://github.com/circlefin/sui-cctp/tree/master/scripts/sui-scripts
- GitHub, circlefin/circle-cctp-crosschain-transfer: https://github.com/circlefin/circle-cctp-crosschain-transfer
- npm, @mysten/sui 2.29.0 (README and d.mts typings inspected locally): https://www.npmjs.com/package/@mysten/sui
- Sui docs, JSON-RPC migration: https://docs.sui.io/develop/accessing-data/json-rpc-migration
- Sui docs, Get coins (faucet): https://docs.sui.io/guides/developer/getting-started/get-coins
- Alchemy Sepolia faucet: https://www.alchemy.com/faucets/ethereum-sepolia
- Google Cloud Sepolia faucet (content did not render): https://cloud.google.com/application/web3/faucet/ethereum/sepolia
- Crypto Economy, "Circle gives developers 95 days before CCTP V1 shuts down" (2026-08-28, secondary; used only to locate the Circle blog): https://crypto-economy.com/circle-gives-developers-95-days-before-cctp-v1-shuts-down/
- Live on-chain reads (2026-09-07): Sepolia via https://ethereum-sepolia-rpc.publicnode.com with foundry `cast`; Sui testnet via https://graphql.testnet.sui.io/graphql; Iris probes against https://iris-api-sandbox.circle.com and https://iris-api.circle.com.
