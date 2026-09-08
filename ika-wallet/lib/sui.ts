import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { SuiGrpcClient } from "@mysten/sui/grpc";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { decodeSuiPrivateKey } from "@mysten/sui/cryptography";
import { fromBase64 } from "@mysten/sui/utils";

export const NETWORK = "testnet" as const;
export const sui = new SuiGrpcClient({ network: NETWORK, baseUrl: "https://fullnode.testnet.sui.io:443" });

let cached: Ed25519Keypair | null = null;
export function operator(): Ed25519Keypair {
  if (cached) return cached;
  const pk = process.env.SUI_OPERATOR_PRIVATE_KEY;
  if (pk) return (cached = Ed25519Keypair.fromSecretKey(decodeSuiPrivateKey(pk).secretKey));
  const want = process.env.SUI_OPERATOR_ADDRESS;
  const ks = JSON.parse(readFileSync(join(homedir(), ".sui", "sui_config", "sui.keystore"), "utf8")) as string[];
  for (const k of ks) { const b = fromBase64(k); if (b[0] !== 0) continue; const kp = Ed25519Keypair.fromSecretKey(b.slice(1)); if (!want || kp.toSuiAddress() === want) return (cached = kp); }
  throw new Error("operator key not found");
}
