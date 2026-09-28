"use client";

import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";

export function AdminLogoutButton() {
  const router = useRouter();
  return (
    <button
      type="button"
      onClick={async () => {
        await fetch("/api/admin/logout", { method: "POST" }).catch(() => undefined);
        router.push("/admin/login");
        router.refresh();
      }}
      className="flex items-center gap-1 text-xs text-ink-faint hover:text-ink"
    >
      <LogOut className="h-3.5 w-3.5" />
      Log out
    </button>
  );
}
