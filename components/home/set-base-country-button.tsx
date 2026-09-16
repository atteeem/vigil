"use client";

import { useAppStore } from "@/hooks/use-app-store";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function SetBaseCountryButton({ code, className }: { code: string; className?: string }) {
  const baseCountryCode = useAppStore((s) => s.baseCountryCode);
  const setBaseCountryCode = useAppStore((s) => s.setBaseCountryCode);
  const isBase = baseCountryCode === code;

  return (
    <button
      onClick={() => setBaseCountryCode(code)}
      disabled={isBase}
      className={cn(buttonVariants({ variant: isBase ? "accent" : "outline", size: "sm" }), className)}
    >
      {isBase ? "Your base country" : "Set as my country"}
    </button>
  );
}
