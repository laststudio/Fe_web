// Design Tokens & Component Stylesheets
import "./tokens.css";
import "./button.css";
import "./field.css";
import "./input.css";
import "./select.css";
import "./tabs.css";
import "./card.css";
import "./dropdown-menu.css";
import "./tooltip.css";
import "./table.css";
import "./dialog.css";
import "./feedback.css";
import "./badge.css";
import "./switch.css";
import "./toast.css";
import "./misc.css";

// Utilities
export { clsx as cx } from "clsx";

// Components
export * from "./Badge";
export * from "./Button";
export * from "./Card";
export * from "./Dialog";
export * from "./DropdownMenu";
export * from "./Empty";
export * from "./Feedback";
export * from "./Field";
export * from "./Input";
export * from "./Select";
export * from "./Skeleton";
export * from "./Switch";
export * from "./Table";
export * from "./Tabs";
export * from "./Toast";
export * from "./Tooltip";

export function formatDate(value?: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat("zh-CN", {
        dateStyle: "medium",
        timeStyle: "short",
        hour12: false,
      }).format(date);
}
