import * as React from "react";
import { Inbox } from "lucide-react";
import clsx from "clsx";

export type EmptyProps = React.HTMLAttributes<HTMLDivElement> & {
  icon?: React.ReactNode;
  title?: React.ReactNode;
  detail?: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
};

export function Empty({
  className,
  icon,
  title = "暂无数据",
  detail,
  description,
  action,
  children,
  ...props
}: EmptyProps) {
  const desc = description ?? detail ?? (title === "暂无数据" ? "调整筛选条件或刷新后重试" : undefined);

  return (
    <div className={clsx("la-empty control-empty", className)} {...props}>
      <div className="la-empty__icon">
        {icon || <Inbox className="la-empty__default-icon" />}
      </div>
      {title ? <h4 className="la-empty__title">{title}</h4> : null}
      {desc ? <p className="la-empty__description">{desc}</p> : null}
      {action ? <div className="la-empty__action">{action}</div> : null}
      {children}
    </div>
  );
}

export const EmptyState = Empty;
