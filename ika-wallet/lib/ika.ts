// Server side Ika: one operator Sui key holds every DWalletCap and pays IKA + SUI.
// Users are identified by their login; each gets a shared dWallet (network signs for the cap holder).
import { getNetworkConfig, IkaClient, IkaTransaction, Curve, Hash, SignatureAlgorithm, UserShareEncryptionKeys,
  createRandomSessionIdentifier, prepareDKGAsync, publicKeyFromDWalletOutput } from "@ika.xyz/sdk";
import { Transaction } from "@mysten/sui/transactions";
import { computeAddress } from "ethers";
import bs58 from "bs58";
import * as bitcoin from "bitcoinjs-lib";
import { sui, operator } from "./sui";
import { store, type Wallet } from "./store";
import { takeReady, refill, adoptOrphans, warmPresignObjects } from "./presignPool";

const curve = Curve.SECP256K1;
const IKA_COIN = () => { const c = process.env.IKA_COIN_ID; if (!c) throw new Error("IKA_COIN_ID not set"); return c; };
const GI: any = (globalThis as any).__ika ??= { ikaClient: null, keys: null, keysEd: null, pp: null, ppEd: null, dw: new Map<string, any>() };
async function ika() {
  if (!GI.ikaClient) { const c = new IkaClient({ suiClient: sui as any, config: getNetworkConfig("testnet"), cache: true }); await c.initialize(); GI.ikaClient = c; }
  return GI.ikaClient as IkaClient;
}
async function keys(c: Curve = curve) {
  const seed = new TextEncoder().encode(process.env.IKA_ROOT_SEED ?? "ika-wallet-demo-seed");
  if (c === Curve.ED25519) { if (!GI.keysEd) GI.keysEd = await UserShareEncryptionKeys.fromRootSeedKey(seed, Curve.ED25519); return GI.keysEd as UserShareEncryptionKeys; }
  if (!GI.keys) GI.keys = await UserShareEncryptionKeys.fromRootSeedKey(seed, curve);
  return GI.keys as UserShareEncryptionKeys;
}
async function exec(tx: Transaction, log?: (s: string) => void) {
  const kp = operator(); tx.setSender(kp.toSuiAddress()); tx.setGasBudget(500_000_000n);
  const t0 = Date.now(); const bytes = await tx.build({ client: sui }); log?.(`sui tx built in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  (tx as any).__builtAt = Date.now();
  const { signature } = await kp.signTransaction(bytes);
  const r: any = await sui.core.executeTransaction({ transaction: bytes, signatures: [signature], include: { effects: true, events: true } });
  log?.(`sui tx executed in ${((Date.now() - t0) / 1000).toFixed(1)}s total`);
  const t = r.Transaction ?? r.transaction ?? r; if (t.effects?.status?.success === false) throw new Error(JSON.stringify(t.effects.status)); return t;
}
const evData = (t: any, re: RegExp) => { const e = (t.events ?? []).find((x: any) => re.test(x.eventType ?? "")); return e?.json?.event_data ?? {}; };

export function deriveAddresses(pub: Uint8Array) {
  const ethAddress = computeAddress("0x" + Buffer.from(pub).toString("hex"));
  const { address: btcAddress } = bitcoin.payments.p2wpkh({ pubkey: Buffer.from(pub), network: bitcoin.networks.testnet });
  return { ethAddress, btcAddress: btcAddress! };
}

function deps(log: (s: string) => void = () => {}) { return { ika: GI.ikaClient, ikaCoin: IKA_COIN, exec, evData, log }; }
/** Fire and forget: keep the shared presign pool topped up. */
const dwCache: Map<string, any> = GI.dw;

// Testnet IKA comes from an on-chain exchange (1 SUI = 10 IKA). Keep the operator's IKA coin above a floor.
const IKA_TYPE = "0x1f26bb2f711ff82dcda4d02c77d5123089cb7f8418751474b9fb744ce031526a::ika::IKA";
const EXCHANGE_PKG = "0x5d2fd4d021b617a998373b4dfec563adb60b1b47be2a77572c3ff158083e9f89";
const EXCHANGE_OBJ = "0xb2ba36b1a5927e3f070240a3dfccdeac033a756bf265aa1401037eb300d40d66";
export async function ensureIka(log?: (s: string) => void, floorIka = Number(process.env.IKA_FLOOR ?? 30), buySui = Number(process.env.IKA_BUY_SUI ?? 5)) {
  try {
    const me = operator().toSuiAddress();
    const [ika, suiBal]: any[] = await Promise.all([sui.core.getBalance({ owner: me, coinType: IKA_TYPE }), sui.core.getBalance({ owner: me, coinType: "0x2::sui::SUI" })]);
    const ikaAmt = Number(ika.balance?.balance ?? ika.balance?.totalBalance ?? 0) / 1e9, suiAmt = Number(suiBal.balance?.balance ?? suiBal.balance?.totalBalance ?? 0) / 1e9;
    if (ikaAmt >= floorIka) return;
    if (suiAmt < buySui + 1) { log?.(`IKA low (${ikaAmt.toFixed(1)}) and not enough SUI to buy more (${suiAmt.toFixed(2)} SUI)`); return; }
    log?.(`IKA low (${ikaAmt.toFixed(1)}); buying ${buySui * 10} IKA with ${buySui} SUI from the exchange`);
    const tx = new Transaction();
    const [c] = tx.splitCoins(tx.gas, [tx.pure.u64(BigInt(buySui * 1e9))]);
    const bought = tx.moveCall({ target: `${EXCHANGE_PKG}::ika_exchange::exchange_all_for_ika`, arguments: [tx.object(EXCHANGE_OBJ), c] });
    tx.mergeCoins(tx.object(IKA_COIN()), [bought]);
    await exec(tx);
    log?.("IKA refuelled");
  } catch (e: any) { log?.("IKA top-up failed: " + String(e.message ?? e).slice(0, 80)); }
}
async function protocolParams(c: IkaClient, dw: any) { if (!GI.pp) GI.pp = await c.getProtocolPublicParameters(dw); return GI.pp; }
export async function warmPool(log?: (s: string) => void, wallet?: Wallet) {
  const c = await ika(); const d = deps(log);
  void (async () => {
    try { await ensureIka(log); } catch {}
    try { await keys(); } catch {}
    try { await warmPresignObjects(d); } catch {}
    try { if (wallet?.dwalletId) { const dw = await c.getDWalletInParticularState(wallet.dwalletId, "Active"); dwCache.set(wallet.dwalletId, dw); await protocolParams(c, dw); } } catch {}
    void refill(d);
    try { await adoptOrphans(d); } catch {}
  })();
}

export async function ensureEncryptionKey() {
  const c = await ika(); const k = await keys();
  try { const tx = new Transaction(); const it = new IkaTransaction({ ikaClient: c, transaction: tx, userShareEncryptionKeys: k }); await it.registerEncryptionKey({ curve }); await exec(tx); } catch { /* already registered */ }
}

export async function getOrCreateWallet(user: string, log: (s: string) => void = () => {}): Promise<Wallet> {
  const existing = store.get(user); if (existing && existing.status === "active") return existing;
  const c = await ika(); const k = await keys(); const me = operator().toSuiAddress();
  await ensureEncryptionKey();
  await ensureIka(log);
  log("running distributed key generation on Ika");
  const sid = createRandomSessionIdentifier();
  const dkg = await prepareDKGAsync(c, curve, k, sid, me);
  const networkKey = await c.getLatestNetworkEncryptionKey();
  const tx = new Transaction(); const it = new IkaTransaction({ ikaClient: c, transaction: tx, userShareEncryptionKeys: k });
  const session = it.registerSessionIdentifier(sid);
  const [cap] = await it.requestDWalletDKGWithPublicUserShare({ publicKeyShareAndProof: dkg.userDKGMessage, publicUserSecretKeyShare: dkg.userSecretKeyShare, userPublicOutput: dkg.userPublicOutput,
    ikaCoin: tx.object(IKA_COIN()), suiCoin: tx.gas, sessionIdentifier: session, dwalletNetworkEncryptionKeyId: networkKey.id, curve });
  tx.transferObjects([cap], me);
  const t = await exec(tx);
  const ed = evData(t, /DKGRequestEvent/);
  const w: Wallet = { user, dwalletId: ed.dwallet_id, dwalletCapId: ed.dwallet_cap_id, publicKey: "", ethAddress: "", btcAddress: "", createdAt: new Date().toISOString(), status: "creating" };
  store.put(w);
  log("waiting for the network to finish DKG");
  const dw: any = await c.getDWalletInParticularState(w.dwalletId, "Active");
  const pub = await publicKeyFromDWalletOutput(curve, Uint8Array.from(dw.state.Active.public_output));
  Object.assign(w, deriveAddresses(pub), { publicKey: Buffer.from(pub).toString("hex"), status: "active" });
  store.put(w);
  log(`dWallet active: ${w.ethAddress}`);
  void refill(deps());   // buy a presign now so the first send is instant
  return w;
}

export async function ensurePresign(w: Wallet, log: (s: string) => void = () => {}) {
  const c = await ika();
  if (w.presignId) { try { const p: any = await c.getPresign(w.presignId); if (p?.state?.Completed) return w.presignId; } catch {} }
  log("requesting a presign (the slow half of ECDSA, done ahead of time)");
  const networkKey = await c.getLatestNetworkEncryptionKey(); const me = operator().toSuiAddress();
  const tx = new Transaction(); const it = new IkaTransaction({ ikaClient: c, transaction: tx });
  const ref = it.requestGlobalPresign({ dwalletNetworkEncryptionKeyId: networkKey.id, curve, signatureAlgorithm: SignatureAlgorithm.ECDSASecp256k1, ikaCoin: tx.object(IKA_COIN()), suiCoin: tx.gas });
  tx.transferObjects([ref], me);
  const t = await exec(tx);
  const presignId = evData(t, /PresignRequestEvent/).presign_id;
  await c.getPresignInParticularState(presignId, "Completed", { timeout: 120_000, interval: 250 });
  w.presignId = presignId; store.put(w);
  return presignId;
}

/** Sign `message` with the dWallet using KECCAK256 (Ethereum). Returns 64-byte r||s. Consumes the presign. */
export async function signKeccak(w: Wallet, message: Uint8Array, log: (s: string) => void = () => {}): Promise<Uint8Array> {
  const c = await ika(); const k = await keys();
  await ensureIka(log);
  let presign: any; let presignId: string;
  const ready = await takeReady(deps(log));
  if (ready) { presign = ready.presign; presignId = ready.presignId; log("presign taken from the pool (bought ahead of time)"); }
  else { presignId = await ensurePresign(w, log); presign = await c.getPresignInParticularState(presignId, "Completed"); }
  const dw: any = dwCache.get(w.dwalletId) ?? await c.getDWalletInParticularState(w.dwalletId, "Active"); dwCache.set(w.dwalletId, dw);
  await protocolParams(c, dw);   // warm the SDK cache; requestSign computes the operator half itself
  log("inputs ready; requestSign computes the operator half (WASM) and builds the Sui call");
  const tx = new Transaction(); const it = new IkaTransaction({ ikaClient: c, transaction: tx, userShareEncryptionKeys: k });
  const approval = it.approveMessage({ dWalletCap: w.dwalletCapId, curve, signatureAlgorithm: SignatureAlgorithm.ECDSASecp256k1, hashScheme: Hash.KECCAK256, message });
  await it.requestSign({ dWallet: dw, messageApproval: approval, hashScheme: Hash.KECCAK256, verifiedPresignCap: it.verifyPresignCap({ presign }), presign, message, signatureScheme: SignatureAlgorithm.ECDSASecp256k1, ikaCoin: tx.object(IKA_COIN()), suiCoin: tx.gas } as any);
  const t = await exec(tx, log);
  const signId = evData(t, /SignRequestEvent/).sign_id;
  log("sign request on Sui confirmed; waiting for the network MPC round");
  const sign: any = await c.getSignInParticularState(signId, curve, SignatureAlgorithm.ECDSASecp256k1, "Completed", { timeout: 120_000, interval: 100 });
  log("signature received from the network");
  w.presignId = undefined; store.put(w);
  void refill(deps());   // replace what we just used, in the background
  return Uint8Array.from(sign.state.Completed.signature);
}


// ---------- Solana: a second dWallet on ed25519, signed with EdDSA ----------
export async function ensureSolanaWallet(w: Wallet, log: (s: string) => void = () => {}) {
  if (w.sol?.status === "active") return w.sol;
  const c = await ika(); const k = await keys(Curve.ED25519); const me = operator().toSuiAddress();
  await ensureIka(log);
  try { const tx = new Transaction(); const it = new IkaTransaction({ ikaClient: c, transaction: tx, userShareEncryptionKeys: k }); await it.registerEncryptionKey({ curve: Curve.ED25519 }); await exec(tx); log("ed25519 encryption key registered"); } catch { /* already registered */ }
  log("running a second DKG on Ika, curve ed25519");
  const sid = createRandomSessionIdentifier();
  const dkg = await prepareDKGAsync(c, Curve.ED25519, k, sid, me);
  const networkKey = await c.getLatestNetworkEncryptionKey();
  const tx = new Transaction(); const it = new IkaTransaction({ ikaClient: c, transaction: tx, userShareEncryptionKeys: k });
  const session = it.registerSessionIdentifier(sid);
  const [cap] = await it.requestDWalletDKGWithPublicUserShare({ publicKeyShareAndProof: dkg.userDKGMessage, publicUserSecretKeyShare: dkg.userSecretKeyShare, userPublicOutput: dkg.userPublicOutput,
    ikaCoin: tx.object(IKA_COIN()), suiCoin: tx.gas, sessionIdentifier: session, dwalletNetworkEncryptionKeyId: networkKey.id, curve: Curve.ED25519 });
  tx.transferObjects([cap], me);
  const t = await exec(tx);
  const ed = evData(t, /DKGRequestEvent/);
  w.sol = { dwalletId: ed.dwallet_id, dwalletCapId: ed.dwallet_cap_id, publicKey: "", address: "", status: "creating" }; store.put(w);
  log("waiting for the network to finish the ed25519 DKG");
  const dw: any = await c.getDWalletInParticularState(w.sol.dwalletId, "Active");
  const pub = await publicKeyFromDWalletOutput(Curve.ED25519, Uint8Array.from(dw.state.Active.public_output));
  w.sol.publicKey = Buffer.from(pub).toString("hex"); w.sol.address = bs58.encode(Buffer.from(pub)); w.sol.status = "active"; store.put(w);
  dwCache.set(w.sol.dwalletId, dw);
  log(`solana address ${w.sol.address}`);
  void presignEd(w, log).catch(() => {});
  return w.sol;
}

async function presignEd(w: Wallet, log: (s: string) => void = () => {}) {
  const c = await ika(); const me = operator().toSuiAddress();
  if (w.sol?.presignId) { try { const p: any = await c.getPresign(w.sol.presignId); if (p?.state?.Completed) return w.sol.presignId; } catch {} }
  const networkKey = await c.getLatestNetworkEncryptionKey();
  const tx = new Transaction(); const it = new IkaTransaction({ ikaClient: c, transaction: tx });
  const ref = it.requestGlobalPresign({ dwalletNetworkEncryptionKeyId: networkKey.id, curve: Curve.ED25519, signatureAlgorithm: SignatureAlgorithm.EdDSA, ikaCoin: tx.object(IKA_COIN()), suiCoin: tx.gas });
  tx.transferObjects([ref], me);
  const t = await exec(tx);
  const presignId = evData(t, /PresignRequestEvent/).presign_id as string;
  await c.getPresignInParticularState(presignId, "Completed", { timeout: 120_000, interval: 250 });
  w.sol!.presignId = presignId; store.put(w);
  return presignId;
}

/** EdDSA signature (64 bytes) over `message` for the ed25519 dWallet. */
export async function signEdDSA(w: Wallet, message: Uint8Array, log: (s: string) => void = () => {}): Promise<Uint8Array> {
  if (!w.sol || w.sol.status !== "active") throw new Error("enable solana first");
  const c = await ika(); const k = await keys(Curve.ED25519);
  await ensureIka(log);
  const had = !!w.sol.presignId;
  const presignId = await presignEd(w, log); log(had ? "ed25519 presign ready" : "ed25519 presign bought");
  const presign: any = await c.getPresignInParticularState(presignId, "Completed", { timeout: 120_000, interval: 250 });
  const dw: any = dwCache.get(w.sol.dwalletId) ?? await c.getDWalletInParticularState(w.sol.dwalletId, "Active"); dwCache.set(w.sol.dwalletId, dw);
  await c.getProtocolPublicParameters(dw);
  log("inputs ready; requestSign computes the operator half (EdDSA) and builds the Sui call");
  const tx = new Transaction(); const it = new IkaTransaction({ ikaClient: c, transaction: tx, userShareEncryptionKeys: k });
  const approval = it.approveMessage({ dWalletCap: w.sol.dwalletCapId, curve: Curve.ED25519, signatureAlgorithm: SignatureAlgorithm.EdDSA, hashScheme: Hash.SHA512, message } as any);
  await it.requestSign({ dWallet: dw, messageApproval: approval, hashScheme: Hash.SHA512, verifiedPresignCap: it.verifyPresignCap({ presign }), presign, message, signatureScheme: SignatureAlgorithm.EdDSA, ikaCoin: tx.object(IKA_COIN()), suiCoin: tx.gas } as any);
  const t = await exec(tx, log);
  const signId = evData(t, /SignRequestEvent/).sign_id;
  log("sign request on Sui confirmed; waiting for the network MPC round");
  const sign: any = await c.getSignInParticularState(signId, Curve.ED25519, SignatureAlgorithm.EdDSA, "Completed", { timeout: 120_000, interval: 100 });
  log("signature received from the network");
  w.sol.presignId = undefined; store.put(w);
  void presignEd(w).catch(() => {});
  return Uint8Array.from(sign.state.Completed.signature);
}
