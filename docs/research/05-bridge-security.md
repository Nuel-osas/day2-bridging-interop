# Bridge Security and How to Evaluate a Bridge

Research brief for the SuiHub Lagos bridging workshop, 2026-09-08. Compiled 2026-09-07. Audience: experienced developers who will integrate a bridge into a Sui app.

Every number carries a source tag like [S12]. The Sources section at the end lists the URL and the date each was read. Where a primary source could not be retrieved, the tag says so and the claim is marked as reported rather than verified.

---

## 0. Ten facts to carry into the room

1. Bridges were 69 percent of all crypto stolen in 2022 at the point Chainalysis measured it (2 billion USD across 13 bridge hacks) [S44]. DefiLlama's running tally, as cited by Hacken, has bridge hacks above 2.5 billion USD, more than half of all DeFi losses [S61].
2. The failure mode changed. 2021 to 2022 was mostly code bugs in verification (Poly, Wormhole, Nomad, BNB). 2022 to 2024 was mostly keys (Ronin, Harmony, Multichain, Orbit). 2026's biggest loss, Kelp DAO at 292 million USD, was a configuration failure: a 1-of-1 verifier with compromised RPC infrastructure, and zero smart contract bugs [S46][S47][S49].
3. PeckShield counted eight bridge hacks and 328.6 million USD stolen in 2026 by mid-May [S51]. Two more (AFX 24.15 million USD, Verus repeat 7.54 million USD) landed on 22 to 23 July 2026 [S54].
4. Sui Bridge is run by Sui validators. A token transfer needs 3334 of 10000 voting power, an emergency pause needs only 450, an unpause needs 5001 [S5].
5. Sui Bridge has an on-chain limiter: a rolling 24 hour, hourly-bucketed USD cap per route. The code default is 5,000,000 USD; the committee has since voted it to 16 million USD Ethereum to Sui and 7 million USD Sui to Ethereum [S1][S3].
6. MoveBit reported two Sui Bridge vulnerabilities through HackenProof on 1 and 17 April 2024; Mysten confirmed them on 19 April and fixed them by 10 May 2024, more than four months before Sui Bridge mainnet on 30 September 2024 [S8][S9][S6].
7. Cetus (22 May 2025, about 223 million USD) was a DEX math bug, not a bridge exploit. Bridges were the exit: roughly 60 million USD left via Wormhole and Circle CCTP before validators stopped processing the attacker's transactions; about 162 million USD stayed frozen on Sui [S11][S12][S13].
8. Wormhole's Sui contracts were audited by OtterSec in April 2023 (the month before Sui mainnet) and again for Sui NTT in August 2025 [S21]. No public exploit of Wormhole on Sui was found in this research.
9. bridge-sui.vercel.app is live today, calls itself "The Official Bridge to Sui Network", and tells users to verify contract addresses "at bridge-sui.vercel.app". The real domain is bridge.sui.io [S57][S1].
10. Across' own docs say refunds after an unfilled intent "can take several hours" and that you should never tell users to expect an immediate refund [S27]. Every intent bridge has a slow path; design for it.

---

## 1. Major bridge exploits, dated

Amounts are at the time of the exploit, rounded, with the source for each figure. "Trust assumption that failed" is the single sentence a developer should remember.

| Date | Bridge | Loss | Root cause (technical) | Trust assumption that failed | Taxonomy bucket |
|---|---|---|---|---|---|
| 2021-08-10 | Poly Network | 611 million USD [S34][S43] | A crafted cross-chain message made EthCrossChainManager call EthCrossChainData.putCurEpochConPubKeyBytes via a function-selector collision, replacing the keeper public key with the attacker's [S34] | Message verification: the contract that executes arbitrary cross-chain calls was also the owner of the contract holding the signer set. Privilege escalation through the bridge's own executor. Funds were returned. | Lock-and-mint with external keepers |
| 2022-02-02 | Wormhole (Solana side) | 120,000 wETH, about 326 million USD [S35][S43] | Signature verification used the deprecated Solana load_instruction_at, which does not check that the sysvar account passed in is the real Instructions sysvar. Attacker passed a fake sysvar, so the guardian signature check "passed" and 120k wETH were minted [S35] | Signature verification bug: the guardian set was fine, but the destination contract's check that guardian signatures were verified could be faked. Jump Trading recapitalised the bridge. | Guardian network (external verification) |
| 2022-03-23 (found 03-29) | Ronin | 173,600 ETH plus 25.5 million USDC, about 624 million USD [S36][S43] | Attacker obtained 5 of 9 validator keys: 4 Sky Mavis nodes plus the Axie DAO validator, whose gas-free RPC allowlist for Sky Mavis (set up November 2021) was never revoked. Nobody noticed for six days [S36] | Key compromise plus operational drift: a temporary permission became permanent, and 9 signers were really fewer independent parties. FBI attributed it to Lazarus [S63]. | Lock-and-mint with external validator multisig |
| 2022-06-24 | Harmony Horizon | about 100 million USD [S37][S38] | The bridge was a 2 of 5 multisig; two signer keys were compromised. Attack vector on the keys never published; speculation was plaintext hot-wallet keys [S37] | Key compromise with a tiny threshold. FBI confirmed Lazarus [S38]. Signers were raised to 4 afterwards [S37]. | Lock-and-mint with external multisig |
| 2022-08-01 | Nomad | about 190 million USD [S32][S43] | A 21 April upgrade to the Replica implementation set confirmAt[0x00] = 1, so acceptableRoot(0x00) returned true. Any message whose root had never been set (default 0x00) was treated as proven. First tx took 100 WBTC; then hundreds of copycats replayed with their own address [S32] | Upgrade introduced a verification bug: the optimistic design's fraud window never engaged because the message skipped proving altogether. "Trusted root initialised to zero" is the canonical example of an unsafe default. | Optimistic verification (upgradeable proxy) |
| 2022-10-06 | BNB Bridge (BSC Token Hub) | 2 million BNB minted, about 566 to 586 million USD; about 100 to 137 million USD left the chain [S33][S43] | IAVL Merkle range-proof verification did not include a node's right attribute in the root hash, so a forged proof with an injected right child validated. Attacker had registered as a relayer for 100 BNB [S33] | Light-client proof verification bug in a precompile. The chain was halted and hard-forked to blacklist the attacker. | Light client / on-chain verification |
| 2023-07-06 to 07-07 | Multichain | 126.3 million USD moved from MPC addresses [S40]; earlier context: CEO detained 2023-05-21, shutdown 2023-07-14 [S39] | The MPC node servers ran on the CEO's personal cloud account; police confiscated his devices, hardware wallets and seed phrases; his sister later used cloud credentials to move funds [S39] | The "MPC network" was one person's infrastructure. Threshold cryptography does not help if all shares live in one operator's cloud. | MPC / TSS network (centralised in practice) |
| 2023-12-31 | Orbit Chain | 81.5 million USD [S41][S42] | Attacker signed with 7 of the 10 ETH Vault multisig signers; the team never disclosed how the keys were taken. Transaction pattern suggested Lazarus [S41] | Key compromise of a multisig whose signers were not independent enough. | Lock-and-mint with external multisig |
| 2025-06-02 | Force Bridge (Nervos) | about 3 to 3.9 million USD [S55][S56] | Attacker invoked privileged unlock functions on Ethereum and BSC; Halborn classifies it as an access-control failure typically caused by compromised keys [S56] | Privileged key / access control. | Lock-and-mint with external operator |
| 2026-01-31 | CrossCurve | about 3 million USD [S53] | ReceiverAxelar.expressExecute was publicly callable and did not verify the message came from the Axelar gateway; attacker fabricated sourceChain and sourceAddress and had PortalV2 release tokens [S53] | Message-origin check missing on the destination contract. Same family as Nomad. | Generic messaging integration bug |
| 2026-02 | IoTeX ioTube | 4.3 million USD [S51] | A validator owner's private key was compromised; unauthorised USDC, USDT, IOTX and WBTC were minted [S51] | Key compromise. | Lock-and-mint with external validators |
| 2026-04-18 | Kelp DAO rsETH (LayerZero OFT) | 116,500 rsETH, about 292 million USD; a further 40,000 rsETH (about 95 to 100 million USD) blocked [S46][S48] | rsETH's OFTAdapter used a 1-of-1 DVN (LayerZero Labs as sole verifier). Attackers compromised two internal RPC nodes feeding that DVN and DDoS'd the external ones, so the DVN attested to a burn on Unichain that never happened. Ethereum released escrowed rsETH. No contract bug [S46][S47][S49] | Verification configuration: one verifier, whose view of the source chain could be poisoned. Attribution: DPRK TraderTraitor [S46]. Aave carried 123 to 230 million USD of bad debt from rsETH collateral [S49]. LayerZero Labs' DVN will no longer sign for 1-of-1 channels [S47]. Kelp says 1-of-1 was LayerZero's documented default [S50]. | Generic messaging with configurable verifiers |
| 2026-05-15 | THORChain | 10.8 million USD [S51] | Compromised validator node; swaps halted about 13 hours [S51] | Key / node compromise. | Liquidity network with TSS vaults |
| 2026-05-17 to 05-18 | Verus-Ethereum | 11.58 million USD (1,625 ETH, 103 tBTC, about 147,000 USDC) [S52] | Both sides validated structure and proofs but neither checked that the value exported on Verus matched the payout claimed on Ethereum (checkCCEValues). A roughly 10 USD Verus transaction unlocked 11.58 million USD [S52] | Semantic validation gap: cryptographically valid, economically fraudulent. | Notary-based lock-and-mint |
| 2026-07-22 to 07-23 | AFX Trade bridge, then Verus again | AFX 24.15 million USDC via five compromised validator keys; Verus 7.54 million USD through the same May vulnerability [S54] | Key compromise (AFX); unpatched repeat (Verus) [S54] | Keys; and a bridge that reopened before the root cause was fixed. | External validators; notary bridge |

Context numbers: Chainalysis puts total 2025 theft above 3.4 billion USD, of which the Bybit exchange breach (not a bridge) was 1.5 billion USD, and DPRK-linked actors took 2.02 billion USD. DPRK actors used cross-chain bridges 97 percent more than other threat actors in laundering [S45].

---

## 2. Taxonomy of bridge designs and their trust assumptions

The question to ask of every design is the same: who or what can cause the destination chain to release or mint value, and what has to be true for that to be wrong?

### 2.1 Lock-and-mint with external validators or multisig

Assets are locked in a contract on the source chain; a set of off-chain signers observe the lock and authorise a mint or release on the destination. Security equals the honesty and key hygiene of the signer set, and the correctness of the contract that checks their signatures.

- Failure modes seen: Ronin (5 of 9 keys) [S36], Harmony (2 of 5) [S37], Orbit (7 of 10) [S41], AFX (5 validator keys) [S54], IoTeX (one validator key) [S51], Poly Network (executor could rewrite the signer set) [S34].
- What to check: number of signers, whether they are genuinely independent organisations, threshold, whether any signer can sign for another (the Ronin allowlist), key storage, and who can change the signer set.

### 2.2 Native validator-set bridges: Sui Bridge

Sui Bridge is "operated and governed by Sui validators, the same set that secures the Sui network" [S1]. Each validator runs a bridge node with a separate ECDSA BridgeAuthorityKey, observes Ethereum and Sui, and signs transfer approvals [S2]. On-chain, execute_system_message calls committee.verify_signatures before touching any payload [S4]. Thresholds are voting power on a 10,000 scale [S5]:

| Action | Required voting power |
|---|---|
| Token transfer | 3334 |
| Emergency pause | 450 |
| Emergency unpause | 5001 |
| Committee blocklist | 5001 |
| Update bridge limit | 5001 |
| Update asset price | 5001 |
| Add tokens on Sui | 5001 |

Trust assumption: the same 1/3 to 1/2 honest-stake assumption as Sui consensus, plus the correctness of the Solidity contracts on Ethereum and the Move bridge package. The bridge does not add a new trusted party, but it does add new code and a new key per validator. A pause needs only 4.5 percent of voting power, which is a deliberate asymmetry: easy to stop, hard to restart or to change limits.

### 2.3 Issuer burn-and-mint: Circle CCTP

USDC is burned on the source chain (depositForBurn), Circle's off-chain attestation service Iris signs a message after the source chain reaches the configured finality, and receiveMessage on the destination mints native USDC [S17]. V2 defines Standard transfers (finality threshold 2000, attested at finalised, 15 to 19 minutes on Ethereum and L2s) and Fast transfers (threshold 1000, attested at confirmed, about 8 to 20 seconds) [S16][S17].

Trust assumption: Circle. There is one attester, and it is the issuer who can already freeze and blacklist USDC. You are not adding a new trusted party, but you are getting nothing more decentralised than the asset already was. Sui is domain 8 and is supported only by CCTP V1 (legacy), not V2, per Circle's chain list [S16]. Native USDC launched on Sui on 2024-10-08, replacing Wormhole-wrapped wUSDC, which Circle notes "is not issued by Circle and not compatible or redeemable with Circle Mint" [S15].

### 2.4 Guardian networks: Wormhole

19 Guardians each run full nodes (or, on some chains, a delegated subset does) and sign observed messages; a VAA is valid at 13 of 19 signatures [S18]. Token bridge (Portal) is lock-and-mint on top of that messaging layer. Defence in depth is the Governor: each Guardian independently enforces a per-chain USD notional limit over a sliding 24 hour window, and large single transfers get a 24 hour delay before Guardians sign; the whitepaper is explicit that the Governor "can only reduce the impact of an exploit, but not prevent it" [S19]. Bug bounty: 2.5 million USD [S20].

Trust assumption: 13 of 19 named institutions do not collude and are not compromised, plus the correctness of every chain's core and token bridge contracts. The 2022 exploit was the second half of that assumption failing on Solana [S35].

### 2.5 Optimistic verification: Nomad, Across

Messages (or settlement bundles) are asserted by a bonded party and accepted unless someone proves fraud within a window.

- Nomad: an Updater signed roots; Watchers had 30 minutes to disconnect the channel and slash the Updater [S31]. The design needs only one honest watcher, but the 2022 exploit bypassed the window entirely because the zero root was pre-trusted [S32].
- Across: relayers fill the user's intent on the destination with their own capital in about 2 seconds; a dataworker bundles fills roughly every 1.5 hours and proposes a merkle root to the HubPool on Ethereum with a bond of about 0.45 ABT; the bundle sits in a challenge period secured by UMA's Optimistic Oracle; a dispute escalates to UMA token-holder vote [S27]. User funds are never at optimistic risk: the relayer is the party waiting for repayment. If nobody fills before fillDeadline, the deposit becomes refundable through the same bundle process, so refunds "can take several hours" and if no refundAddress was set the recovery is manual [S27].

Trust assumption: liveness of at least one honest challenger during the window, and that the window is long enough that the challenger's transaction cannot be censored. Note the asymmetry between where the optimistic risk sits: on the user (Nomad) versus on the relayer (Across).

### 2.6 Light clients and zk bridges

The destination chain verifies the source chain's consensus or state proofs itself. No external signer to bribe; the risk moves entirely into the verifier code and the source chain's own security. BNB Bridge is the cautionary tale: the IAVL proof verifier accepted a forged proof [S33]. Hyperbridge (April 2026, about 237,000 USD) was likewise a forged-proof mint of nearly 1 billion fake bridged DOT [S51]. zk bridges compress the verifier into a circuit; the same question applies to the circuit and its trusted setup.

### 2.7 Intent and solver networks: deBridge DLN, Mayan Swift, Across

The user posts an order; a solver fulfils it from their own inventory on the destination; a messaging layer later proves the fill so the solver can unlock the user's source-chain deposit.

- Mayan Swift: drivers bid on Solana, the winner delivers on the destination "in as little as 2 seconds", and a Wormhole VAA of the fulfilment releases the source-chain lock. If nobody fills, the refund returns the converted primary asset (for example USDC or ETH), not necessarily the token the user sent [S24]. Mayan also offers MCTP over Circle CCTP for stablecoin routes up to about 10 million USD and a Wormhole Swap route; Sui is a supported chain [S23].
- deBridge: DLN is a 0-TVL design where solvers provide liquidity on demand and unfilled orders can always be cancelled and reclaimed in full; the underlying DMP has validators sign messages after source finality, stores signatures on Arweave, and lets anyone claim with sufficient signatures [S25]. Validator count and threshold were not stated in the pages retrieved; ask before integrating. Sui support was not confirmed in the docs fetched for this brief.

Trust assumption for the user: small and time-boxed (the deposit is either filled or refundable). Trust assumption for the solver: the messaging layer that unlocks their capital. For the app: the refund path, its latency, and the asset the refund arrives in.

### 2.8 Liquidity pools: Stargate

Stargate V1 used unified liquidity pools balanced by a Delta algorithm; V2 locks native assets in core pools and mints OFT representations on "Hydra" chains; messaging is LayerZero for V1, V2 and OFT routes, and CCTP for native USDC routes [S28]. The security of a Stargate route is therefore the security of that route's LayerZero verifier configuration, which is exactly the surface that failed for Kelp DAO's rsETH OFT (1-of-1 DVN) [S46][S47].

Trust assumption: the DVN set configured for that specific OApp, plus pool solvency. Ask for the DVN configuration by name and count, not for "LayerZero".

### 2.9 MPC or TSS networks: Ika, ZetaChain, Hashi

- Ika (built on Sui): 2PC-MPC "dWallets" split signing authority between the user and a decentralised MPC network, with the claim that "no party, not even the network, can sign without user consent"; the Sui program authorises and the MPC network completes the signature [S30]. Trust assumption: the MPC committee's threshold plus the user's own share; the user share is what distinguishes it from Multichain's model.
- ZetaChain: validators observe connected chains and co-sign from TSS-controlled vault addresses. Its ZetaChain-side GatewayEVM contract lost about 333,000 USD in April 2026 to a combination of three bugs [S51]. ZetaChain's architecture pages could not be retrieved during this research, so validator counts and thresholds are unverified here.
- Hashi: not a bridge but an aggregator that requires block headers or messages to be attested by multiple independent oracles or bridges before acceptance, so a single compromised bridge cannot forge a message [S29]. This is the Kelp lesson turned into a product: N-of-M verifiers.

Trust assumption for all TSS designs: the threshold, the independence of share holders, and the key-generation and resharing ceremonies. Multichain is the proof that "MPC" on the label says nothing about how many people actually control the shares [S39].

### 2.10 Mapping the incidents to the taxonomy

| Bucket | Incidents | Dominant failure |
|---|---|---|
| External validators / multisig | Ronin, Harmony, Orbit, AFX, IoTeX, Force Bridge | Keys and operational drift |
| Guardian network | Wormhole 2022 | Destination-side signature verification bug |
| Optimistic | Nomad | Unsafe default in an upgrade bypassed the fraud window |
| Light client | BNB Bridge, Hyperbridge | Proof verifier bug |
| Configurable messaging (LayerZero, Axelar integrations) | Kelp DAO rsETH, CrossCurve | Verifier configuration and missing origin checks |
| Notary bridge | Verus (twice) | Missing semantic (amount) validation |
| MPC / TSS | Multichain, THORChain | Centralised or compromised share holders |
| Native validator set | Sui Bridge | No exploit to date; two pre-launch vulnerabilities fixed (Section 3) |
| Issuer burn-and-mint | CCTP | No exploit found; single-attester by design |

---

## 3. Sui-specific security facts

### 3.1 Sui Bridge: launch, scope, audits

- Mainnet launch 2024-09-30 with ETH and WETH; Ethereum to Sui takes about 10 minutes because of Ethereum's probabilistic finality; Sui Bridge ETH is a distinct asset from Wormhole WETH [S6].
- Today's supported assets: WBTC, LBTC, ETH, WETH, USDT [S1]. Audits by OtterSec and Zellic are linked from the docs [S1].
- The bridge waits for Sui finality before releasing on Ethereum, and the Ethereum transaction then needs Ethereum confirmations; the docs warn that a source-chain confirmation only proves the user initiated the bridge, not that funds are available [S1].
- Bridge nodes must use a dedicated BridgeAuthorityKey separate from validator and admin keys, generated offline, with a WAF rate limit of 50 requests per second per IP designated a production requirement [S2].

### 3.2 The limiter

The Move limiter keeps a TransferRecord per route with hour_head, hour_tail, per_hour_amounts and total_amount, slides the 24 hour window every hour, converts each transfer to USD using the treasury's notional price for the token, and rejects a transfer when the window total plus the new amount would exceed the route limit [S3]. The hard-coded mainnet default for the Sui to Ethereum route is 5,000,000 USD (with an 8-decimal USD multiplier) [S3]. Governance has since raised the operating limits to 16 million USD Ethereum to Sui and 7 million USD Sui to Ethereum per 24 hours; pricing is static (ETH counted at 2,600 USD), and changes are voted by the committee and announced in the validator Discord channel [S1]. Updating a route limit or an asset price needs 5001 voting power [S5].

Teaching point: the limiter caps the blast radius of any single-key or single-bug failure to one route's daily budget, the same idea as Wormhole's Governor [S19], but enforced on-chain rather than in each guardian's process.

### 3.3 The MoveBit report, 2024

MoveBit (a BitsLab brand) discovered a Sui Bridge vulnerability described as related to asset freezing on 2024-04-01 and submitted it through HackenProof; it submitted a second issue on 2024-04-17; Mysten engineers confirmed both on 2024-04-19; the fix landed on 2024-05-10 [S8][S9]. The disclosure was published in October 2024 [S8][S9]. The MoveBit article body is rendered client-side and could not be retrieved during this research, so the exact functions involved are not reproduced here; the dates and the "asset freezing" characterisation come from MoveBit's own summary as republished on Binance Square [S9]. The point for the workshop: both issues were found and fixed on testnet, before the 2024-09-30 mainnet launch [S6], which is what a bug bounty is for.

### 3.4 Sui Bridge incidents

No exploit, pause or loss event involving Sui Bridge was found in the sources consulted. Sui mainnet itself halted for 6 hours 44 minutes on 28 to 29 May 2026 due to a gas-charging logic bug in v1.72, with all validators crashing and no blocks produced [S62]. Any bridge that waits on Sui finality stalls during such an event; that is a liveness failure, not a safety failure, and it is why Section 6 treats bridge transfers as pending until observed on the destination.

### 3.5 Cetus, 22 May 2025

- Root cause: the checked_shlw overflow guard in the shared integer-mate library used the wrong check, so a shift-left scaling step in Cetus' u256 fixed-point math overflowed silently and let the attacker mint outsized liquidity for a one-unit deposit [S11][S12]. About 223 million USD was taken in under 15 minutes [S11].
- Were bridges involved? Only as the exit. Roughly 60 million USD was bridged to Ethereum and about 162 million USD was frozen on Sui [S11][S13]. Merkle Science identifies Wormhole and Circle CCTP as the two rails used, with the attacker "transferring about 1M USDC every 30 seconds" [S12]. Elliptic notes the attacker converted USDT and USDC to ETH on Ethereum, presumably because issuers can freeze those stablecoins [S14]. No bridge malfunctioned; the bridges did what bridges do.
- The freeze: validators stopped processing transactions from the two attacker addresses [S12]. A protocol upgrade then let a specified address act as both hacker addresses for two pre-specified transactions, moving the frozen funds into a 4-of-6 multisig held by Cetus, the Sui Foundation and OtterSec; the vote passed with 90.9 percent of stake in favour [S10].
- Bridge lesson: the attacker's exit rate was bounded by the rails. A limiter such as Sui Bridge's [S3] or Wormhole's Governor [S19] turns "drain in 15 minutes" into "drain over days", which is the window in which freezes and pauses work.

### 3.6 Wormhole on Sui

- OtterSec audited Wormhole's Sui contracts in April 2023 (Wormhole_OtterSec_Sui_2023-04.pdf) and Sui NTT on 2025-08-22 [S21]. Sui mainnet launched on 2023-05-03 [S65]; Wormhole Connect and Portal were the documented bridging path in Sui's September 2023 bridging guide [S7].
- Wormhole-wrapped USDC (wUSDC) was the de facto dollar on Sui until native USDC arrived on 2024-10-08, with Wormhole remaining an integration partner for the migration [S15].
- Portal's Sui page is at portalbridge.com/sui [S22]. Wormhole's messaging security is the 13 of 19 guardian quorum [S18] plus the Governor [S19].
- No Sui-specific Wormhole incident was found in this research.

---

## 4. Phishing and fake bridge sites targeting Sui users

### 4.1 bridge-sui.vercel.app, read 2026-09-07 [S57]

What it claims: title "Sui Bridge – Cross-Chain Bridge & DeFi Hub on Sui Network"; hero text "The Official Bridge to Sui Network"; "$4.8B+ Bridged", "30+ Networks", "<30s Bridge Time", "12.4% SUI APY", "297,000+ TPS", "Active Validators 106", "Total Value Locked $2.1B"; a sample route "ETH → Wormhole → Sui" with "~25 seconds"; NFT bridging, SUI staking, a DEX aggregator; and a footer "© 2025 Sui Bridge · bridge-sui.vercel.app". Its FAQ instructs users to "verify the contract address directly from the official Sui Bridge documentation or the official website at bridge-sui.vercel.app".

How to spot it in one minute:

- The real Sui Bridge lives at bridge.sui.io [S1][S6]. Free-tier hosting subdomains (vercel.app, netlify.app, github.io, pages.dev) are never a production bridge domain for a protocol run by 100+ validators.
- The real Sui Bridge supports five assets between Ethereum and Sui and takes about 10 minutes Ethereum to Sui [S1][S6]. It does not stake SUI, bridge NFTs, or aggregate DEXes.
- A page that tells you to verify addresses against itself is circular. Verification must come from a domain you already trust (docs.sui.io) or from on-chain state.
- Technical note: the page's single script bundle (4.js, about 26 KB) contained no wallet-signing or network calls when pulled on 2026-09-07 [S57]. It is a static lookalike today. That can change on the next deploy, and lookalikes are routinely swapped for drainers once they rank in search. Treat it as hostile.

### 4.2 The wider pattern

Sui's own security guidance from October 2023 lists phishing links and unsolicited requests as red flags and tells users to reach an official site by searching rather than by clicking links in messages, and to watch for wallet prompts involving unrecognised tokens [S58]. Search engines and Vercel-hosted lookalikes are the standard drainer delivery path, and DPRK-linked groups increasingly target infrastructure and keys rather than contracts [S45][S46].

### 4.3 Verify the real domains

| Bridge | Domain to trust | How to cross-check |
|---|---|---|
| Sui Bridge | bridge.sui.io [S1][S6] | Linked from docs.sui.io; the Move package is the on-chain sui_bridge framework package [S1][S4] |
| Wormhole Portal | portalbridge.com (Sui page: portalbridge.com/sui) [S22] | Linked from Sui's bridging guide [S7]; Wormhole audits at github.com/wormhole-foundation/wormhole-audits [S21] |
| Circle CCTP | circle.com and developers.circle.com [S15][S16] | Circle publishes contract addresses and domain IDs in the CCTP docs; Sui is domain 8 [S16] |
| Mayan | mayan.finance, app at swap.mayan.finance [S23] | Docs at docs.mayan.finance list Sui as supported [S23] |
| deBridge | debridge.com, app at app.debridge.com (migrated from debridge.finance; the old app domain redirected after 30 days) [S26] | Docs at docs.debridge.com [S25] |

Practical rule for the workshop: bookmark from the docs, never from search or chat; compare the package or contract ID in the wallet prompt against the docs before signing; and on Sui read the Move call target in the wallet's transaction preview, since a real bridge deposit calls the bridge package, not an unknown package's "claim" or "verify" function.

---

## 5. Evaluation checklist before integrating a bridge

Ask these in order. A "we do not publish that" answer is itself the answer.

**Who can move funds**
- Exactly which keys or which quorum can release or mint on each chain? Get the number of signers, the threshold, and the list of independent operators. (Ronin: 9 signers, effectively fewer parties [S36]. Harmony: 2 of 5 [S37]. Kelp: 1 of 1 [S47].)
- For messaging-layer bridges, get the verifier configuration for the specific application, not the protocol default. LayerZero's DVN is per-OApp; Kelp ran 1-of-1 and says that was the documented default [S50].
- For MPC or TSS, who operates the share holders, and where do the shares physically live? (Multichain: one person's cloud account [S39].)

**Upgrade keys**
- Is the destination contract upgradeable? Who holds the upgrade key, with what timelock? Nomad's exploit shipped in a routine upgrade [S32]. On Sui, ask whether the UpgradeCap is held by a multisig, is time-locked, or has been made immutable.
- Can the signer set be changed by a bridge message (Poly Network's fatal design [S34])?

**Rate limits**
- Is there an on-chain or guardian-enforced cap per route per 24 hours, and what is it? Sui Bridge: 16 million USD in, 7 million USD out, hourly buckets [S1][S3]. Wormhole: per-chain notional Governor with a 24 hour delay on large transfers [S19].
- Compare the cap with your app's TVL. If a bridge's daily limit exceeds everything your users hold, the limit does not protect you.

**Pause and unpause**
- Who can pause, how fast, and who can unpause? Sui Bridge pauses at 450 voting power and unpauses at 5001 [S5]. Kelp paused within about 46 minutes and saved an estimated 200 million USD [S51]; Ronin took six days to notice [S36].

**Monitoring**
- Does the bridge publish its own invariant monitoring (minted supply on destination equals locked supply on source)? The Kelp exploit broke exactly that invariant [S46]. If they do not monitor it, you must.

**Insurance and recourse**
- Is there a treasury, an insurance fund, or a named backstop? Wormhole was recapitalised by Jump in 2022 [S35]; the Sui Foundation loaned Cetus funds for user compensation [S13]. Most bridges have neither.

**Audits and bounties**
- Which firms, which commits, how recent, and is the report public? Sui Bridge: OtterSec and Zellic [S1]. Wormhole Sui: OtterSec 2023-04 and 2025-08 [S21]. Bounty size and platform: Wormhole 2.5 million USD [S20]; Sui uses HackenProof, which is how the MoveBit findings arrived [S8][S9].
- Remember the Kelp finding: audits cover code; they do not cover the verifier configuration or the RPC nodes behind it [S49].

**Time to finality**
- What does the bridge wait for on the source chain, and what does it wait for on the destination? CCTP Standard on Ethereum: 15 to 19 minutes; Fast: 8 to 20 seconds with a weaker finality threshold [S16][S17]. Sui Bridge Ethereum to Sui: about 10 minutes [S6]. Across fills in about 2 seconds but settles every 1.5 hours plus a challenge window [S27].
- Faster always means someone is taking reorg or fraud risk. Find out who.

**Refund paths**
- If the transfer is not completed, where does the money go, in what asset, after how long, and does it require a manual step? Across: refund only after fillDeadline plus bundle settlement, several hours, manual if no refundAddress [S27]. Mayan Swift: refund in the converted primary asset, not necessarily the input token [S24]. deBridge: cancel and reclaim in full [S25].

**What to log on your side**
- Source tx digest, source chain, nonce or sequence, destination chain, expected recipient, expected asset and amount, quote, fill deadline, and the bridge's own message ID (VAA sequence, CCTP nonce, Sui Bridge message nonce).
- Destination observation: the tx that credited the recipient, its checkpoint or block, and the finality status when you observed it.
- Timing: submit time, attestation time, destination time. Alert on anything past the bridge's documented p99.
- Aggregate: net flow per route per hour against the bridge's published limit, and minted-versus-locked supply if the bridge exposes it.

---

## 6. Designing so a bridge failure does not become your failure

### 6.1 Treat bridged balances as pending until destination finality

Never credit a user because a source-chain deposit happened; Sui's docs say plainly that a source tx "confirms that the user initiated the bridge" and nothing more [S1]. Credit only when you observe the destination-side object or event, and hold that credit as pending until the destination chain's own finality is reached (on Sui, the transaction is in a certified checkpoint; on Ethereum, your chosen confirmation depth). For CCTP, prefer Standard over Fast for anything you cannot claw back [S17].

### 6.2 Per-route limits inside your app

Mirror the bridge's limiter in your own state: cap the value you will accept from each bridge and route per hour and per day, at a fraction of that bridge's published limit. If Sui Bridge's inbound cap is 16 million USD per day [S1], an app that accepts unlimited inbound value over Sui Bridge is trusting something the bridge itself does not. Route limits also make Kelp-style contagion visible early: Aave's rsETH markets took 123 to 230 million USD of bad debt because minted rsETH was accepted as collateral without a cap tied to verifiable backing [S49].

### 6.3 Kill switches with an asymmetric threshold

Copy Sui Bridge's design: a small quorum (or even one monitored key) can pause inbound credit from a specific bridge, while unpausing needs a larger quorum and a delay [S5]. Wire the pause to automated invariant checks: destination credits from bridge X exceeding source deposits observed by your own indexer, or flow exceeding your per-route limit. Kelp's 46 minute pause saved an estimated 200 million USD; Ronin's six-day blind spot cost 624 million USD [S51][S36].

### 6.4 Segregate by origin

Do not pool bridged assets of different provenance in one balance. Sui Bridge ETH and Wormhole WETH are different coin types [S6]; native USDC and wUSDC are different coin types with different redeemability [S15]. Keep them distinct in your accounting and in your risk limits, so that a failure of one bridge can be isolated and its wrapped asset devalued without touching the others.

### 6.5 How Sui object ownership helps

- Bridged funds on Sui arrive as Coin objects owned by an address, and Sui Bridge either delivers directly or lets the owner (or a relayer on the owner's behalf) claim, with the contract asserting the sender is the owner for a direct claim [S4]. Your app can accept those objects into a shared object only after finality, and can return them as objects rather than as ledger entries, which makes "pending" a literal state of a literal object.
- Coin types are distinct Move types, so provenance segregation from 6.4 is enforced by the type system: a function that takes Coin<SuiBridgeETH> cannot be handed Coin<WormholeWETH>.
- Pausing and limits can be capabilities: a PauseCap held by an ops multisig, a LimitCap held by governance. Object ownership gives you the same asymmetric-threshold design as the bridge's committee without writing a signature scheme.
- Freezing is cheap: an object made immutable or wrapped in a timelocked escrow cannot be spent by anyone, which is how an app can quarantine a suspicious inbound credit while an investigation runs. The Cetus response showed the extreme version at the validator layer [S10][S12]; your app should have the mild version at the object layer.
- Because Sui finality is per transaction and typically sub-second [S59], you can afford to wait for destination finality before crediting without making the user wait minutes; the slow part is always the source chain and the bridge's attestation, not Sui.

### 6.6 Assume liveness failures

Bridges pause (THORChain 13 hours [S51], Sui mainnet 6 hours 44 minutes [S62]). Design the UX for "your transfer is in flight, here is the bridge's own tracker, here is the refund path and its expected time", using the bridge's documented refund semantics [S24][S25][S27]. Show the bridge message ID to the user so support can trace it.

---

## 7. The three most teachable incidents

1. **Kelp DAO rsETH, 2026-04-18, 292 million USD.** Zero contract bugs. One verifier, poisoned RPC, broken supply invariant, contagion into Aave. Teaches: verifier configuration is a security parameter you must read, audits do not cover it, and downstream apps that accepted the wrapped asset without limits paid the bill [S46][S47][S49][S50].
2. **Nomad, 2022-08-01, 190 million USD.** A routine upgrade initialised a trusted root to zero and turned the bridge into a public faucet that anyone could copy-paste. Teaches: upgrades are attack surface, defaults are code, and an optimistic window is worthless if the message never enters it [S32].
3. **Ronin, 2022-03-23, 624 million USD.** Five of nine keys, four from one company and the fifth via a forgotten allowlist from a busy month, and nobody looked for six days. Teaches: count independent parties, not keys; revoke temporary permissions; monitor the invariant, not the dashboard [S36][S63].

Honourable mention for a Sui audience: Cetus, because it shows what a bounded exit looks like when validators and bridges have brakes [S10][S11][S12].

---

## Sources

All read on 2026-09-07 unless noted. Where a page is a syndicated summary rather than the original, that is stated.

- [S1] Sui docs, Bridging Tokens (Sui Bridge): https://docs.sui.io/concepts/tokenomics/sui-bridging
- [S2] Sui docs, Sui Bridge Validator Node Configuration: https://docs.sui.io/guides/operator/bridge-node-configuration
- [S3] Sui framework source, bridge limiter.move: https://raw.githubusercontent.com/MystenLabs/sui/main/crates/sui-framework/packages/bridge/sources/limiter.move
- [S4] Sui framework source, bridge.move: https://raw.githubusercontent.com/MystenLabs/sui/main/crates/sui-framework/packages/bridge/sources/bridge.move
- [S5] Sui framework source, message.move (required_voting_power): https://raw.githubusercontent.com/MystenLabs/sui/main/crates/sui-framework/packages/bridge/sources/message.move
- [S6] Sui blog, Sui Bridge Goes Live on Mainnet Today (2024-09-30): https://www.sui.io/blog/sui-bridge-launches-on-mainnet
- [S7] Sui blog, All About Bridging (published 2023-09-06, modified 2026-07-16): https://www.sui.io/blog/bridging-explained
- [S8] MoveBit blog, MoveBit Discovers and Helps Fix Vulnerability in Sui Cross-Chain Protocol (2024-10-12). Page body is client-rendered and did not load in any fetch attempted; dates taken from S9: https://movebit.xyz/blog/post/MoveBit-Discovers-and-Helps-Fix-Vulnerability-in-Sui-Cross-Chain-Protocol-20241012.html
- [S9] Binance Square repost of the MoveBit disclosure (2024-10-09), as surfaced in search results: https://www.binance.com/square/post/2024-10-09-movebit-sui-14625908844498
- [S10] Sui blog, Response to the Cetus Incident: Onchain Community Vote (2025-05-27): https://www.sui.io/blog/cetus-incident-response-onchain-community-vote
- [S11] Cyfrin, Inside the 223M Cetus Exploit: https://www.cyfrin.io/blog/inside-the-223m-cetus-exploit-root-cause-and-impact-analysis
- [S12] Merkle Science, Hack Track: How a Shared Library Bug Triggered the 223M Cetus Hack: https://www.merklescience.com/blog/hack-track-how-a-shared-library-bug-triggered-the-223m-cetus-hack
- [S13] The Defiant, Cetus Protocol Hit by 223 Million Hack; 162 Million Frozen: https://thedefiant.io/news/hacks/cetus-protocol-hit-223-million-hack-162-million-frozen-5-million-bounty-vote-on-c13985eb
- [S14] Elliptic, Cetus Protocol hacked for more than 200 million: https://www.elliptic.co/blog/cetus-protocol-hacked-for-more-than-200-million
- [S15] Circle, Now Available: Native USDC on Sui (2024-10-08): https://www.circle.com/blog/now-available-native-usdc-on-sui
- [S16] Circle developers, CCTP supported chains and domains: https://developers.circle.com/cctp/concepts/supported-chains-and-domains
- [S17] Circle developers, CCTP technical guide: https://developers.circle.com/cctp/technical-guide
- [S18] Wormhole docs, Guardians: https://wormhole.com/docs/protocol/infrastructure/guardians/
- [S19] Wormhole whitepaper 0007, Governor: https://raw.githubusercontent.com/wormhole-foundation/wormhole/main/whitepapers/0007_governor.md
- [S20] Wormhole, Security: https://wormhole.com/platform/security
- [S21] Wormhole audits repository listing (files Wormhole_OtterSec_Sui_2023-04.pdf and 2025-08-22-ottersec-sui-ntt.pdf): https://api.github.com/repos/wormhole-foundation/wormhole-audits/contents/
- [S22] Portal Bridge, Sui page: https://portalbridge.com/sui
- [S23] Mayan docs, What is Mayan: https://docs.mayan.finance/
- [S24] Mayan docs, Swift architecture: https://docs.mayan.finance/architecture/swift
- [S25] deBridge docs index, DMP overview and DLN overview: https://docs.debridge.com/llms.txt , https://docs.debridge.com/home/products/dmp-overview.md , https://docs.debridge.com/home/products/dln-overview.md
- [S26] deBridge blog, Introducing debridge.com: https://debridge.com/learn/blog/introducing-debridge-com/
- [S27] Across docs: Intents architecture https://docs.across.to/concepts/intents-architecture-in-across , Intent lifecycle https://docs.across.to/concepts/intent-lifecycle-in-across , Refunds https://docs.across.to/introduction/refunds , Security model https://docs.across.to/introduction/security
- [S28] Stargate docs, Architecture: https://docs.stargate.finance/introduction/architecture
- [S29] Hashi docs (Crosschain Alliance): https://crosschain-alliance.gitbook.io/hashi
- [S30] Ika: https://ika.xyz/ and https://docs.ika.xyz/
- [S31] Nomad docs, Optimistic Timeout Period: https://docs.nomad.xyz/the-nomad-protocol/security/root-of-trust/fraud/optimistic-timeout-period ; Connext, Optimistic Bridges: https://medium.com/connext/optimistic-bridges-fb800dc7b0e0
- [S32] Immunefi, Hack Analysis: Nomad Bridge, August 2022: https://immunefi.com/blog/bug-fix-reviews/hack-analysis-nomad-bridge-august-2022/
- [S33] Immunefi, Hack Analysis: Binance Bridge, October 2022: https://immunefi.com/blog/bug-fix-reviews/hack-analysis-binance-bridge-october-2022/
- [S34] Mudit Gupta, Poly Network Hack Analysis: https://mudit.blog/poly-network-largest-crypto-hack/
- [S35] Halborn, Explained: The Wormhole Hack (February 2022): https://www.halborn.com/blog/post/explained-the-wormhole-hack-february-2022 ; Rekt, Wormhole: https://rekt.news/wormhole-rekt
- [S36] Rekt, Ronin Network: https://rekt.news/ronin-rekt
- [S37] Rekt, Harmony Bridge: https://rekt.news/harmony-rekt
- [S38] FBI press release, FBI Confirms Lazarus Group Cyber Actors Responsible for Harmony's Horizon Bridge Currency Theft: https://www.fbi.gov/news/press-releases/fbi-confirms-lazarus-group-cyber-actors-responsible-for-harmonys-horizon-bridge-currency-theft ; CFR summary: https://www.cfr.org/cyber-operations/targeting-of-harmony-cryptocurrency-bridge
- [S39] Decrypt, Multichain Shutters Operations After Chinese Police Take CEO's Sister Into Custody (2023-07-14): https://decrypt.co/148559/multichain-shutters-operations-chinese-police-take-ceo-sister-custody
- [S40] Rekt, Multichain REKT 2: https://rekt.news/multichain-rekt2
- [S41] Rekt, Orbit Bridge: https://rekt.news/orbit-bridge-rekt
- [S42] Unchained, Orbit Chain Announces Significant Clue in 81 Million New Year's Eve Hack: https://unchainedcrypto.com/orbit-chain-announces-significant-clue-in81-million-new-years-eve-hack/
- [S43] Rekt leaderboard: https://rekt.news/leaderboard
- [S44] Chainalysis, Vulnerabilities in Cross-chain Bridge Protocols Emerge as Top Security Risk (2022-08-02): https://www.chainalysis.com/blog/cross-chain-bridge-hacks-2022/
- [S45] Chainalysis, 2025 Crypto Theft Reaches 3.4 Billion (2025-12-18): https://www.chainalysis.com/blog/crypto-hacking-stolen-funds-2026/
- [S46] Chainalysis, Inside the KelpDAO Bridge Exploit (April 2026): https://www.chainalysis.com/blog/kelpdao-bridge-exploit-april-2026/
- [S47] LayerZero, KelpDAO Incident Statement: https://layerzero.network/blog/kelpdao-incident-statement
- [S48] Blockaid, How a Single LayerZero DVN Compromise Drained 292M from KelpDAO: https://blockaid.io/blog/how-a-single-layerzero-dvn-compromise-drained-292m-from-kelpdao
- [S49] OpenZeppelin, 292 Million Lost, Zero Bugs Found: Lessons From the rsETH Bridge Exploit: https://www.openzeppelin.com/news/lessons-from-kelpdao-hack
- [S50] Unchained, Kelp DAO Disputes LayerZero's Account of the 290 Million Exploit: https://unchainedcrypto.com/kelp-dao-disputes-layerzeros-account-of-the-290-million-exploit-escalating-blame-game/
- [S51] The Crypto Times, Crypto Bridge Hacks Top 328M in 2026 (2026-05-18, citing PeckShield): https://www.cryptotimes.io/2026/05/18/crypto-bridge-hacks-top-328m-in-2026-as-cross-chain-exploits-accelerate/
- [S52] Merkle Science, Hack Track: The 11.58M Verus Bridge Hack: https://www.merklescience.com/blog/hack-track-the-11-58m-verus-bridge-hack
- [S53] KuCoin News, CrossCurve Bridge Exploit: 3M Loss Due to Fabricated Message Vulnerability: https://www.kucoin.com/news/articles/crosscurve-bridge-exploit-3m-loss-due-to-fabricated-message-vulnerability
- [S54] Bitcoin Foundation news, Two Cross-Chain Bridges Hacked in One Day: AFX Loses 24 Million, Verus 7.5 Million (2026-07-23): https://bitcoinfoundation.org/news/crimes-and-fraud-news/bridge-hacks-july/
- [S55] The Block, Hackers drain over 3 million from Nervos Network's Force bridge (2025-06-02): https://www.theblock.co/post/356535/hackers-drain-over-3-million-in-crypto-from-nervos-networks-force-cross-chain-bridge-say-security-analysts
- [S56] Halborn, Explained: The Force Bridge Hack (June 2025), via search summary (page rate-limited on fetch): https://www.halborn.com/blog/post/explained-the-force-bridge-hack-june-2025
- [S57] Lookalike site bridge-sui.vercel.app, HTML and 4.js bundle pulled 2026-09-07: https://bridge-sui.vercel.app/
- [S58] Sui blog, Watch for These 5 Red Flags to Avoid Web3 Scams (2023-10-24): https://www.sui.io/blog/security-scam-red-flags
- [S59] Datawallet, How to Bridge to Sui Network (2026-08-01): https://www.datawallet.com/crypto/bridge-to-sui
- [S60] GetBlock, How to Bridge to Sui: Top Bridges on Sui (2024-12-23): https://getblock.io/blog/top-bridges-on-sui/
- [S61] Hacken, Cross-Chain Bridge Security (citing DefiLlama hacks): https://hacken.io/discover/cross-chain-bridge-security/
- [S62] KuCoin blog, Sui Mainnet Outage Lasted 6.7 Hours (2026-05-29): https://www.kucoin.com/blog/sui-mainnet-outage-gas-logic-bug-1b-assets-2026
- [S63] Halborn, Explained: The Ronin Hack (March 2022), via search summary (page rate-limited on fetch): https://www.halborn.com/blog/post/explained-the-ronin-hack-march-2022
- [S65] Sui Developer Forum, Announcing Sui Mainnet (2023-05-03): https://forums.sui.io/t/announcing-sui-mainnet/42578

Not retrieved despite attempts, and therefore not relied on for numbers: ZetaChain architecture docs (404 on the URLs tried), Ika technical docs beyond the landing page, the deBridge validator count, and the MoveBit article body.
