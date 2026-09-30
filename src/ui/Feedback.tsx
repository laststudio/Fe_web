import { LoaderCircle, type LucideIcon } from "lucide-react";
import clsx from "clsx";

export { Empty, EmptyState, type EmptyProps } from "./Empty";

export function Spinner({ label = "正在加载", className }: { label?: string; className?: string }) {
  return (
    <div className={clsx("la-loading control-loading", className)}>
      <LoaderCircle className="la-spinner is-spinning" size={20} />
      <span>{label}</span>
    </div>
  );
}

export function Loading({ label = "正在加载", icon: Icon = LoaderCircle, className }: { label?: string; icon?: LucideIcon; className?: string }) {
  return (
    <div className={clsx("la-loading", className)}>
      <Icon className="la-spinner is-spinning" size={20} />
      <span>{label}</span>
    </div>
  );
}
