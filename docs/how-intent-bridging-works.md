# How intent-based bridging works

## The shift

A classic bridge moves an asset. You lock or burn on chain A, a set of verifiers attests to it,
and chain B mints or releases. The user waits for both chains and for the verifiers, and the
verifiers hold the risk: if their keys or code fail, every user's funds are exposed at once.

An intent flips the order. The user signs a statement of the outcome they want: "I give 100 USDC
on Base, I want at least 99.5 USDC on Sui at this address within this deadline." A solver who
already holds USDC on Sui pays the user there immediately, out of the solver's own inventory.
The protocol then settles with the solver later, by moving the user's Base USDC to the solver
through whatever slow path it likes. The user is done in seconds. The slow path is the solver's
problem.

## The five parts

1. The intent. A signed order: input asset and amount, output asset and minimum amount,
   destination address, deadline, and who may fill it. It lives on the source chain in an
   escrow contract or as a signed message.
2. The auction. Solvers see the order and compete on price. Whoever offers the best output wins
   the right to fill. On Mayan this runs on Solana; on deBridge the DLN order book is on the
   source chain; on Across it is a relayer race.
3. The fill. The winning solver sends the output asset on the destination chain directly to the
   user. This is the moment the user cares about. Seconds.
4. Proof of fill. The destination chain records that the fill happened. A message carries that
   proof back to the source chain. Wormhole guardians, Circle attestations, UMA optimistic
   assertions, or the protocol's own validators do this step.
5. Settlement. The escrow on the source chain releases the user's input to the solver. Slow and
   invisible to the user. If the proof never arrives, the user is refunded from escrow.

## Who holds the risk

- The solver holds inventory risk: they front the output and wait for settlement. If the
  settlement message is wrong or slow, the solver loses, not the user.
- The user holds deadline risk: if no solver fills, the order expires and the input is
  refunded. The user is never left with a wrapped IOU.
- The protocol's verifier only touches settlement between escrow and solvers, so a verifier
  failure hits solver capital first, and the blast radius is the open orders, not a pooled
  treasury. Compare Wormhole 2022 or Ronin 2022, where the verifier was the direct custodian
  of everyone's funds.

## Why it is faster

Nobody waits for finality on the source chain before the user is paid. The solver takes the
reorg and finality risk in exchange for the spread. That is why a fill can land in a few seconds
while a lock-and-mint bridge waits 13 minutes for Ethereum confirmations.

## Why it is what a dApp integrates

- One REST call returns a quote and a ready-to-sign transaction for the user's wallet. LI.FI,
  Mayan, and deBridge all work this way.
- The dApp never custodies anything. It forwards a signed transaction and polls a status
  endpoint.
- Referrer fees are a query parameter, so onboarding becomes revenue.
- Aggregators such as LI.FI sit above several intent protocols and pick the best fill, so the
  dApp integrates once.

## Where it is weaker

- Long-tail assets: solvers only hold inventory in liquid tokens. USDC, ETH, SOL, SUI yes; your
  new token no. For those you still need lock-and-mint or NTT.
- Large sizes: a single fill is limited by one solver's inventory on the destination chain.
- Thin destinations: fewer solvers hold inventory on Sui than on Base or Arbitrum, so quotes
  into Sui can fall back to slower routes. Today LI.FI's quotes into Sui route through Mayan
  MCTP, which uses Circle CCTP underneath and quotes 15 to 20 minutes, not a pure fast fill.
  Watch the tool column in `pnpm quotes`.

## Not to be confused with Sui Payment Intents

Sui's own Payment Intents are single-chain: one PTB that batches many payment operations
atomically with one signature. Same word, different thing. Bridging intents are about outcomes
across two chains and third-party solvers.
