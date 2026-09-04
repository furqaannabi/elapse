/**
 * The three key dialogs: create (name), roll (grace period), revoke
 * (confirm naming the key). Each returns the merchant's intent; the page
 * does the API call with an idempotency key.
 *
 * Maps to: FR-DSH-071, FR-DSH-072, FR-DSH-073; BR-DSH-010.
 */
"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ApiKey } from "@/lib/dashboard/types";
import { GRACE_OPTIONS, GraceRadios } from "./grace-radios";

export function CreateKeyDialog({ open, onCancel, onCreate, busy }: { open: boolean; onCancel: () => void; onCreate: (name: string) => void; busy: boolean }) {
  const [name, setName] = useState("");
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) onCreate(name.trim());
          }}
          className="contents"
        >
          <DialogHeader>
            <DialogTitle>Create secret key</DialogTitle>
            <DialogDescription>Name it after where it lives. The key is shown once.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="key-name">Name</Label>
            <Input id="key-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Production server" autoFocus className="h-10" />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onCancel} className="h-9">
              Cancel
            </Button>
            <Button type="submit" disabled={busy || !name.trim()} className="h-9">
              {busy ? "Creating…" : "Create key"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function RollKeyDialog({ target, onCancel, onRoll, busy }: { target: ApiKey | null; onCancel: () => void; onRoll: (graceMs: number) => void; busy: boolean }) {
  const [grace, setGrace] = useState<number>(GRACE_OPTIONS[2].ms);
  return (
    <Dialog open={target !== null} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Roll “{target?.name}”</DialogTitle>
          <DialogDescription>
            You get a new key with the same name. Choose when the old one, <span className="numerals">{target?.prefix}…{target?.last4}</span>, stops working.
          </DialogDescription>
        </DialogHeader>
        <GraceRadios value={grace} onChange={setGrace} />
        <DialogFooter>
          <Button variant="outline" onClick={onCancel} className="h-9">
            Cancel
          </Button>
          <Button onClick={() => onRoll(grace)} disabled={busy} className="h-9">
            {busy ? "Rolling…" : "Roll key"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function RevokeKeyDialog({ target, onCancel, onRevoke, busy }: { target: ApiKey | null; onCancel: () => void; onRevoke: () => void; busy: boolean }) {
  return (
    <Dialog open={target !== null} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Revoke “{target?.name}”?</DialogTitle>
          <DialogDescription>
            Requests signed with <span className="numerals">{target?.prefix}…{target?.last4}</span> fail from now on. The row stays in this list for your records.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel} className="h-9">
            Cancel
          </Button>
          <Button variant="destructive" onClick={onRevoke} disabled={busy} className="h-9">
            {busy ? "Revoking…" : "Revoke key"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
