# Sui Bridge (native bridge) deep dive

Research for the SuiHub Lagos bridging workshop, 2026-09-08. Research date: 2026-09-07. Every on-chain number below was read live on 2026-09-07 from public Sui gRPC/GraphQL endpoints and public Ethereum RPCs; the commands are in the "Demo ideas" section so you can re-read them in class.

Headline facts, each backed by a source below:

- Sui Bridge is an Ethereum to Sui token bridge operated by the Sui validator set. Committee signatures are recoverable secp256k1 ECDSA over keccak256("SUI_BRIDGE_MESSAGE" || message). A token transfer needs 3334/10000 voting power; most governance needs 5001; an emergency pause needs only 450.
- Official fee statement (bridge.sui.io FAQ): "There is no fee charged by Sui Bridge. Sui Bridge subsidizes claim gas costs for transfers from Ethereum to Sui, unless the limit is hit at that time. In this case the only expense from users is the gas costs on Ethereum."
- Direction matters. Ethereum to Sui: the bridge client (run by validators) submits approve plus claim on Sui for you, ~13 minutes after deposit because the bridge nodes only read Ethereum blocks tagged `finalized`. Sui to Ethereum: approval on Sui lands in seconds, then you pay Ethereum gas to submit the claim yourself.
- Limits are live-governed and the docs and UI are stale. On-chain today: $25,000,000 per 24h for Ethereum to Sui (Sui-side Move limiter) and $50,000,000 per 24h for Sui to Ethereum (Ethereum-side BridgeLimiter). docs.sui.io says $16M/$7M, bridge.sui.io FAQ says $8M/$5M. Testnet limits are currently set to 1 unit (effectively $0), so fresh testnet claims fail with TokenTransferLimitExceed until the 48h V2 bypass matures. Plan demos around that.
- Mainnet assets: ETH (native), WETH, WBTC, USDT, LBTC (Sui type `wlbtc::WLBTC`). Testnet (Sepolia): ETH, WETH, WBTC, USDC, USDT plus a PEPE test token.
- No TypeScript bridge SDK and no hosted REST status API. You integrate with the Move package `0xb` (object `0x9`), the Solidity `SuiBridge` proxy, the public signing REST endpoints every bridge node exposes, `sui-bridge-cli`, and events via gRPC or GraphQL. JSON-RPC on public fullnodes is switched off (observed today).

---

## 1. Architecture

### 1.1 Components

The Sui Foundation blog "Diving into Sui Bridge Architecture" (published 2024-07-22, modified 2026-07-16) lists four pieces: the Sui Bridge Committee / node network, smart contracts on both chains, full nodes on Ethereum and Sui, and a bridge client that is "permissionless and can be executed by anyone". The repo primer `bridge/SUI_NATIVE_BRIDGE_PRIMER.md` gives the code map:

| Component | Path | Role |
| --- | --- | --- |
| EVM `SuiBridge` | `bridge/evm/contracts/SuiBridge.sol` (+ `SuiBridgeV2.sol`, `BridgeCommittee.sol`, `BridgeLimiter.sol`, `BridgeVault.sol`, `BridgeConfig.sol`, `utils/BridgeUtils.sol`, `utils/CommitteeUpgradeable.sol`) | Custody vault orchestrator on Ethereum: collects deposits, enforces limits, releases assets after committee-signed messages |
| Move `bridge::bridge` | `crates/sui-framework/packages/bridge/sources/{bridge,committee,limiter,message,message_types,treasury,chain_ids,crypto}.move` | Mints/burns bridged coins, stores every transfer record, verifies committee signatures, enforces limiter, executes governance |
| Bridge node | `crates/sui-bridge/src` (`node.rs`, `server/`, `client/`, `orchestrator.rs`, `eth_syncer.rs`, `sui_syncer.rs`, `action_executor.rs`, `sui_bridge_watchdog/`) | Off-chain daemon: (a) Axum signing server, (b) optional client that watches both chains, aggregates signatures and submits transactions |
| Tooling | `crates/sui-bridge-cli`, `crates/sui-bridge-indexer`, `crates/sui-bridge-indexer-alt`, `crates/sui-bridge-schema` | Operator CLI, self-hostable indexer |

Trust claim, verbatim from the architecture blog: "Sui Bridge requires no additional trust. The entities that secure Sui are the same that secure Sui Bridge." and "The same node operators that secure Sui by running validator nodes manage and maintain the infrastructure that the Sui Bridge runs on." docs.sui.io: "Sui Bridge is operated and governed by Sui validators, the same set that secures the Sui network. Bridge transfers and other actions require validator signatures with a threshold of voting power. Governance is handled by validator voting."

### 1.2 Committee equals (a snapshot of) the validator set

- Registration: a validator runs `sui validator register-bridge-committee --bridge-authority-key-path ... --bridge-authority-url ...`. In Move, `bridge::committee::register` requires the sender to be in `SuiSystemState.active_validator_addresses` and stores a 33-byte compressed secp256k1 key (`ECDSA_COMPRESSED_PUBKEY_LENGTH = 33`) plus an HTTP REST URL.
- Formation: `try_create_next_committee` runs in the end-of-epoch transaction and instantiates the committee once registered stake reaches `min_stake_participation_percentage`. `CommitteeMember.voting_power` is "in the scale of 10000".
- Live mainnet (read 2026-09-07 from object `0x9`): 96 members, total voting power 9,133 of 10,000 (exactly the `minCommitteeStakeRequired: 9133` in `bridge/evm/deploy_configs/mainnet.json`), 2 members blocklisted, `last_committee_update_epoch = 527` (current epoch 1243). Live testnet: 66 members, 0 blocklisted, `last_committee_update_epoch = 380`.
- The committee is therefore a snapshot, not a per-epoch mirror. The blog: "Dynamic management of the committee will be implemented post-Mainnet to enable newer validators joining." Docs: "Authority key rotation is not supported yet."
- Blocklist: `committee::execute_blocklist` maps Ethereum addresses back to pubkeys via `crypto::ecdsa_pub_key_to_eth_address` and sets `blocklisted = true`; blocklisted members contribute zero voting power in `verify_signatures`. Ethereum mirror: `BridgeCommittee.updateBlocklistWithSignatures`. Both sides show exactly one blocklist action executed on mainnet (Sui `sequence_nums[1] = 1`, Ethereum `committee.nonces(1) = 1`).

### 1.3 Bridge nodes

From docs.sui.io/guides/operator/bridge-node-configuration:

- `BridgeAuthorityKey` is "an ECDSA key to sign messages. Because this is a hot key that stays in memory..." Keys must be separated by role; a dedicated `bridge-client-key-path` is recommended.
- Node listens on TCP 9191 by default; "Rate limit protection is required", recommended "50 requests/second per unique IP" via a WAF or HAProxy.
- Suggested hardware: 6 physical cores, 16 GB RAM, 200 GB disk, 100 Mbps.
- Config fields: `server-listen-port`, `metrics-port`, `bridge-authority-key-path`, `run-client`, `approved-governance-actions`, `sui:sui-rpc-url`, `sui:sui-bridge-chain-id` (0 mainnet, 1 testnet), `eth:eth-rpc-url`, `eth:eth-bridge-proxy-address`, `eth:eth-bridge-chain-id` (10 mainnet, 11 Sepolia), `eth:eth-contracts-start-block-fallback`, `db-path`, `sui:bridge-client-key-path`, `metrics:push-url`.
- `BridgeClient` is optional: "It is optional to run for a BridgeNode. BridgeClient submits transaction on the Sui network. Thus when it's enabled, you need a Sui account key with enough SUI balance." Key metric: `bridge_gas_coin_balance`.

Signing server routes (`crates/sui-bridge/src/server/mod.rs`), all GET, all returning `Json<SignedBridgeAction>`, no auth:

```
/ping
/metrics_pub_key
/sign/bridge_tx/eth/sui/{tx_hash}/{event_index}
/sign/bridge_tx/sui/eth/{tx_digest}/{event_index}
/sign/bridge_action/sui/eth/{source_chain}/{message_type}/{bridge_seq_num}
/sign/update_committee_blocklist/{chain_id}/{nonce}/{type}/{keys}
/sign/emergency_button/{chain_id}/{nonce}/{type}
/sign/update_limit/{chain_id}/{nonce}/{sending_chain_id}/{new_usd_limit}
/sign/update_asset_price/{chain_id}/{nonce}/{token_id}/{new_usd_price}
/sign/upgrade_evm_contract/{chain_id}/{nonce}/{proxy_address}/{new_impl_address}
/sign/add_tokens_on_sui/{chain_id}/{nonce}/{native}/{token_ids}/{token_type_names}/{token_prices}
/sign/add_tokens_on_evm/{chain_id}/{nonce}/{native}/{token_ids}/{token_addresses}/{token_sui_decimals}/{token_prices}
```

A node only signs a governance action if it is listed in its own `approved-governance-actions`: "A list of approved governance actions. Action in this list will be signed when requested by client." (config.rs). Signing a token transfer requires the node to independently verify the source event: for Ethereum it fetches the finalized head first ("Query the finalized head first, then fetch receipt, to avoid a race where the receipt is observed before finalization and then reorged out.", eth_client.rs).

### 1.4 Signatures, threshold, message format

- Blog: the committee uses "recoverable ECDSA signatures, which allow public key recovery directly from the signature itself" and "A message is considered valid only when the combined weight of the signatures meets or exceeds a predefined threshold."
- Move `committee::verify_signatures`: for each signature `ecdsa_k1::secp256k1_ecrecover(&signatures[i], &message_bytes, 0)` (hash flag 0 = keccak256), reject duplicates (`EDuplicatedSignature`), require membership (`EInvalidSignature`), sum `voting_power` of non-blocklisted members, `assert!(threshold >= required_voting_power, ESignatureBelowThreshold)`. Prefix constant `SUI_MESSAGE_PREFIX = b"SUI_BRIDGE_MESSAGE"`.
- Solidity `BridgeCommittee.verifySignatures`: `ECDSA.tryRecover(BridgeUtils.computeHash(message), v, r, s)`, blocklist check, non-zero stake check, duplicate bitmap, `require(approvalStake >= requiredStake, "BridgeCommittee: Insufficient stake amount")`. `BridgeUtils.computeHash` is `keccak256(abi.encodePacked("SUI_BRIDGE_MESSAGE", messageType, version, nonce, chainID, payload))`.
- Wire layout (identical on both chains): `[message_type: u8][version: u8][nonce: u64][source_chain: u8][payload]`. Move struct `BridgeMessage { message_type: u8, message_version: u8, seq_num: u64, source_chain: u8, payload: vector<u8> }`. Token payload: `sender_address`, `target_chain`, `target_address`, `token_type`, `amount` (64-byte payload on the EVM decoder); V2 payload appends `timestamp_ms`.

Required voting power (Move `message::required_voting_power`, mirrored by `BridgeUtils` constants):

| Message | Type id (Move / EVM) | Required (of 10000) |
| --- | --- | --- |
| Token transfer | 0 / 0 | 3334 |
| Committee blocklist | 1 / 1 | 5001 |
| Emergency op: pause | 2 / 2 | 450 |
| Emergency op: unpause | 2 / 2 | 5001 |
| Update bridge limit | 3 / 3 | 5001 |
| Update asset price | 4 / 4 | 5001 |
| EVM contract upgrade | n/a / 5 | 5001 |
| Add tokens on Sui | 6 / n/a | 5001 |
| Add tokens on EVM | n/a / 7 | 5001 |

Teaching point: one third of stake can move funds (same liveness/safety split as Sui consensus), 4.5 percent can pause, and a majority is needed to unpause or change anything.

### 1.5 Nonces and replay protection

- Sui: `BridgeInner.sequence_nums: VecMap<u8, u64>` is "nonce for replay protection; key: message type, value: next sequence number". `send_token` increments the token sequence; `execute_system_message` asserts `message.seq_num() == expected_seq_num` (`EUnexpectedSeqNum`) and increments. Primer: "sequence_nums are per message type, not per chain; resetting them incorrectly bricks governance."
- Ethereum: `SuiBridge.nonces[messageType]` increments on each deposit; `isTransferProcessed[nonce]` blocks double claims ("SuiBridge: Message already processed"). Each governance contract (`BridgeLimiter`, `BridgeConfig`, `BridgeCommittee`) keeps its own `nonces` (they all inherit `CommitteeUpgradeable`), so read the right contract.
- Records: every transfer is a `BridgeRecord { message, verified_signatures: Option<vector<vector<u8>>>, claimed: bool }` in `token_transfer_records: LinkedTable<BridgeMessageKey, BridgeRecord>`, keyed by `(source_chain, message_type, bridge_seq_num)`. Blog: "All bridging records and approvals are stored in the bridge object onchain. This is feasible in Sui because its storage and gas costs are affordably low." Testnet table size today: 317,514 records.

### 1.6 Chain ids and routes (`chain_ids.move`)

`SUI_MAINNET = 0`, `SUI_TESTNET = 1`, `SUI_CUSTOM = 2`, `ETH_MAINNET = 10`, `ETH_SEPOLIA = 11`, `ETH_CUSTOM = 12`. Valid routes: mainnet <-> mainnet, testnet <-> Sepolia, testnet <-> custom, custom <-> Sepolia, custom <-> custom. `send_token` aborts with `EInvalidBridgeRoute` otherwise.

### 1.7 The bridge object on Sui

- Package `0xb` (system package, module `bridge::bridge`), shared object `0x9` of type `0xb::bridge::Bridge { id: UID, inner: Versioned }`. The real state is a dynamic field `Field<u64, BridgeInner>` under the `Versioned` UID (mainnet field object `0x00ba8458097a879607d609817a05599dc3e9e73ce942f97d4f1262605a8bf0fc`; testnet `0x170e627dcac3379bf4de6eb057018cd4a9b6e877f5e3cc7ea8c82d89413e9145`).
- `BridgeInner { bridge_version: u64, message_version: u8, chain_id: u8, sequence_nums, committee: BridgeCommittee, treasury: BridgeTreasury, token_transfer_records, limiter: TransferLimiter, paused: bool }`. Live: `bridge_version = 1`, `message_version = 1`, `paused = false` on both networks.
- Treasury: `supported_tokens: VecMap<TypeName, BridgeTokenMetadata { id: u8, decimal_multiplier: u64, notional_value: u64, native_token: bool }>`, `id_token_type_map`, `treasuries: ObjectBag` (TreasuryCaps), `waiting_room: Bag` (registered but not yet approved tokens; mainnet waiting room has 2 entries today).

### 1.8 Ethereum contracts and addresses

Mainnet (docs.sui.io plus live `cast call` reads today):

| Contract | Address |
| --- | --- |
| SuiBridge proxy (ERC1967, docs "Sui Bridge contract on Ethereum Mainnet") | `0xda3bD1fE1973470312db04551B65f401Bc8a92fD` |
| SuiBridge implementation (Etherscan: `SuiBridge`, v1, no V2 functions) | `0xa60f29201aeae592d9ab95747ae1cf425dbb036c` |
| BridgeLimiter | `0x12183B0796BBc4678999100e8c6C5715D5736767` |
| BridgeVault | `0x312e67b47A2A29AE200184949093D92369F80B53` |
| BridgeCommittee | `0xee2d52477a7c1A7Be0B0347dBe7e3b15185B416F` |
| BridgeConfig | `0x72D34Fe82c71Bf8120647518e5128e53106a1540` |
| WETH | `0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2` |
| Deployment block | 20811249 (2024-09-23), `sui_bridge_genesis_checkpoint` 55455583 |

Sepolia (indexer README, primer, verified on Etherscan and by `cast call`):

| Contract | Address |
| --- | --- |
| SuiBridge proxy (ERC1967, created 2024-05-29, 302,826 txs) | `0xAE68F87938439afEEDd6552B0E83D2CbC2473623` |
| SuiBridge implementation (Etherscan: `SuiBridgeV2`, deployed about Feb 2026) | `0xe3D3C63E820999c61Bc25C0A808Bf480B1C65C7F` |
| BridgeLimiter | `0xFA393e28Dd7F88F66112324b20F45F8AA60c19Df` |
| BridgeVault | `0xaB480a0A143FF115659Af987b47E018008540011` |
| BridgeCommittee | `0xcAa4c1539ABA31e8761E68179989E38f88b1911E` |
| BridgeConfig | `0x624Ddc521b3934CaFb94AA6a4fF120fc8FA45B5F` |
| Deployment block | 5997013, `sui_bridge_genesis_checkpoint` 43917829 (testnet) |

Warning: Etherscan also labels `0x47d79e8575e29E70067fD8fF535DFE6B4042d733` "Sui Bridge" on Sepolia. It has zero transactions. Use `0xAE68...` (the one the indexer, primer and testnet UI use).

Storage layout gotcha (primer and PR #25228, merged 2026-02-03): the Sepolia proxy was deployed before a `uint256[50] __gap` was added to `CommitteeUpgradeable`, so `vault`/`limiter` live at slots 4/5 on testnet but 54/55 on mainnet. The testnet V2 upgrade briefly broke node startup because the new implementation read zero addresses.

---

## 2. User flows

### 2.1 Ethereum to Sui (lock on EVM, mint on Sui)

1. User calls `SuiBridge.bridgeETH(bytes recipientAddress, uint8 destinationChainID)` (payable) or `bridgeERC20(uint8 tokenID, uint256 amount, bytes recipientAddress, uint8 destinationChainID)` after an ERC20 approve. Recipient must be exactly 32 bytes ("SuiBridge: Invalid recipient address length"). Funds go to `BridgeVault` (ETH is wrapped to WETH in the vault's `receive()`); the contract measures the vault balance delta, converts ERC20 decimals to Sui decimals (8 for ETH/BTC, 6 for USDT), emits `TokensDeposited(sourceChainID, nonce, destinationChainID, tokenID, suiAdjustedAmount, senderAddress, recipientAddress)` and increments `nonces[TOKEN_TRANSFER]`.
2. Bridge nodes' `EthSyncer` only reads logs up to the block returned by `eth_getBlockByNumber("finalized")`, polled every 5 s (`FINALIZED_BLOCK_QUERY_INTERVAL`). This is the confirmation policy: Ethereum finality, not a fixed block count. bridge.sui.io FAQ: "takes around 13 minutes from Ethereum to Sui. The latter is because validators only consider finalized deposit transactions on Ethereum, which takes 2 Ethereum epochs or 13 minutes." docs.sui.io words it as "a configurable number of Ethereum block confirmations... The exact depth is set by the bridge validator committee."
3. The bridge client (any validator running `run-client: true`) aggregates signatures from peer nodes (`/sign/bridge_tx/eth/sui/{tx_hash}/{event_index}`) until 3334 voting power, then submits one Sui PTB: `message::create_token_bridge_message(_v2)` -> `bridge::approve_token_transfer(bridge, message, signatures)` -> `bridge::claim_and_transfer_token<T>(bridge, clock, source_chain, seq_num)`. Observed live on testnet today (tx `GDYSUkYqfkcfd7fWmMRccM42E6Cv61yTf1GLKmxniwTX`, 2026-09-04): exactly those three Move calls, sender is the client key, events `TokenTransferApproved` then `TokenTransferLimitExceed`.
4. Who pays: the client key pays Sui gas (`bridge_client_gas_object`, metric `bridge_gas_coin_balance`). Blog: "Sui Validators currently subsidize the gas fees associated with bridging transactions on Sui and allowing the client to execute the transactions automatically". If the limiter blocks the claim, `claim_and_transfer_token` returns (does not abort) and emits `TokenTransferLimitExceed`; anyone, including the recipient, can later call `claim_token<T>` (recipient only) or `claim_and_transfer_token<T>` (anyone) once the window frees or the message matures. The mainnet launch blog: "Bridged tokens typically arrive automatically; manual claiming may be needed in edge cases."
5. Retry behaviour: the executor retries signing and execution up to 16 times with exponential backoff (0.1 s doubling), then "Manual intervention required".

Typical timing: about 13 to 15 minutes end to end (Ethereum finality dominates; Sui side is seconds).

### 2.2 Sui to Ethereum (burn on Sui, unlock on EVM)

1. User calls `bridge::send_token<T>(bridge: &mut Bridge, target_chain: u8, target_address: vector<u8>, token: Coin<T>, ctx)` (or `send_token_v2` with `clock: &Clock`). Checks: not paused (`EBridgeUnavailable`), valid route, `target_address.length() == 20` (`EInvalidEvmAddress`), amount > 0 (`ETokenValueIsZero`). The coin is burned by the treasury, a pending `BridgeRecord` is stored, and `TokenDepositedEvent { seq_num, source_chain, sender_address, target_chain, target_address, token_type, amount }` (V2 adds `timestamp_ms`) is emitted. Sui finality is the checkpoint; `SuiSyncer` polls every 2 s.
2. The bridge client collects signatures (`/sign/bridge_tx/sui/eth/{tx_digest}/{event_index}`) and submits `bridge::approve_token_transfer` on Sui, which attaches `verified_signatures` to the existing record and emits `TokenTransferApproved`. Primer: "This is the first on-chain transaction the client executes in this direction."
3. The user submits `SuiBridge.transferBridgedTokensWithSignatures(bytes[] signatures, Message message)` on Ethereum (the UI's "Claim" button; the CLI's `client claim-on-eth`). Blog: "When bridging from Sui to Ethereum, the process is similar except users must submit the claiming transaction manually on Ethereum." The contract verifies signatures, checks `isTransferProcessed`, checks the limiter, pulls from the vault (unwrapping WETH for ETH), marks the nonce processed and emits `TokensClaimed`.
4. Who pays: the user pays Ethereum gas for the claim (calldata carries a few dozen 65-byte signatures plus one `ecrecover` each, so it is noticeably more than a plain transfer; check a recent "Transfer Bridged" tx on Etherscan for a current figure). The FAQ: "the only expense from users is the gas costs on Ethereum."

Typical timing: FAQ says "the transfer is instant from Sui to Ethereum" (approval within seconds; claim whenever the user submits, then normal Ethereum inclusion).

### 2.3 App integration rule

docs.sui.io: "Do not assume a bridge transfer is complete based on the source chain transaction alone... Crediting users prematurely exposes your app to double-spend risk if the source transaction is reorganized." Credit only on `TokenTransferClaimed` (Sui) or `TokensClaimed` (Ethereum).

---

## 3. The limiter

### 3.1 Mechanism

- docs.sui.io: "A limiter protects funds by constraining the total value of assets leaving Sui Bridge in a 24-hour window. It tracks value hourly and aggregates from the last 24 hours, refreshing every hour. The limit applies globally and varies by direction (Ethereum -> Sui versus Sui -> Ethereum). It also caps the maximum single transfer." and "The maximum transfer equals the global USD limit."
- The limiter runs on the receiving chain. `limiter.move`: "Note limiter only takes effects on the receiving chain, so we only need to specify routes from Ethereum to Sui." So the Sui-side `TransferLimiter` governs Ethereum to Sui, and the Ethereum-side `BridgeLimiter.chainLimits[sendingChainID]` governs Sui to Ethereum.
- Sui: `TransferRecord { hour_head, hour_tail, per_hour_amounts: vector<u64> (24 buckets), total_amount }` in USD with 8 decimals (`USD_VALUE_MULTIPLIER = 100000000`). `check_and_record_sending_transfer` evicts buckets older than 24 h, converts the amount with the token's `notional_value`, and refuses if `total + amount > route_limit`. Genesis values: 5,000,000 USD for ETH mainnet -> Sui mainnet, `MAX_TRANSFER_LIMIT` (u64::MAX) for every testnet/custom route.
- Ethereum: `chainHourlyTransferAmount[chainID << 32 | hourTimestamp]`, `calculateWindowAmount` sums 24 hourly buckets, `willAmountExceedLimit` converts via `BridgeConfig.tokenPriceOf`, revert string "BridgeLimiter: amount exceeds rolling window limit". Comment: "total limit in USD (8 decimal precision) (e.g. 1000_00000000 => 1000 USD)".
- Static pricing: docs "Sui Bridge v1 uses static pricing to calculate limits. ETH is priced at $2,600." That number is stale; see 3.2. Prices change only by `update_asset_price` governance.
- 48 h bypass (V2, PR #24221 "Bridge limiter bypass", merged 2025-12-23): `bridge.move` claim path: "if more than 48 hours have passed since deposit, bypass the limiter (the limiter exists to give time to respond to bugs)": `bypass_limiter = clock.timestamp_ms() > timestamp + 48 * 3600000` for `message_version == 2`. EVM mirror `SuiBridgeV2.limitNotExceededV2` with `BridgeUtilsV2.isMatureMessage(ts, block.timestamp)` (`> ts + 48 * 3600`). V2 is live on Sepolia (implementation `SuiBridgeV2`); the mainnet implementation still has no V2 functions and all mainnet `nonces(UPGRADE)` are 0, so mainnet is V1 today.

### 3.2 Current values (read 2026-09-07)

| Item | Mainnet | Testnet |
| --- | --- | --- |
| Ethereum -> Sui 24 h limit (Sui limiter, route 10->0 / 11->1) | 2,500,000,000,000,000 (8 dp) = $25,000,000 | 1 (8 dp) = $0.00000001 |
| Sui -> Ethereum 24 h limit (EVM `chainLimits`) | 5,000,000,000,000,000 (8 dp) = $50,000,000 | 1 |
| Used in trailing 24 h, Ethereum -> Sui | $732,783 (`total_amount` 73,278,320,475,700) | $0 |
| Used in trailing 24 h, Sui -> Ethereum (`calculateWindowAmount`) | $550,142 | $0 |
| Limit updates executed | Sui side 5, EVM side 4 (Etherscan dates on the limiter: 2025-01-31, 2025-08-11, 2025-08-28, 2025-10-30) | Sui side 3, EVM side 3 |
| Static prices (Sui `notional_value` / EVM `tokenPriceOf`) | ETH $3,300; WBTC $101,000; USDT $1; LBTC $90,000 | ETH $10,000; WBTC $70,000; USDC $1; USDT $1; PEPE $0.00001152 |

What the docs and UI say instead: docs.sui.io "The global limit is currently $16 million from Ethereum to Sui and $7 million from Sui to Ethereum per 24 hours." bridge.sui.io FAQ "The current limits is $8MM from Ethereum to Sui and $5MM from Sui to Etheruem every 24 hours." Both lag the chain. Governance changes are announced in the Discord `mn-validator-announcements` channel per docs.

Testnet consequence (important for the workshop): with both testnet limits at 1, every fresh transfer is approved but the claim emits `TokenTransferLimitExceed` (Sui) or reverts in `BridgeLimiter` (Sepolia). Observed: the newest Sepolia deposits (seq 227,938 and 227,939, 2026-09-04) each produced `TokenTransferApproved` + `TokenTransferLimitExceed`, and no `TokenTransferClaimed` appeared in the fullnode's ~6 day event window. Because testnet is on V2, claims become possible 48 h after deposit via `sui-bridge-cli client claim-on-sui --seq-num N --source-chain 11 --dry-run false` or any PTB calling `0xb::bridge::claim_and_transfer_token<T>`. The CLI help text says exactly this: "Auto-detects V1/V2 from the on-chain record (V2 messages >48h old bypass the rate limiter)."

---

## 4. Fees

- bridge.sui.io FAQ (rendered in a headless browser on 2026-09-07): "Are there any fees associated with asset bridging? There is no fee charged by Sui Bridge. Sui Bridge subsidizes claim gas costs for transfers from Ethereum to Sui, unless the limit is hit at that time. In this case the only expense from users is the gas costs on Ethereum."
- Architecture blog: "Sui Validators currently subsidize the gas fees associated with bridging transactions on Sui and allowing the client to execute the transactions automatically, creating a seamless bridging experience onto Sui."
- docs.sui.io bridging page does not mention a protocol fee at all; the Move code has no fee parameter (burn exactly `token.balance().value()`, mint exactly `amount`), and the Solidity code releases the full decimal-adjusted amount.
- What users do pay: Ethereum gas for `bridgeETH`/`bridgeERC20` (deposit) and for `transferBridgedTokensWithSignatures` (Sui to Ethereum claim); Sui gas for `send_token` (a normal PTB). Precision loss: "For ETH and WETH, reduced precision of eight decimals rounds 10.0000000000000001 down to 10." Minimums: 0.00000001 ETH/WETH, 0.000001 USDT.

---

## 5. Supported assets

Mainnet (docs.sui.io table, confirmed against `treasury.supported_tokens` and `BridgeConfig` today):

| Token | id | Ethereum address | Sui coin type | Sui decimals |
| --- | --- | --- | --- | --- |
| ETH (native) / WETH | 2 | native / `0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2` | `0xd0e89b2af5e4910726fbcd8b8dd37bb79b29e5f83f7491bca830e94f7f226d29::eth::ETH` | 8 |
| WBTC | 1 | `0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599` | `0xaafb102dd0902f5055cadecd687fb5b71ca82ef0e0285d90afde828ec58ca96b::btc::BTC` | 8 |
| USDT | 4 | `0xdAC17F958D2ee523a2206206994597C13D831ec7` | `0x375f70cf2ae4c00bf37117d0c85a2c71545e6ee05c4a5c7d282cd66a4504b068::usdt::USDT` | 6 |
| LBTC (Lombard) | 6 | `0x8236a87084f8B84306f72007F36F2618A5634494` | `0xc6d1cb347faf61fb743d09cf91be7280960052374a3e894342ce947b2de3e56f::wlbtc::WLBTC` | 8 |

USDC (id 3) is not registered on mainnet (`tokenAddressOf(3) = 0x0`); native USDC on Sui comes via Circle CCTP instead (the UI even has a separate "Bridge USDC" tab). Launch was ETH/WETH only (2024-09-30); WBTC, USDT and LBTC were added by `add_tokens_on_sui` / `ADD_EVM_TOKENS` governance (Sui `sequence_nums[6] = 4`, EVM `config.nonces(7) = 3`).

Vault holdings today (mainnet): 4,122.009 WETH, 105.4706 WBTC, 5,781,968.63 USDT, 70.8225 LBTC, roughly $36.4M at the bridge's static prices. Deposit counters: 33,004 Ethereum -> Sui deposits, 23,831 Sui -> Ethereum deposits since launch.

Testnet (Sepolia <-> Sui testnet), from `deploy_configs/sepolia.json`, the testnet launch blog and live reads:

| Token | id | Sepolia address | Sui testnet coin type |
| --- | --- | --- | --- |
| ETH / WETH | 2 | native / `0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14` (wrap via `deposit()`) | `0xd4e8b2874af2ccd2f067dc208ffc25a420b0c7a91d8f71c249f730d2e158afeb::eth::ETH` |
| WBTC (mock, public `mint`, 8 dp) | 1 | `0xBe9566f1bc9a6a18ad1ed5620Ccb76ff639534d5` | `0x7fd9268baa20a130e52f85935a928d9fc715365a85251eaec0a223524a258b92::btc::BTC` |
| USDC (mock, public `mint`, 6 dp) | 3 | `0x8140EBa492e02Dbf137080E2E4eC0Bd3e10784a0` | `0xa09fd1f4c7cfafcafdec341cd971c28621b451c8a60b950a92685d64cf1f1e0a::usdc::USDC` |
| USDT (mock, public `mint`, 6 dp) | 4 | `0x4E9D6D3dbFFc32399D514A5a03268e5860b6769d` | `0x85ae32e1c848dd9759917abdb0f2e19114f9b1ee47a2d6d2429af9b9ab0458fc::usdt::USDT` |
| PEPE (test token added later) | 5 | `0x3424623646F8b6DB81B58964fF22Ab6c3255daAf` | `0x5b3e288552de1d0c645227273d5342a3385c4781d1aa4dfaf55f9cc7dbf31ed5::pepe::PEPE` |

---

## 6. Governance and upgrades

- Everything is a committee-signed `BridgeMessage` executed through `bridge::execute_system_message` (Sui) or the matching `*WithSignatures` function (EVM): emergency pause/unpause, blocklist, limit update, asset price update, add tokens, and (EVM only) `upgradeWithSignatures`.
- Operator workflow (`sui-bridge-cli governance --config-path ... --chain-id ... [--dry-run] <emergency-button|update-committee-blocklist|update-limit|update-asset-price|add-tokens-on-sui|add-tokens-on-evm|upgrade-evm-contract>`): the CLI asks every committee node's `/sign/...` endpoint; nodes sign only if the action is in their `approved-governance-actions`; the CLI submits once 5001 is reached. Docs: "Limits are set by validator committee vote and announced in the mn-validator-announcements channel on Discord."
- Ethereum upgrades: UUPS. `CommitteeUpgradeable.upgradeWithSignatures(signatures, message)` decodes the payload, checks the proxy address, sets `_upgradeAuthorized`, calls `upgradeToAndCall`; `_authorizeUpgrade` requires that flag ("CommitteeUpgradeable: Unauthorized upgrade"). Event `ContractUpgraded(nonce, proxy, implementation)`. Sepolia SuiBridge has executed 4 upgrades; mainnet 0.
- Sui upgrades: `0xb` is a system package, so it changes only through Sui protocol/framework upgrades shipped in validator releases and activated at an epoch boundary; the `Versioned` wrapper (`bridge_version`, `CURRENT_VERSION = 1`) exists for lazy inner-state migration. Recent framework commits touching the package: "Bridge limiter bypass" (2025-12-23), stdlib/formatter chores through 2026-07-14.
- Emergency pause: 450 voting power (about 5 validators) can pause both sides; unpause needs 5001. `EmergencyOpEvent { frozen: bool }` on Sui, `EmergencyOperation(nonce, paused)` on Ethereum. Counters show 4 emergency ops executed on mainnet (Sui `sequence_nums[2] = 4`, EVM `nonces(2) = 4`), i.e. two pause/unpause cycles since launch, and 2 on testnet. None occurred within the current event retention window (about 4 to 5 weeks); I could not date the earlier ones from public sources during this research.
- Committee changes: registrations are open to active validators at any time (`committee_registration`, `update_node_url`), but a new committee is only instantiated by `try_create_next_committee` at end of epoch and has not been recreated on mainnet since epoch 527.

---

## 7. Audits, bounty, incidents and bugs

Audits (sui-foundation/security-audits README, linked from docs.sui.io):

- OtterSec, "Sui Bridge v1", 2024-04-17, `docs/Sui_bridge_v1_OtterSec.pdf`.
- Zellic, "Sui Bridge v1", 2024-04-29, `docs/Sui_Bridge_v1_Zellic.pdf`.
- Certora, 2026 (report not yet in the public audits repo). Evidence in the repo: PR #25396 "Certora audit fix: L-03" (merged 2026-02-10) fixed an offset bug in `BridgeUtils.decodeBlocklistPayload` where `offset += i * 20` inside the loop mis-parsed blocklist payloads with three or more addresses (replaced with `offset += 20` plus a regression test); PR #26213 "Address Certora audit fixes feedback" (merged 2026-04-14) touched `client/bridge_client.rs`, `error.rs`, `server/mod.rs`.

MoveBit disclosure (2024): MoveBit reported two issues through HackenProof on 2024-04-01 and 2024-04-17 "related to asset freezing" in the Sui cross-chain protocol; Mysten confirmed both on 2024-04-19 and resolved them on 2024-05-10, before the testnet (June 2024) and mainnet (September 2024) launches. Source: MoveBit blog post of 2024-10-12 as mirrored by Binance Square (the MoveBit domain currently serves an unrelated site, so the original text could not be re-read today; treat mechanism details beyond "asset freezing / DoS class" as unverified).

Bug bounty (HackenProof "Sui Protocol"): in scope `crates/sui-bridge` (Critical) and `bridge/` (High); critical examples "Forging of Native Bridge Messages enabling theft or illegitimate minting of assets greater than $3M with fully working PoC", "Governance / Upgrade Bypass of Bridge Contract", "Remote Code Execution on Bridge Nodes"; top reward up to $1,000,000; "Bridge authority DoS" capped at $3,000.

Operational incidents and bugs found in the repo history:

- Testnet storage-layout mismatch (Feb 2026, PR #25228): after the V2 upgrade on Sepolia the implementation read `vault`/`limiter` from mainnet slots (54/55) instead of testnet slots (4/5), returning `0x0` and "breaking node startup"; fixed in node code and documented.
- Two mainnet pause/unpause cycles (see section 6) and one validator blocklist action (2 members blocklisted today).
- Sui mainnet halts of 2026-05-28/29 were consensus/gas-logic bugs in release 1.72, not bridge issues; the bridge simply waits for Sui checkpoints.
- Not a bug, but a design hazard the primer calls out: "Decimal conversions happen twice (ERC20 -> Sui during deposit, Sui -> ERC20 during withdrawal); mismatched decimals lead to silent value drift."

No public report of funds lost from Sui Bridge was found.

---

## 8. Move package reference (package `0xb`)

Module `bridge::bridge`, constants: `MESSAGE_VERSION = 1`, `CURRENT_VERSION = 1`, `EVM_ADDRESS_LENGTH = 20`, transfer status `PENDING 0, APPROVED 1, CLAIMED 2, NOT_FOUND 3`. Errors 0..19 include `EUnauthorisedClaim (1)`, `EUnexpectedChainID (4)`, `EUnexpectedSeqNum (6)`, `EBridgeUnavailable (8)`, `EBridgeAlreadyPaused (13)`, `ETokenAlreadyClaimedOrHitLimit (15)`, `EInvalidBridgeRoute (16)`, `EInvalidEvmAddress (18)`, `ETokenValueIsZero (19)`.

Public functions:

```move
public fun send_token<T>(bridge: &mut Bridge, target_chain: u8, target_address: vector<u8>, token: Coin<T>, ctx: &mut TxContext)
public fun send_token_v2<T>(bridge: &mut Bridge, target_chain: u8, target_address: vector<u8>, token: Coin<T>, clock: &Clock, ctx: &mut TxContext)
public fun approve_token_transfer(bridge: &mut Bridge, message: BridgeMessage, signatures: vector<vector<u8>>)
public fun claim_token<T>(bridge: &mut Bridge, clock: &Clock, source_chain: u8, bridge_seq_num: u64, ctx: &mut TxContext): Coin<T>
public fun claim_and_transfer_token<T>(bridge: &mut Bridge, clock: &Clock, source_chain: u8, bridge_seq_num: u64, ctx: &mut TxContext)
public fun execute_system_message(bridge: &mut Bridge, message: BridgeMessage, signatures: vector<vector<u8>>)
public fun committee_registration(bridge: &mut Bridge, system_state: &mut SuiSystemState, bridge_pubkey_bytes: vector<u8>, http_rest_url: vector<u8>, ctx: &TxContext)
public fun update_node_url(bridge: &mut Bridge, new_url: vector<u8>, ctx: &TxContext)
public fun register_foreign_token<T>(bridge: &mut Bridge, tc: TreasuryCap<T>, uc: UpgradeCap, metadata: &CoinMetadata<T>)
```

`register_foreign_token` is how a new asset is proposed: the coin's `TreasuryCap` (supply must be zero) and `UpgradeCap` are handed to the bridge and parked in the treasury `waiting_room` (`TokenRegistrationEvent { type_name, decimal, native_token }`); only a 5001-power `add_tokens_on_sui` message moves it into `supported_tokens`, freezes the `UpgradeCap` and emits `NewTokenEvent { token_id, type_name, native_token, decimal_multiplier, notional_value }`.

Events (all `copy, drop`):

```move
public struct TokenDepositedEvent   { seq_num: u64, source_chain: u8, sender_address: vector<u8>, target_chain: u8, target_address: vector<u8>, token_type: u8, amount: u64 }
public struct TokenDepositedEventV2 { seq_num: u64, source_chain: u8, sender_address: vector<u8>, target_chain: u8, target_address: vector<u8>, token_type: u8, amount: u64, timestamp_ms: u64 }
public struct TokenTransferApproved        { message_key: BridgeMessageKey }
public struct TokenTransferClaimed         { message_key: BridgeMessageKey }
public struct TokenTransferAlreadyApproved { message_key: BridgeMessageKey }
public struct TokenTransferAlreadyClaimed  { message_key: BridgeMessageKey }
public struct TokenTransferLimitExceed     { message_key: BridgeMessageKey }
public struct EmergencyOpEvent             { frozen: bool }
// BridgeMessageKey { source_chain: u8, message_type: u8, bridge_seq_num: u64 }
// committee: CommitteeUpdateEvent { members, stake_participation_percentage }, CommitteeMemberUrlUpdateEvent, BlocklistValidatorEvent, CommitteeMemberRegistration
// treasury: TokenRegistrationEvent, NewTokenEvent, UpdateTokenPriceEvent { token_id, new_price }
// limiter: UpdateRouteLimitEvent { sending_chain, receiving_chain, new_limit }
```

The bridge node parses exactly these type strings (`crates/sui-bridge/src/events.rs`): `bridge::TokenDepositedEvent`, `bridge::TokenDepositedEventV2`, `bridge::TokenTransferApproved`, `bridge::TokenTransferClaimed`, `bridge::TokenTransferAlreadyApproved`, `bridge::TokenTransferAlreadyClaimed`, `bridge::TokenTransferLimitExceed`, `bridge::EmergencyOpEvent`, `committee::CommitteeUpdateEvent`, `committee::CommitteeMemberUrlUpdateEvent`, `committee::BlocklistValidatorEvent`, `committee::CommitteeMemberRegistration`, `treasury::TokenRegistrationEvent`, `treasury::NewTokenEvent`, `treasury::UpdateTokenPriceEvent`, `limiter::UpdateRouteLimitEvent`.

Read helpers used by dev-inspect tooling (private, marked `#[allow(unused_function)]`): `get_token_transfer_action_status(bridge, source_chain, seq_num): u8` and `get_token_transfer_action_signatures(...)`.

Token ids (`treasury.move` / `BridgeUtils`): SUI 0 (EVM only), BTC 1, ETH 2, USDC 3, USDT 4; 5 and 6 were assigned by governance (PEPE on testnet, WLBTC on mainnet).

---

## 9. Integrating programmatically

What exists:

- No `@mysten/bridge` TypeScript SDK. `@mysten/sui` (2.29.0 today) gives you everything needed: `Transaction` for PTBs, `SuiGrpcClient` (`@mysten/sui/grpc`) and `SuiGraphQLClient` (`@mysten/sui/graphql`) for reads and streams. JSON-RPC is gone on public nodes: today's response was `"JSON-RPC on public fullnodes has been deprecated. Please migrate to gRPC or GraphQL endpoints."` (docs: shutoff the week of 2026-07-27, full removal mid-October 2026).
- No hosted status REST API. The bridge UI (bridge.sui.io, bridge.testnet.sui.io) is a closed frontend that reads chain state. Bridge nodes expose the public `GET /sign/...` endpoints listed in 1.3 (each returns that validator's `SignedBridgeAction`), which is exactly how the client and CLI assemble certificates; you can do the same.
- `sui-bridge-cli` (Rust, `cargo install --locked --git https://github.com/MystenLabs/sui.git sui-bridge-cli`): `view-sui-bridge --sui-rpc-url <url> [--ping]` (dumps committee, limits, tokens, pings each node), `view-eth-bridge --eth-rpc-url <url> --bridge-proxy <addr>`, `view-bridge-registration`, and `client --config-path <cfg> {deposit-native-ether-on-eth | deposit-on-sui | claim-on-eth --seq-num N | claim-on-sui --seq-num N --source-chain 11}` (with `--bridge-version v1|v2`). Converted to gRPC in Feb 2026.
- `sui-bridge-indexer` (self-hosted, Postgres, reads checkpoints from `https://checkpoints.mainnet.sui.io` and Ethereum logs; config needs `eth_sui_bridge_contract_address`, `sui_bridge_genesis_checkpoint`, `eth_bridge_genesis_block`).

Building a Sui -> Ethereum deposit with the TS SDK (testnet; ETH type from section 5):

```ts
import { Transaction } from '@mysten/sui/transactions';
import { fromHex } from '@mysten/sui/utils';

const BRIDGE = '0x9';
const ETH_TESTNET = '0xd4e8b2874af2ccd2f067dc208ffc25a420b0c7a91d8f71c249f730d2e158afeb::eth::ETH';
const ETH_SEPOLIA_CHAIN_ID = 11;
const ethRecipient = '0x1111111111111111111111111111111111111111';

const tx = new Transaction();
const [coin] = tx.splitCoins(tx.object(ethCoinObjectId), [tx.pure.u64(1_000_000)]); // 0.01 ETH at 8 dp
tx.moveCall({
  target: '0xb::bridge::send_token_v2',            // or send_token without the clock
  typeArguments: [ETH_TESTNET],
  arguments: [
    tx.object(BRIDGE),
    tx.pure.u8(ETH_SEPOLIA_CHAIN_ID),
    tx.pure.vector('u8', Array.from(fromHex(ethRecipient))), // exactly 20 bytes
    coin,
    tx.object('0x6'),                                // Clock, only for v2
  ],
});
// sign + execute with your wallet or SuiGrpcClient.signAndExecuteTransaction
```

Claiming an approved Ethereum -> Sui transfer yourself (anyone may call it):

```ts
tx.moveCall({
  target: '0xb::bridge::claim_and_transfer_token',
  typeArguments: [ETH_TESTNET],
  arguments: [tx.object('0x9'), tx.object('0x6'), tx.pure.u8(11), tx.pure.u64(seqNum)],
});
```

Depositing on Ethereum with Foundry (Sepolia):

```bash
# recipient must be the 32-byte Sui address as bytes
cast send 0xAE68F87938439afEEDd6552B0E83D2CbC2473623 \
  'bridgeETH(bytes,uint8)' 0x<32-byte-sui-address> 1 \
  --value 0.001ether --rpc-url https://ethereum-sepolia-rpc.publicnode.com --private-key $PK
```

Monitoring events with gRPC (verified shapes; note the fully padded package address is mandatory, `0xb` alone is rejected with "invalid address"):

```bash
PKG=0x000000000000000000000000000000000000000000000000000000000000000b
# live stream of Sui -> Ethereum deposits on testnet
grpcurl -d '{"filter":{"terms":[{"literals":[{"event_type":{"event_type":"'$PKG'::bridge::TokenDepositedEvent"}}]}]},
             "read_mask":{"paths":["event_type","json","checkpoint","transaction_digest"]}}' \
  fullnode.testnet.sui.io:443 sui.rpc.v2.SubscriptionService/SubscribeEvents

# recent history (fullnode index keeps roughly the last 5 weeks on mainnet, 6 days on testnet)
grpcurl -d '{"filter":{"terms":[{"literals":[{"event_type":{"event_type":"'$PKG'::bridge::TokenTransferLimitExceed"}}]}]},
             "options":{"limit":5,"ordering":"ORDERING_DESCENDING"},
             "read_mask":{"paths":["event_type","json","checkpoint","transaction_digest"]}}' \
  fullnode.testnet.sui.io:443 sui.rpc.v2.LedgerService/ListEvents
```

TypeScript equivalent:

```ts
import { SuiGrpcClient } from '@mysten/sui/grpc';
const client = new SuiGrpcClient({ network: 'testnet', baseUrl: 'https://fullnode.testnet.sui.io:443' });
const PKG = '0x000000000000000000000000000000000000000000000000000000000000000b';
const stream = client.subscriptionService.subscribeEvents({
  filter: { terms: [{ literals: [{ eventType: { eventType: `${PKG}::bridge::TokenDepositedEvent` } }] }] },
  readMask: { paths: ['event_type', 'json', 'checkpoint', 'transaction_digest'] },
});
for await (const msg of stream.responses) console.log(msg.event?.json);
// one-shot reads: client.getObject({ objectId: '0x9' }), client.stateService.listDynamicFields({ parent }), client.ledgerService.listEvents({...})
```

GraphQL (about 4 weeks of retention on the public endpoint; earliest deposit event returned today was 2026-08-11):

```graphql
{ events(filter:{type:"0x000000000000000000000000000000000000000000000000000000000000000b::bridge::TokenDepositedEvent"}, last:5) {
    nodes { timestamp transaction { digest } contents { json } } } }
```
POST to `https://graphql.testnet.sui.io/graphql` or `https://graphql.mainnet.sui.io/graphql`.

Checking a transfer's status without an indexer: read the record from the `token_transfer_records` linked table (dynamic field keyed by `BridgeMessageKey { source_chain, message_type: 0, bridge_seq_num }`) through `StateService.ListDynamicFields` / `LedgerService.GetObject`, or run `sui-bridge-cli view-sui-bridge`, or watch for `TokenTransferApproved` / `TokenTransferClaimed` with the message key.

---

## 10. Testnet setup

- UI: https://bridge.testnet.sui.io/ (HTTP 200 today). Networks: Ethereum Sepolia (chain id 11 in bridge terms) <-> Sui testnet (chain id 1).
- Contracts: SuiBridge proxy `0xAE68F87938439afEEDd6552B0E83D2CbC2473623` and the support contracts in section 1.8; Sui package `0xb`, object `0x9`, token types in section 5.
- Faucets: Sepolia ETH from the Google Cloud faucet `https://cloud.google.com/application/web3/faucet/ethereum/sepolia`; SUI from the wallet faucet or `sui client faucet`. Test WETH: call `deposit()` on `0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14` with value; test WBTC/USDC/USDT: the mock contracts expose a public `mint` (per the testnet launch blog, "Write Contract" on Etherscan).
- Limiter status today: 1 unit in both directions, so plan for approval-visible-immediately, claim-after-48h behaviour (section 3.2). Deposit at least two days before you need to show a completed claim.
- Historical note: the June 2024 testnet incentive program (100,000 SUI) disqualified addresses that "used the bridge outside the web interface (direct function calls)"; that program is over, direct calls are fine now.

---

## 11. Roadmap (as stated by Sui)

- Architecture blog: "Later versions of Sui Bridge will add new functionality such as custom cross-chain messaging and integration with other blockchains." and "After Sui Bridge is released on Mainnet, support for more assets will be prioritized."
- GitHub issue #14983 (Nov 2023, the original design proposal, now closed): V1 = static committee, blocklist, fungible tokens Sui <-> Ethereum; future = "new assets, message types and more chains" and dynamic committee management.
- Mainnet launch blog (2024-09-30): "Sui Bridge will expand asset support and eventually add unique functionality to accommodate a wide range of use cases."
- What has actually shipped since: WBTC, USDT, LBTC added; four limit raises; V2 timestamped messages with the 48 h limiter bypass (Dec 2025, live on testnet, not yet on mainnet EVM); bridge node moved from ethers to alloy (Jan 2026) and CLI moved to gRPC (Feb 2026); a Certora review (early 2026). No second chain and no generic messaging are live as of 2026-09-07.

---

## 12. Demo ideas that work on testnet

All commands were run successfully on 2026-09-07 from this machine (`sui` 1.79.0, `grpcurl`, `cast`, `node` available).

1. Read the bridge object and its inner state (no wallet needed):

```bash
grpcurl -d '{"object_id":"0x9","read_mask":{"paths":["object_id","version","owner","object_type","json"]}}' \
  fullnode.testnet.sui.io:443 sui.rpc.v2.LedgerService/GetObject
# take json.inner.id, list its one dynamic field, then read it:
grpcurl -d '{"parent":"0x7e1cbb5e18bf371232f9efe1e954a0f80bd72533a9da06a347087c434e6224b9"}' \
  fullnode.testnet.sui.io:443 sui.rpc.v2.StateService/ListDynamicFields
grpcurl -d '{"object_id":"0x170e627dcac3379bf4de6eb057018cd4a9b6e877f5e3cc7ea8c82d89413e9145","read_mask":{"paths":["json"]}}' \
  fullnode.testnet.sui.io:443 sui.rpc.v2.LedgerService/GetObject | jq '.object.json.value | {paused, chain_id, sequence_nums, limiter: .limiter.transfer_limits, tokens: .treasury.id_token_type_map, committee_size: (.committee.members.contents | length)}'
```
Talking points: `paused`, the per-message-type nonces, the 5 route limits (spot the `1`), 66 committee members, base64 `http_rest_url` values.

2. Decode a committee member's URL and hit its signing server:

```bash
echo aHR0cHM6Ly9zdWktdGVzdG5ldC1icmlkZ2UuYndhcmVsYWJzLmNvbTo0NDM= | base64 -d   # https://sui-testnet-bridge.bwarelabs.com:443
curl -s https://sui-testnet-bridge.bwarelabs.com:443/ping
# ask that validator to sign an existing Sepolia deposit (tx hash + log index from Etherscan)
curl -s https://sui-testnet-bridge.bwarelabs.com:443/sign/bridge_tx/eth/sui/<sepolia_tx_hash>/<event_index> | jq
```
Talking point: signatures are public goods; anyone can aggregate 3334 of them and submit `approve_token_transfer`.

3. Stream live deposits while someone in the room bridges from the UI (`SubscribeEvents` command in section 9). Testnet has real traffic (227,940 Sepolia deposits, 89,663 Sui-side deposits so far).

4. Do a Sui -> Sepolia deposit from the CLI and watch the record move from PENDING to APPROVED in seconds:

```bash
sui client switch --env testnet
sui client ptb \
  --split-coins @<eth_coin_object> "[1000000]" --assign c \
  --move-call 0xb::bridge::send_token "<0xd4e8...::eth::ETH>" @0x9 11u8 "vector[0x11u8,0x11u8,0x11u8,0x11u8,0x11u8,0x11u8,0x11u8,0x11u8,0x11u8,0x11u8,0x11u8,0x11u8,0x11u8,0x11u8,0x11u8,0x11u8,0x11u8,0x11u8,0x11u8,0x11u8]" c \
  --gas-budget 20000000
```
Then query `TokenTransferApproved` for your `seq_num`. Explain that the Sepolia claim would currently revert on the limiter (limit = 1) unless you sent a V2 message and wait 48 h.

5. Read the Ethereum side with cast (no key needed):

```bash
export S=https://ethereum-sepolia-rpc.publicnode.com; B=0xAE68F87938439afEEDd6552B0E83D2CbC2473623
cast call $B 'paused()(bool)' --rpc-url $S
cast call $B 'nonces(uint8)(uint64)' 0 --rpc-url $S                       # deposits so far
cast call 0xFA393e28Dd7F88F66112324b20F45F8AA60c19Df 'chainLimits(uint8)(uint64)' 1 --rpc-url $S   # Sui->Sepolia limit
cast call 0x624Ddc521b3934CaFb94AA6a4fF120fc8FA45B5F 'tokenPriceOf(uint8)(uint64)' 2 --rpc-url $S # ETH static price
# same on mainnet with B=0xda3bD1fE1973470312db04551B65f401Bc8a92fD, limiter 0x12183B..., config 0x72D34F..., chain 0
```

6. Ethereum -> Sui end to end (needs 48 h lead time on today's testnet): `cast send $B 'bridgeETH(bytes,uint8)' 0x<sui address 32 bytes> 1 --value 0.001ether ...` two days before class; in class, show the `TokensDeposited` log, the Sui `TokenTransferApproved` + `TokenTransferLimitExceed` pair 13 minutes later (from history), then claim live with `claim_and_transfer_token` (section 9) or `sui-bridge-cli client claim-on-sui --seq-num N --source-chain 11 --dry-run false`, and watch `TokenTransferClaimed` plus the ETH coin landing in the recipient's balance.

7. Verify a committee signature offline (advanced): fetch a `SignedBridgeAction` from step 2, rebuild `keccak256("SUI_BRIDGE_MESSAGE" || type || version || nonce || chain || payload)` with `cast keccak`, recover with `cast` or `@noble/curves` secp256k1, and check the address against the `BridgeCommittee.committeeStake` mapping on Sepolia. This shows why the same signature works on both chains.

Fallback for the room: mainnet reads (`0x9` state, vault balances, 24 h window usage) are instant and safe to run live; they make the "$25M / $50M limits, $36M in the vault" point concrete.

---

## Sources (all read 2026-09-07)

Official docs and blog

- Bridging Tokens (Sui docs): https://docs.sui.io/onchain-finance/fungible-tokens/sui-bridging (and the source `docs/content/onchain-finance/fungible-tokens/sui-bridging.mdx`)
- Sui Bridge Validator Node Configuration: https://docs.sui.io/guides/operator/bridge-node-configuration
- Framework reference, module bridge::bridge: https://docs.sui.io/references/framework/sui_bridge/bridge
- JSON-RPC migration (deprecation timeline, gRPC/GraphQL mapping): https://docs.sui.io/develop/accessing-data/json-rpc-migration
- Using events (gRPC ListEvents/SubscribeEvents, GraphQL events): https://docs.sui.io/develop/accessing-data/using-events
- Diving into Sui Bridge Architecture (2024-07-22): https://www.sui.io/blog/sui-bridge-architecture
- Sui Bridge Goes Live on Testnet with Incentive Program (2024-06-11): https://www.sui.io/blog/sui-bridge-live-on-testnet-with-incentives
- Sui Bridge Goes Live on Mainnet Today (2024-09-30): https://www.sui.io/blog/sui-bridge-launches-on-mainnet
- All About Bridging (2023-09-06, predates Sui Bridge; covers Wormhole): https://www.sui.io/blog/bridging-explained
- Sui Bridge UI and FAQ (rendered in headless browser): https://bridge.sui.io/ ; testnet UI: https://bridge.testnet.sui.io/

Code (MystenLabs/sui, main branch)

- Move package: https://github.com/MystenLabs/sui/tree/main/crates/sui-framework/packages/bridge/sources (bridge.move, committee.move, limiter.move, message.move, message_types.move, treasury.move, chain_ids.move)
- Solidity: https://github.com/MystenLabs/sui/tree/main/bridge/evm (SuiBridge.sol, SuiBridgeV2.sol, BridgeCommittee.sol, BridgeLimiter.sol, BridgeConfig.sol, utils/BridgeUtils.sol, utils/CommitteeUpgradeable.sol, deploy_configs/mainnet.json, deploy_configs/sepolia.json, script/deploy_bridge.s.sol)
- Native bridge primer: https://github.com/MystenLabs/sui/blob/main/bridge/SUI_NATIVE_BRIDGE_PRIMER.md
- Testnet incentive FAQ: https://github.com/MystenLabs/sui/blob/main/bridge/incentivize_testnet_faq.md
- Bridge node: https://github.com/MystenLabs/sui/tree/main/crates/sui-bridge/src (config.rs, eth_client.rs, eth_syncer.rs, action_executor.rs, events.rs, server/mod.rs, sui_transaction_builder.rs, eth_transaction_builder.rs)
- Bridge CLI: https://github.com/MystenLabs/sui/tree/main/crates/sui-bridge-cli/src (lib.rs, main.rs)
- Bridge indexer README: https://github.com/MystenLabs/sui/blob/main/crates/sui-bridge-indexer/README.md
- PRs: #24221 Bridge limiter bypass (2025-12-23), #25228 storage layout mismatch (2026-02-03), #25396 Certora audit fix L-03 (2026-02-10), #26213 Certora feedback (2026-04-14), #25378 V2 CLI commands (2026-02-13), #24575 ethers to alloy (2026-01-07)
- Original design issue: https://github.com/MystenLabs/sui/issues/14983

Security

- Sui Foundation audit index: https://github.com/sui-foundation/security-audits (OtterSec 2024-04-17, Zellic 2024-04-29)
- HackenProof Sui Protocol bounty: https://hackenproof.com/sui/sui-protocol
- MoveBit disclosure (2024-10-12): https://movebit.xyz/blog/post/MoveBit-Discovers-and-Helps-Fix-Vulnerability-in-Sui-Cross-Chain-Protocol-20241012.html (original not reachable today) ; mirror summary: https://www.binance.com/square/post/2024-10-09-movebit-sui-14625908844498

Explorers and live reads

- Etherscan mainnet proxy: https://etherscan.io/address/0xda3bd1fe1973470312db04551b65f401bc8a92fd ; implementation: https://etherscan.io/address/0xa60f29201aeae592d9ab95747ae1cf425dbb036c ; limiter (limit update dates): https://etherscan.io/address/0x12183B0796BBc4678999100e8c6C5715D5736767
- Sepolia proxy: https://sepolia.etherscan.io/address/0xAE68F87938439afEEDd6552B0E83D2CbC2473623 ; implementation (SuiBridgeV2): https://sepolia.etherscan.io/address/0xe3D3C63E820999c61Bc25C0A808Bf480B1C65C7F ; unused "Sui Bridge" label: https://sepolia.etherscan.io/address/0x47d79e8575e29e70067fd8ff535dfe6b4042d733
- Sui gRPC: fullnode.mainnet.sui.io:443, fullnode.testnet.sui.io:443 (GetObject, ListDynamicFields, ListEvents, GetTransaction, GetCheckpoint, GetServiceInfo); GraphQL: https://graphql.mainnet.sui.io/graphql, https://graphql.testnet.sui.io/graphql
- Ethereum RPC used for reads: https://ethereum-rpc.publicnode.com, https://ethereum-sepolia-rpc.publicnode.com

Secondary (context only)

- Stakin, "A Deep-Dive Into Sui Bridge" (2024-07-02): https://stakin.com/blog/a-deep-dive-into-sui-bridge
- Datawallet / GetBlock bridge guides (fee and limit summaries, not authoritative)
