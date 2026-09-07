import React from "react";
import { createRoot } from "react-dom/client";
import WormholeConnect from "@wormhole-foundation/wormhole-connect";

// One component, one config. Sepolia <-> Sui testnet. Routes come from Wormhole:
// wrapped token transfers with automatic relay, CCTP for USDC, gas drop-off.
const config = {
  network: "Testnet",
  chains: ["Sepolia", "Sui"],
  ui: { title: "Bridge into Sui", defaultInputs: { fromChain: "Sepolia", toChain: "Sui" } },
};
const theme = { mode: "dark", primary: "#2563eb" };

createRoot(document.getElementById("root")).render(
  <div style={{ maxWidth: 560, margin: "40px auto", padding: 16 }}>
    <h1 style={{ fontSize: 22, fontWeight: 600 }}>Bridge into Sui</h1>
    <p style={{ opacity: 0.7, marginTop: 4 }}>Wormhole Connect, testnet. The bridge lives inside the app; the user never leaves.</p>
    <WormholeConnect config={config} theme={theme} />
  </div>
);
