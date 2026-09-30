import * as SwitchPrimitive from "@radix-ui/react-switch";

type SwitchProps = { checked: boolean; onCheckedChange: (checked: boolean) => void; disabled?: boolean; "aria-label"?: string };

export function Switch(props: SwitchProps) {
  return <SwitchPrimitive.Root {...props} className="la-switch admin-switch"><SwitchPrimitive.Thumb className="la-switch__thumb admin-switch-thumb" /></SwitchPrimitive.Root>;
}
