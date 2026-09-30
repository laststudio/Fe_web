import * as DialogPrimitive from "@radix-ui/react-dialog";
import { CircleAlert, X } from "lucide-react";
import { type CSSProperties, type ReactNode } from "react";
import clsx from "clsx";
import { Button } from "./Button";

export type DialogProps = {
  title: string;
  children: ReactNode;
  onClose: () => void;
  width?: number;
  className?: string;
  overlayClassName?: string;
};

export function Dialog({ children, className, onClose, overlayClassName, title, width }: DialogProps) {
  const style = width ? ({ "--la-dialog-width": `${width}px` } as CSSProperties) : undefined;
  return (
    <DialogPrimitive.Root open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className={clsx("la-dialog-overlay", "control-dialog-layer", overlayClassName)} />
        <DialogPrimitive.Content
          className={clsx("la-dialog", "control-dialog", className)}
          onOpenAutoFocus={(event) => {
            const target = (event.currentTarget as HTMLElement).querySelector<HTMLElement>("[data-autofocus]");
            if (!target) return;
            event.preventDefault();
            target.focus();
          }}
          style={style}
        >
          <header className="la-dialog__header">
            <DialogPrimitive.Title>{title}</DialogPrimitive.Title>
            <DialogPrimitive.Close aria-label="关闭" className="la-dialog__close"><X size={18} /></DialogPrimitive.Close>
          </header>
          {children}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

export function DialogActions({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={clsx("la-dialog__actions", "control-dialog-actions", className)}>{children}</div>;
}

export function ConfirmDialog({ title, message, confirmLabel, danger = true, submitting = false, onClose, onConfirm }: { title: string; message: ReactNode; confirmLabel: string; danger?: boolean; submitting?: boolean; onClose: () => void; onConfirm: () => void }) {
  return <Dialog onClose={submitting ? ignoreClose : onClose} title={title}><div className="control-form control-confirm-form"><div className="control-confirm"><span className="control-confirm-icon"><CircleAlert size={22} /></span><p>{message}</p></div><DialogActions><Button data-autofocus disabled={submitting} onClick={onClose}>取消</Button><Button className={danger ? "is-danger" : "is-primary"} loading={submitting} loadingLabel="处理中..." onClick={onConfirm} variant={danger ? "danger" : "primary"}>{confirmLabel}</Button></DialogActions></div></Dialog>;
}

export function ignoreClose() {}
