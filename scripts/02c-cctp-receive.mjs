// Step 3 of 3: mint native USDC on Sui testnet from the attested message.
// One PTB, five calls, copied from Circle's own receiveMessage.ts:
//   receive_message -> handle_receive_message<USDC> -> deconstruct_stamp_receipt_ticket_with_burn_message
//   -> stamp_receipt<MessageTransmitterAuthenticator> -> complete_receive_message
import { readFileSync } from "node:fs";
import { Transaction } from "@mysten/sui/transactions";
import { fromHex } from "@mysten/sui/utils";
import { SUI_TESTNET as S } from "./_cctp.mjs";
import { client, signer, explorer } from "./_sui.mjs";

const a = JSON.parse(readFileSync("out/attestation.json", "utf8"));
const kp = signer();
console.log(`receiving on Sui for ${a.recipient}, submitted by ${kp.toSuiAddress()}`);

const tx = new Transaction();
tx.setSender(kp.toSuiAddress());
const [receipt] = tx.moveCall({
  target: `${S.messageTransmitter}::receive_message::receive_message`,
  arguments: [tx.pure.vector("u8", fromHex(a.message)), tx.pure.vector("u8", fromHex(a.attestation)), tx.object(S.messageTransmitterState)],
});
const [ticketWithBurn] = tx.moveCall({
  target: `${S.tokenMessengerMinter}::handle_receive_message::handle_receive_message`,
  typeArguments: [S.usdcType],
  arguments: [receipt, tx.object(S.tokenMessengerMinterState), tx.object(S.denyList), tx.object(S.usdcTreasury)],
});
const [ticket] = tx.moveCall({
  target: `${S.tokenMessengerMinter}::handle_receive_message::deconstruct_stamp_receipt_ticket_with_burn_message`,
  arguments: [ticketWithBurn],
});
const [stamped] = tx.moveCall({
  target: `${S.messageTransmitter}::receive_message::stamp_receipt`,
  typeArguments: [`${S.tokenMessengerMinter}::message_transmitter_authenticator::MessageTransmitterAuthenticator`],
  arguments: [ticket, tx.object(S.messageTransmitterState)],
});
tx.moveCall({ target: `${S.messageTransmitter}::receive_message::complete_receive_message`, arguments: [stamped, tx.object(S.messageTransmitterState)] });
tx.setGasBudget(200_000_000);

const res = await client.signAndExecuteTransaction({ transaction: tx, signer: kp, include: { effects: true, balanceChanges: true } });
const t = res.Transaction ?? res;
console.log(`status: ${JSON.stringify(t.effects?.status)}\nmint: ${explorer(t.digest)}`);
for (const b of t.balanceChanges ?? []) if (String(b.coinType).endsWith("::usdc::USDC")) console.log(`USDC change: ${b.amount} to ${b.address ?? b.owner}`);
const bal = await client.getBalance({ owner: a.recipient, coinType: S.usdcType });
console.log(`recipient USDC balance now: ${bal.balance?.balance ?? JSON.stringify(bal).slice(0, 120)}`);
console.log("Native USDC on Sui. No wrapped asset. One burn, one attestation, one mint.");
