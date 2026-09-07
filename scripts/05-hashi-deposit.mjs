// Hashi: native Bitcoin as collateral on Sui, without wrapping. Testnet uses Bitcoin Signet.
//
//   pnpm hashi address              -> a P2TR deposit address bound to your Sui address
//   pnpm hashi deposit <txid> <vout> <sats>   -> tell Hashi about the Signet payment
//   pnpm hashi status <digest>      -> track approval and mint
//   pnpm hashi balance              -> hBTC balance (sats)
import { hashi } from "@mysten/hashi";
import { client as base, signer } from "./_sui.mjs";

const client = base.$extend(hashi());
const kp = signer();
const me = kp.toSuiAddress();
const [cmd, ...args] = process.argv.slice(2);

if (cmd === "address" || !cmd) {
  const addr = await client.hashi.generateDepositAddress({ suiAddress: me });
  console.log(`Sui address    ${me}`);
  console.log(`Signet deposit ${addr}`);
  console.log("Send Signet BTC here (signetfaucet.com), then: pnpm hashi deposit <txid> <vout> <sats>");
  console.log("The address is a 2-of-2 P2TR between the Hashi committee's MPC key and the Guardian, derived for your Sui address.");
} else if (cmd === "deposit") {
  const [txid, vout, sats] = args;
  const r = await client.hashi.deposit({ signer: kp, txid: txid.startsWith("0x") ? txid : `0x${txid}`, utxos: [{ vout: Number(vout), amountSats: BigInt(sats) }], recipient: me });
  if (r.$kind !== "Transaction") { console.error(JSON.stringify(r.FailedTransaction ?? r, null, 2)); process.exit(1); }
  console.log(`deposit request digest ${r.Transaction.digest}`);
  console.log(await client.hashi.view.depositStatus(r.Transaction.digest));
} else if (cmd === "status") {
  console.log(await client.hashi.view.depositStatus(args[0]));
} else if (cmd === "wait") {
  const info = await client.hashi.waitForDeposit(args[0], { intervalMs: 15_000, signal: AbortSignal.timeout(3_600_000) });
  console.log(info);
} else if (cmd === "balance") {
  console.log(await client.hashi.view.balance(me));
} else if (cmd === "params") {
  console.log(JSON.stringify(await client.hashi.view.all(), (k, v) => (typeof v === "bigint" ? v.toString() : v), 2).slice(0, 2500));
}
