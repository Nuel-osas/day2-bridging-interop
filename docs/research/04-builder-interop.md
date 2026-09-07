# Interoperability options for building on Sui (research, 2026-09-07)

Prepared for SuiHub Lagos, Day 3 second half: "ways a Sui contract or app can act on or receive from other chains without a classic bridge".

Scope: Ika (dWallets), Hashi (native BTC collateral), cross-chain messaging (Wormhole, LayerZero, Axelar, ZetaChain, Sui Bridge), and other primitives (Sui light client, zkBridge, intent protocols such as deBridge and Mayan). Every fact below carries a source in the Sources section with the date it was read. Anything I could not confirm from a primary source is marked UNVERIFIED.

Important tooling note for every item: public Sui fullnodes no longer serve JSON-RPC. All current SDKs in this report (Ika 0.5.0, Hashi 0.6.13, Mayan 15.x, Wormhole sdk-sui 6.x) build on `@mysten/sui` v2 and `SuiGrpcClient`. LayerZero's Sui SDK still pins `@mysten/sui` ^1.33.0, so it cannot share a node_modules tree with the others without care. (Sources: Ika CHANGELOG 0.5.0; npm registry reads on 2026-09-07.)

---

## 0. One-table summary

| Primitive | What it gives a Sui builder | Status today | Live demo in under 1 hour? |
|---|---|---|---|
| Ika dWallets | A Sui contract holds a `DWalletCap` and approves messages that the Ika MPC network signs for Bitcoin, Ethereum, Solana etc. No asset is bridged. | Mainnet (beta) since 2025-07-28; testnet live; SDK 0.5.0 (2026-08-18) | Yes if you already hold testnet IKA. No public IKA testnet faucet found. |
| Hashi | Native BTC deposited to a per-user Taproot address is minted as `hBTC` (`Coin<BTC>`) on Sui by a committee of Sui validators plus a Guardian. | Testnet since 2026-07-22 (Sui testnet + Bitcoin Signet); mainnet TBD | Partly. Address derivation and deposit submission yes; mint completion needs Signet confirmations plus a time delay. |
| Wormhole core messaging | Emit arbitrary payloads from Move (`publish_message`), verify VAAs in Move. NTT for tokens. | Mainnet and testnet | Yes for emitting a message from a testnet Move package. NTT deploy is longer. |
| LayerZero V2 | Endpoint on Sui (EID 30378 mainnet, 40378 testnet), OApp and OFT Move packages, PTB-based Call pattern. | Mainnet (WBTC OFT live since 2025-12-05) and testnet | No. OFT deploy plus DVN and peer config exceeds an hour for first-timers. |
| Axelar GMP and ITS | `gateway::prepare_message` and `send_message` from Move, `ApprovedMessage` on receive; ITS for tokens. | Mainnet and testnet packages deployed | Maybe. A deployed Example package exists on testnet; docs site was unreachable during research. |
| ZetaChain Sui Gateway | `deposit_and_call` from Sui into universal contracts on ZetaChain; `on_call` callbacks into Move. | Live per ZetaChain and Sui docs | Maybe. Testnet gateway IDs not verified in this research. |
| Sui Bridge custom messaging | Stated in 2024 as a "later version" feature. | Not shipped; asset bridge only (ETH, WETH, WBTC, LBTC, USDT) | No. |
| Sui light client | Verify Sui checkpoints, transactions and objects off-chain from committee signatures. | Rust CLI in MystenLabs/sui | No (Rust build and sync). |
| deBridge DLN | Intent-based swaps via REST API. | Sui is NOT in the live supported-chains list | No. Remove from plan. |
| Mayan swap-sdk | Intent and Wormhole-based cross-chain swaps from a Sui PTB. | Mainnet, `@mysten/sui` v2 | Quote fetch yes (no funds needed); executing a swap needs mainnet funds. |

---

## 1. Ika (formerly dWallet Network)

### 1.1 What a dWallet is

Ika's own definition: dWallets are "non-collusive, massively decentralized, programmable and transferable signing mechanism with an address on any other blockchain, that can sign transactions to those networks." A developer on Sui "could generate a Bitcoin or an Ethereum signature within their smart contract." (Source: docs `core-concepts/dwallets.mdx`.)

Mechanically, a dWallet is a keypair on some target curve (secp256k1 for Bitcoin and Ethereum, ed25519 for Solana, secp256r1 for passkeys) whose private key never exists in one place. It is split into a user share and a network share; a signature requires both. The Sui-side handle is a `DWalletCap` object:

```move
/// contracts/ika_dwallet_2pc_mpc/sources/coordinator_inner.move
public struct DWalletCap has key, store {
    id: UID,
    /// ID of the controlled dWallet
    dwallet_id: ID,
}
```

Because it has `key, store`, a Move contract can hold it in a struct field, which is the entire integration model: whoever holds the cap decides which messages get signed.

### 1.2 2PC-MPC

2PC-MPC is a two-party computation where one party is the user and the other party is itself an MPC among the Ika validators (hundreds of nodes, threshold based). The Sui blog phrasing: users "remain one party while hundreds of Ika nodes form the other party." Ika runs its own network (a Sui fork) but uses Sui as the coordination and settlement layer; the `DWalletCoordinator` shared object on Sui is where every request (DKG, presign, sign) is posted and where results land. (Sources: Sui blog 2024-10-30 and 2025-07-28; Ika README.)

### 1.3 dWallet kinds: zero-trust, shared, imported-key

From the SDK docs (`dwallet-types.mdx`) and README:

| Kind | User share | Who can sign | Use |
|---|---|---|---|
| `zero-trust` | Encrypted, held by the user (class-groups encryption, decrypted client side) | Only with user participation | Custody, personal wallets, compliance that needs user consent |
| `shared` | Public, stored on-chain | The network alone, so a Move contract can trigger signing without a user | DAOs, treasuries, automated systems |
| `imported-key` | Existing private key imported, split into shares | As zero-trust (user needed) | Bring an existing wallet under contract control |
| `imported-key-shared` | Imported and made public | Network alone | Same as shared, with a pre-existing address |

Docs warning on imported keys: "Your original private key still exists outside the dWallet system. If compromised, it bypasses the dWallet security model entirely." Converting zero-trust to shared is irreversible.

For a class demo of "a Sui contract that controls a Bitcoin address", the shared variant is the simplest because the contract can sign without a browser round trip. The bundled `multisig-bitcoin` example uses exactly this (`request_dwallet_dkg_with_public_user_secret_key_share`).

### 1.4 Status as of 2026-09-07

- Mainnet: launched 2025-07-28 ("Ika Network Debuts, Letting Sui Smart Contracts Manage Cross-chain Assets", Sui blog). README today says "on mainnet in beta, coordinated on Sui". Latest release tags `release/mainnet-v1.4.1` and `release/testnet-v1.4.1`, both published 2026-09-04.
- Testnet: live, package IDs below.
- Solana: "pre-alpha" (announced 2026-03-31 per secondary sources; the docs home says "Solana Pre-Alpha is live"). UNVERIFIED date.
- SDK: `@ika.xyz/sdk` 0.5.0 published 2026-08-18. Depends on `@mysten/sui` ^2.20.1 and `@ika.xyz/ika-wasm` 0.3.0. The CHANGELOG is blunt: "0.4.x is broken against mainnet and testnet today" because the bundled WASM cannot parse the current reconfiguration outputs. Use 0.5.0.
- Token: IKA is "used to pay network fees and as delegated stake". Every dWallet operation takes both an IKA coin and a SUI coin.

### 1.5 Testnet and mainnet package IDs (from `sdk/typescript/src/client/network-configs.ts`)

Testnet:

```
ikaPackage                       0x1f26bb2f711ff82dcda4d02c77d5123089cb7f8418751474b9fb744ce031526a
ikaCommonPackage                 0x96fc75633b6665cf84690587d1879858ff76f88c10c945e299f90bf4e0985eb0
ikaSystemOriginalPackage         0xae71e386fd4cff3a080001c4b74a9e485cd6a209fa98fb272ab922be68869148
ikaSystemPackage                 0xde05f49e5f1ee13ed06c1e243c0a8e8fe858e1d8689476fdb7009af8ddc3c38b
ikaDwallet2pcMpcOriginalPackage  0xf02f5960c94fce1899a3795b5d11fd076bc70a8d0e20a2b19923d990ed490730
ikaDwallet2pcMpcPackage          0x6573a6c13daf26a64eb8a37d3c7a4391b353031e223072ca45b1ff9366f59293
ikaSystemObject                  0x2172c6483ccd24930834e30102e33548b201d0607fb1fdc336ba3267d910dec6 (initialSharedVersion 508060325)
ikaDWalletCoordinator            0x4d157b7415a298c56ec2cb1dcab449525fa74aec17ddba376a83a7600f2062fc (initialSharedVersion 510819272)
```

Mainnet:

```
ikaPackage                       0x7262fb2f7a3a14c888c438a3cd9b912469a58cf60f367352c46584262e8299aa
ikaDwallet2pcMpcOriginalPackage  0xdd24c62739923fbf582f49ef190b4a007f981ca6eb209ca94f3a8eaf7c611317
ikaDwallet2pcMpcPackage          0x23b5bd96051923f800c3a2150aacdcdd8d39e1df2dce4dac69a00d2d8c7f7e77
ikaDWalletCoordinator            0x5ea59bce034008a006425df777da925633ef384ce25761657ea89e2a08ec75f3 (initialSharedVersion 595876492)
```

You never type these; `getNetworkConfig('testnet' | 'mainnet')` returns them.

### 1.6 TypeScript SDK: install and client setup

```bash
pnpm add @ika.xyz/sdk @mysten/sui
# Node >= 18 (examples require Node 24)
```

```ts
import { getNetworkConfig, IkaClient } from '@ika.xyz/sdk';
import { SuiGrpcClient } from '@mysten/sui/grpc';

const suiClient = new SuiGrpcClient({
  baseUrl: 'https://fullnode.testnet.sui.io:443',
  network: 'testnet',
});

const ikaClient = new IkaClient({
  suiClient,
  config: getNetworkConfig('testnet'),
  cache: true,
  encryptionKeyOptions: { autoDetect: true },
});

await ikaClient.initialize();
```

Network names are exactly `'testnet'` and `'mainnet'`. There is no devnet config. A `SuiJsonRpcClient` pointed at a public fullnode fails with `Method not found`; JSON-RPC is only valid against localnet or a private fullnode. (Source: docs `sdk/ika-client/ika-client.mdx`, SDK README, CHANGELOG 0.5.0.)

### 1.7 Full flow: create a zero-trust dWallet, presign, sign with secp256k1

Note on "DKG rounds": the coordinator still exposes `request_dwallet_dkg_first_round` and `request_dwallet_dkg_second_round` (legacy v1 flow), but the current SDK and docs do DKG in one PTB with `requestDWalletDKG`. Under the hood the user computes their DKG contribution client side (WASM) with `prepareDKGAsync`, the network completes its part, and the dWallet moves through states `AwaitingKeyHolderSignature` then `Active` after you accept your encrypted share.

The code below is assembled from the docs page `sdk/ika-transaction/zero-trust.mdx` (read 2026-09-07) with the curve switched to secp256k1 and hash set for Bitcoin or Ethereum. `ikaCoin` and `suiCoin` are `Coin<IKA>` and `Coin<SUI>` transaction arguments you own (for example `tx.object(ikaCoinId)` and `tx.gas` after a split).

Step 1: keys and DKG.

```ts
import {
  Curve, Hash, SignatureAlgorithm,
  IkaTransaction, UserShareEncryptionKeys,
  createRandomSessionIdentifier, prepareDKGAsync,
  type ZeroTrustDWallet,
} from '@ika.xyz/sdk';
import { Transaction } from '@mysten/sui/transactions';

const curve = Curve.SECP256K1;                 // Bitcoin and Ethereum
const signerAddress = keypair.toSuiAddress();

// Root seed must be stored by the user; it derives the class-groups
// encryption keypair and an Ed25519 signing key.
const userShareEncryptionKeys = await UserShareEncryptionKeys.fromRootSeedKey(
  rootSeedBytes, curve,
);

const tx = new Transaction();
const ikaTx = new IkaTransaction({ ikaClient, transaction: tx, userShareEncryptionKeys });

// One time per address and curve. Safe to include again; skip if already registered.
await ikaTx.registerEncryptionKey({ curve });

const identifier = createRandomSessionIdentifier();
const dkgRequestInput = await prepareDKGAsync(
  ikaClient, curve, userShareEncryptionKeys, identifier, signerAddress,
);
const networkKey = await ikaClient.getLatestNetworkEncryptionKey();

const [dWalletCap] = await ikaTx.requestDWalletDKG({
  curve,
  dkgRequestInput,
  sessionIdentifier: ikaTx.registerSessionIdentifier(identifier),
  ikaCoin: tx.object(IKA_COIN_ID),
  suiCoin: tx.splitCoins(tx.gas, [tx.pure.u64(100_000_000)]),
  dwalletNetworkEncryptionKeyId: networkKey.id,
});

tx.transferObjects([dWalletCap], signerAddress);
const res = await suiClient.signAndExecuteTransaction({ transaction: tx, signer: keypair });
// Read the dWallet ID and encrypted user share ID from emitted events
// (DWalletDKGRequestEvent style events) or from the DWalletCap object.
```

Step 2: wait, then accept your encrypted share (activates the dWallet).

```ts
const dWallet = await ikaClient.getDWalletInParticularState(dWalletId, 'AwaitingKeyHolderSignature');

const tx2 = new Transaction();
const ikaTx2 = new IkaTransaction({ ikaClient, transaction: tx2, userShareEncryptionKeys });
await ikaTx2.acceptEncryptedUserShare({
  dWallet: dWallet as ZeroTrustDWallet,
  encryptedUserSecretKeyShareId,
  userPublicOutput: new Uint8Array(dWallet.state.AwaitingKeyHolderSignature?.public_output),
});
await suiClient.signAndExecuteTransaction({ transaction: tx2, signer: keypair });

const active = await ikaClient.getDWalletInParticularState(dWalletId, 'Active');
```

Step 3: presign. Global presigns are not tied to a dWallet and can be requested ahead of time (this is what makes signing fast). For zero-trust dWallets created on the current network, use a global presign.

```ts
const tx3 = new Transaction();
const ikaTx3 = new IkaTransaction({ ikaClient, transaction: tx3, userShareEncryptionKeys });
const presignCap = await ikaTx3.requestGlobalPresign({
  curve,
  signatureAlgorithm: SignatureAlgorithm.ECDSASecp256k1,
  ikaCoin: tx3.object(IKA_COIN_ID),
  suiCoin: tx3.splitCoins(tx3.gas, [tx3.pure.u64(100_000_000)]),
  dWalletNetworkEncryptionKeyId: networkKey.id,
});
tx3.transferObjects([presignCap], signerAddress);
await suiClient.signAndExecuteTransaction({ transaction: tx3, signer: keypair });

const presign = await ikaClient.getPresignInParticularState(presignId, 'Completed');
```

Step 4: approve the message and sign.

```ts
const encryptedUserSecretKeyShare = await ikaClient.getEncryptedUserSecretKeyShare(encryptedUserSecretKeyShareId);

// For Ethereum: message = 32 byte tx hash to sign, hashScheme = Hash.KECCAK256
// For Bitcoin legacy/segwit ECDSA: hashScheme = Hash.DoubleSHA256 (sighash preimage)
// For Bitcoin Taproot: signatureAlgorithm = SignatureAlgorithm.Taproot, hashScheme = Hash.SHA256
const message = sighashPreimageBytes;

const tx4 = new Transaction();
const ikaTx4 = new IkaTransaction({ ikaClient, transaction: tx4, userShareEncryptionKeys });

const messageApproval = ikaTx4.approveMessage({
  message,
  curve,
  dWalletCap: active.dwallet_cap_id,          // you must own the cap
  signatureAlgorithm: SignatureAlgorithm.ECDSASecp256k1,
  hashScheme: Hash.KECCAK256,
});

await ikaTx4.requestSign({
  dWallet: active as ZeroTrustDWallet,
  messageApproval,
  hashScheme: Hash.KECCAK256,
  verifiedPresignCap: ikaTx4.verifyPresignCap({ presign }),
  presign,
  encryptedUserSecretKeyShare,
  message,
  signatureScheme: SignatureAlgorithm.ECDSASecp256k1,
  ikaCoin: tx4.object(IKA_COIN_ID),
  suiCoin: tx4.splitCoins(tx4.gas, [tx4.pure.u64(100_000_000)]),
});
const signRes = await suiClient.signAndExecuteTransaction({ transaction: tx4, signer: keypair });

// Sign ID comes from the emitted sign request event.
const sign = await ikaClient.getSignInParticularState(
  signId, curve, SignatureAlgorithm.ECDSASecp256k1, 'Completed',
);
const rawSignature = Uint8Array.from(sign.state.Completed.signature);
// Broadcast: attach rawSignature to the Bitcoin or Ethereum transaction and send it
// with a normal RPC (bitcoinjs-lib, viem, ethers). Ika does not broadcast for you.
```

Deriving the foreign address: `publicKeyFromDWalletOutput(curve, dWalletOutput)` gives the secp256k1 public key; hash it the usual way (keccak for Ethereum, hash160 or x-only for Bitcoin).

Supported schemes (SDK README):

| Curve | Signature algorithm | Hashes |
|---|---|---|
| SECP256K1 | ECDSASecp256k1 | KECCAK256, SHA256, DoubleSHA256 |
| SECP256K1 | Taproot | SHA256 |
| SECP256R1 | ECDSASecp256r1 | SHA256, DoubleSHA256 |
| ED25519 | EdDSA | SHA512 |
| RISTRETTO | Schnorrkel (renamed from SchnorrkelSubstrate in 0.5.0) | Merlin |

### 1.8 Move integration: holding a DWalletCap and approving messages

Move.toml (docs `move-integration/getting-started.mdx`, testnet):

```toml
[dependencies]
Sui = { git = "https://github.com/MystenLabs/sui.git", subdir = "crates/sui-framework/packages/sui-framework", rev = "framework/testnet" }
ika_dwallet_2pc_mpc = { git = "https://github.com/dwallet-labs/ika.git", subdir = "deployed_contracts/testnet/ika_dwallet_2pc_mpc", rev = "main" }
ika = { git = "https://github.com/dwallet-labs/ika.git", subdir = "deployed_contracts/testnet/ika", rev = "main" }
```

Modules you touch: `ika::ika::IKA`, `ika_dwallet_2pc_mpc::coordinator::DWalletCoordinator`, `ika_dwallet_2pc_mpc::coordinator_inner::{DWalletCap, UnverifiedPresignCap, VerifiedPresignCap, MessageApproval}`, `ika_dwallet_2pc_mpc::sessions_manager::SessionIdentifier`.

The public entry point that gates every signature (from `coordinator.move`):

```move
public fun approve_message(
    self: &mut DWalletCoordinator,
    dwallet_cap: &DWalletCap,
    signature_algorithm: u32,
    hash_scheme: u32,
    message: vector<u8>,
): MessageApproval
```

`MessageApproval` is a hot potato consumed by `request_sign` (or `request_sign_and_return_id`, `request_sign_with_partial_user_signature_and_return_id`). Only code that can borrow the `DWalletCap` can mint an approval, so whatever Move logic wraps the cap is the policy: multisig quorum, time lock, price condition, DAO vote.

Numeric IDs are relative to the curve (docs table): curve SECP256K1 = 0; algorithm ECDSASecp256k1 = 0, Taproot = 1; hash KECCAK256 = 0, SHA256 = 1, DoubleSHA256 = 2 for ECDSA; SHA256 = 0 for Taproot. (The `signing.mdx` page uses different illustrative values; trust the table in `getting-started.mdx` and the SDK enums.)

Reference contract skeleton (docs `signing.mdx`, trimmed):

```move
module my_protocol::signer;

use ika::ika::IKA;
use ika_dwallet_2pc_mpc::{
    coordinator::DWalletCoordinator,
    coordinator_inner::{DWalletCap, UnverifiedPresignCap}
};
use sui::{balance::Balance, coin::Coin, sui::SUI};

const ECDSA: u32 = 0;
const KECCAK256: u32 = 0;

public struct Signer has key, store {
    id: UID,
    dwallet_cap: DWalletCap,
    presigns: vector<UnverifiedPresignCap>,
    ika_balance: Balance<IKA>,
    sui_balance: Balance<SUI>,
    dwallet_network_encryption_key_id: ID,
}

public fun sign_message(
    self: &mut Signer,
    coordinator: &mut DWalletCoordinator,
    message: vector<u8>,
    message_centralized_signature: vector<u8>, // user's partial sig from the SDK
    ctx: &mut TxContext,
): ID {
    let mut ika = self.ika_balance.withdraw_all().into_coin(ctx);
    let mut sui = self.sui_balance.withdraw_all().into_coin(ctx);

    let unverified = self.presigns.swap_remove(0);
    let verified = coordinator.verify_presign_cap(unverified, ctx);

    // This is the policy point. Add your checks before this line.
    let approval = coordinator.approve_message(&self.dwallet_cap, ECDSA, KECCAK256, message);

    let session = coordinator.register_session_identifier(
        ctx.fresh_object_address().to_bytes(), ctx,
    );

    let sign_id = coordinator.request_sign_and_return_id(
        verified, approval, message_centralized_signature, session, &mut ika, &mut sui, ctx,
    );

    self.ika_balance.join(ika.into_balance());
    self.sui_balance.join(sui.into_balance());
    sign_id
}
```

Real example in the repo: `examples/multisig-bitcoin/contract/sources/multisig.move` ("bitisi"), published on testnet at `0x98eec1dd5a67695bf03d55d355c81eedfcca5f4aee196f295305acdd574b1e94`. It creates a shared dWallet in `init` with `request_dwallet_dkg_with_public_user_secret_key_share`, stores the cap in `Multisig { dwallet_cap: DWalletCap, ... }`, and on an approved request calls `coordinator.approve_message(&self.dwallet_cap, ...)` then `request_sign_with_partial_user_signature_and_return_id`. That contract is the best teaching artifact for "Move governs a Bitcoin key".

### 1.9 IKA token, faucets, fees

- Fees: every DKG, presign, sign and future-sign call takes `&mut Coin<IKA>` and `&mut Coin<SUI>`; the protocol deducts what it needs and leaves the remainder. Amounts are "protocol-defined" and queryable via `coordinator.current_pricing()`. The KeySpring example budgets 1 IKA per operation by default (`IKA_FEE_BUDGET=1000000000`, so 9 decimals). Coordinator can also be subsidised (`subsidize_coordinator_with_ika`).
- Testnet IKA faucet: none found in docs, README, CLI reference, or examples. The Move getting-started page simply says you need "A Sui wallet with testnet SUI and IKA tokens". The CLI has `--ika-coin-id` for payment but no faucet subcommand. UNVERIFIED whether the Ika team hands out testnet IKA on request (Discord). Plan for this before class: either obtain testnet IKA in advance or run the localnet (`scripts/run_sui.sh` then `scripts/rerun_ika_info.sh`, 4 validators, several minutes first build), where IKA is minted at genesis.
- Testnet SUI: standard Sui faucet.

### 1.10 End-to-end examples in the repo (all testnet-only, unaudited)

- `examples/multisig-bitcoin` (bitisi): Bitcoin multisig governed on Sui, Move plus Next.js, `@mysten/sui` v2 over gRPC, dApp Kit 2. Bitcoin testnet.
- `examples/keyspring`: create an Ethereum address from a browser wallet or passkey and send ETH on Base Sepolia. Bun backend plus Next.js. Shows the zero-trust flow end to end with an EVM broadcast.
- `examples/ikavery`: import an existing key, put it behind a t-of-N roster of passkeys, sweep on Solana.
- Docs "Code Examples" page is literally "Coming Soon".

### 1.11 Limitations

- Two tokens for every operation, and no public testnet IKA faucet found.
- Latency: DKG and each sign need the Ika network to complete a session; docs raised the default poll timeout from 30 s to 600 s in 0.5.0. Presigns hide most of it but you must pre-fill a pool.
- WASM-heavy client (class-groups crypto) and a 0.4.x to 0.5.0 breaking change history; pin versions.
- Ika does not broadcast to the target chain or watch it; you need your own Bitcoin or EVM RPC and your own indexing for confirmations.
- Shared dWallets trust the Ika validator threshold; zero-trust ones need a live user, so pure contract automation means shared.

---

## 2. Hashi (Mysten Labs native Bitcoin collateral)

### 2.1 What it is

"Hashi is the Sui native Bitcoin orchestrator ... a protocol for securing and managing BTC for use on the Sui blockchain using threshold cryptography." First feature: "deposit and withdraw BTC to a managed pool, with ownership represented as a fungible `Coin<BTC>` on Sui." Symbol `hBTC`, 8 decimals. There is no HASHI token; the docs explicitly warn that any "$HASHI" offering is an imitation. (Sources: design docs index and user-flows, `packages/hashi/sources/btc/btc.move`.)

### 2.2 Timeline and status

- 2026-03-19: devnet announced (news.bitcoin.com 2026-03-20; Sui blog "new era of bitcoin based finance begins, meet hashi").
- 2026-06-23: coalition expands (Cumberland, Fluid, SwissBorg join); global testnet "this July".
- 2026-07-22: testnet live (Chainwire press release, Sui blog). Guardian Layer unveiled.
- 2026-08-18: news.bitcoin.com reports 1.1 million deposits and 165,000 withdrawals in three weeks (units appear to be transaction counts on Signet, not BTC value). Also: "Hashi's Guardian Layer must clear security reviews before any 2026 mainnet transition begins."
- 2026-09-02: Sui blog DeFi overview still says "Hashi has not shipped yet".
- Mainnet: no date. The runbook's Networks table lists mainnet `package-id` and `hashi-object-id` as TBD. The TS SDK throws on mainnet.
- Repo activity: last commits 2026-09-04; 1,090 commits; Move package `packages/hashi`.

Institutional partners (Chainwire 2026-07-22, 25+): custody and wallets BitGo, Blockdaemon, Cobo, Fordefi (Paxos), Cubist, Ledger, SwissBorg; liquidity Bullish, Cumberland, Erebor, FalconX; DeFi and lending AlphaLend, Bluefin, Current, Scallop, Suilend, Fluid, Navi; vaults Concrete by Blueprint Finance, Inveniam Capital, Wave Digital Assets; infrastructure and security CF Benchmarks, Soter Insure, Asymptotic, Certora, OtterSec.

### 2.3 Architecture

Committee. A subset of Sui validators (expected more than 90 percent of the set) register on-chain with a BLS12-381 key, an endpoint URL and a TLS key; voting weight mirrors `SuiSystemState`. They run a threshold Schnorr signer (DKG, key rotation at epoch change, distributed signing). Parameters: secure while fewer than `t` (33 to 50 percent) of stake colludes, live while fewer than `f` (20 to 33 percent) is unresponsive. (Source: design `committee.md`, `mpc-protocol.md`.)

Deposit addresses: 2-of-2 Taproot. Every Sui address gets a unique P2TR address. Descriptor:

```
tr({i}, {multi_a(2, {g}, {h}), and_v(v:older({delay}), pk({h}))})
```

`h` is derived from the committee master key `H` using the depositor's Sui address as the derivation path (custom unhardened secp256k1 derivation, not BIP-32), `g` is the Guardian's fixed key, `i` is the BIP-341 NUMS internal key so only script paths can spend. Leaf 1 is the 2-of-2 multisig (committee plus Guardian) used for every normal spend. Leaf 2 is a recovery path: the committee alone can spend after a 60-day BIP-68 relative timelock, so a lost Guardian key does not strand funds. (Source: design `address-scheme.md`.)

Validator observation and hBTC mint. Four phases: Request, Approve, Confirm, Mint.

1. User sends BTC to their deposit address (minimum initially 30,000 sats), then calls `hashi::deposit::deposit(hashi, utxo, clock, ctx)` on Sui with the txid, vout, amount and derivation path.
2. Committee nodes (each running a Bitcoin Core node plus an embedded BIP-157 light client) watch for `bitcoin_confirmation_threshold` confirmations, screen the source address against a sanctions endpoint, gather a quorum certificate, and one member calls `approve_deposit(hashi, request_id, cert, clock, ctx)`.
3. After a configurable `bitcoin_deposit_time_delay_ms` window (a circuit-breaker period during which operators can pause), anyone calls `confirm_deposit`. It re-verifies the certificate against the current committee.
4. `confirm_deposit` mints hBTC to the recipient and adds the UTXO to the pool.

Threshold Schnorr withdrawal. Five phases: Request, Approve, Build TX, Sign, Broadcast.

```move
public fun request_withdrawal(
    hashi: &mut Hashi, clock: &Clock, btc: Coin<BTC>,
    bitcoin_address: vector<u8>,   // P2WPKH (20 bytes) or P2TR (32 bytes) witness program
    ctx: &mut TxContext,
)
```

Requests queue with a timestamp; the Guardian's token-bucket rate limiter (denominated in BTC) must have capacity; committee approves via certificate; a leader batches approved requests into one Bitcoin transaction (largest-first coin selection, one output per user plus change), commits it on-chain with `commit_withdrawal_tx` (which burns the hBTC and marks UTXOs spent); the Guardian enclave signs each input, the committee runs threshold Schnorr for the second signature; both signatures go into the script-path witness; broadcast; `confirm_withdrawal` after confirmations. Fee: user pays only the Bitcoin miner fee (deducted from the output, estimated with `estimatesmartfee`, bounded to at least 1 sat/vB and at most 3x each validator's own estimate); deposits are free. Stuck transactions are bumped via CPFP. Users can cancel before the request is picked up, after a cooldown. (Sources: design `withdraw.md`, `fees.md`, `limiter.md`.)

Guardian Layer. "A second signatory on the managed Bitcoin deposits, providing defense in depth against committee compromise." It is a private signer and policy engine in a cloud enclave, fronted by a public gRPC proxy, with its key split among independent Key Provisioners holding YubiKey-backed OpenPGP shares, and immutable logs in S3. An active Guardian verifies committee certificates, enforces the rate limiter, signs Bitcoin inputs and records logs. Standby Guardians can be provisioned and activated. Press coverage describes it as a "circuit breaker" for large withdrawals. (Sources: design `guardian.md`; Chainwire 2026-07-22; Crypto Briefing 2026-07-22.)

Governance actions (committee votes weighted by stake): Upgrade, EnableVersion, DisableVersion, UpdateConfig, UpdateEpochConfig, AddConfig, EmergencyPause, UpdateGuardian, AbortReconfig.

### 2.4 Testnet details for a developer

Networks table (design runbook):

| Parameter | Testnet (current) | Mainnet |
|---|---|---|
| Sui network | Testnet | Mainnet |
| Bitcoin network | Signet | Mainnet |
| `sui-chain-id` | `69WiPg3DAQiwdxfncX6wYQ2siKwAe6L9BZthQea3JNMD` | `4btiuiMPvEENsttpZC7CZ53DruC3MAgfznDbASZ7DR6S` |
| Bitcoin genesis | `00000008819873e925422c1ff0f99f7cc9bbb232af63a077a480a3633bee1ef6` | `000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f` |
| `package-id` | `0xfcea10cadbb553c4874201584abf68771592678952efd957b2e82c010c7f4360` | TBD |
| `hashi-object-id` | `0x22c0ce66ce09df2dc88a31bd320d4177b766518b9b88010368cfbdcd724528f8` | TBD |

The testnet web app bundle at testnet.hashi.sui.io hard-codes the same `HASHI_PACKAGE_ID` and `HASHI_OBJECT_ID`, points at `mempool.space/signet` for explorer links, and uses an Alchemy Signet RPC. A second package ID `0xa877d4d97b6a8bae1da982a84980c502c5ad2ead4b24e6c8e50c57cd6ddc3771` also appears in the bundle, most likely the devnet deployment (UNVERIFIED).

hBTC coin type on testnet: the coin is `hashi::btc::BTC`, so the full type is `0xfcea10cadbb553c4874201584abf68771592678952efd957b2e82c010c7f4360::btc::BTC` (symbol hBTC, 8 decimals, registered through `sui::coin_registry`). Caveat: Move type identity is fixed by the original publish address; if the runbook's `package-id` is a later upgrade version, the type prefix is the original. Verify with `client.hashi.view.balance()` or by inspecting an hBTC coin object on the testnet explorer before putting the string on a slide. (Derived from `btc.move` plus the runbook table; UNVERIFIED as a literal string.)

Getting test BTC in: Signet coins come from third-party faucets; the docs name signetfaucet.com and alt.signetfaucet.com and warn they are not operated by Hashi. Deposit minimum 30,000 sats; wait several Signet blocks (about 10 minutes each) plus the deposit time delay before hBTC mints.

TypeScript SDK: `@mysten/hashi` 0.6.13 published 2026-09-02, peer `@mysten/sui` ^2.29.0. Marked "Not production-ready ... only Sui testnet and devnet are wired up". End-user surface is deposit, request withdrawal, cancel withdrawal, plus read helpers.

```bash
pnpm add @mysten/hashi @mysten/sui
```

```ts
import { SuiGrpcClient } from '@mysten/sui/grpc';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { hashi } from '@mysten/hashi';

const client = new SuiGrpcClient({
  network: 'testnet',
  baseUrl: 'https://fullnode.testnet.sui.io:443',
}).$extend(hashi());                       // testnet defaults to Bitcoin signet

const signer = Ed25519Keypair.fromSecretKey(process.env.SUI_KEY!);
const recipient = signer.toSuiAddress();

// 1. Unique P2TR deposit address for this Sui address
const btcAddress = await client.hashi.generateDepositAddress({ suiAddress: recipient });

// 2. Send Signet BTC to btcAddress (faucet), note display-order txid and vout

// 3. Tell Hashi about it
const result = await client.hashi.deposit({
  signer,
  txid: '0x<64-hex display-order txid>',
  utxos: [{ vout: 0, amountSats: 100_000n }],
  recipient,
});
if (result.$kind !== 'Transaction') throw new Error(JSON.stringify(result.FailedTransaction));

// 4. Track
const status = await client.hashi.view.depositStatus(result.Transaction.digest);
// status.status: "pending" | "confirmed" | "expired" | "unknown"; confirmableAtMs once approved
const info = await client.hashi.waitForDeposit(result.Transaction.digest, {
  intervalMs: 15_000, signal: AbortSignal.timeout(1_800_000),
});

const { totalBalance } = await client.hashi.view.balance(recipient); // hBTC in sats

// Withdraw
const w = await client.hashi.requestWithdrawal({
  signer, amountSats: 50_000n, bitcoinAddress: 'tb1q...',   // P2WPKH or tb1p... P2TR on signet
});
```

Other readers: `view.withdrawalFees(address)` returns `worstCaseNetworkFeeSats`, `withdrawalMinimumSats`, `gasEstimateMist`; `view.findUsedUtxos`; `view.transactionHistory`; `view.all()` for governance parameters. A CLI (`hashi deposit -c hashi-cli.toml generate-address --recipient 0x...`, `request --txid ... --recipient ...`, `status <request-id>`, `hashi balance`) is documented in the runbook.

### 2.5 How a lending app integrates hBTC

hBTC is a plain `Coin<BTC>` with 8 decimals. A lending protocol does nothing Hashi-specific: it accepts `Coin<0xfcea...::btc::BTC>` as collateral in its own Move modules, prices it via an oracle (Pyth, Switchboard; CF Benchmarks is a named partner), sets LTV and liquidation parameters, and lets users borrow USDC. Suilend, Navi, Scallop, AlphaLend, Bluefin and Fluid are named as lending venues preparing this. From the user's perspective the loop is: deposit BTC to their Hashi address, receive hBTC, supply hBTC as collateral, borrow, repay, withdraw hBTC, request withdrawal back to a Bitcoin address. Nothing in the lending contract talks to Bitcoin; Hashi is the only component that does. If your protocol wants to react to deposits automatically, index the `DepositConfirmed` event from `hashi::deposit`; for withdrawals, `WithdrawalRequested` from `withdrawal_queue`.

### 2.6 Limitations

- Testnet only, pre-1.0 SDK, mainnet package IDs TBD, no announced mainnet date.
- Bitcoin latency: several confirmations plus a governance time delay before minting; withdrawals are batched (about 10 minutes buffer) and rate-limited by the Guardian.
- Sanctions screening is applied by each committee member; deposits from flagged addresses may never be approved.
- Trust model: committee threshold plus a single Guardian operated with enclaves and key provisioners. It is decentralised on the validator side, but the Guardian is a designed-in policy authority.
- Signet faucets are third-party and flaky.

---

## 3. Cross-chain messaging for Sui contracts

### 3.1 Wormhole: core messaging and NTT on Sui

Status: mainnet and testnet. Sui Wormhole chain ID is 21 (SDK constants). Core contract (package) addresses from the Wormhole reference page: mainnet `0xaeab97f96cf9877fee2883315d459552b2b921edc16d7ceac6eab944dd88919c`, testnet `0x31358d198147da50db32eda2562951d53973a0c0ad5ed738e9b17d88b213d790`. Token Bridge (WTT): mainnet `0xc57508ee0d4595e5a8728974a4a93a787d38f339757230d441e895422c07aba9`, testnet `0x6fb10cdb7aa299e9a4308752dadecb049ff55a892de92992a1edbd7912b3d6da`. Note the Wormhole docs have no Sui-specific core messaging guide (the "guides/sui" URL 404s); the Move source is the reference.

Sending from Move. Your package holds an `EmitterCap` (created once with `wormhole::emitter::new(&state, ctx)`) and in a PTB does:

```move
// wormhole::publish_message (sui/wormhole/sources/publish_message.move)
public fun prepare_message(emitter_cap: &mut EmitterCap, nonce: u32, payload: vector<u8>): MessageTicket
public fun publish_message(
    wormhole_state: &mut State, message_fee: Coin<SUI>,
    prepared_msg: MessageTicket, the_clock: &Clock,
): u64   // sequence
```

`prepare_message` is called inside your module (it needs your `EmitterCap`), and `publish_message` is called as the last step of the PTB; it emits a `WormholeMessage` event that guardians observe and sign into a VAA. `message_fee` must match the on-chain fee (query `state`; it has been zero on some networks, UNVERIFIED for Sui testnet today).

Receiving in Move: `wormhole::vaa::parse_and_verify(&state, vaa_bytes, &clock): VAA`, then read `emitter_chain()`, `emitter_address()`, `sequence()`, `payload()`, and enforce your own replay protection (store consumed digests) and emitter allow-list. A relayer (yours) fetches the signed VAA from Wormholescan or a guardian RPC and submits it in a Sui transaction; there is no automatic relayer for Sui in the standard docs.

Move.toml dependency (from the Wormhole repo layout): `Wormhole = { git = "https://github.com/wormhole-foundation/wormhole.git", subdir = "sui/wormhole", rev = "<tag>" }` with the `wormhole` address set to the network's package ID. Pin a tag; `main` moves.

NTT on Sui (guide last updated 2026-08-07, testnet and mainnet):

```bash
curl -fsSL https://raw.githubusercontent.com/wormhole-foundation/native-token-transfers/main/cli/install.sh | bash
ntt --version
ntt new my-ntt-project && cd my-ntt-project
ntt init Testnet
# token must use legacy CoinMetadata; deploy with `sui client publish` (see example-ntt-token-sui)
ntt add-chain Sui --latest --mode burning --token <FULL_COIN_TYPE> --sui-treasury-cap <TREASURY_CAP_ID>
# or hub-and-spoke:
ntt add-chain Sui --latest --mode locking --token <FULL_COIN_TYPE>
ntt status && ntt pull && ntt push     # rate limits live in deployment.json
```

npm: `@wormhole-foundation/sdk` and `@wormhole-foundation/sdk-sui` 6.1.5 (2026-07-29), `@wormhole-foundation/sdk-sui-ntt` 8.0.1 (2026-07-28); all depend on `@mysten/sui` ^2.17.0. Sui NTT needs a separate Move governance contract per token (docs note), which the CLI handles.

Limitations: you run or rent the relayer for generic messages; VAA finality is guardian-set trust (13 of 19); Sui NTT requires legacy `CoinMetadata` tokens.

### 3.2 LayerZero V2 on Sui

Status: mainnet and testnet, verified via LayerZero's deployments metadata API (read 2026-09-07):

| Network | EID | EndpointV2 | SendUln302 / ReceiveUln302 | Executor |
|---|---|---|---|---|
| sui-mainnet | 30378 | `0x31beaef889b08b9c3b37d19280fc1f8b75bae5b2de2410fc3120f403e9a36dac` | `0x3ce7457bed48ad23ee5d611dd3172ae4fbd0a22ea0e846782a7af224d905dbb0` | `0xde7fe1a6648d587fcc991f124f3aa5b6389340610804108094d5c5fbf61d1989` |
| sui-testnet | 40378 | `0xabf9629418d997fcc742a5ca22820241b72fb53691f010bc964eb49b4bd2263a` | `0xf5d69c7b0922ce0ab4540525fbc66ca25ce9f092c64b032b91e4c5625ea0fb24` | `0xb9fdc6748fb939095e249b22717d564edf890681e387131d6c525d867d30f834` |

Mainnet proof of use: BitGo's WBTC launched natively on Sui as a LayerZero OFT on 2025-12-05, type `0x0041f9f9344cac094454cd574e333c4fdb132d7bcc9379bcd4aab485b2a63942::WBTC::WBTC`. Sui Foundation announced the integration on 2025-09-30.

OApp and OFT support: yes, as Move packages in `LayerZero-v2/packages/layerzero-v2/sui/contracts` (`endpoint-v2`, `message-libs`, `oapps/oapp`, `oapps/oft`, `ptb-builders`, `workers`, `zro`, `dynamic-call`). Official docs: `docs.layerzero.network/v2/developers/sui/overview`, `technical-overview`, `oft/overview`.

Design: Sui has no dynamic dispatch, so LayerZero uses a `Call<Param, Result>` hot potato (no `drop`, no `store`) that must be routed through the Endpoint inside one PTB and consumed by the designated callee. Send: `oapp::lz_send` creates the Call, the PTB routes it through the Endpoint, then `oapp::confirm_lz_send` returns the `MessagingReceipt`. Receive: the Executor builds a PTB that hands your OApp a `Call<LzReceiveParam, Void>`; your `lz_receive` destroys it with your `oapp_cap`, asserts the callee is the endpoint and the sender is the configured peer, then processes the payload.

OFT quick path (docs `oft/overview`):

```toml
[dependencies]
OApp      = { git = "https://github.com/LayerZero-Labs/LayerZero-v2.git", subdir = "packages/layerzero-v2/sui/contracts/oapps/oapp", rev = "main" }
OFTCommon = { git = "https://github.com/LayerZero-Labs/LayerZero-v2.git", subdir = "packages/layerzero-v2/sui/contracts/oapps/oft/oft-common", rev = "main" }
PtbMoveCall = { git = "https://github.com/LayerZero-Labs/LayerZero-v2.git", subdir = "packages/layerzero-v2/sui/contracts/ptb-builders/ptb-move-call", rev = "main" }
```

```ts
import { SDK } from '@layerzerolabs/lz-sui-sdk-v2';
import { OFT } from '@layerzerolabs/lz-sui-oft-sdk-v2';
import { Stage } from '@layerzerolabs/lz-definitions';

const sdk = new SDK({ client, stage: Stage.TESTNET });
const oft = new OFT(sdk, OFT_PKG, undefined, TOKEN_TYPE, OAPP);
const tx = new Transaction();
const [adminCap, migrationCap] = oft.initOftMoveCall(tx, TOKEN_TYPE, TICKET, OAPP, TREASURY, METADATA, 6);
tx.transferObjects([adminCap, migrationCap], sender);
```

Then register the OApp with the endpoint, set send and receive libraries, DVNs, enforced options, and set the peer last. Mint/burn needs the `TreasuryCap`; lock/unlock (`initOftAdapterMoveCall`) does not.

npm: `@layerzerolabs/lz-sui-sdk-v2` and `@layerzerolabs/lz-sui-oft-sdk-v2` 3.0.168 (2026-04-15), depending on `@mysten/sui` ^1.33.0 (v1, JSON-RPC era). The getting-started page even says `npm install @mysten/sui.js`, which is the deprecated package name. Expect friction mixing this with v2 SDKs.

Limitations: heaviest setup of the group (two packages, endpoint registration, DVN config, peers on the remote chain); SDK on `@mysten/sui` v1; docs partly EVM-shaped.

### 3.3 Axelar GMP and ITS on Sui

Status: deployed on Sui mainnet and testnet per Axelar's canonical chain config (`axelar-contract-deployments/axelar-chains-config/info/{testnet,mainnet}.json`, read 2026-09-07). Axelar chain name `sui`. The docs site `docs.axelar.dev` was unreachable from this environment during research (connection refused), so page-level statements are from the GitHub sources; docs URLs are listed in Sources for the class.

Testnet objects:

```
AxelarGateway package   0x6ddfcdd14a1019d13485a724db892fa0defe580f19c991eaabd690140abb21e4
  Gateway object        0x6fc18d39a9d7bf46c438bdb66ac9e90e902abffca15b846b32570538982fb3db
GasService package      0xddf711b99aec5c72594e5cf2da4014b2d30909850a759d2e8090add1088dbbc9
  GasService object     0xac1a4ad12d781c2f31edc2aa398154d53dbda0d50cb39a4319093e3b357bc27d
InterchainTokenService  0x0f9fb8246525699ac7e0a9742094f3491e20b0f3b2a5faf503f139df383390f0 (object 0x55fcd94e5293ff04c512a23c835d79b75e52611f66496e2d02cca439b84fa73c)
RelayerDiscovery object 0xac080ff19b7d44c9362b83628253a4b55747779096034a72ca62ce89a188305e
Example package         0x96b4aac36f2e08f71e93ce160d33ea60852d1653d86c1ccb9c06ae5506e4fc34
  GmpSingleton          0xd2fabdbdfd05dfdd618405e9a60e8cd57f2b6d43ffd0429edcc1f7ca7836e8f7
```

Mainnet: AxelarGateway `0xeb055ffc3237c24e305a2bb760fe6551f6ff7c5fdb68735169c0f528fccab373`, GasService `0x695f612a1ee9268d25ca5c03e705819a285ff0c5b4f7720fc75a00cb8c6f3b63`, ITS `0xbaec6524bedbc95fa4c3314271ecf5d2ce7d8a602c8413c03a5264c949c7263d`.

Programming model (from `axelar-cgp-sui` README and `move/example/sources/gmp/gmp.move`): your module owns a `Channel` (the capability that is your cross-chain "address"). Sending:

```move
public fun send_call(
    singleton: &Singleton, gateway: &Gateway, gas_service: &mut GasService,
    destination_chain: String, destination_address: String, payload: vector<u8>,
    refund_address: address, coin: Coin<SUI>, params: vector<u8>,
) {
    let ticket = gateway::prepare_message(&singleton.channel, destination_chain, destination_address, payload);
    gas_service.pay_gas(&ticket, coin, refund_address, params);
    gateway.send_message(ticket);
}
```

Receiving: because Sui has no interfaces, you register a transaction template with `RelayerDiscovery` (`register_transaction`) that tells Axelar's relayer which function to call and with which objects; the relayer then calls your `execute(call: ApprovedMessage, ...)`, and you consume it with `channel.consume_approved_message(call)` to get `(source_chain, message_id, source_address, payload)`. ITS on Sui supports mint/burn (`TreasuryCap`) and lock/unlock coin management. Sui coins are u64, so 18-decimal tokens get scaled.

Limitations: the relayer discovery pattern is unusual and easy to get wrong; message payloads for ITS are ABI-encoded; docs site availability issue today.

### 3.4 ZetaChain Sui Gateway

Status: Sui is listed as supported by ZetaChain and by Sui's own bridging docs ("ZetaChain enables omnichain smart contracts and cross-chain messaging between Sui and other blockchains"). The gateway contract repo is `zeta-chain/protocol-contracts-sui`. The public docs pages for Sui returned 404 to my fetches on 2026-09-07 (they may have moved), so testnet and mainnet gateway object IDs are UNVERIFIED here; get them from `zetachain.com/docs/developers/chains/sui` or the ZetaChain CLI before class.

Model: a universal app is a Solidity contract on ZetaChain. From Sui you call the gateway:

```move
// protocol-contracts-sui/sources/gateway.move
public entry fun deposit<T>(gateway: &mut Gateway, coins: Coin<T>, receiver: String, ctx: &mut TxContext)
public entry fun deposit_and_call<T>(
    gateway: &mut Gateway, coins: Coin<T>, receiver: String,   // ZetaChain EVM address of the universal contract
    payload: vector<u8>, ctx: &mut TxContext,
)
```

Deposited SUI (or whitelisted coins) become ZRC-20 on ZetaChain and `onCall` fires on the universal contract. Outbound, ZetaChain observers hold a `WithdrawCap` and call `withdraw<T>` on the gateway; with a call, the ZetaChain PTB invokes your Move `on_call` entry function. Example (`example-contracts/examples/call/sui/sources/connected.move`):

```move
public entry fun on_call<SOURCE_COIN, TARGET_COIN>(
    in_coins: Coin<SOURCE_COIN>, cetus_config: &GlobalConfig,
    pool: &mut Pool<SOURCE_COIN, TARGET_COIN>, cetus_partner: &mut Partner,
    clock: &Clock, data: vector<u8>, ctx: &mut TxContext,
) { /* swap and transfer to the address encoded in data */ }
```

The Move.toml in that example depends on the gateway package as a local path (`gateway = { local = ... }`), which is the localnet setup; for testnet you point at the published gateway. ZetaChain's positioning for Sui is native BTC access (swap SUI to native BTC) via its Bitcoin TSS. Live apps cited: Zuno, Amana (UNVERIFIED).

Limitations: security is ZetaChain's validator set and TSS; universal logic lives in Solidity on ZetaChain, not in Move; whitelisting of coin types is gated by ZetaChain.

### 3.5 Sui Bridge and custom messaging

What exists: an asset bridge between Sui and Ethereum "operated and governed by Sui validators", supporting ETH, WETH, WBTC, LBTC and USDT, with a global 24 hour limiter (16 million USD Ethereum to Sui, 7 million USD Sui to Ethereum at the time of the docs page). CCTP USDC was added 2024-12-17.

The custom messaging statement: the Sui blog "Sui Bridge architecture" of 2024-07-22 says "Later versions of Sui Bridge will add new functionality such as custom cross-chain messaging and integration with other blockchains." The mainnet launch post (2024-09-30) only says the bridge "will expand asset support and eventually add unique functionality". Nothing newer restates the plan, and the current docs page contains no roadmap. As of today there is no builder-facing Sui Bridge messaging API. Treat it as announced, unshipped, and undated.

### 3.6 Which one for what

- Emit a proof that something happened on Sui and act on Ethereum or Solana: Wormhole core (cheapest to start), Axelar GMP, LayerZero OApp.
- Ship a token that exists natively on Sui and other chains: Wormhole NTT, LayerZero OFT, Axelar ITS.
- Control assets that stay on Bitcoin or another chain from Move policy, no wrapped asset: Ika dWallets.
- Bring real BTC as collateral into Sui DeFi with a validator-secured mint: Hashi.
- Let a Sui user trigger logic that ends in native BTC or an EVM chain in one click: ZetaChain, or an intent protocol (Mayan).

---

## 4. Other interop primitives for Sui builders in 2026

### 4.1 Sui light client (MystenLabs/sui, `crates/sui-light-client`)

Status: Rust CLI in the main repo. It syncs every end-of-epoch checkpoint (each carries the next committee), verifies them by certificate, and can then verify any transaction, its effects and events, or any object, against a checkpoint signed by two thirds of stake. Usage: config with `full_node_url`, `checkpoint_summary_dir` containing `genesis.blob`, `object_store_url`, `graphql_url`; then `sui-light-client --config mainnet.yaml sync`, `... transaction -t <digest>`, `... object -o <id>`. `mainnet.yaml` and `testnet.yaml` are provided.

What you can build: an off-chain or other-chain verifier of Sui state (the building block for a Sui to X trust-minimised bridge, or for oracles that attest Sui events). It is not an on-chain light client of Ethereum or Bitcoin running on Sui. I found no Ethereum consensus light client written in Move for Sui in this research (UNVERIFIED absence). Hashi embeds a BIP-157 Bitcoin light client in the validator node service, off-chain.

### 4.2 zkBridge efforts

Polyhedra zkBridge historically announced Sui support (2023), but the Polyhedra pages I could reach on 2026-09-07 returned 404 or an empty index, so current Sui support is UNVERIFIED. No Mysten or Sui Foundation zkBridge product exists. For the class, mention zk light clients as the direction (Sui Bridge's 2024 architecture post talks about "trust-minimised" via the validator set, not zk).

### 4.3 Intent protocols

deBridge DLN: the live API `https://dln.debridge.finance/v1.0/supported-chains-info` (read 2026-09-07) lists Ethereum, Optimism, BSC, Polygon, Robinhood, Base, Arbitrum, Avalanche, Linea, Solana, Story, Cronos, HyperEVM, Tron, Injective, Monad, MegaETH. Sui is not there. The requested "deBridge DLN API for programmatic use on Sui" cannot be demoed; drop it or present it as "not yet on Sui".

Mayan swap-sdk: `@mayanfinance/swap-sdk` 15.2.2 (2026-08-31), depends on `@mysten/sui` ^2.17.0, ESM only, requires the v2 client with Core API (gRPC recommended). `ChainName` includes `'sui'`; token standard `'suicoin'`. Routes Solana to Sui, Sui to Solana, Sui to EVM, EVM to EVM. Sui to HyperCore is temporarily disabled. Mainnet only (Mayan has no testnet; UNVERIFIED as a statement, but no testnet is documented).

```ts
import { SuiGrpcClient } from '@mysten/sui/grpc';
import { fetchQuote, createSwapFromSuiMoveCalls } from '@mayanfinance/swap-sdk';

const suiClient = new SuiGrpcClient({ network: 'mainnet', baseUrl: 'https://fullnode.mainnet.sui.io:443' });

const quotes = await fetchQuote({
  amountIn64: '1000000000',           // 1 SUI
  fromToken: '0x2::sui::SUI',
  toToken: '0x0000000000000000000000000000000000000000',  // native ETH on Base
  fromChain: 'sui',
  toChain: 'base',
  slippageBps: 'auto',
});

const tx = await createSwapFromSuiMoveCalls(
  quotes[0], suiAddress, evmDestination, null, null, suiClient,
);
await suiClient.signAndExecuteTransaction({ signer: keypair, transaction: tx });
```

Because `createSwapFromSuiMoveCalls` returns a `Transaction`, you can append your own Move calls in the same PTB, which is the "programmatic interop from a Sui app" angle.

---

## 5. Demo feasibility for tomorrow (live on testnet, under one hour of setup)

Ranked, with the blocker that decides it.

1. Wormhole core message from a Move package (best odds). Publish a 30-line module with an `EmitterCap` that calls `prepare_message`, run a PTB that finishes with `publish_message` against testnet core `0x31358d...`, then show the VAA on Wormholescan (testnet) minutes later. Needs only testnet SUI and the Wormhole Move dependency pinned. Risk: message fee value and dependency rev; test tonight.
2. Hashi testnet, staged. `@mysten/hashi` 0.6.13 plus `SuiGrpcClient`: derive the P2TR deposit address live, show it on mempool.space/signet, submit `deposit()` live. Pre-fund a second address tonight so that a confirmed deposit and an hBTC balance already exist to show, and pre-submit a withdrawal so `view.withdrawalStatus` has something to display. Blocker: Signet faucet availability and Signet block times; do the faucet step before class.
3. Ika, staged. If you can obtain testnet IKA (no public faucet found; ask the Ika team or run localnet), the zero-trust flow with `@ika.xyz/sdk` 0.5.0 is scriptable: DKG, accept share, global presign, sign a keccak hash, print an Ethereum address and a signature verified with viem. Pre-run DKG and presign tonight; sign live. Also show `multisig.move` on screen for the Move policy story. Blocker: IKA tokens and network session latency (allow minutes).
4. Axelar GMP on testnet. Call `example::gmp::send_call` on the deployed Example package (`0x96b4...`, `GmpSingleton 0xd2fa...`) with a small SUI gas payment to an EVM testnet address, then watch it on Axelarscan testnet. Blocker: docs site was unreachable today; you must know the exact argument encoding (`params` and `destination_chain` names) from the GitHub example.
5. Mayan quote (mainnet, read-only). Two lines to fetch a Sui to Base quote; no funds needed. Executing a swap would spend mainnet SUI; optional.
6. ZetaChain deposit_and_call from Sui testnet. Doable with the ZetaChain CLI if you fetch the current testnet gateway IDs, but unverified today; treat as a slide, not a demo.
7. LayerZero OFT on Sui testnet. Not in an hour: two package publishes, endpoint registration, DVN and library config, and a peer on a remote chain, on an SDK that wants `@mysten/sui` v1.
8. Sui light client, zkBridge, Sui Bridge messaging, deBridge on Sui: slides only.

Suggested live sequence: Wormhole message (10 minutes), Hashi address plus staged balance (10 minutes), Ika staged sign plus Move walkthrough (15 minutes), then the comparison table.

---

## Sources (URL, date read)

Ika
- https://github.com/dwallet-labs/ika (README, releases, tree) 2026-09-07
- https://raw.githubusercontent.com/dwallet-labs/ika/main/sdk/typescript/README.md 2026-09-07
- https://raw.githubusercontent.com/dwallet-labs/ika/main/sdk/typescript/CHANGELOG.md 2026-09-07
- https://raw.githubusercontent.com/dwallet-labs/ika/main/sdk/typescript/src/client/network-configs.ts 2026-09-07
- https://raw.githubusercontent.com/dwallet-labs/ika/main/contracts/ika_dwallet_2pc_mpc/sources/coordinator.move 2026-09-07
- https://raw.githubusercontent.com/dwallet-labs/ika/main/contracts/ika_dwallet_2pc_mpc/sources/coordinator_inner.move 2026-09-07
- https://raw.githubusercontent.com/dwallet-labs/ika/main/docs/content/docs/sdk/ika-transaction/zero-trust.mdx 2026-09-07
- https://raw.githubusercontent.com/dwallet-labs/ika/main/docs/content/docs/sdk/ika-transaction/presign.mdx 2026-09-07
- https://raw.githubusercontent.com/dwallet-labs/ika/main/docs/content/docs/sdk/ika-transaction/dwallet-types.mdx 2026-09-07
- https://raw.githubusercontent.com/dwallet-labs/ika/main/docs/content/docs/sdk/ika-client/ika-client.mdx 2026-09-07
- https://raw.githubusercontent.com/dwallet-labs/ika/main/docs/content/docs/move-integration/getting-started.mdx 2026-09-07
- https://raw.githubusercontent.com/dwallet-labs/ika/main/docs/content/docs/move-integration/core-concepts/capabilities-and-approvals.mdx 2026-09-07
- https://raw.githubusercontent.com/dwallet-labs/ika/main/docs/content/docs/move-integration/core-concepts/payment-handling.mdx 2026-09-07
- https://raw.githubusercontent.com/dwallet-labs/ika/main/docs/content/docs/move-integration/protocols/signing.mdx 2026-09-07
- https://raw.githubusercontent.com/dwallet-labs/ika/main/docs/content/docs/core-concepts/dwallets.mdx 2026-09-07
- https://raw.githubusercontent.com/dwallet-labs/ika/main/examples/README.md, examples/multisig-bitcoin/README.md, examples/keyspring/README.md, examples/multisig-bitcoin/contract/sources/multisig.move, examples/multisig-bitcoin/contract/Move.toml 2026-09-07
- https://docs.ika.xyz/docs/sdk and https://docs.ika.xyz/ 2026-09-07 (note: several docs.ika.xyz deep links 404; GitHub sources used)
- https://registry.npmjs.org/@ika.xyz/sdk 2026-09-07 (0.5.0 published 2026-08-18)
- https://www.sui.io/blog/ika-mainnet-launch-btcfi-interoperability (2025-07-28) 2026-09-07
- https://www.sui.io/blog/ika-dwallet-mpc-network-interoperability (2024-10-30) 2026-09-07

Hashi
- https://sui.io/hashi 2026-09-07
- https://mystenlabs.github.io/hashi/design/ and llms-full.txt (user-flows, committee, mpc-protocol, guardian, address-scheme, limiter, fees, deposit, withdraw, node-operator-runbook Networks table, ts-sdk) 2026-09-07
- https://github.com/MystenLabs/hashi (README, tree, packages/hashi/sources/btc/btc.move, deposit.move, withdraw.move, Move.toml, Published.toml) 2026-09-07
- https://testnet.hashi.sui.io (HTML and JS bundle inspected for package IDs and Signet references) 2026-09-07
- https://registry.npmjs.org/@mysten/hashi 2026-09-07 (0.6.13 published 2026-09-02)
- https://chainwire.org/2026/07/22/hashi-testnet-is-live-bringing-native-bitcoin-finance-one-step-closer-to-global-adoption/ 2026-09-07
- https://cryptobriefing.com/hashi-testnet-guardian-layer-btc-collateral-sui/ (2026-07-22) 2026-09-07
- https://news.bitcoin.com/crypto-news/sui-hashi-bitcoin-bridge-1-1-million-deposits/ (2026-08-18) 2026-09-07
- https://news.bitcoin.com/sui-foundation-and-leading-institutions-launch-hashi-bitcoin-finance-primitive/ (2026-03-20) 2026-09-07
- https://www.sui.io/blog/hashi-global-coalition-expands (2026-06-23) 2026-09-07
- https://www.sui.io/blog/defi-sui-deepbook-gasless-stablecoins-hashi-bitcoin (2026-09-02) 2026-09-07

Wormhole
- https://wormhole.com/docs/reference/contract-addresses/ 2026-09-07
- https://wormhole.com/docs/products/token-transfers/native-token-transfers/guides/deploy-to-sui/ (last updated 2026-08-07) 2026-09-07
- https://raw.githubusercontent.com/wormhole-foundation/wormhole/main/sui/wormhole/sources/publish_message.move, vaa.move, emitter.move, sui/README.md 2026-09-07
- https://github.com/wormhole-foundation/example-ntt-token-sui 2026-09-07
- https://raw.githubusercontent.com/wormhole-foundation/wormhole-sdk-ts/main/core/base/src/constants/chains.ts (Sui = 21) 2026-09-07
- npm: @wormhole-foundation/sdk-sui 6.1.5, @wormhole-foundation/sdk-sui-ntt 8.0.1 2026-09-07

LayerZero
- https://docs.layerzero.network/v2/developers/sui/overview 2026-09-07
- https://docs.layerzero.network/v2/developers/sui/getting-started 2026-09-07
- https://docs.layerzero.network/v2/developers/sui/technical-overview 2026-09-07
- https://docs.layerzero.network/v2/developers/sui/oft/overview 2026-09-07
- https://metadata.layerzero-api.com/v1/metadata/deployments (sui-mainnet EID 30378, sui-testnet EID 40378) 2026-09-07
- https://github.com/LayerZero-Labs/LayerZero-v2/tree/main/packages/layerzero-v2/sui/contracts 2026-09-07
- https://www.sui.io/blog/layerzero-oft-interoperability (2025-09-30) 2026-09-07
- https://www.sui.io/blog/bitgo-native-wbtc-layerzero (2025-12-05) 2026-09-07
- npm: @layerzerolabs/lz-sui-sdk-v2 and lz-sui-oft-sdk-v2 3.0.168 (2026-04-15) 2026-09-07

Axelar
- https://raw.githubusercontent.com/axelarnetwork/axelar-cgp-sui/main/README.md 2026-09-07
- https://raw.githubusercontent.com/axelarnetwork/axelar-cgp-sui/main/move/example/sources/gmp/gmp.move 2026-09-07
- https://raw.githubusercontent.com/axelarnetwork/axelar-contract-deployments/main/axelar-chains-config/info/testnet.json and mainnet.json 2026-09-07
- Docs (unreachable from this environment on 2026-09-07, for class use): https://docs.axelar.dev/dev/general-message-passing/sui/intro, https://docs.axelar.dev/dev/general-message-passing/sui/gmp-tutorial/, https://docs.axelar.dev/dev/send-tokens/sui/intro/

ZetaChain
- https://raw.githubusercontent.com/zeta-chain/protocol-contracts-sui/main/sources/gateway.move and README 2026-09-07
- https://github.com/zeta-chain/example-contracts/tree/main/examples/call/sui (connected.move, Move.toml) 2026-09-07
- https://docs.sui.io/onchain-finance/fungible-tokens/sui-bridging (ZetaChain listed) 2026-09-07
- Docs URLs that 404ed on 2026-09-07: https://www.zetachain.com/docs/developers/chains/sui, https://www.zetachain.com/docs/developers/tutorials/sui

Sui Bridge
- https://docs.sui.io/onchain-finance/fungible-tokens/sui-bridging 2026-09-07
- https://www.sui.io/blog/sui-bridge-architecture (2024-07-22, custom messaging quote) 2026-09-07
- https://www.sui.io/blog/sui-bridge-launches-on-mainnet (2024-09-30) 2026-09-07
- https://www.sui.io/blog/circle-usdc-cctp-sui-bridge-integration (2024-12-17) 2026-09-07

Other
- https://raw.githubusercontent.com/MystenLabs/sui/main/crates/sui-light-client/README.md 2026-09-07
- https://dln.debridge.finance/v1.0/supported-chains-info (no Sui) 2026-09-07
- https://github.com/mayan-finance/swap-sdk (README, src/types.ts) and https://registry.npmjs.org/@mayanfinance/swap-sdk (15.2.2, 2026-08-31) 2026-09-07
- https://docs.polyhedra.network/ (empty index; Sui support UNVERIFIED) 2026-09-07
