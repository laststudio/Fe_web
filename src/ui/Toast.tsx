import * as ToastPrimitive from "@radix-ui/react-toast";
import { CheckCircle2, CircleAlert, Info, X } from "lucide-react";
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

type ToastKind = "success" | "error" | "info";
type ToastItem = { id: number; kind: ToastKind; title: string; description?: string };
type ToastApi = { success: (title: string, description?: string) => void; error: (title: string, description?: string) => void; info: (title: string, description?: string) => void };
const ToastContext = createContext<ToastApi>({ success: () => {}, error: () => {}, info: () => {} });

export function useToast() { return useContext(ToastContext); }

const toastIcons: Record<ToastKind, ReactNode> = { success: <CheckCircle2 size={17} />, error: <CircleAlert size={17} />, info: <Info size={17} /> };

export function ToastHost({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const open = useCallback((kind: ToastKind, title: string, description?: string) => {
    const id = Date.now() + Math.random();
    setItems((current) => [...current.slice(-3), { id, kind, title, description }]);
  }, []);
  const api = useMemo<ToastApi>(() => ({ success: (title, description) => open("success", title, description), error: (title, description) => open("error", title, description), info: (title, description) => open("info", title, description) }), [open]);
  return <ToastContext.Provider value={api}><ToastPrimitive.Provider swipeDirection="right" duration={4000}>{children}{items.map((item) => <ToastPrimitive.Root key={item.id} className={`la-toast admin-toast is-${item.kind}`} duration={item.kind === "error" ? 7000 : 3200} onOpenChange={(isOpen: boolean) => { if (!isOpen) setItems((current) => current.filter((entry) => entry.id !== item.id)); }}><span className="admin-toast-icon">{toastIcons[item.kind]}</span><div className="admin-toast-body"><ToastPrimitive.Title>{item.title}</ToastPrimitive.Title>{item.description ? <ToastPrimitive.Description>{item.description}</ToastPrimitive.Description> : null}</div><ToastPrimitive.Close aria-label="关闭"><X size={15} /></ToastPrimitive.Close></ToastPrimitive.Root>)}<ToastPrimitive.Viewport className="admin-toast-viewport" /></ToastPrimitive.Provider></ToastContext.Provider>;
}
