import * as React from "react";
import * as TabsPrimitive from "@radix-ui/react-tabs";
import clsx from "clsx";

export const Tabs = TabsPrimitive.Root;

export type TabsListProps = React.ComponentPropsWithoutRef<typeof TabsPrimitive.List> & {
  variant?: "pill" | "line";
};

export const TabsList = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.List>,
  TabsListProps
>(({ className, variant = "pill", ...props }, ref) => (
  <TabsPrimitive.List
    ref={ref}
    className={clsx("la-tabs-list", `la-tabs-list--${variant}`, className)}
    {...props}
  />
));
TabsList.displayName = TabsPrimitive.List.displayName;

export const TabsTrigger = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Trigger
    ref={ref}
    className={clsx("la-tabs-trigger", className)}
    {...props}
  />
));
TabsTrigger.displayName = TabsPrimitive.Trigger.displayName;

export const TabsContent = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Content
    ref={ref}
    className={clsx("la-tabs-content", className)}
    {...props}
  />
));
TabsContent.displayName = TabsPrimitive.Content.displayName;
