// Step 2 of 3: poll Circle's attestation service until the burn is attested.
// Shows the states a real integration sees: not found, pending_confirmations, complete.
import { readFileSync, writeFileSync } from "node:fs";
import { IRIS_SANDBOX } from "./_cctp.mjs";

const burn = JSON.parse(readFileSync("out/burn.json", "utf8"));
console.log(`burn ${burn.burnHash} at ${burn.at}\npolling ${IRIS_SANDBOX} every 10s (Sepolia finality: 13 to 19 minutes)`);
const started = Date.now();
for (;;) {
  let status = "unknown", attestation, message = burn.message;
  const r2 = await fetch(`${IRIS_SANDBOX}/v2/messages/0?transactionHash=${burn.burnHash}`);
  if (r2.status === 200) {
    const m = (await r2.json()).messages?.[0];
    if (m) { status = m.status; if (m.status === "complete") { attestation = m.attestation; message = m.message ?? message; } }
  } else {
    const r1 = await fetch(`${IRIS_SANDBOX}/v1/attestations/${burn.messageHash}`);
    if (r1.status === 200) { const j = await r1.json(); status = j.status; if (j.status === "complete") attestation = j.attestation; }
    else status = `http ${r1.status}`;
  }
  const mins = ((Date.now() - started) / 60000).toFixed(1);
  console.log(`[${mins} min] ${status}`);
  if (attestation) {
    writeFileSync("out/attestation.json", JSON.stringify({ ...burn, message, attestation, attestedAt: new Date().toISOString() }, null, 2));
    console.log("attested. saved out/attestation.json. Next: pnpm cctp:receive");
    break;
  }
  await new Promise((res) => setTimeout(res, 10_000));
}
