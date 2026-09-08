import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
export type Wallet = { user: string; dwalletId: string; dwalletCapId: string; publicKey: string; ethAddress: string; btcAddress: string; presignId?: string; createdAt: string; status: "creating" | "active" };
const FILE = join(process.cwd(), "data", "wallets.json");
function load(): Record<string, Wallet> { if (!existsSync(FILE)) return {}; return JSON.parse(readFileSync(FILE, "utf8")); }
function save(all: Record<string, Wallet>) { mkdirSync(join(process.cwd(), "data"), { recursive: true }); writeFileSync(FILE, JSON.stringify(all, null, 2)); }
export const store = {
  get: (user: string): Wallet | undefined => load()[user],
  put: (w: Wallet) => { const all = load(); all[w.user] = w; save(all); },
  all: () => Object.values(load()),
};
