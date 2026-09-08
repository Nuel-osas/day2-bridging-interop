import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { hasDb, q } from "./db";
export type Wallet = { user: string; dwalletId: string; dwalletCapId: string; publicKey: string; ethAddress: string; btcAddress: string; presignId?: string; createdAt: string; status: "creating" | "active"; sol?: { dwalletId: string; dwalletCapId: string; publicKey: string; address: string; presignId?: string; status: "creating" | "active" } };
const FILE = join(process.cwd(), "data", "wallets.json");
function load(): Record<string, Wallet> { if (!existsSync(FILE)) return {}; return JSON.parse(readFileSync(FILE, "utf8")); }
function save(all: Record<string, Wallet>) { mkdirSync(join(process.cwd(), "data"), { recursive: true }); writeFileSync(FILE, JSON.stringify(all, null, 2)); }
export const store = {
  get: async (user: string): Promise<Wallet | undefined> => hasDb() ? (await q<{ data: Wallet }>("SELECT data FROM wallets WHERE usr = $1", [user]))[0]?.data : load()[user],
  put: async (w: Wallet) => { if (hasDb()) await q("INSERT INTO wallets (usr, data) VALUES ($1, $2) ON CONFLICT (usr) DO UPDATE SET data = EXCLUDED.data, updated_at = now()", [w.user, JSON.stringify(w)]); else { const all = load(); all[w.user] = w; save(all); } },
  all: async (): Promise<Wallet[]> => hasDb() ? (await q<{ data: Wallet }>("SELECT data FROM wallets ORDER BY updated_at")).map((r) => r.data) : Object.values(load()),
};
