// Postgres (Neon) when DATABASE_URL is set; the JSON files under data/ otherwise.
// On Vercel every request may run in a different instance, so anything shared between users
// (wallets, the presign pool, the one-at-a-time rule for the operator's Sui transactions) lives here.
import { Pool, neonConfig } from "@neondatabase/serverless";
import ws from "ws";
if (typeof (globalThis as any).WebSocket === "undefined") neonConfig.webSocketConstructor = ws as any;

export const hasDb = () => !!process.env.DATABASE_URL;
const G: any = (globalThis as any).__ikaDb ??= { pool: null, ready: null };
function pool(): Pool { return (G.pool ??= new Pool({ connectionString: process.env.DATABASE_URL })); }
async function ready() {
  G.ready ??= pool().query(`
    CREATE TABLE IF NOT EXISTS wallets (usr text PRIMARY KEY, data jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now());
    CREATE TABLE IF NOT EXISTS presigns (id text PRIMARY KEY, pool text NOT NULL, created_at timestamptz NOT NULL DEFAULT now());`);
  await G.ready;
}
export async function q<T = any>(text: string, params: any[] = []): Promise<T[]> { await ready(); return (await pool().query(text, params)).rows as T[]; }

/** Run fn while holding a transaction-level advisory lock; other instances wait. */
export async function withLock<T>(key: number, fn: () => Promise<T>): Promise<T> {
  await ready(); const c = await pool().connect();
  try { await c.query("BEGIN"); await c.query("SELECT pg_advisory_xact_lock($1)", [key]); const r = await fn(); await c.query("COMMIT"); return r; }
  catch (e) { await c.query("ROLLBACK").catch(() => {}); throw e; }
  finally { c.release(); }
}
/** Like withLock but gives up immediately if someone else holds it. Returns false in that case. */
export async function tryLock(key: number, fn: () => Promise<void>): Promise<boolean> {
  await ready(); const c = await pool().connect();
  try { await c.query("BEGIN"); const r = await c.query("SELECT pg_try_advisory_xact_lock($1) AS ok", [key]); if (!r.rows[0]?.ok) { await c.query("COMMIT"); return false; } await fn(); await c.query("COMMIT"); return true; }
  catch (e) { await c.query("ROLLBACK").catch(() => {}); throw e; }
  finally { c.release(); }
}
export const LOCK_SUI_EXEC = 1001;   // the operator's IKA coin and gas: one Sui transaction at a time
export const LOCK_REFILL = 1002;     // one presign refill loop at a time
