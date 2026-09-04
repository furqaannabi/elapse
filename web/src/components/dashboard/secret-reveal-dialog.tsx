/**
 * `SecretRevealDialog` — shows a freshly created secret exactly once.
 * The value is set in numerals with a copy control and a plain warning;
 * closing it is an explicit "I have saved it". Nothing about the secret
 * is stored by the dialog.
 *
 * Maps to: FR-DSH-071, FR-DSH-081; BR-DSH-001.
 */
"use client";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { CopyButton } from "@/components/site/copy-button";

export function SecretRevealDialog({
  secret,
  title,
  description,
  onClose,
}: {
  secret: string | null;
  title: string;
  description: string;
  onClose: () => void;
}) {
  return (
    <Dialog
      open={secret !== null}
      disablePointerDismissal
      onOpenChange={(open, details) => {
        if (open) return;
        // Only the explicit acknowledgment closes it (BR-DSH-001).
        if (details.reason === "escape-key" || details.reason === "outside-press") {
          details.cancel();
          return;
        }
        onClose();
      }}
    >
      <DialogContent showCloseButton={false} className="md:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-2 rounded-lg border border-border bg-card pl-3">
          <code data-testid="secret-key" className="numerals min-w-0 flex-1 break-all py-2.5 text-[13px]">
            {secret}
          </code>
          <CopyButton text={secret ?? ""} label="Copy key" />
        </div>
        <p className="text-[13px] text-caution">Store it now. It won&apos;t be shown again.</p>
        <DialogFooter>
          <Button onClick={onClose} className="h-9 w-full sm:w-auto">
            I have saved it
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
