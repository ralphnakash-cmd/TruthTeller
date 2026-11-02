import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";
import { cn } from "@/lib/utils";

const badgeVariants = cva("inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-medium leading-none", {
  variants: {
    tone: {
      neutral: "border-rule text-muted",
      true: "border-true/35 bg-true/10 text-true",
      false: "border-false/35 bg-false/10 text-false",
      unverified: "border-unverified/35 bg-unverified/10 text-unverified",
      ice: "border-ice/30 bg-ice/10 text-ice",
    },
  },
  defaultVariants: { tone: "neutral" },
});

export function Badge({ className, tone, ...props }: React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}
