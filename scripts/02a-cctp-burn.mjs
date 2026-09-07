// Step 1 of 3: burn USDC on Sepolia for a Sui recipient. Writes out/burn.json.
// Run this 15 to 20 minutes before you want to receive; Circle waits for Ethereum finality.
import { writeFileSync } from "node:fs";
import { createWalletClient, createPublicClient, http, parseAbi, parseEventLogs, keccak256, pad } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { normalizeSuiAddress } from "@mysten/sui/utils";
import { SEPOLIA, SUI_TESTNET } from "./_cctp.mjs";
import { signer } from "./_sui.mjs";  // also loads .env

const amount = BigInt(process.argv[2] ?? 1_000_000); // 1 USDC
const account = privateKeyToAccount(process.env.EVM_PRIVATE_KEY);
const recipient = normalizeSuiAddress(process.env.SUI_RECIPIENT || signer().toSuiAddress());
const wallet = createWalletClient({ account, chain: sepolia, transport: http(process.env.SEPOLIA_RPC_URL) });
const pub = createPublicClient({ chain: sepolia, transport: http(process.env.SEPOLIA_RPC_URL) });

const erc20 = parseAbi(["function approve(address,uint256) returns (bool)", "function balanceOf(address) view returns (uint256)", "function allowance(address,address) view returns (uint256)"]);
const messenger = parseAbi(["function depositForBurn(uint256 amount, uint32 destinationDomain, bytes32 mintRecipient, address burnToken) returns (uint64)"]);
const messageSent = parseAbi(["event MessageSent(bytes message)"]);

const [eth, usdc] = await Promise.all([pub.getBalance({ address: account.address }), pub.readContract({ address: SEPOLIA.usdc, abi: erc20, functionName: "balanceOf", args: [account.address] })]);
console.log(`Sepolia ${account.address}: ${Number(eth) / 1e18} ETH, ${Number(usdc) / 1e6} USDC`);
console.log(`burning ${Number(amount) / 1e6} USDC for Sui recipient ${recipient} (domain ${SUI_TESTNET.domain})`);
if (usdc < amount) { console.error("not enough Sepolia USDC: https://faucet.circle.com"); process.exit(1); }

const allowance = await pub.readContract({ address: SEPOLIA.usdc, abi: erc20, functionName: "allowance", args: [account.address, SEPOLIA.tokenMessenger] });
if (allowance < amount) {
  const h = await wallet.writeContract({ address: SEPOLIA.usdc, abi: erc20, functionName: "approve", args: [SEPOLIA.tokenMessenger, amount] });
  await pub.waitForTransactionReceipt({ hash: h }); console.log(`approve  https://sepolia.etherscan.io/tx/${h}`);
}
const mintRecipient = pad(recipient, { size: 32 }); // a Sui address is already 32 bytes
const burnHash = await wallet.writeContract({ address: SEPOLIA.tokenMessenger, abi: messenger, functionName: "depositForBurn", args: [amount, SUI_TESTNET.domain, mintRecipient, SEPOLIA.usdc] });
const receipt = await pub.waitForTransactionReceipt({ hash: burnHash });
const [log] = parseEventLogs({ abi: messageSent, logs: receipt.logs });
const message = log.args.message;
const out = { burnHash, message, messageHash: keccak256(message), recipient, amount: amount.toString(), at: new Date().toISOString() };
writeFileSync("out/burn.json", JSON.stringify(out, null, 2));
console.log(`burn     https://sepolia.etherscan.io/tx/${burnHash}`);
console.log(`message hash ${out.messageHash}\nsaved out/burn.json. Next: pnpm cctp:attest`);
