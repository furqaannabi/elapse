/**
 * Webhook endpoint dialogs: add / edit (url + event picker), send test
 * event (type picker), roll signing secret (grace period).
 *
 * Maps to: FR-DSH-081, FR-DSH-082; BR-DSH-010.
 */
"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { EVENT_TYPES, type EventType, type WebhookEndpoint } from "@/lib/dashboard/types";
import { cn } from "@/lib/utils";
import { CheckBox } from "./check-box";
import { GRACE_OPTIONS, GraceRadios } from "./grace-radios";

export type EndpointForm = { url: string; events: EventType[] | "*" };

export function EndpointFormDialog({
  open,
  initial,
  title,
  submitLabel,
  error,
  busy,
  onCancel,
  onSubmit,
}: {
  open: boolean;
  initial?: EndpointForm;
  title: string;
  submitLabel: string;
  error: string | null;
  busy: boolean;
  onCancel: () => void;
  onSubmit: (form: EndpointForm) => void;
}) {
  const [url, setUrl] = useState(initial?.url ?? "");
  const [all, setAll] = useState(initial ? initial.events === "*" : true);
  const [picked, setPicked] = useState<EventType[]>(initial && initial.events !== "*" ? initial.events : []);
  const toggle = (t: EventType) => setPicked((p) => (p.includes(t) ? p.filter((x) => x !== t) : [...p, t]));

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent className="md:max-w-md">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onSubmit({ url: url.trim(), events: all ? "*" : picked });
          }}
          className="contents"
          noValidate
        >
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>We POST signed JSON here for the events you pick. Lifecycle events only, never per second.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="endpoint-url">Endpoint URL</Label>
            <Input
              id="endpoint-url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://your.app/webhooks/elapse"
              inputMode="url"
              spellCheck={false}
              autoFocus
              aria-invalid={error ? true : undefined}
              className="numerals h-10 text-[13px]"
            />
            {error && (
              <p role="alert" className="text-[13px] text-caution">
                {error}
              </p>
            )}
          </div>
          <fieldset className="flex flex-col gap-1.5">
            <legend className="text-sm font-medium">Events</legend>
            <label className="flex min-h-11 cursor-pointer items-center gap-2.5 py-1 text-[14px] md:min-h-8">
              <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} className="peer sr-only" />
              <CheckBox checked={all} />
              All events
            </label>
            <div className={cn("grid gap-0.5 pl-6", all && "opacity-50")}>
              {EVENT_TYPES.map((t) => (
                <label key={t} className={cn("flex min-h-10 items-center gap-2.5 py-0.5 md:min-h-7", all ? "cursor-default" : "cursor-pointer")}>
                  <input type="checkbox" disabled={all} checked={all || picked.includes(t)} onChange={() => toggle(t)} className="peer sr-only" />
                  <CheckBox checked={all || picked.includes(t)} />
                  <span className="numerals text-[13px]">{t}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onCancel} className="h-9">
              Cancel
            </Button>
            <Button type="submit" disabled={busy} className="h-9">
              {busy ? "Saving…" : submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function TestEventDialog({ open, busy, onCancel, onSend }: { open: boolean; busy: boolean; onCancel: () => void; onSend: (type: EventType) => void }) {
  const [type, setType] = useState<EventType>("subscription.canceled");
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Send test event</DialogTitle>
          <DialogDescription>A synthetic event delivered through the normal path, signed with this endpoint&apos;s secret.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="test-event-type">Event type</Label>
          <select
            id="test-event-type"
            value={type}
            onChange={(e) => setType(e.target.value as EventType)}
            className="numerals h-10 rounded-lg border border-input bg-transparent px-2.5 text-[13px] outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
          >
            {EVENT_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel} className="h-9">
            Cancel
          </Button>
          <Button onClick={() => onSend(type)} disabled={busy} className="h-9">
            {busy ? "Sending…" : "Send"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function RollSecretDialog({ target, busy, onCancel, onRoll }: { target: WebhookEndpoint | null; busy: boolean; onCancel: () => void; onRoll: (graceMs: number) => void }) {
  const [grace, setGrace] = useState<number>(GRACE_OPTIONS[2].ms);
  return (
    <Dialog open={target !== null} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Roll signing secret</DialogTitle>
          <DialogDescription>
            We sign with both secrets until the old one expires, so your handler can switch without dropping an event.
          </DialogDescription>
        </DialogHeader>
        <GraceRadios value={grace} onChange={setGrace} name="secret-grace" />
        <DialogFooter>
          <Button variant="outline" onClick={onCancel} className="h-9">
            Cancel
          </Button>
          <Button onClick={() => onRoll(grace)} disabled={busy} className="h-9">
            {busy ? "Rolling…" : "Roll secret"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
