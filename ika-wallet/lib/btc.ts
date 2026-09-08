// Bitcoin testnet3 balance for a P2WPKH address. Two public indexers, first that answers wins.
export async function btcBalance(address: string) {
  const urls = [`https://blockstream.info/testnet/api/address/${address}`, `https://mempool.space/testnet/api/address/${address}`];
  for (const u of urls) {
    try { const r = await fetch(u, { signal: AbortSignal.timeout(8000) }); if (!r.ok) continue; const j: any = await r.json(); const s = j.chain_stats; return ((s.funded_txo_sum - s.spent_txo_sum) / 1e8).toFixed(8); } catch {}
  }
  return "n/a";
}
