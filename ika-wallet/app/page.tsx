"use client";
import { useEffect, useRef, useState } from "react";

type ChainInfo = { label: string; symbol: string; faucet: string };
type WalletResp = { user: string; wallet: { dwalletId: string; dwalletCapId: string; ethAddress: string; btcAddress: string; createdAt: string }; balances: { evm: Record<string, string>; testnetBtc: string }; chains: Record<string, ChainInfo>; steps: string[] };
type Step = { key: string; label: string; detail: string };
async function readStream(res: Response, onLine: (o: any) => void) {
  const reader = res.body!.getReader(); const dec = new TextDecoder(); let buf = "";
  for (;;) { const { value, done } = await reader.read(); if (done) break; buf += dec.decode(value, { stream: true }); let i; while ((i = buf.indexOf("\n")) >= 0) { const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1); if (line) onLine(JSON.parse(line)); } }
  if (buf.trim()) onLine(JSON.parse(buf.trim()));
}
const STEPS: Step[] = [
  { key: "signin", label: "Sign in", detail: "Your login is the account id. No wallet, no seed phrase." },
  { key: "dkg", label: "Generate the key on Ika", detail: "Distributed key generation between the operator and the Ika network. No party ever holds the whole key." },
  { key: "active", label: "dWallet active on Sui", detail: "A DWalletCap on Sui now authorises every signature for this key." },
  { key: "derive", label: "Derive addresses", detail: "One secp256k1 public key becomes an Ethereum address and a Bitcoin address." },
];

export default function Page() {
  const [cfg, setCfg] = useState<{ googleClientId: string | null } | null>(null);
  const [user, setUser] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [w, setW] = useState<WalletResp | null>(null);
  const [phase, setPhase] = useState<"idle" | "creating" | "ready">("idle");
  const [stepIdx, setStepIdx] = useState(0);
  const [log, setLog] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState<"wallet" | "receive" | "send" | "how">("wallet");
  const [chain, setChain] = useState<string>("sepolia");   // an EVM key, or "btc"
  const [txExplorer, setTxExplorer] = useState<string | null>(null);
  const [to, setTo] = useState(""); const [amount, setAmount] = useState("0.0001");
  const [txHash, setTxHash] = useState<string | null>(null);
  const [toast, setToast] = useState<{ kind: "ok" | "err"; text: string; href?: string } | null>(null);
  const say = (kind: "ok" | "err", text: string, href?: string) => { setToast({ kind, text, href }); setTimeout(() => setToast(null), 9000); };
  const logRef = useRef<HTMLDivElement>(null);
  const push = (s: string) => setLog((l) => [...l, `${new Date().toLocaleTimeString([], { hour12: false })}  ${s}`]);
  useEffect(() => { logRef.current?.scrollTo({ top: 1e9 }); }, [log]);

  useEffect(() => { fetch("/api/config").then((r) => r.json()).then(setCfg); fetch("/api/auth/me").then((r) => r.json()).then((j) => { if (j.user) { setUser(j.user); setStepIdx(1); } }); }, []);
  useEffect(() => {
    if (!cfg?.googleClientId || user) return;
    const s = document.createElement("script"); s.src = "https://accounts.google.com/gsi/client"; s.async = true;
    s.onload = () => { const g = (window as any).google; g.accounts.id.initialize({ client_id: cfg.googleClientId, callback: async (resp: any) => { const r = await fetch("/api/auth/google", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ credential: resp.credential }) }); const j = await r.json(); if (j.user) { setUser(j.user); setStepIdx(1); } } }); g.accounts.id.renderButton(document.getElementById("gbtn"), { theme: "filled_black", size: "large", shape: "rectangular", text: "signin_with" }); };
    document.body.appendChild(s);
  }, [cfg, user]);

  async function demoLogin() { const r = await fetch("/api/auth/demo", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email }) }); const j = await r.json(); if (j.user) { setUser(j.user); setStepIdx(1); } else push(j.error); }
  async function loadWallet() {
    setBusy(true); setPhase((p) => (p === "ready" ? "ready" : "creating")); if (!w) setStepIdx(1); push("checking Ika for a dWallet bound to this login");
    const r = await fetch("/api/wallet");
    if (!r.ok || !r.body) { push("error: " + (await r.text())); setBusy(false); return; }
    let final: any = null;
    await readStream(r, (o) => {
      if (o.step) { push(`+${(o.t / 1000).toFixed(1)}s  ${o.step}`); if (/finish DKG/i.test(o.step)) setStepIdx(2); if (/active/i.test(o.step)) setStepIdx(3); }
      if (o.done) final = o;
    });
    if (final?.wallet) { setW(final); setStepIdx(4); setPhase("ready"); push("ready"); }
    else { push("error: " + (final?.error ?? "unknown")); say("err", final?.error ?? "wallet error"); setPhase("idle"); }
    setBusy(false);
  }
  async function send() {
    setBusy(true); setTxHash(null); push(`send ${amount} to ${to} on ${w?.chains[chain]?.label}`);
    const r = await fetch("/api/send", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ to, amount, chain }) });
    if (!r.ok || !r.body) { const e = await r.text(); push("error: " + e); say("err", e); setBusy(false); return; }
    let final: any = null;
    await readStream(r, (o) => { if (o.step) push(`+${(o.t / 1000).toFixed(1)}s  ${o.step}`); if (o.done) final = o; });
    if (final?.hash) { setTxHash(final.hash); setTxExplorer(final.explorer); push(`broadcast ${final.hash} (${(final.t / 1000).toFixed(1)}s)`); say("ok", `sent ${amount} ${w?.chains[chain]?.symbol} on ${w?.chains[chain]?.label} in ${(final.t / 1000).toFixed(0)}s`, final.explorer); loadWallet(); }
    else { push("error: " + (final?.error ?? "unknown")); say("err", final?.error ?? "send failed"); }
    setBusy(false);
  }
  async function logout() { await fetch("/api/auth/logout", { method: "POST" }); setUser(null); setW(null); setLog([]); setPhase("idle"); setStepIdx(0); setView("wallet"); }
  useEffect(() => { if (user && !w && phase === "idle") loadWallet(); }, [user]);

  const addr = chain === "btc" ? w?.wallet.btcAddress : w?.wallet.ethAddress;
  const evmKeys = w ? Object.keys(w.chains) : [];
  const fmt = (v: string) => (v === "n/a" ? "n/a" : Number(v).toFixed(5));

  return (
    <main style={{ maxWidth: 760, margin: "0 auto", padding: "40px 20px 80px" }}>
      {toast && (
        <div style={{ position: "fixed", right: 20, bottom: 20, zIndex: 50, maxWidth: 420, background: toast.kind === "ok" ? "#f4f4f5" : "#18181b", color: toast.kind === "ok" ? "#000" : "#f4f4f5", border: "1px solid " + (toast.kind === "ok" ? "#f4f4f5" : "#3f3f46"), borderRadius: 12, padding: "12px 14px", fontSize: 13, boxShadow: "0 10px 30px rgba(0,0,0,.6)" }}>
          <div style={{ fontWeight: 600, marginBottom: toast.href ? 6 : 0 }}>{toast.kind === "ok" ? "signed by ika" : "failed"}</div>
          <div style={{ wordBreak: "break-word" }}>{toast.text}</div>
          {toast.href && <a href={toast.href} target="_blank" style={{ color: "inherit", display: "inline-block", marginTop: 6 }}>view on explorer →</a>}
        </div>
      )}
      <header className="row" style={{ justifyContent: "space-between", marginBottom: 28 }}>
        <div>
          <div className="kicker">ika wallet · sui testnet</div>
          <h1 style={{ fontSize: 22, fontWeight: 600, margin: "6px 0 0" }}>one login, every chain</h1>
        </div>
        {user && <div className="row"><span style={{ color: "var(--mute)", fontSize: 12 }}>{user}</span><button className="btn ghost" onClick={logout}>sign out</button></div>}
      </header>

      {!user && (
        <section className="card">
          <div className="kicker">01 · sign in</div>
          <p style={{ color: "var(--mute)", margin: "8px 0 16px", lineHeight: 1.6 }}>Sign in with Google. You get an Ethereum address and a Bitcoin address backed by one Ika dWallet controlled from Sui. No extension, no seed phrase, no private key anywhere.</p>
          {cfg?.googleClientId ? <div id="gbtn" style={{ marginBottom: 12 }} /> : <div className="kicker" style={{ marginBottom: 8 }}>google not configured on this server · demo login</div>}
          <div className="row"><input className="input" placeholder="you@gmail.com" value={email} onChange={(e) => setEmail(e.target.value)} onKeyDown={(e) => e.key === "Enter" && demoLogin()} /><button className="btn" onClick={demoLogin}>continue</button></div>
        </section>
      )}

      {user && phase !== "ready" && (
        <section className="card">
          <div className="kicker">02 · creating your dWallet</div>
          <div style={{ marginTop: 10 }}>
            {STEPS.map((s, i) => (
              <div className="step" key={s.key}>
                <div className={"dot " + (i < stepIdx ? "done" : i === stepIdx ? "live" : "")}>{i < stepIdx ? "✓" : ""}</div>
                <div><div style={{ fontWeight: 500 }}>{s.label}</div><div style={{ color: "var(--dim)", fontSize: 12, marginTop: 2 }}>{s.detail}</div></div>
              </div>
            ))}
          </div>
          {phase === "idle" && <button className="btn" style={{ marginTop: 14 }} onClick={loadWallet} disabled={busy}>create wallet</button>}
        </section>
      )}

      {user && phase === "ready" && w && (
        <>
          <nav className="row" style={{ marginBottom: 12 }}>
            {(["wallet", "receive", "send", "how"] as const).map((v) => <button key={v} className={"tab " + (view === v ? "on" : "")} onClick={() => setView(v)}>{v === "how" ? "how it works" : v}</button>)}
            <span style={{ flex: 1 }} />
            <button className="btn ghost" onClick={loadWallet} disabled={busy}>refresh</button>
          </nav>

          {view === "wallet" && (
            <>
              <div className="kicker" style={{ margin: "4px 0 10px" }}>one secp256k1 key · {evmKeys.length} evm networks share the address {w.wallet.ethAddress.slice(0, 10)}…</div>
              <div className="grid">
                {evmKeys.map((k) => (
                  <div className="card" key={k}>
                    <div className="kicker">{w.chains[k].label}</div>
                    <div style={{ fontSize: 24, fontWeight: 600, margin: "10px 0 2px" }}>{fmt(w.balances.evm[k])} <span style={{ fontSize: 12, color: "var(--mute)" }}>{w.chains[k].symbol}</span></div>
                    <div className="row" style={{ marginTop: 12 }}>
                      <button className="btn ghost" onClick={() => { setChain(k); setView("receive"); }}>receive</button>
                      <button className="btn" onClick={() => { setChain(k); setView("send"); }}>send</button>
                    </div>
                  </div>
                ))}
                <div className="card">
                  <div className="kicker">bitcoin · testnet</div>
                  <div style={{ fontSize: 24, fontWeight: 600, margin: "10px 0 2px" }}>{w.balances.testnetBtc} <span style={{ fontSize: 12, color: "var(--mute)" }}>BTC</span></div>
                  <div className="addr" style={{ color: "var(--mute)", marginTop: 6, fontSize: 11.5 }}>{w.wallet.btcAddress}</div>
                  <div className="row" style={{ marginTop: 12 }}>
                    <button className="btn ghost" onClick={() => { setChain("btc"); setView("receive"); }}>receive</button>
                    <button className="btn ghost" disabled title="Bitcoin sends: Day 3">send</button>
                  </div>
                </div>
                <div className="card" style={{ opacity: 0.6 }}>
                  <div className="kicker">solana · near · cardano</div>
                  <div style={{ marginTop: 10, fontSize: 12.5, color: "var(--mute)", lineHeight: 1.6 }}>Need an ed25519 dWallet: a second DKG on Curve.ED25519 and EdDSA signing. Same operator, same code path, one more curve. Not wired today.</div>
                </div>
                <div className="card" style={{ gridColumn: "1 / -1" }}>
                  <div className="kicker">sui · coordination layer</div>
                  <div style={{ marginTop: 10, display: "grid", gridTemplateColumns: "120px 1fr", rowGap: 6, columnGap: 12, fontSize: 12.5 }}>
                    <span style={{ color: "var(--dim)" }}>dWallet</span><span className="addr">{w.wallet.dwalletId}</span>
                    <span style={{ color: "var(--dim)" }}>DWalletCap</span><span className="addr">{w.wallet.dwalletCapId}</span>
                    <span style={{ color: "var(--dim)" }}>evm address</span><span className="addr">{w.wallet.ethAddress}</span>
                    <span style={{ color: "var(--dim)" }}>created</span><span>{new Date(w.wallet.createdAt).toLocaleString()}</span>
                  </div>
                </div>
              </div>
            </>
          )}

          {view === "receive" && (
            <div className="card">
              <div className="row" style={{ marginBottom: 10, flexWrap: "wrap" }}>
                {evmKeys.map((k) => <button key={k} className={"tab " + (chain === k ? "on" : "")} onClick={() => setChain(k)}>{w.chains[k].label.split(" · ")[0]}</button>)}
                <button className={"tab " + (chain === "btc" ? "on" : "")} onClick={() => setChain("btc")}>bitcoin</button>
              </div>
              <div className="kicker">{chain === "btc" ? "testnet p2wpkh address" : `${w.chains[chain]?.label} address (same on every evm chain)`}</div>
              <div className="addr" style={{ fontSize: 15, margin: "10px 0 14px" }}>{addr}</div>
              <div className="row">
                <button className="btn" onClick={() => navigator.clipboard.writeText(addr!)}>copy</button>
                <a className="btn ghost" style={{ textDecoration: "none" }} href={chain === "btc" ? "https://coinfaucet.eu/en/btc-testnet/" : w.chains[chain]?.faucet} target="_blank">faucet</a>
              </div>
              <hr />
              <p style={{ color: "var(--dim)", fontSize: 12, margin: 0, lineHeight: 1.6 }}>Nothing happens on Sui when you receive. The address is a pure function of the dWallet's public key.</p>
            </div>
          )}

          {view === "send" && (
            <div className="card">
              <div className="row" style={{ marginBottom: 10, flexWrap: "wrap" }}>{evmKeys.map((k) => <button key={k} className={"tab " + (chain === k ? "on" : "")} onClick={() => setChain(k)}>{w.chains[k].label.split(" · ")[0]}</button>)}</div>
              <div className="kicker">send · {w.chains[chain]?.label ?? "ethereum · sepolia"}</div>
              <div style={{ marginTop: 12 }}>
                <input className="input" placeholder="0x recipient" value={to} onChange={(e) => setTo(e.target.value)} />
                <div className="row" style={{ marginTop: 8 }}>
                  <input className="input" style={{ width: 180 }} value={amount} onChange={(e) => setAmount(e.target.value)} />
                  <span style={{ color: "var(--mute)", fontSize: 12 }}>{w.chains[chain]?.symbol} · balance {fmt(w.balances.evm[chain] ?? "0")}</span>
                  <span style={{ flex: 1 }} />
                  <button className="btn" onClick={send} disabled={busy || !to}>{busy ? "signing with ika…" : "sign with ika and send"}</button>
                </div>
              </div>
              {txHash && <div style={{ marginTop: 12 }}><a href={txExplorer ?? "#"} target="_blank">view on explorer →</a></div>}
              <hr />
              <p style={{ color: "var(--dim)", fontSize: 12, margin: 0, lineHeight: 1.6 }}>The transaction is built here and hashed. The Ika network and the operator produce the ECDSA signature together; the recovery bit is found by matching your address; then it is broadcast. At no point does a private key exist.</p>
            </div>
          )}

          {view === "how" && (
            <div className="card">
              <div className="kicker">how it works</div>
              <div style={{ marginTop: 10 }}>
                {[
                  ["login", "Google or an email identifies you. The server maps that id to one dWallet."],
                  ["operator", "One Sui key on the server holds IKA, SUI and every DWalletCap. It pays for DKG, presigns and signatures."],
                  ["dkg", "requestDWalletDKGWithPublicUserShare. The key is generated as shares between the operator and the Ika network."],
                  ["addresses", "publicKeyFromDWalletOutput, then keccak256 for Ethereum and hash160 + bech32 for Bitcoin."],
                  ["presign", "requestGlobalPresign runs the slow half of ECDSA before there is anything to sign."],
                  ["sign", "approveMessage + requestSign. Whoever can borrow the DWalletCap decides. A Move module could be that holder, with any rule you write."],
                ].map(([k, v]) => <div className="step" key={k}><div className="dot" /><div><div style={{ fontWeight: 500 }}>{k}</div><div style={{ color: "var(--dim)", fontSize: 12, marginTop: 2, lineHeight: 1.5 }}>{v}</div></div></div>)}
              </div>
            </div>
          )}
        </>
      )}

      {log.length > 0 && (
        <section className="card" style={{ marginTop: 12 }}>
          <div className="kicker">activity</div>
          <div className="log" ref={logRef} style={{ marginTop: 8 }}>{log.map((l, i) => <div key={i}>{l}</div>)}</div>
        </section>
      )}
    </main>
  );
}
