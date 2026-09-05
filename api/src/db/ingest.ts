/**
 * Chain log → platform state (API FRD FR-API-070..073, FR-API-050/051, FR-API-107).
 *
 * `ingestChainEvent` runs one transaction per log: insert the `chain_events` row (the
 * idempotency key), find the Subscription for the stream, apply the FR-API-071 mapping,
 * write ledger rows, invoices and merchant Events with their delivery jobs. A duplicate
 * log is acknowledged and does nothing else; a log for an address we did not create is
 * stored and ignored (FR-API-072). Status is derived only from chain events (BR-API-005).
 */
import type { SQL } from "bun";
import { sql } from "./client";
import { newId } from "../lib/ids";
import { createEvent } from "./events";
import { insertInvoice, serializeInvoice } from "./invoices";
import { findSubscriptionForLog, serializeSubscription, type SubscriptionRow } from "./subscriptions";

export type LedgerKind = "deposit" | "settlement" | "fee" | "refund";
export interface IngestBody {
  chain_id: number;
  block_number: number;
  block_hash: string;
  block_timestamp: number;
  tx_hash: string;
  log_index: number;
  address: string;
  event_name: string;
  args: Record<string, string>;
  ledger: Array<{ kind: LedgerKind; amount: string; from: string; to: string }>;
}

export type IngestResult =
  | { duplicate: true }
  | { duplicate: false; ignored: true }
  | { duplicate: false; subscription: string; events: string[] };

export class ModeMismatch extends Error {
  constructor(public readonly subscriptionId: string) {
    super("Chain id does not match the subscription's mode.");
  }
}

export async function ingestChainEvent(body: IngestBody): Promise<IngestResult> {
  return sql.begin(async (tx) => {
    const address = body.address.toLowerCase();
    const txHash = body.tx_hash.toLowerCase();
    const [inserted] = await tx`
      INSERT INTO chain_events (chain_id, block_number, block_hash, block_timestamp, tx_hash, log_index, address, event_name, args, ledger)
      VALUES (${body.chain_id}, ${body.block_number}, ${body.block_hash.toLowerCase()}, ${body.block_timestamp}, ${txHash}, ${body.log_index},
              ${address}, ${body.event_name}, ${body.args}, ${body.ledger})
      ON CONFLICT (chain_id, tx_hash, log_index) DO NOTHING
      RETURNING id`;
    if (!inserted) return { duplicate: true };
    const chainEventId = Number(inserted.id);

    // StreamCreated is emitted by the factory; the stream it names is in args.
    const streamAddress = body.event_name === "StreamCreated" ? (body.args.stream ?? "").toLowerCase() : address;
    const sub = streamAddress ? await findSubscriptionForLog(body.chain_id, streamAddress, txHash, tx) : null;
    if (!sub) return { duplicate: false, ignored: true };
    if (sub.livemode !== (body.chain_id === 143)) throw new ModeMismatch(sub.id);

    await tx`UPDATE chain_events SET subscription_id = ${sub.id} WHERE id = ${chainEventId}`;
    const events = await applyLog(tx, sub, body, chainEventId);
    return { duplicate: false, subscription: sub.id, events };
  });
}

const big = (s: string | undefined): bigint => BigInt(s ?? "0");
const int = (s: string | undefined): number => Number(s ?? "0");

async function applyLog(tx: SQL, sub: SubscriptionRow, body: IngestBody, chainEventId: number): Promise<string[]> {
  const a = body.args;
  const ts = body.block_timestamp;
  const eventIds: string[] = [];
  const emit = async (type: Parameters<typeof createEvent>[0]["type"], object: Record<string, unknown>) => {
    const ev = await createEvent({ merchantId: sub.merchant_id, livemode: sub.livemode, type, object, chainEventId, tx });
    eventIds.push(ev.id);
  };
  const reload = async (): Promise<SubscriptionRow> => (await findSubscriptionForLog(sub.chain_id, sub.stream_address ?? body.args.stream ?? "", body.tx_hash, tx))!;

  switch (body.event_name) {
    case "StreamCreated": {
      await tx`UPDATE subscriptions SET stream_address = ${(a.stream ?? "").toLowerCase()}, updated_at = now() WHERE id = ${sub.id}`;
      break;
    }
    case "Deposited": {
      await tx`UPDATE subscriptions SET funded_wei = ${big(a.totalDeposited).toString()}::numeric, updated_at = now() WHERE id = ${sub.id}`;
      break;
    }
    case "StreamStarted": {
      await tx`UPDATE subscriptions SET status = 'active', started_at = to_timestamp(${int(a.startedAt)}), updated_at = now() WHERE id = ${sub.id}`;
      if (sub.checkout_session_id) {
        await tx`UPDATE checkout_sessions SET status = 'complete', subscription_id = ${sub.id}, customer_id = ${sub.customer_id}, updated_at = now()
                 WHERE id = ${sub.checkout_session_id}`;
        await emit("checkout.session.completed", {
          id: sub.checkout_session_id,
          object: "checkout.session",
          status: "complete",
          subscription: sub.id,
          customer: sub.customer_id,
          product: sub.product_id,
          livemode: sub.livemode,
        });
      }
      await emit("subscription.created", serializeSubscription(await reload(), ts));
      break;
    }
    case "StreamPaused": {
      await tx`UPDATE subscriptions SET status = 'paused', paused_at = to_timestamp(${int(a.at)}), updated_at = now() WHERE id = ${sub.id}`;
      await emit("subscription.updated", serializeSubscription(await reload(), ts));
      break;
    }
    case "StreamResumed": {
      const pausedFor = sub.paused_at ? Math.max(0, int(a.at) - Math.floor(sub.paused_at.getTime() / 1000)) : 0;
      await tx`UPDATE subscriptions SET status = 'active', paused_at = NULL, paused_seconds = paused_seconds + ${pausedFor}, updated_at = now() WHERE id = ${sub.id}`;
      await emit("subscription.updated", serializeSubscription(await reload(), ts));
      break;
    }
    case "Settled": {
      const seconds = int(a.seconds);
      const amount = big(a.amount);
      const fee = big(a.fee);
      await tx`UPDATE subscriptions
               SET settled_wei = settled_wei + ${amount.toString()}::numeric, settled_fee_wei = settled_fee_wei + ${fee.toString()}::numeric,
                   settled_seconds = settled_seconds + ${seconds}, updated_at = now()
               WHERE id = ${sub.id}`;
      const invoice = await insertInvoice(
        {
          merchantId: sub.merchant_id, livemode: sub.livemode, subscriptionId: sub.id, customerId: sub.customer_id,
          periodStart: ts - seconds, periodEnd: ts, seconds, amountWei: amount, feeWei: fee, status: "paid",
          txHash: body.tx_hash.toLowerCase(), logIndex: body.log_index, chainEventId,
        },
        tx,
      );
      await emit("invoice.settled", serializeInvoice(invoice));
      break;
    }
    case "StreamCanceled": {
      const secondsElapsed = int(a.secondsElapsed);
      const capReached = secondsElapsed >= sub.max_duration_seconds;
      const reason = capReached ? "cap_reached" : "canceled";
      await tx`UPDATE subscriptions
               SET status = 'canceled', ended_reason = ${reason}, canceled_at = to_timestamp(${int(a.at)}), paused_at = NULL,
                   settled_seconds = ${secondsElapsed}, settled_wei = ${big(a.amountSettled).toString()}::numeric, updated_at = now()
               WHERE id = ${sub.id}`;
      const after = await reload();
      if (capReached) {
        // FR-API-051: a cap end anchors `invoice.payment_failed` on a zero invoice, then cancels (William, 2026-09-04).
        const failed = await insertInvoice(
          {
            merchantId: sub.merchant_id, livemode: sub.livemode, subscriptionId: sub.id, customerId: sub.customer_id,
            periodStart: ts, periodEnd: ts, seconds: 0, amountWei: 0n, feeWei: 0n, status: "failed",
            txHash: body.tx_hash.toLowerCase(), logIndex: body.log_index, chainEventId,
          },
          tx,
        );
        await emit("invoice.payment_failed", serializeInvoice(failed));
        await tx`INSERT INTO notifications (id, merchant_id, livemode, kind, summary, target_id)
                 VALUES (${newId("ntf")}, ${sub.merchant_id}, ${sub.livemode}, 'payment_failed',
                         ${`Subscription ${sub.id} reached its cap after ${secondsElapsed} seconds and ended.`}, ${sub.id})`;
      }
      await emit("subscription.canceled", serializeSubscription(after, ts));
      break;
    }
    default:
      break; // FeeChanged and anything new: stored in chain_events, no subscription effect.
  }

  for (const row of body.ledger) {
    await tx`INSERT INTO ledger_entries (id, merchant_id, livemode, kind, amount_wei, from_address, to_address, subscription_id, customer_id,
                                         chain_id, tx_hash, log_index, block_hash, block_timestamp, chain_event_id)
             VALUES (${newId("led")}, ${sub.merchant_id}, ${sub.livemode}, ${row.kind}, ${BigInt(row.amount).toString()}::numeric,
                     ${row.from.toLowerCase()}, ${row.to.toLowerCase()}, ${sub.id}, ${sub.customer_id},
                     ${body.chain_id}, ${body.tx_hash.toLowerCase()}, ${body.log_index}, ${body.block_hash.toLowerCase()}, ${ts}, ${chainEventId})
             ON CONFLICT (chain_id, tx_hash, log_index, kind, block_hash) DO NOTHING`;
  }
  return eventIds;
}
