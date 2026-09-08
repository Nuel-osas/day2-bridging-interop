// Ika end to end on testnet: a shared dWallet that is an Ethereum wallet.
// register encryption key -> DKG (public user share) -> Active -> ETH address -> global presign
// -> sign keccak(message) -> recover the address from the signature. Costs IKA + SUI.
import { getNetworkConfig, IkaClient, IkaTransaction, Curve, Hash, SignatureAlgorithm, UserShareEncryptionKeys,
  createRandomSessionIdentifier, prepareDKGAsync, publicKeyFromDWalletOutput, createUserSignMessageWithPublicOutput } from "@ika.xyz/sdk";
import { Transaction } from "@mysten/sui/transactions";
import { keccak256, toBeHex, computeAddress, recoverAddress, Signature } from "ethers";
import { writeFileSync } from "node:fs";
import { client, signer } from "./_sui.mjs";

const IKA_COIN = process.env.IKA_COIN_ID; if (!IKA_COIN) throw new Error("IKA_COIN_ID");
const kp = signer(); const me = kp.toSuiAddress();
const curve = Curve.SECP256K1;
const ika = new IkaClient({ suiClient: client, config: getNetworkConfig("testnet"), cache: true });
await ika.initialize();
const keys = await UserShareEncryptionKeys.fromRootSeedKey(new TextEncoder().encode(process.env.IKA_ROOT_SEED ?? "suihub-day2-shared-dwallet-seed"), curve);
const networkKey = await ika.getLatestNetworkEncryptionKey();
const t0 = Date.now(); const lap = () => `[${((Date.now() - t0) / 1000).toFixed(0)}s]`;
const exec = async (tx) => { tx.setSender(me); try { var r = await client.signAndExecuteTransaction({ transaction: tx, signer: kp, include: { effects: true, events: true, objectChanges: true } }); } catch (e) { console.log("FAILED PTB:"); tx.getData().commands.forEach((c, i) => console.log(" ", i, c.$kind, c.$kind === "MoveCall" ? c.MoveCall.function + " " + JSON.stringify(c.MoveCall.arguments) : JSON.stringify(c[c.$kind]).slice(0, 160))); throw e; } const t = r.Transaction ?? r; if (t.effects?.status?.success === false) throw new Error(JSON.stringify(t.effects.status)); return t; };
const evData = (t, re) => { const e = (t.events ?? []).find((x) => re.test(x.eventType ?? x.type ?? "")); return e?.json?.event_data ?? e?.parsedJson?.event_data ?? e?.json ?? e?.parsedJson ?? {}; };
const createdOwnedByMe = (t) => (t.effects?.changedObjects ?? []).filter((o) => o.idOperation === "Created" && JSON.stringify(o.outputOwner ?? "").includes(me.slice(0, 20))).map((o) => o.id);
import { existsSync, readFileSync } from "node:fs";

// 1. register encryption key (idempotent enough for a demo; skip if it fails as already registered)
try { const tx = new Transaction(); const it = new IkaTransaction({ ikaClient: ika, transaction: tx, userShareEncryptionKeys: keys }); await it.registerEncryptionKey({ curve }); const t = await exec(tx); console.log(lap(), "encryption key registered", t.digest); }
catch (e) { console.log(lap(), "encryption key: skipped,", String(e.message).slice(0, 80)); }

// 2. DKG with public user share (shared dWallet)
const sid = createRandomSessionIdentifier();
const dkg = await prepareDKGAsync(ika, curve, keys, sid, me);
let dwalletId = process.env.DWALLET_ID, dwalletCapId = process.env.DWALLET_CAP_ID;
if (!dwalletId && existsSync("out/ika-dwallet.json")) { const j = JSON.parse(readFileSync("out/ika-dwallet.json", "utf8")); dwalletId = j.dwalletId; dwalletCapId = j.dwalletCapId; console.log(lap(), "reusing dWallet from out/ika-dwallet.json", dwalletId); }
if (!dwalletId) {
  const tx = new Transaction(); const it = new IkaTransaction({ ikaClient: ika, transaction: tx, userShareEncryptionKeys: keys });
  const sessionId = it.registerSessionIdentifier(sid);
  const [cap, signId] = await it.requestDWalletDKGWithPublicUserShare({
    publicKeyShareAndProof: dkg.userDKGMessage, publicUserSecretKeyShare: dkg.userSecretKeyShare, userPublicOutput: dkg.userPublicOutput,
    ikaCoin: tx.object(IKA_COIN), suiCoin: tx.gas,
    sessionIdentifier: sessionId, dwalletNetworkEncryptionKeyId: networkKey.id, curve,
  });
  tx.transferObjects([cap], me);
  const t = await exec(tx);
  const ed = evData(t, /DKGRequestEvent/);
  dwalletId = ed.dwallet_id; dwalletCapId = ed.dwallet_cap_id ?? createdOwnedByMe(t)[0];
  console.log(lap(), "DKG requested", t.digest, "dwallet", dwalletId, "cap", dwalletCapId);
  if (!dwalletId) { console.log("events:", JSON.stringify((t.events ?? []).map((e) => [e.eventType, e.json]), null, 1).slice(0, 1500)); process.exit(1); }
}

// 3. wait Active, derive ETH address
const dWallet = await ika.getDWalletInParticularState(dwalletId, "Active");
const pub = await publicKeyFromDWalletOutput(curve, Uint8Array.from(dWallet.state.Active.public_output));
const ethAddress = computeAddress("0x" + Buffer.from(pub).toString("hex"));
console.log(lap(), "dWallet Active. ETH address:", ethAddress);
writeFileSync("out/ika-dwallet.json", JSON.stringify({ dwalletId, dwalletCapId, ethAddress, publicKey: Buffer.from(pub).toString("hex"), curve: "SECP256K1", kind: "shared", seedHint: "IKA_ROOT_SEED", createdAt: new Date().toISOString() }, null, 2));

// 4. global presign
let presignId = process.env.PRESIGN_ID;
if (!presignId) {
  const tx = new Transaction(); const it = new IkaTransaction({ ikaClient: ika, transaction: tx });
  const ref = it.requestGlobalPresign({ dwalletNetworkEncryptionKeyId: networkKey.id, curve, signatureAlgorithm: SignatureAlgorithm.ECDSASecp256k1,
    ikaCoin: tx.object(IKA_COIN), suiCoin: tx.gas });
  tx.transferObjects([ref], me);
  const t = await exec(tx);
  presignId = evData(t, /PresignRequestEvent/).presign_id ?? evData(t, /Presign/).presign_id;
  console.log(lap(), "presign requested", t.digest, "presign", presignId);
}
const presign = await ika.getPresignInParticularState(presignId, "Completed");
console.log(lap(), "presign completed");

// 5. sign keccak256 of a message
const message = new TextEncoder().encode("SuiHub Lagos: a Sui-controlled Ethereum key, " + new Date().toISOString());
const pp = await ika.getProtocolPublicParameters(dWallet);
const userSig = await createUserSignMessageWithPublicOutput(pp, Uint8Array.from(dWallet.state.Active.public_output), Uint8Array.from(dWallet.public_user_secret_key_share), Uint8Array.from(presign.state.Completed.presign), message, Hash.KECCAK256, SignatureAlgorithm.ECDSASecp256k1, curve);
let signId;
{
  const tx = new Transaction(); const it = new IkaTransaction({ ikaClient: ika, transaction: tx, userShareEncryptionKeys: keys });
  const approval = it.approveMessage({ dWalletCap: dwalletCapId, curve, signatureAlgorithm: SignatureAlgorithm.ECDSASecp256k1, hashScheme: Hash.KECCAK256, message });
  const ref = await it.requestSign({ dWallet, messageApproval: approval, hashScheme: Hash.KECCAK256, verifiedPresignCap: it.verifyPresignCap({ presign }), presign, message, signatureScheme: SignatureAlgorithm.ECDSASecp256k1, userSignMessage: userSig,
    ikaCoin: tx.object(IKA_COIN), suiCoin: tx.gas });
  const t = await exec(tx);
  signId = evData(t, /SignRequestEvent/).sign_id ?? evData(t, /Sign(?!.*Presign)/).sign_id;
  console.log(lap(), "sign requested", t.digest, "sign", signId);
}
const sign = await ika.getSignInParticularState(signId, curve, SignatureAlgorithm.ECDSASecp256k1, "Completed");
const sigBytes = Uint8Array.from(sign.state.Completed.signature);
console.log(lap(), "signature bytes:", sigBytes.length);
const digest = keccak256(message);
let recovered = null;
for (const v of [27, 28]) { try { const s = Signature.from({ r: toBeHex(BigInt("0x" + Buffer.from(sigBytes.slice(0, 32)).toString("hex")), 32), s: toBeHex(BigInt("0x" + Buffer.from(sigBytes.slice(32, 64)).toString("hex")), 32), v }); const a = recoverAddress(digest, s); if (a.toLowerCase() === ethAddress.toLowerCase()) { recovered = a; break; } } catch {} }
console.log(lap(), recovered ? `recovered ${recovered} == dWallet ETH address. Ika signs for Ethereum.` : "recovery did not match (check signature layout)");
