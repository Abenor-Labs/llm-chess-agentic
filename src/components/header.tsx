"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { usePageVisibility } from "@/hooks/use-page-visibility";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/", label: "Play" },
  { href: "/games", label: "History" },
  { href: "/leaderboard", label: "Leaderboard" },
];

/** App header: navigation, a live-game indicator and Settings. */
export function Header({ onSettingsClick }: { onSettingsClick: () => void }) {
  const pathname = usePathname();
  const visible = usePageVisibility();
  const [live, setLive] = useState<{ id: string; label: string } | null>(null);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    const check = async () => {
      try {
        const res = await fetch("/api/games?status=active&limit=1", { cache: "no-store" });
        if (!res.ok || cancelled) return;
        const g = (await res.json()).games?.[0];
        setLive(g ? { id: g.id, label: `${g.whiteModel?.name ?? "White"} vs ${g.blackModel?.name ?? "Black"}` } : null);
      } catch {
        // offline; keep the last known state
      }
    };
    void check();
    const t = setInterval(check, 15_000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [visible, pathname]);

  return (
    <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/90 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-[1500px] items-center gap-3 px-3 sm:px-6">
        <Link href="/" className="flex shrink-0 items-center gap-2">
          <Image src="/logo.png" alt="" width={28} height={28} priority />
          <span className="hidden text-base font-bold tracking-tight sm:inline">LLM Chess Arena</span>
        </Link>
        <nav className="flex items-center gap-1" aria-label="Main">
          {NAV.map((item) => {
            const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "rounded-lg px-3 py-1.5 text-sm font-medium transition",
                  active ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100 hover:text-slate-900",
                )}
                aria-current={active ? "page" : undefined}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          {live && (
            <Link
              href={`/game/${live.id}`}
              className="hidden max-w-[22rem] items-center gap-2 truncate rounded-full bg-rose-50 px-3 py-1 text-xs font-medium text-rose-700 ring-1 ring-rose-200 hover:bg-rose-100 md:inline-flex"
              data-testid="live-indicator"
            >
              <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-rose-500" />
              <span className="truncate">Live: {live.label}</span>
            </Link>
          )}
          <button
            onClick={onSettingsClick}
            className="rounded-lg px-3 py-1.5 text-sm font-medium text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50"
            aria-label="Open settings"
            data-testid="open-settings"
          >
            Settings
          </button>
        </div>
      </div>
    </header>
  );
}
