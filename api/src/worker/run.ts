import { attemptDelivery, type DeliveryLogger } from "./deliver";
import { claimDue } from "./queue";

export interface RunOptions {
  batch: number;
  concurrency: number;
  timeoutMs: number;
  log: DeliveryLogger;
}

/** One poll: claim a batch, run attempts `concurrency` at a time, return counts. */
export async function runOnce(o: RunOptions): Promise<{ claimed: number; succeeded: number; failed: number; skipped: number }> {
  const jobs = await claimDue(o.batch);
  const counts = { claimed: jobs.length, succeeded: 0, failed: 0, skipped: 0 };
  let i = 0;
  const workers = Array.from({ length: Math.min(o.concurrency, jobs.length) }, async () => {
    while (i < jobs.length) {
      const job = jobs[i++]!;
      try {
        const { status } = await attemptDelivery(job, { timeoutMs: o.timeoutMs, now: () => new Date(), log: o.log });
        if (status === "succeeded") counts.succeeded++;
        else if (status === "skipped") counts.skipped++;
        else counts.failed++;
      } catch (e) {
        // The lock expires in 60 s and another poll picks the row up (FR-WRK-015).
        console.error("attempt crashed", { delivery_id: job.id, message: (e as Error).message });
        counts.failed++;
      }
    }
  });
  await Promise.all(workers);
  return counts;
}

/** FR-WRK-010: poll every 500 ms while busy, back off to 2 s when idle. */
export async function runForever(o: RunOptions, signal?: AbortSignal): Promise<void> {
  let idle = 0;
  while (!signal?.aborted) {
    const r = await runOnce(o);
    idle = r.claimed === 0 ? Math.min(idle + 1, 4) : 0;
    await Bun.sleep(idle === 0 ? 500 : 500 * idle);
  }
}
