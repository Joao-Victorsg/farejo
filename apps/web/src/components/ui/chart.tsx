"use client";

import type { ComponentProps, ReactElement } from "react";
import { ResponsiveContainer } from "recharts";
import { cn } from "@/lib/utils";

export function ChartContainer({
  children,
  className,
  ...props
}: Omit<ComponentProps<"div">, "children"> & { children: ReactElement }) {
  return (
    <div
      className={cn(
        "flex h-[150px] w-full min-w-0 justify-center text-xs sm:h-[200px] [&_.recharts-cartesian-axis-tick_text]:fill-[#70736a] [&_.recharts-layer]:outline-none [&_.recharts-surface:focus-visible]:outline-2 [&_.recharts-surface:focus-visible]:outline-offset-2 [&_.recharts-surface:focus-visible]:outline-[#1c7a4d]",
        className,
      )}
      data-slot="chart"
      {...props}
    >
      <ResponsiveContainer height="100%" minWidth={0} width="100%">
        {children}
      </ResponsiveContainer>
    </div>
  );
}
