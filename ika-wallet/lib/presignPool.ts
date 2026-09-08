// A standing pool of completed global presigns, shared by every user, one pool per curve.
//
// v4 presigns are client independent: one is valid for any dWallet on the same curve and
// algorithm and for any message. So the operator buys them ahead of intent, keeps a small depth,
// adopts any it already paid for and never used, and refills in the background after each send.
// With DATABASE_URL set the pool is a Postgres table: taking one is an atomic DELETE ... RETURNING,
// so two instances can never hand the same presign to two users, and only one instance refills.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { Transaction } from "@mysten/sui/transactions";
import { Curve, SignatureAlgorithm, IkaTransaction, getNetworkConfig } from "@ika.xyz/sdk";
import { sui, operator } from "./sui";
import { hasDb, q, tryLock, LOCK_REFILL } from "./db";

export type PoolKey = "secp" | "ed";
export const POOLS: Record<PoolKey, { curve: Curve; alg: SignatureAlgorithm }> = {
  secp: { curve: Curve.SECP256K1, alg: SignatureAlgorithm.ECDSASecp256k1 },
  ed: { curve: Curve.ED25519, alg: SignatureAlgorithm.EdDSA },
};
const FILE = join(process.cwd(), "data", "presigns.json");
const TARGET_DEPTH = Number(process.env.PRESIGN_POOL_DEPTH ?? 1);
type Entry = { presignId: string; pool?: PoolKey; requestedAt: string };
const load = (): Entry[] => (existsSync(FILE) ? JSON.parse(readFileSync(FILE, "utf8")) : []);
const save = (e: Entry[]) => { mkdirSync(join(process.cwd(), "data"), { recursive: true }); writeFileSync(FILE, JSON.stringify(e, null, 2)); };
const G: any = (globalThis as any).__ikaPool ??= { refilling: new Map<PoolKey, Promise<void>>(), presignObjects: new Map<string, any>(), adoptedOnce: false };
const presignObjects: Map<string, any> = G.presignObjects;

type Deps = { ika: any; ikaCoin: () => string; exec: (tx: Transaction) => Promise<any>; evData: (t: any, re: RegExp) => any; log?: (s: string) => void };

// ---- storage primitives (Postgres or file)
async function depth(k: PoolKey) { return hasDb() ? Number((await q("SELECT count(*)::int AS n FROM presigns WHERE pool = $1", [k]))[0].n) : load().filter((e) => (e.pool ?? "secp") === k).length; }
async function ids(k: PoolKey) { return hasDb() ? (await q<{ id: string }>("SELECT id FROM presigns WHERE pool = $1", [k])).map((r) => r.id) : load().filter((e) => (e.pool ?? "secp") === k).map((e) => e.presignId); }
async function add(k: PoolKey, id: string, note = "") { if (hasDb()) await q("INSERT INTO presigns (id, pool) VALUES ($1, $2) ON CONFLICT DO NOTHING", [id, k]); else { const p = load(); p.push({ presignId: id, pool: k, requestedAt: note || new Date().toISOString() }); save(p); } }
async function takeOne(k: PoolKey): Promise<string | null> {
  if (hasDb()) return (await q<{ id: string }>("DELETE FROM presigns WHERE id = (SELECT id FROM presigns WHERE pool = $1 ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED) RETURNING id", [k]))[0]?.id ?? null;
  const p = load(); const i = p.findIndex((e) => (e.pool ?? "secp") === k); if (i < 0) return null; const [e] = p.splice(i, 1); save(p); return e.presignId;
}

/** Take a Completed presign out of the pool, or null. Never waits. */
export async function takeReady(d: Deps, k: PoolKey = "secp"): Promise<{ presignId: string; presign: any } | null> {
  for (let i = 0; i < 8; i++) {
    const id = await takeOne(k); if (!id) return null;
    const cached = presignObjects.get(id); d.log?.(`presign object cache ${cached ? "hit" : "miss"} (${presignObjects.size} cached)`); if (cached) { presignObjects.delete(id); return { presignId: id, presign: cached }; }
    try { const p: any = await d.ika.getPresign(id); if (p?.state?.Completed) return { presignId: id, presign: p }; } catch {}
  }
  return null;
}

/** Buy presigns until the pool holds TARGET_DEPTH. Safe to call often; one refill loop at a time. */
export function refill(d: Deps, k: PoolKey = "secp"): Promise<void> {
  if (G.refilling.get(k)) return G.refilling.get(k);
  const run = async () => { while ((await depth(k)) < TARGET_DEPTH) { const id = await requestOne(d, k); d.log?.(`presign pool ${k}: +1 (${id.slice(0, 10)}…), depth ${await depth(k)}`); } };
  const p = (async () => {
    try { if (hasDb()) { if (!(await tryLock(LOCK_REFILL + (k === "ed" ? 1 : 0), run))) d.log?.(`presign pool ${k}: another instance is refilling`); } else await run(); }
    catch (e: any) { d.log?.(`presign pool ${k} refill failed: ` + String(e.message ?? e).slice(0, 80)); }
    finally { G.refilling.delete(k); }
  })();
  G.refilling.set(k, p); return p;
}

async function requestOne(d: Deps, k: PoolKey): Promise<string> {
  const { curve, alg } = POOLS[k];
  const networkKey = await d.ika.getLatestNetworkEncryptionKey(); const me = operator().toSuiAddress();
  const tx = new Transaction(); const it = new IkaTransaction({ ikaClient: d.ika, transaction: tx });
  const ref = it.requestGlobalPresign({ dwalletNetworkEncryptionKeyId: networkKey.id, curve, signatureAlgorithm: alg, ikaCoin: tx.object(d.ikaCoin()), suiCoin: tx.gas });
  tx.transferObjects([ref], me);
  const t = await d.exec(tx);
  const presignId = d.evData(t, /PresignRequestEvent/).presign_id as string;
  const p = await d.ika.getPresignInParticularState(presignId, "Completed", { timeout: 120_000, interval: 250 });
  presignObjects.set(presignId, p);
  await add(k, presignId);
  return presignId;
}

/** Fetch the presign objects for everything already in the pool so the send path does not. */
export async function warmPresignObjects(d: Deps) {
  for (const k of Object.keys(POOLS) as PoolKey[]) for (const id of await ids(k)) { if (presignObjects.has(id)) continue; try { const p: any = await d.ika.getPresign(id); if (p?.state?.Completed) presignObjects.set(id, p); } catch {} }
}

/** Presign caps the operator already owns but never consumed: paid for, so use them first. */
export async function adoptOrphans(d: Deps) {
  if (G.adoptedOnce) return; G.adoptedOnce = true;
  try {
    const cfg = getNetworkConfig("testnet"); const me = operator().toSuiAddress();
    const known = new Set([...(await ids("secp")), ...(await ids("ed"))]);
    const owned: any = await (sui.core as any).listOwnedObjects({ owner: me, type: `${cfg.packages.ikaDwallet2pcMpcOriginalPackage}::coordinator_inner::UnverifiedPresignCap`, include: { json: true } });
    let added = 0;
    for (const o of owned.objects ?? []) {
      const presignId = o?.json?.presign_id ?? (await (sui.core as any).getObject({ objectId: o.id, include: { json: true } }).catch(() => null))?.object?.json?.presign_id;
      if (!presignId || known.has(presignId)) continue;
      try { const p: any = await d.ika.getPresign(presignId); if (p?.state?.Completed) { const k: PoolKey = Number(p.curve) === Number(Curve.ED25519) ? "ed" : "secp"; await add(k, presignId, "adopted"); added++; } } catch {}
    }
    if (added) d.log?.(`presign pool: adopted ${added} unused presign(s) already paid for`);
  } catch (e: any) { d.log?.("presign pool: orphan scan skipped, " + String(e.message ?? e).slice(0, 60)); }
}
