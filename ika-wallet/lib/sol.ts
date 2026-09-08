import { Connection, PublicKey, SystemProgram, Transaction as SolTx, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { signEdDSA } from "./ika";
import type { Wallet } from "./store";

export const SOL_RPC = process.env.SOLANA_RPC_URL ?? "https://api.devnet.solana.com";
export const solConn = new Connection(SOL_RPC, "confirmed");
export const solBalance = async (address: string) => { try { return (await solConn.getBalance(new PublicKey(address)) / LAMPORTS_PER_SOL).toFixed(6); } catch { return "n/a"; } };
const AIRDROP_RPCS = [SOL_RPC, "https://api.devnet.solana.com", "https://rpc.ankr.com/solana_devnet", "https://devnet.helius-rpc.com/?api-key=public"];
export async function solAirdrop(address: string) {
  let last = "";
  for (const url of AIRDROP_RPCS) for (const amt of [1, 0.5]) {
    try { const c = new Connection(url, "confirmed"); const sig = await c.requestAirdrop(new PublicKey(address), amt * LAMPORTS_PER_SOL); await solConn.confirmTransaction(sig, "confirmed"); return sig; }
    catch (e: any) { last = String(e.message ?? e).slice(0, 120); }
  }
  throw new Error(`devnet faucet is rate limited right now (${last}). Open faucet.solana.com, paste the address, pick devnet.`);
}

export async function sendSol(w: Wallet, to: string, amountSol: string, log: (s: string) => void) {
  if (!w.sol?.address) throw new Error("enable solana first");
  const from = new PublicKey(w.sol.address);
  const lamports = Math.round(Number(amountSol) * LAMPORTS_PER_SOL);
  const bal = await solConn.getBalance(from);
  if (bal < lamports + 5000) throw new Error(`insufficient devnet SOL: balance ${(bal / LAMPORTS_PER_SOL).toFixed(6)}, need ${amountSol} plus fee. Use "airdrop 1 SOL" or faucet.solana.com first.`);
  const { blockhash, lastValidBlockHeight } = await solConn.getLatestBlockhash("confirmed");
  const tx = new SolTx({ feePayer: from, blockhash, lastValidBlockHeight });
  tx.add(SystemProgram.transfer({ fromPubkey: from, toPubkey: new PublicKey(to), lamports }));
  const message = tx.serializeMessage();
  log(`built solana transfer, ${amountSol} SOL to ${to}, blockhash ${blockhash.slice(0, 8)}…`);
  const sig = await signEdDSA(w, new Uint8Array(message), log);
  tx.addSignature(from, Buffer.from(sig));
  if (!tx.verifySignatures()) throw new Error("signature did not verify against the dWallet public key");
  log("broadcasting to solana devnet");
  const txid = await solConn.sendRawTransaction(tx.serialize(), { skipPreflight: false });
  await solConn.confirmTransaction({ signature: txid, blockhash, lastValidBlockHeight }, "confirmed");
  return { hash: txid, explorer: `https://explorer.solana.com/tx/${txid}?cluster=devnet` };
}
