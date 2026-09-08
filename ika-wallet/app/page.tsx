"use client";
import { useEffect, useState } from "react";

type WalletResp = { user: string; wallet: { dwalletId: string; dwalletCapId: string; ethAddress: string; btcAddress: string }; balances: { sepoliaEth: string; testnetBtc: string }; steps: string[] };
const card: React.CSSProperties = { background: "#111a2e", border: "1px solid #1f2a44", borderRadius: 14, padding: 20, marginBottom: 16 };
const mono: React.CSSProperties = { fontFamily: "ui-monospace, Menlo, monospace", fontSize: 13, wordBreak: "break-all" };
const btn: React.CSSProperties = { background: "#2563eb", color: "#fff", border: 0, borderRadius: 10, padding: "10px 16px", fontSize: 14, cursor: "pointer" };
const input: React.CSSProperties = { background: "#0b1220", color: "#e5e7eb", border: "1px solid #1f2a44", borderRadius: 10, padding: "10px 12px", fontSize: 14, width: "100%", boxSizing: "border-box" };

export default function Page() {
  const [cfg, setCfg] = useState<{ googleClientId: string | null } | null>(null);
  const [user, setUser] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [w, setW] = useState<WalletResp | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [to, setTo] = useState(""); const [amount, setAmount] = useState("0.001");
  const [txHash, setTxHash] = useState<string | null>(null);
  const push = (s: string) => setLog((l) => [...l, `${new Date().toLocaleTimeString()}  ${s}`]);

  useEffect(() => { fetch("/api/config").then((r) => r.json()).then(setCfg); fetch("/api/auth/me").then((r) => r.json()).then((j) => setUser(j.user)); }, []);
  useEffect(() => {
    if (!cfg?.googleClientId || user) return;
    const s = document.createElement("script"); s.src = "https://accounts.google.com/gsi/client"; s.async = true;
    s.onload = () => { (window as any).google.accounts.id.initialize({ client_id: cfg.googleClientId, callback: async (resp: any) => { const r = await fetch("/api/auth/google", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ credential: resp.credential }) }); const j = await r.json(); if (j.user) setUser(j.user); } }); (window as any).google.accounts.id.renderButton(document.getElementById("gbtn"), { theme: "filled_black", size: "large", text: "signin_with" }); };
    document.body.appendChild(s);
  }, [cfg, user]);

  async function demoLogin() { const r = await fetch("/api/auth/demo", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email }) }); const j = await r.json(); if (j.user) setUser(j.user); else push(j.error); }
  async function loadWallet() {
    setBusy(true); push("looking up your dWallet on Ika (first time: distributed key generation, about 20 s)");
    const r = await fetch("/api/wallet"); const j = await r.json(); (j.steps ?? []).forEach(push);
    if (j.wallet) { setW(j); push("ready"); } else push("error: " + j.error);
    setBusy(false);
  }
  async function send() {
    setBusy(true); setTxHash(null); push(`sending ${amount} ETH to ${to}`);
    const r = await fetch("/api/send", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ to, amount }) }); const j = await r.json(); (j.steps ?? []).forEach(push);
    if (j.hash) { setTxHash(j.hash); push("broadcast: " + j.hash); } else push("error: " + j.error);
    setBusy(false);
  }
  async function logout() { await fetch("/api/auth/logout", { method: "POST" }); setUser(null); setW(null); setLog([]); }
  useEffect(() => { if (user && !w) loadWallet(); }, [user]);

  return (
    <main style={{ maxWidth: 680, margin: "40px auto", padding: 16 }}>
      <h1 style={{ fontSize: 24, fontWeight: 600, margin: 0 }}>Sign in with Gmail. Get a wallet on every chain.</h1>
      <p style={{ opacity: 0.7, marginTop: 6 }}>One Ika dWallet, controlled from Sui, gives you an Ethereum address and a Bitcoin address. Receive on either. Send on Sepolia. Testnet only.</p>

      {!user && (
        <div style={card}>
          {cfg?.googleClientId ? <div id="gbtn" /> : <p style={{ opacity: 0.7, marginTop: 0 }}>Google sign-in is not configured on this server; use the demo login.</p>}
          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
            <input style={input} placeholder="you@gmail.com" value={email} onChange={(e) => setEmail(e.target.value)} />
            <button style={btn} onClick={demoLogin}>Continue</button>
          </div>
        </div>
      )}

      {user && (
        <div style={card}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div><div style={{ opacity: 0.6, fontSize: 12 }}>signed in as</div><div>{user}</div></div>
            <button style={{ ...btn, background: "#1f2a44" }} onClick={logout}>Sign out</button>
          </div>
        </div>
      )}

      {user && w && (
        <>
          <div style={card}>
            <div style={{ opacity: 0.6, fontSize: 12 }}>Ethereum (Sepolia)</div>
            <div style={mono}>{w.wallet.ethAddress}</div>
            <div style={{ marginTop: 6 }}>{w.balances.sepoliaEth} ETH</div>
            <div style={{ opacity: 0.6, fontSize: 12, marginTop: 14 }}>Bitcoin (testnet, P2WPKH)</div>
            <div style={mono}>{w.wallet.btcAddress}</div>
            <div style={{ marginTop: 6 }}>{w.balances.testnetBtc} BTC</div>
            <div style={{ opacity: 0.6, fontSize: 12, marginTop: 14 }}>dWallet on Sui</div>
            <div style={mono}>{w.wallet.dwalletId}</div>
            <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
              <button style={{ ...btn, background: "#1f2a44" }} onClick={() => navigator.clipboard.writeText(w.wallet.ethAddress)}>Copy ETH address</button>
              <button style={{ ...btn, background: "#1f2a44" }} onClick={() => navigator.clipboard.writeText(w.wallet.btcAddress)}>Copy BTC address</button>
              <button style={{ ...btn, background: "#1f2a44" }} onClick={loadWallet} disabled={busy}>Refresh</button>
            </div>
          </div>
          <div style={card}>
            <div style={{ fontWeight: 600, marginBottom: 10 }}>Send ETH on Sepolia</div>
            <input style={input} placeholder="0x recipient" value={to} onChange={(e) => setTo(e.target.value)} />
            <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
              <input style={{ ...input, width: 160 }} value={amount} onChange={(e) => setAmount(e.target.value)} />
              <button style={btn} onClick={send} disabled={busy || !to}>Sign with Ika and send</button>
            </div>
            {txHash && <div style={{ marginTop: 10 }}><a style={{ color: "#60a5fa" }} href={`https://sepolia.etherscan.io/tx/${txHash}`} target="_blank">view on Etherscan</a></div>}
            <p style={{ opacity: 0.6, fontSize: 12, marginTop: 10 }}>The transaction is built here, hashed, and the hash is signed by the Ika network on behalf of the dWallet cap held by this server. No private key exists anywhere.</p>
          </div>
        </>
      )}

      {log.length > 0 && <div style={card}><div style={{ opacity: 0.6, fontSize: 12, marginBottom: 6 }}>log</div>{log.map((l, i) => <div key={i} style={{ ...mono, opacity: 0.85 }}>{l}</div>)}</div>}
    </main>
  );
}
