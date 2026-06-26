// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Andreas Bergstedt
//
// Branch A - Admin Mode: shared confirmation dialog used by every slice so all
// write actions follow the same explicit confirm pattern.

import type { ReactNode } from "react";

interface ConfirmDialogProps {
  title: string;
  confirmLabel?: string;
  cancelLabel?: string;
  busy?: boolean;
  onConfirm(): void;
  onCancel(): void;
  children?: ReactNode;
}

export function ConfirmDialog({
  title,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  busy = false,
  onConfirm,
  onCancel,
  children,
}: ConfirmDialogProps) {
  return (
    <div className="admin-dialog-backdrop">
      <div
        className="admin-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <h3 className="admin-dialog__title">{title}</h3>
        <div className="admin-dialog__content">{children}</div>
        <div className="admin-dialog__actions">
          <button className="secondary" onClick={onCancel} disabled={busy}>
            {cancelLabel}
          </button>
          <button onClick={onConfirm} disabled={busy}>
            {busy ? "Working…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
