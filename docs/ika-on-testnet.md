# Ika on testnet, what actually works (2026-09-08)

Verified end to end with `@ika.xyz/sdk` 0.5.0 on `@mysten/sui` 2.29 with the gRPC client.

## Getting IKA

There is no drip faucet. `faucet.ika.xyz` is an on-chain exchange: 1 SUI buys 10 IKA.
The UI needs a browser wallet, but the contract is callable from the CLI:

```bash
sui client ptb \
  --split-coins gas "[2000000000]" --assign c \
  --move-call 0x5d2fd4d021b617a998373b4dfec563adb60b1b47be2a77572c3ff158083e9f89::ika_exchange::exchange_all_for_ika \
      @0xb2ba36b1a5927e3f070240a3dfccdeac033a756bf265aa1401037eb300d40d66 c.0 --assign ika \
  --transfer-objects "[ika]" @$(sui client active-address) --gas-budget 20000000
```

Costs observed: DKG about 4 IKA, a global presign more than 2.6 IKA, a sign a few IKA. Budget
10 IKA per dWallet demo.

## The flow that ran (scripts/09-ika-eth-wallet.mjs)

1. `registerEncryptionKey({ curve })` once per Sui address. A second attempt aborts with code 0; catch it.
2. `prepareDKGAsync` then `requestDWalletDKGWithPublicUserShare` (a shared dWallet: the network signs for whoever holds the `DWalletCap`). Returns `[cap, signId]`; transfer the cap to yourself.
3. `getDWalletInParticularState(id, "Active")`, then `publicKeyFromDWalletOutput` and `computeAddress` from ethers for the Ethereum address.
4. `requestGlobalPresign`, transfer the returned cap to yourself, wait for `Completed`.
5. `createUserSignMessageWithPublicOutput` with the protocol public parameters, then `approveMessage` plus `requestSign`. Do not transfer requestSign's return value.
6. `getSignInParticularState(signId, curve, algo, "Completed")`. The 64-byte r||s recovers to the dWallet's Ethereum address with v 27 or 28.

## Gotchas that cost an hour

- Pass `tx.object(IKA_COIN)` and `tx.gas` directly. Both Move functions take the coins by
  mutable reference and deduct fees; a split coin is left over and the PTB fails with
  `UnusedValueWithoutDrop`.
- gRPC events carry `json.event_data`; the JSON-RPC `parsedJson` shape is gone. `dwallet_id`,
  `dwallet_cap_id`, `presign_id`, `sign_id` live there.
- `getOwnedDWalletCaps` throws on caps minted by older coordinator versions; wrap it.
- The `option::none` type argument must use the upgraded 2pc-mpc package id; the SDK does this correctly.
