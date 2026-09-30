import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { Slot } from "@radix-ui/react-slot";
import { LoaderCircle } from "lucide-react";
import clsx from "clsx";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "link";
export type ButtonSize = "sm" | "md" | "lg";

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  loadingLabel?: string;
  icon?: ReactNode;
  asChild?: boolean;
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    asChild = false,
    children,
    className,
    disabled,
    icon,
    loading = false,
    loadingLabel,
    size = "md",
    type = "button",
    variant = "secondary",
    ...props
  },
  ref,
) {
  const Comp = asChild ? Slot : "button";
  const buttonType = asChild ? undefined : type;

  return (
    <Comp
      {...props}
      className={clsx("la-button", `la-button--${variant}`, `la-button--${size}`, className)}
      disabled={disabled || loading}
      ref={ref}
      type={buttonType}
    >
      {loading ? <LoaderCircle aria-hidden="true" className="la-spinner" /> : icon}
      {loading && loadingLabel ? loadingLabel : children}
    </Comp>
  );
});
