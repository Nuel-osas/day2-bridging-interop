# ika-wallet


## Solana (ed25519)

Solana, NEAR, Cardano and Sui all sign with ed25519, not secp256k1. A dWallet is bound to one curve, so Solana needs a second dWallet per user. The "solana" card runs that second DKG on demand (`Curve.ED25519`), and sends sign with `SignatureAlgorithm.EdDSA` + `Hash.SHA512` over the serialized Solana message. The 64-byte signature is attached with `tx.addSignature` and broadcast to devnet.

Measured on testnet Ika: second DKG 27 s (one-off per user), send 17 s (presign ready), first send after enable buys a presign so add 10 s.

Funding: devnet airdrop is rate limited from busy networks. If the "airdrop 1 SOL" button fails, use https://faucet.solana.com or `solana transfer -u devnet --allow-unfunded-recipient <addr> 0.5` from a funded CLI key.

Files: `lib/ika.ts` (`ensureSolanaWallet`, `signEdDSA`), `lib/sol.ts`, `app/api/solana/{enable,airdrop}`, `chain: "solana"` on `/api/send`.
