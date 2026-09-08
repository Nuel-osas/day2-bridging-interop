// NDJSON streaming for long server flows: each step is written the moment it happens,
// so the browser log shows real timestamps instead of a batch at the end.
export function ndjson(run: (emit: (obj: any) => void) => Promise<any>) {
  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const emit = (obj: any) => controller.enqueue(enc.encode(JSON.stringify(obj) + "\n"));
      const t0 = Date.now();
      try { const result = await run((o) => emit({ t: Date.now() - t0, ...o })); emit({ t: Date.now() - t0, done: true, ...result }); }
      catch (e: any) { emit({ t: Date.now() - t0, done: true, error: [e?.shortMessage ?? e?.message ?? String(e), e?.details ?? e?.cause?.details ?? ""].filter(Boolean).join(": ") }); }
      finally { controller.close(); }
    },
  });
  return new Response(stream, { headers: { "content-type": "application/x-ndjson", "cache-control": "no-cache", "x-accel-buffering": "no" } });
}
