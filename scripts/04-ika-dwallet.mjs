// Ika: a Sui contract that can sign for Bitcoin or Ethereum. 2PC-MPC dWallets.
//
// Read-only by default: connects to Ika testnet, shows the network, the epoch, the active
// encryption key, and any DWalletCaps your address already owns. Every write (DKG,
// presign, sign) costs IKA plus SUI, and there is no public IKA faucet, so the write path
// runs only with IKA_COIN_ID set and --execute passed.
import { getNetworkConfig, IkaClient, IkaTransaction, Curve, Hash, SignatureAlgorithm,
  UserShareEncryptionKeys, createRandomSessionIdentifier, prepareDKGAsync } from "@ika.xyz/sdk";
import { Transaction } from "@mysten/sui/transactions";
import { client as suiClient, signer } from "./_sui.mjs";

const network = process.env.SUI_NETWORK === "mainnet" ? "mainnet" : "testnet";
const kp = signer();
const me = kp.toSuiAddress();
const config = getNetworkConfig(network);
const ika = new IkaClient({ suiClient, config, cache: true, encryptionKeyOptions: { autoDetect: true } });
await ika.initialize();

console.log(`Ika ${network}`);
console.log(`  dWallet coordinator   ${config.objects.ikaDWalletCoordinator.objectID}`);
console.log(`  2pc-mpc package       ${config.packages.ikaDwallet2pcMpcPackage}`);
console.log(`  epoch                 ${await ika.getEpoch()}`);
const key = await ika.getLatestNetworkEncryptionKey();
console.log(`  network encryption key ${key.id}`);
try {
  const caps = await ika.getOwnedDWalletCaps(me);
  console.log(`  DWalletCaps owned by ${me.slice(0, 10)}…: ${caps.length}`);
  for (const c of caps.slice(0, 5)) console.log(`    cap ${c.id?.id ?? c.id}  dwallet ${c.dwallet_id}`);
} catch (e) {
  // SDK 0.5.0 cannot decode caps minted by older coordinator versions; this address has some.
  console.log(`  DWalletCaps owned by ${me.slice(0, 10)}…: (older-version caps present, SDK cannot decode: ${e.message.slice(0, 60)})`);
}

if (!process.argv.includes("--execute")) {
  console.log(`
What the write path does (one PTB each, all need Coin<IKA> + Coin<SUI>):
  1. registerEncryptionKey(curve)                      once per address
  2. prepareDKGAsync + requestDWalletDKG               -> DWalletCap in your wallet, dWallet AwaitingKeyHolderSignature
  3. acceptEncryptedUserShare                          -> dWallet Active
  4. requestGlobalPresign                              -> a presign you can hold ahead of time
  5. approveMessage + requestSign(secp256k1, KECCAK256 or DoubleSHA256)
     -> a signature you attach to a Bitcoin or Ethereum transaction and broadcast yourself
The Move side: whatever module holds the DWalletCap decides when coordinator::approve_message runs.
That is the policy: multisig, timelock, price condition, DAO vote. Ika never sees your rule.
Re-run with IKA_COIN_ID=<Coin<IKA> object> --execute to run steps 1 and 2 for real.`);
  process.exit(0);
}

// --execute: steps 1 and 2 (DKG). Needs IKA.
const curve = Curve.SECP256K1;
const seed = new TextEncoder().encode(process.env.IKA_ROOT_SEED ?? "suihub-day2-demo-seed-do-not-use-in-prod");
const keys = await UserShareEncryptionKeys.fromRootSeedKey(seed, curve);
const tx = new Transaction();
tx.setSender(me);
const ikaTx = new IkaTransaction({ ikaClient: ika, transaction: tx, userShareEncryptionKeys: keys });
await ikaTx.registerEncryptionKey({ curve });
const identifier = createRandomSessionIdentifier();
const dkgRequestInput = await prepareDKGAsync(ika, curve, keys, identifier, me);
const [cap] = await ikaTx.requestDWalletDKG({
  curve, dkgRequestInput,
  sessionIdentifier: ikaTx.registerSessionIdentifier(identifier),
  ikaCoin: tx.object(process.env.IKA_COIN_ID),
  suiCoin: tx.splitCoins(tx.gas, [tx.pure.u64(100_000_000)]),
  dwalletNetworkEncryptionKeyId: key.id,
});
tx.transferObjects([cap], me);
const res = await suiClient.signAndExecuteTransaction({ transaction: tx, signer: kp, include: { effects: true, events: true } });
console.log("DKG requested:", res.Transaction?.digest ?? res.digest);
