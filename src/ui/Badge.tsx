import { type HTMLAttributes } from "react";
import clsx from "clsx";

export const statusLabels: Record<string, string> = { active: "活跃", blocked: "已禁用", revoked: "已下线", used: "已使用", enabled: "已启用", disabled: "已停用", suspended: "已暂停", unbound: "已解绑", allow: "允许", deny: "拒绝", info: "信息", warning: "警告", critical: "严重", unused: "未使用", pending: "待审核", approved: "已通过", rejected: "已拒绝" };

export function Badge({ children, className, tone = "neutral", ...props }: HTMLAttributes<HTMLSpanElement> & { tone?: "neutral" | "accent" | "success" | "warning" | "danger" }) {
  return <span {...props} className={clsx("la-badge", `la-badge--${tone}`, className)}>{children}</span>;
}

export function StatusBadge({ status, label }: { status: string; label?: string }) {
  const tone = ["active", "approved", "enabled", "unused", "allow"].includes(status) ? "success" : ["pending", "warning"].includes(status) ? "warning" : ["blocked", "disabled", "rejected", "critical", "deny", "revoked"].includes(status) ? "danger" : "accent";
  return <Badge className={clsx("control-status", `status-${status}`)} tone={tone}>{label || statusLabels[status] || status}</Badge>;
}
