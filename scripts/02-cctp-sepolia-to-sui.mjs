// USDC from Sepolia to Sui testnet with Circle CCTP (V1 on Sui), in three moves:
//   1. burn on Sepolia         TokenMessenger.depositForBurn(amount, domain 8, recipient, USDC)
//   2. wait for Circle          GET iris-api-sandbox.circle.com/attestations/<messageHash>
//   3. mint on Sui              message_transmitter::receive_message + token_messenger_minter::handle_receive_message
//
// Env: EVM_PRIVATE_KEY, SEPOLIA_RPC_URL, SUI_RECIPIENT (optional; defaults to the sui CLI active address)
// Needs: Sepolia ETH for gas and Sepolia USDC (faucet.circle.com) on EVM_ADDRESS.
import { createWalletClient, createPublicClient, http, parseAbi, keccak256, encodeFunctionData, pad } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { Transaction } from "@mysten/sui/transactions";
import { client as sui, signer, explorer } from "./_sui.mjs";

// Sepolia CCTP V1 (Circle docs, verify before class)
const SEPOLIA = {
  usdc: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
  tokenMessenger: "0x9f3B8679c73C2Fef8b59B4f3444d4e156fb70AA5",
  messageTransmitter: "0x7865fAfC2db2093669d92c0F33AeEF291086BEFD",
};
// Sui testnet CCTP V1 (developers.circle.com/cctp/v1/sui-packages)
const SUI = {
  domain: 8,
  messageTransmitter: "0x4931e06dce648b3931f890035bd196920770e913e43e45990b383f6486fdd0a5",
  tokenMessengerMinter: "0x31cc14d80c175ae39777c0238f20594c6d4869cfab199f40b69f3319956b8beb",
  messageTransmitterState: "0x98234bd0fa9ac12cc0a20a144a22e36d6a32f7e0a97baaeaf9c76cdc6d122d2e",
  tokenMessengerMinterState: "0x5252abd1137094ed1db3e0d75bc36abcd287aee4bc310f8e047727ef5682e7c2",
  usdcTreasury: "0x7170137d4a6431bf83351ac025baf462909bffe2877d87716374fb42b9629ebe",
  usdcType: "0xa1ec7fc00a6f40db9693ad1415d0c193ad3906494428cf252621037bd7117e29::usdc::USDC",
  denyList: "0x403",
};
const IRIS = "https://iris-api-sandbox.circle.com";

const amount = BigInt(process.argv[2] ?? 1_000_000); // 1 USDC (6 decimals)
const account = privateKeyToAccount(process.env.EVM_PRIVATE_KEY);
const suiKp = signer();
const recipient = process.env.SUI_RECIPIENT || suiKp.toSuiAddress();
const evm = createWalletClient({ account, chain: sepolia, transport: http(process.env.SEPOLIA_RPC_URL) });
const evmRead = createPublicClient({ chain: sepolia, transport: http(process.env.SEPOLIA_RPC_URL) });

const erc20 = parseAbi(["function approve(address,uint256) returns (bool)", "function balanceOf(address) view returns (uint256)", "function allowance(address,address) view returns (uint256)"]);
const messenger = parseAbi(["function depositForBurn(uint256 amount, uint32 destinationDomain, bytes32 mintRecipient, address burnToken) returns (uint64 nonce)"]);

console.log(`Sepolia ${account.address} -> Sui ${recipient}, amount ${amount} (USDC 6dp)`);
const bal = await evmRead.readContract({ address: SEPOLIA.usdc, abi: erc20, functionName: "balanceOf", args: [account.address] });
console.log(`Sepolia USDC balance: ${bal}`);
if (bal < amount) { console.error("Not enough Sepolia USDC. Get some at https://faucet.circle.com"); process.exit(1); }

// 1. approve + burn
const allowance = await evmRead.readContract({ address: SEPOLIA.usdc, abi: erc20, functionName: "allowance", args: [account.address, SEPOLIA.tokenMessenger] });
if (allowance < amount) {
  const h = await evm.writeContract({ address: SEPOLIA.usdc, abi: erc20, functionName: "approve", args: [SEPOLIA.tokenMessenger, amount] });
  await evmRead.waitForTransactionReceipt({ hash: h });
  console.log(`approve: ${h}`);
}
const mintRecipient = pad(recipient, { size: 32 }); // Sui addresses are already 32 bytes
const burnHash = await evm.writeContract({ address: SEPOLIA.tokenMessenger, abi: messenger, functionName: "depositForBurn", args: [amount, SUI.domain, mintRecipient, SEPOLIA.usdc] });
const receipt = await evmRead.waitForTransactionReceipt({ hash: burnHash });
console.log(`burn on Sepolia: https://sepolia.etherscan.io/tx/${burnHash}`);

// 2. find MessageSent(bytes) log, hash it, poll attestation
const MESSAGE_SENT = keccak256(new TextEncoder().encode("MessageSent(bytes)"));
const log = receipt.logs.find((l) => l.topics[0] === MESSAGE_SENT);
if (!log) throw new Error("MessageSent log not found");
const messageBytes = `0x${log.data.slice(2 + 64 + 64).slice(0, Number(BigInt("0x" + log.data.slice(2 + 64, 2 + 128))) * 2)}`;
const messageHash = keccak256(messageBytes);
console.log(`message hash: ${messageHash}\nwaiting for Circle attestation (usually 1 to 3 minutes on testnet)...`);
let attestation;
for (let i = 0; i < 90; i++) {
  const r = await fetch(`${IRIS}/attestations/${messageHash}`);
  const j = await r.json().catch(() => ({}));
  if (j.status === "complete") { attestation = j.attestation; break; }
  await new Promise((res) => setTimeout(res, 5000));
  process.stdout.write(".");
}
if (!attestation) throw new Error("attestation timed out");
console.log("\nattested.");

// 3. receive on Sui: receive_message returns a Receipt, handle_receive_message mints USDC to mintRecipient
const tx = new Transaction();
tx.setSender(suiKp.toSuiAddress());
const [receiptObj] = tx.moveCall({
  target: `${SUI.messageTransmitter}::receive_message::receive_message`,
  arguments: [tx.pure.vector("u8", Array.from(Buffer.from(messageBytes.slice(2), "hex"))), tx.pure.vector("u8", Array.from(Buffer.from(attestation.slice(2), "hex"))), tx.object(SUI.messageTransmitterState)],
});
const [stampReceipt] = tx.moveCall({
  target: `${SUI.tokenMessengerMinter}::handle_receive_message::handle_receive_message`,
  typeArguments: [SUI.usdcType],
  arguments: [receiptObj, tx.object(SUI.tokenMessengerMinterState), tx.object(SUI.denyList), tx.object(SUI.usdcTreasury)],
});
tx.moveCall({
  target: `${SUI.messageTransmitter}::receive_message::complete_receive_message`,
  arguments: [stampReceipt, tx.object(SUI.messageTransmitterState)],
});
const res = await sui.signAndExecuteTransaction({ transaction: tx, signer: suiKp });
const d = res.Transaction?.digest ?? res.digest;
console.log(`mint on Sui: ${explorer(d)}`);
console.log("Done. Native USDC on Sui, no wrapped asset, one burn and one mint.");
