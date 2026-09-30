import {
  forwardRef,
  type InputHTMLAttributes,
  type LabelHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";
import clsx from "clsx";

export type FieldProps = LabelHTMLAttributes<HTMLLabelElement> & {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  required?: boolean;
};

export function Field({ children, className, error, hint, label, required = false, ...props }: FieldProps) {
  return (
    <label {...props} className={clsx("la-field", className)}>
      <span className="la-field__label">
        {label}
        {required ? <span className="la-field__required">*</span> : null}
      </span>
      {children}
      {error ? (
        <span className="la-field__error">{error}</span>
      ) : hint ? (
        <span className="la-field__hint">{hint}</span>
      ) : null}
    </label>
  );
}

export const TextInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function TextInput(
  { className, ...props },
  ref,
) {
  return <input {...props} className={clsx("la-input", className)} ref={ref} />;
});

export const NativeSelect = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function NativeSelect(
  { className, ...props },
  ref,
) {
  return <select {...props} className={clsx("la-input la-select", className)} ref={ref} />;
});

export const TextArea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function TextArea(
  { className, ...props },
  ref,
) {
  return <textarea {...props} className={clsx("la-input la-textarea", className)} ref={ref} />;
});

export function Checkbox({
  children,
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { children?: ReactNode }) {
  return (
    <label className={clsx("la-checkbox", className)}>
      <input {...props} type="checkbox" />
      {children ? <span>{children}</span> : null}
    </label>
  );
}
