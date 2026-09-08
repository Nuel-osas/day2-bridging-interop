export const metadata = { title: "ika wallet: one login, every chain" };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet" />
        <style>{`
          :root { --bg:#000; --fg:#f4f4f5; --mute:#a1a1aa; --dim:#71717a; --line:#27272a; --panel:#09090b; --panel2:#111113; }
          * { box-sizing: border-box; }
          body { margin:0; background:var(--bg); color:var(--fg); font-family:"JetBrains Mono", ui-monospace, Menlo, monospace; font-size:14px; -webkit-font-smoothing:antialiased; }
          a { color:var(--fg); }
          input { font-family:inherit; }
          button { font-family:inherit; cursor:pointer; }
          button:disabled { opacity:.45; cursor:not-allowed; }
          .btn { background:var(--fg); color:#000; border:1px solid var(--fg); border-radius:8px; padding:10px 14px; font-size:13px; font-weight:500; }
          .btn.ghost { background:transparent; color:var(--fg); border-color:var(--line); }
          .btn.ghost:hover { border-color:var(--mute); }
          .input { background:var(--panel); color:var(--fg); border:1px solid var(--line); border-radius:8px; padding:10px 12px; font-size:13px; width:100%; outline:none; }
          .input:focus { border-color:var(--mute); }
          .card { background:var(--panel); border:1px solid var(--line); border-radius:12px; padding:18px; }
          .kicker { font-size:11px; letter-spacing:.22em; text-transform:uppercase; color:var(--dim); }
          .addr { word-break:break-all; font-size:12.5px; color:var(--fg); }
          .row { display:flex; gap:8px; align-items:center; }
          .grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(280px,1fr)); gap:12px; }
          .step { display:flex; gap:12px; align-items:flex-start; padding:10px 0; border-top:1px solid var(--line); }
          .step:first-child { border-top:0; }
          .dot { width:18px; height:18px; border-radius:999px; border:1px solid var(--line); display:grid; place-items:center; font-size:10px; flex:none; margin-top:1px; }
          .dot.done { background:var(--fg); color:#000; border-color:var(--fg); }
          .dot.live { border-color:var(--fg); animation:pulse 1.2s infinite; }
          @keyframes pulse { 0%,100%{ box-shadow:0 0 0 0 rgba(244,244,245,.35)} 50%{ box-shadow:0 0 0 6px rgba(244,244,245,0)} }
          .log { font-size:12px; color:var(--mute); max-height:220px; overflow:auto; }
          .tab { padding:8px 12px; border-radius:8px; border:1px solid transparent; background:transparent; color:var(--mute); font-size:13px; }
          .tab.on { border-color:var(--line); color:var(--fg); background:var(--panel2); }
          hr { border:0; border-top:1px solid var(--line); margin:14px 0; }
        `}</style>
      </head>
      <body>{children}</body>
    </html>
  );
}
