import { createPublicClient, http, serializeTransaction, keccak256, recoverAddress, formatEther, parseEther, type Hex, type TransactionSerializableEIP1559 } from "viem";
import { sepolia } from "viem/chains";
import { signKeccak } from "./ika";
import type { Wallet } from "./store";

export const eth = createPublicClient({ chain: sepolia, transport: http(process.env.SEPOLIA_RPC_URL ?? "https://ethereum-sepolia-rpc.publicnode.com") });
export const ethBalance = async (a: string) => formatEther(await eth.getBalance({ address: a as Hex }));

export async function sendEth(w: Wallet, to: string, amountEth: string, log: (s: string) => void) {
  const from = w.ethAddress as Hex;
  const [nonce, fees] = await Promise.all([eth.getTransactionCount({ address: from }), eth.estimateFeesPerGas()]);
  const tx: TransactionSerializableEIP1559 = { chainId: sepolia.id, type: "eip1559", nonce, to: to as Hex, value: parseEther(amountEth), gas: 21_000n, maxFeePerGas: fees.maxFeePerGas, maxPriorityFeePerGas: fees.maxPriorityFeePerGas };
  const unsigned = serializeTransaction(tx);
  log(`built EIP-1559 tx, nonce ${nonce}, sending ${amountEth} ETH to ${to}`);
  const sig = await signKeccak(w, Buffer.from(unsigned.slice(2), "hex"), log);
  const r = ("0x" + Buffer.from(sig.slice(0, 32)).toString("hex")) as Hex, s = ("0x" + Buffer.from(sig.slice(32, 64)).toString("hex")) as Hex;
  const digest = keccak256(unsigned);
  let yParity: 0 | 1 = 0;
  for (const y of [0, 1] as const) { const a = await recoverAddress({ hash: digest, signature: { r, s, yParity: y } }); if (a.toLowerCase() === from.toLowerCase()) { yParity = y; break; } }
  const raw = serializeTransaction(tx, { r, s, yParity });
  log("broadcasting to Sepolia");
  const hash = await eth.sendRawTransaction({ serializedTransaction: raw });
  return hash;
}
