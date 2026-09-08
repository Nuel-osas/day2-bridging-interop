// Server side Ika: one operator Sui key holds every DWalletCap and pays IKA + SUI.
// Users are identified by their login; each gets a shared dWallet (network signs for the cap holder).
import { getNetworkConfig, IkaClient, IkaTransaction, Curve, Hash, SignatureAlgorithm, UserShareEncryptionKeys,
  createRandomSessionIdentifier, prepareDKGAsync, publicKeyFromDWalletOutput, createUserSignMessageWithPublicOutput } from "@ika.xyz/sdk";
import { Transaction } from "@mysten/sui/transactions";
import { computeAddress } from "ethers";
import * as bitcoin from "bitcoinjs-lib";
import { sui, operator } from "./sui";
import { store, type Wallet } from "./store";
import { takeReady, refill } from "./presignPool";

const curve = Curve.SECP256K1;
const IKA_COIN = () => { const c = process.env.IKA_COIN_ID; if (!c) throw new Error("IKA_COIN_ID not set"); return c; };
let ikaClient: IkaClient | null = null;
let keysCache: UserShareEncryptionKeys | null = null;
async function ika() {
  if (!ikaClient) { ikaClient = new IkaClient({ suiClient: sui as any, config: getNetworkConfig("testnet"), cache: true }); await ikaClient.initialize(); }
  return ikaClient;
}
async function keys() {
  if (!keysCache) keysCache = await UserShareEncryptionKeys.fromRootSeedKey(new TextEncoder().encode(process.env.IKA_ROOT_SEED ?? "ika-wallet-demo-seed"), curve);
  return keysCache;
}
async function exec(tx: Transaction) {
  const kp = operator(); tx.setSender(kp.toSuiAddress());
  const r: any = await sui.signAndExecuteTransaction({ transaction: tx, signer: kp, include: { effects: true, events: true } });
  const t = r.Transaction ?? r; if (t.effects?.status?.success === false) throw new Error(JSON.stringify(t.effects.status)); return t;
}
const evData = (t: any, re: RegExp) => { const e = (t.events ?? []).find((x: any) => re.test(x.eventType ?? "")); return e?.json?.event_data ?? {}; };

export function deriveAddresses(pub: Uint8Array) {
  const ethAddress = computeAddress("0x" + Buffer.from(pub).toString("hex"));
  const { address: btcAddress } = bitcoin.payments.p2wpkh({ pubkey: Buffer.from(pub), network: bitcoin.networks.testnet });
  return { ethAddress, btcAddress: btcAddress! };
}

function deps(log: (s: string) => void = () => {}) { return { ika: ikaClient!, ikaCoin: IKA_COIN, exec, evData, log }; }
/** Fire and forget: keep the shared presign pool topped up. */
export async function warmPool(log?: (s: string) => void) { await ika(); void refill(deps(log)); }

export async function ensureEncryptionKey() {
  const c = await ika(); const k = await keys();
  try { const tx = new Transaction(); const it = new IkaTransaction({ ikaClient: c, transaction: tx, userShareEncryptionKeys: k }); await it.registerEncryptionKey({ curve }); await exec(tx); } catch { /* already registered */ }
}

export async function getOrCreateWallet(user: string, log: (s: string) => void = () => {}): Promise<Wallet> {
  const existing = store.get(user); if (existing && existing.status === "active") return existing;
  const c = await ika(); const k = await keys(); const me = operator().toSuiAddress();
  await ensureEncryptionKey();
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
  await c.getPresignInParticularState(presignId, "Completed");
  w.presignId = presignId; store.put(w);
  return presignId;
}

/** Sign `message` with the dWallet using KECCAK256 (Ethereum). Returns 64-byte r||s. Consumes the presign. */
export async function signKeccak(w: Wallet, message: Uint8Array, log: (s: string) => void = () => {}): Promise<Uint8Array> {
  const c = await ika(); const k = await keys();
  let presign: any; let presignId: string;
  const ready = await takeReady(deps(log));
  if (ready) { presign = ready.presign; presignId = ready.presignId; log("presign taken from the pool (bought ahead of time)"); }
  else { presignId = await ensurePresign(w, log); presign = await c.getPresignInParticularState(presignId, "Completed"); }
  const dw: any = await c.getDWalletInParticularState(w.dwalletId, "Active");
  const pp = await c.getProtocolPublicParameters(dw);
  const userSig = await createUserSignMessageWithPublicOutput(pp, Uint8Array.from(dw.state.Active.public_output), Uint8Array.from(dw.public_user_secret_key_share), Uint8Array.from(presign.state.Completed.presign), message, Hash.KECCAK256, SignatureAlgorithm.ECDSASecp256k1, curve);
  log("asking the Ika network for its half of the signature");
  const tx = new Transaction(); const it = new IkaTransaction({ ikaClient: c, transaction: tx, userShareEncryptionKeys: k });
  const approval = it.approveMessage({ dWalletCap: w.dwalletCapId, curve, signatureAlgorithm: SignatureAlgorithm.ECDSASecp256k1, hashScheme: Hash.KECCAK256, message });
  await it.requestSign({ dWallet: dw, messageApproval: approval, hashScheme: Hash.KECCAK256, verifiedPresignCap: it.verifyPresignCap({ presign }), presign, message, signatureScheme: SignatureAlgorithm.ECDSASecp256k1, userSignMessage: userSig, ikaCoin: tx.object(IKA_COIN()), suiCoin: tx.gas } as any);
  const t = await exec(tx);
  const signId = evData(t, /SignRequestEvent/).sign_id;
  const sign: any = await c.getSignInParticularState(signId, curve, SignatureAlgorithm.ECDSASecp256k1, "Completed");
  w.presignId = undefined; store.put(w);
  void refill(deps());   // replace what we just used, in the background
  return Uint8Array.from(sign.state.Completed.signature);
}
