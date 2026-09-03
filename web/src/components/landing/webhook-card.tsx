/**
 * `WebhookCard` — the `subscription.canceled` event the merchant's server
 * receives. At rest it shows the canonical demo (83 seconds, $0.33),
 * labelled as such; after the visitor cancels it carries their numbers.
 *
 * This is the product's hero artifact: the payload shape is the real one
 * from the detailed doc §5.3. Ids are synthetic and labelled.
 *
 * @param secondsElapsed - Whole seconds from the meter.
 * @param amountSettled - Amount without symbol, e.g. "0.33".
 * @param createdAt - Epoch seconds for the `created` field.
 * @param demo - True when showing the canonical example rather than the visitor's run.
 */
import { CodeBlock } from "@/components/site/code-block";

export function buildCanceledEvent({
  secondsElapsed,
  amountSettled,
  createdAt,
}: {
  secondsElapsed: number;
  amountSettled: string;
  createdAt: number;
}) {
  return `{
  "id": "evt_1S2xq7Kd3",
  "object": "event",
  "type": "subscription.canceled",
  "created": ${createdAt},
  "data": {
    "object": {
      "id": "sub_1S2xq6Hf9",
      "status": "canceled",
      "seconds_elapsed": ${secondsElapsed},
      "amount_settled": "${amountSettled}",
      "currency": "usd",
      "product": "prod_gpu4090",
      "customer": "cus_7Qw2m"
    }
  }
}`;
}

export function WebhookCard({
  demo = false,
  ...props
}: {
  secondsElapsed: number;
  amountSettled: string;
  createdAt: number;
  demo?: boolean;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="placard">
          POST /webhooks · your server{demo ? " · example" : ""}
        </span>
        <span className="placard text-live">200 OK</span>
      </div>
      <CodeBlock
        lang="json"
        title="X-Elapse-Signature: t=1756800083,v1=9f2c…"
        code={buildCanceledEvent(props)}
      />
    </div>
  );
}
