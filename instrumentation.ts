// Next.js server-startup hook (runs once per server process, both `next
// dev` and `next start`). Used only to start the local-development
// source-ingestion poll loop — see lib/ingestion/poll.ts.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startIngestionPolling } = await import("@/lib/ingestion/poll");
    const intervalMs = Number(process.env.INGESTION_POLL_INTERVAL_MS) || 60_000;
    startIngestionPolling(intervalMs);
  }
}
