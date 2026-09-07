// Shared Sui helpers on @mysten/sui v2: gRPC client with MVR built in, keystore signer.
import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { SuiGrpcClient } from "@mysten/sui/grpc";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { decodeSuiPrivateKey } from "@mysten/sui/cryptography";
import { fromBase64 } from "@mysten/sui/utils";

loadDotEnv();
export const NETWORK = process.env.SUI_NETWORK ?? "testnet";
export const client = new SuiGrpcClient({
  network: NETWORK,
  baseUrl: process.env.SUI_GRPC_URL ?? `https://fullnode.${NETWORK}.sui.io:443`,
  mvr: { url: `https://${NETWORK}.mvr.mystenlabs.com` },
});

export function signer() {
  const pk = process.env.SUI_PRIVATE_KEY;
  if (pk) return Ed25519Keypair.fromSecretKey(decodeSuiPrivateKey(pk).secretKey);
  const cfg = join(homedir(), ".sui", "sui_config");
  const want = process.env.SUI_SIGNER_ADDRESS
    ?? readFileSync(join(cfg, "client.yaml"), "utf8").match(/active_address:\s*"?(0x[0-9a-fA-F]+)"?/)?.[1];
  for (const k of JSON.parse(readFileSync(join(cfg, "sui.keystore"), "utf8"))) {
    const b = fromBase64(k); if (b[0] !== 0) continue;
    const kp = Ed25519Keypair.fromSecretKey(b.slice(1));
    if (!want || kp.toSuiAddress() === want) return kp;
  }
  throw new Error("no matching ed25519 key in keystore");
}

export const explorer = (d) => `https://suiscan.xyz/${NETWORK}/tx/${d}`;

function loadDotEnv() {
  const p = join(process.cwd(), ".env"); if (!existsSync(p)) return;
  for (const line of readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
}
