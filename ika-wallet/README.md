# ika-wallet


## Solana (ed25519)

Solana, NEAR, Cardano and Sui all sign with ed25519, not secp256k1. A dWallet is bound to one curve, so Solana needs a second dWallet per user. The "solana" card runs that second DKG on demand (`Curve.ED25519`), and sends sign with `SignatureAlgorithm.EdDSA` + `Hash.SHA512` over the serialized Solana message. The 64-byte signature is attached with `tx.addSignature` and broadcast to devnet.

Measured on testnet Ika: second DKG 27 s (one-off per user), send 17 s (presign ready), first send after enable buys a presign so add 10 s.

Funding: devnet airdrop is rate limited from busy networks. If the "airdrop 1 SOL" button fails, use https://faucet.solana.com or `solana transfer -u devnet --allow-unfunded-recipient <addr> 0.5` from a funded CLI key.

Files: `lib/ika.ts` (`ensureSolanaWallet`, `signEdDSA`), `lib/sol.ts`, `app/api/solana/{enable,airdrop}`, `chain: "solana"` on `/api/send`.

## Deploying (Vercel + Neon Postgres)

Live: https://ika-wallet-nues-projects-a2cec4ad.vercel.app (branch `vercel`).

With `DATABASE_URL` set the app stops using `data/*.json`. Wallets and the presign pool live in Postgres (`lib/db.ts`, tables `wallets` and `presigns`, created on first use). Two things only Postgres gives you on serverless:

- Taking a presign is `DELETE ... RETURNING` with `SKIP LOCKED`, so two instances never hand the same presign to two users. One refill loop at a time via `pg_try_advisory_xact_lock`.
- Every operator transaction on Sui runs under `pg_advisory_xact_lock`, then waits until the fullnode has seen it. The operator has one IKA coin and one gas pool; two instances building against the same object versions get rejected by validators as equivocation.

Env on Vercel: `DATABASE_URL`, `SUI_OPERATOR_PRIVATE_KEY` (suiprivkey string, from `sui keytool export`), `SUI_OPERATOR_ADDRESS`, `IKA_COIN_ID`, `IKA_ROOT_SEED`, `SESSION_SECRET`, `GOOGLE_CLIENT_ID`, `SEPOLIA_RPC_URL`. Routes declare `maxDuration = 300`. Deployment protection must be off (project settings, or PATCH `ssoProtection: null`).

Measured on Vercel: cold send about 50 s (WASM and protocol parameters load in the instance), warm about 20 s. Migrate an existing `data/wallets.json` with a one-off insert into `wallets (usr, data)`.
