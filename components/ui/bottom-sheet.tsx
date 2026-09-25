"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useAppStore } from "@/hooks/use-app-store";
import { useEffect } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

export function BottomSheet({
  open,
  onClose,
  children,
  className,
  label,
}: {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  className?: string;
  label?: string;
}) {
  // Device reduced-motion or Settings → Reduce motion: the sheet appears and disappears without sliding.
  const osReduce = useReducedMotion();
  const settingReduce = useAppStore((st) => st.contentSensitivity) === "reduced";
  const reduce = osReduce || settingReduce;
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            className="fixed inset-0 z-[55] bg-black/50 sm:hidden"
            initial={reduce ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            // A closing sheet must never swallow taps meant for the map underneath.
            exit={{ opacity: 0, pointerEvents: "none" }}
            transition={reduce ? { duration: 0 } : { duration: 0.15 }}
            onClick={onClose}
            aria-hidden
          />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label={label}
            className={cn(
              "fixed inset-x-0 bottom-0 z-[56] rounded-t-3xl border-t border-border bg-surface pb-[env(safe-area-inset-bottom)] shadow-[0_-8px_32px_rgba(0,0,0,0.45)] sm:hidden",
              className,
            )}
            // Reduced motion: mount straight at the resting position (no first-frame offset to animate from).
            initial={reduce ? false : { y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%", pointerEvents: "none" }}
            transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 340, damping: 34 }}
            drag="y"
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 0.4 }}
            onDragEnd={(_, info) => {
              if (info.offset.y > 120) onClose();
            }}
          >
            <div className="mx-auto mt-2.5 h-1 w-10 rounded-full bg-border-strong" aria-hidden />
            <button type="button" onClick={onClose} aria-label="Close sheet" className="absolute right-3 top-2 flex h-9 w-9 items-center justify-center rounded-full text-ink-faint hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
              <X className="h-4 w-4" aria-hidden />
            </button>
            <div className="max-h-[75vh] overflow-y-auto px-5 pb-6 pt-3">{children}</div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
