// A standing pool of completed global presigns, shared by every user.
//
// v4 presigns are client independent: one is valid for any dWallet on the same curve and
// algorithm and for any message. So the operator buys them ahead of intent, keeps a small depth,
// adopts any it already paid for and never used, and refills in the background after each send.
// The send path then does a single online round instead of waiting ~15 s for the offline half.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { Transaction } from "@mysten/sui/transactions";
import { Curve, SignatureAlgorithm, IkaTransaction, getNetworkConfig } from "@ika.xyz/sdk";
import { sui, operator } from "./sui";

const FILE = join(process.cwd(), "data", "presigns.json");
const TARGET_DEPTH = Number(process.env.PRESIGN_POOL_DEPTH ?? 1);
type Entry = { presignId: string; requestedAt: string };
const load = (): Entry[] => (existsSync(FILE) ? JSON.parse(readFileSync(FILE, "utf8")) : []);
const save = (e: Entry[]) => { mkdirSync(join(process.cwd(), "data"), { recursive: true }); writeFileSync(FILE, JSON.stringify(e, null, 2)); };
let refilling: Promise<void> | null = null;
let adoptedOnce = false;

type Deps = { ika: any; ikaCoin: () => string; exec: (tx: Transaction) => Promise<any>; evData: (t: any, re: RegExp) => any; log?: (s: string) => void };

/** Take a Completed presign out of the pool, or null. Never waits. */
export async function takeReady(d: Deps): Promise<{ presignId: string; presign: any } | null> {
  await adoptOrphans(d);
  const pool = load();
  while (pool.length) {
    const e = pool.shift()!; save(pool);
    try { const p: any = await d.ika.getPresign(e.presignId); if (p?.state?.Completed) return { presignId: e.presignId, presign: p }; } catch {}
  }
  return null;
}

/** Buy presigns until the pool holds TARGET_DEPTH. Safe to call often; runs at most once at a time. */
export function refill(d: Deps): Promise<void> {
  if (refilling) return refilling;
  refilling = (async () => {
    try {
      while (load().length < TARGET_DEPTH) {
        const id = await requestOne(d);
        d.log?.(`presign pool: +1 (${id.slice(0, 10)}…), depth ${load().length}`);
      }
    } catch (e: any) { d.log?.("presign pool refill failed: " + String(e.message ?? e).slice(0, 80)); }
    finally { refilling = null; }
  })();
  return refilling;
}

async function requestOne(d: Deps): Promise<string> {
  const networkKey = await d.ika.getLatestNetworkEncryptionKey(); const me = operator().toSuiAddress();
  const tx = new Transaction(); const it = new IkaTransaction({ ikaClient: d.ika, transaction: tx });
  const ref = it.requestGlobalPresign({ dwalletNetworkEncryptionKeyId: networkKey.id, curve: Curve.SECP256K1, signatureAlgorithm: SignatureAlgorithm.ECDSASecp256k1, ikaCoin: tx.object(d.ikaCoin()), suiCoin: tx.gas });
  tx.transferObjects([ref], me);
  const t = await d.exec(tx);
  const presignId = d.evData(t, /PresignRequestEvent/).presign_id as string;
  await d.ika.getPresignInParticularState(presignId, "Completed");
  const pool = load(); pool.push({ presignId, requestedAt: new Date().toISOString() }); save(pool);
  return presignId;
}

/** Presign caps the operator already owns but never consumed: paid for, so use them first. */
async function adoptOrphans(d: Deps) {
  if (adoptedOnce) return; adoptedOnce = true;
  try {
    const cfg = getNetworkConfig("testnet"); const me = operator().toSuiAddress();
    const known = new Set(load().map((e) => e.presignId));
    const owned: any = await (sui.core as any).listOwnedObjects({ owner: me, type: `${cfg.packages.ikaDwallet2pcMpcOriginalPackage}::coordinator_inner::UnverifiedPresignCap`, include: { json: true } });
    let added = 0;
    for (const o of owned.objects ?? []) {
      const presignId = o?.json?.presign_id ?? (await (sui.core as any).getObject({ objectId: o.id, include: { json: true } }).catch(() => null))?.object?.json?.presign_id;
      if (!presignId || known.has(presignId)) continue;
      try { const p: any = await d.ika.getPresign(presignId); if (p?.state?.Completed) { const pool = load(); pool.push({ presignId, requestedAt: "adopted" }); save(pool); added++; } } catch {}
    }
    if (added) d.log?.(`presign pool: adopted ${added} unused presign(s) already paid for`);
  } catch (e: any) { d.log?.("presign pool: orphan scan skipped, " + String(e.message ?? e).slice(0, 60)); }
}
