import * as React from "react";
import clsx from "clsx";

export function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={clsx("la-skeleton", className)}
      {...props}
    />
  );
}
