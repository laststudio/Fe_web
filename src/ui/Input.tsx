import { forwardRef, type InputHTMLAttributes, type ReactNode } from "react";
import clsx from "clsx";

export type InputSize = "sm" | "md" | "lg";

export type InputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "size"> & {
  size?: InputSize;
  invalid?: boolean;
  leftSection?: ReactNode;
  rightSection?: ReactNode;
};

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, disabled, invalid = false, leftSection, rightSection, size = "md", type = "text", ...props },
  ref,
) {
  if (leftSection || rightSection) {
    return (
      <div
        className={clsx(
          "la-input-wrapper",
          `la-input-wrapper--${size}`,
          invalid && "la-input-wrapper--invalid",
          disabled && "la-input-wrapper--disabled",
          className,
        )}
      >
        {leftSection ? <span className="la-input-section la-input-section--left">{leftSection}</span> : null}
        <input
          {...props}
          className="la-input-inner"
          disabled={disabled}
          ref={ref}
          type={type}
        />
        {rightSection ? <span className="la-input-section la-input-section--right">{rightSection}</span> : null}
      </div>
    );
  }

  return (
    <input
      {...props}
      className={clsx(
        "la-input",
        `la-input--${size}`,
        invalid && "la-input--invalid",
        className,
      )}
      disabled={disabled}
      ref={ref}
      type={type}
    />
  );
});
