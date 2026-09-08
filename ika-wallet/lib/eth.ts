import { createPublicClient, http, serializeTransaction, keccak256, recoverAddress, formatEther, parseEther, type Hex, type TransactionSerializableEIP1559, type Chain } from "viem";
import { sepolia, baseSepolia, arbitrumSepolia, optimismSepolia, polygonAmoy, avalancheFuji, bscTestnet } from "viem/chains";
import { signKeccak } from "./ika";
import type { Wallet } from "./store";

export type EvmKey = "sepolia" | "baseSepolia" | "arbitrumSepolia" | "optimismSepolia" | "polygonAmoy" | "avalancheFuji" | "bscTestnet";
export const EVM: Record<EvmKey, { chain: Chain; label: string; symbol: string; rpc: string; explorer: string; faucet: string }> = {
  sepolia:         { chain: sepolia,         label: "ethereum · sepolia",     symbol: "ETH",  rpc: process.env.SEPOLIA_RPC_URL ?? "https://ethereum-sepolia-rpc.publicnode.com", explorer: "https://sepolia.etherscan.io/tx/",          faucet: "https://cloud.google.com/application/web3/faucet/ethereum/sepolia" },
  baseSepolia:     { chain: baseSepolia,     label: "base · sepolia",         symbol: "ETH",  rpc: "https://sepolia.base.org",                                              explorer: "https://sepolia.basescan.org/tx/",          faucet: "https://www.alchemy.com/faucets/base-sepolia" },
  arbitrumSepolia: { chain: arbitrumSepolia, label: "arbitrum · sepolia",     symbol: "ETH",  rpc: "https://sepolia-rollup.arbitrum.io/rpc",                                explorer: "https://sepolia.arbiscan.io/tx/",           faucet: "https://www.alchemy.com/faucets/arbitrum-sepolia" },
  optimismSepolia: { chain: optimismSepolia, label: "optimism · sepolia",     symbol: "ETH",  rpc: "https://sepolia.optimism.io",                                           explorer: "https://sepolia-optimism.etherscan.io/tx/", faucet: "https://www.alchemy.com/faucets/optimism-sepolia" },
  polygonAmoy:     { chain: polygonAmoy,     label: "polygon · amoy",         symbol: "POL",  rpc: "https://polygon-amoy-bor-rpc.publicnode.com",                                   explorer: "https://amoy.polygonscan.com/tx/",          faucet: "https://faucet.polygon.technology" },
  avalancheFuji:   { chain: avalancheFuji,   label: "avalanche · fuji",       symbol: "AVAX", rpc: "https://api.avax-test.network/ext/bc/C/rpc",                            explorer: "https://testnet.snowtrace.io/tx/",          faucet: "https://core.app/tools/testnet-faucet" },
  bscTestnet:      { chain: bscTestnet,      label: "bnb chain · testnet",    symbol: "BNB",  rpc: "https://data-seed-prebsc-1-s1.binance.org:8545",                        explorer: "https://testnet.bscscan.com/tx/",           faucet: "https://www.bnbchain.org/en/testnet-faucet" },
};
const clients = new Map<EvmKey, ReturnType<typeof createPublicClient>>();
export function evm(key: EvmKey) { let c = clients.get(key); if (!c) { c = createPublicClient({ chain: EVM[key].chain, transport: http(EVM[key].rpc, { timeout: 8000 }) }); clients.set(key, c); } return c; }

export async function evmBalances(address: string): Promise<Record<EvmKey, string>> {
  const out = {} as Record<EvmKey, string>;
  await Promise.all((Object.keys(EVM) as EvmKey[]).map(async (k) => { try { out[k] = formatEther(await evm(k).getBalance({ address: address as Hex })); } catch { out[k] = "n/a"; } }));
  return out;
}

export async function sendNative(w: Wallet, key: EvmKey, to: string, amount: string, log: (s: string) => void) {
  const c = evm(key); const from = w.ethAddress as Hex; const cfg = EVM[key];
  const [nonce, fees] = await Promise.all([c.getTransactionCount({ address: from }), c.estimateFeesPerGas()]);
  const tx: TransactionSerializableEIP1559 = { chainId: cfg.chain.id, type: "eip1559", nonce, to: to as Hex, value: parseEther(amount), gas: 21_000n, maxFeePerGas: fees.maxFeePerGas, maxPriorityFeePerGas: fees.maxPriorityFeePerGas };
  const unsigned = serializeTransaction(tx);
  log(`built EIP-1559 tx on ${cfg.label}, nonce ${nonce}, ${amount} ${cfg.symbol} to ${to}`);
  const sig = await signKeccak(w, Buffer.from(unsigned.slice(2), "hex"), log);
  const r = ("0x" + Buffer.from(sig.slice(0, 32)).toString("hex")) as Hex, s = ("0x" + Buffer.from(sig.slice(32, 64)).toString("hex")) as Hex;
  const digest = keccak256(unsigned);
  let yParity: 0 | 1 = 0;
  for (const y of [0, 1] as const) { const a = await recoverAddress({ hash: digest, signature: { r, s, yParity: y } }); if (a.toLowerCase() === from.toLowerCase()) { yParity = y; break; } }
  log(`broadcasting to ${cfg.label}`);
  const hash = await c.sendRawTransaction({ serializedTransaction: serializeTransaction(tx, { r, s, yParity }) });
  return { hash, explorer: cfg.explorer + hash };
}
// kept for older imports
export const ethBalance = async (a: string) => (await evmBalances(a)).sepolia;
export const sendEth = (w: Wallet, to: string, amount: string, log: (s: string) => void) => sendNative(w, "sepolia", to, amount, log).then((r) => r.hash);
