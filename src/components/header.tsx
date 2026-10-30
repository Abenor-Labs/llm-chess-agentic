"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { usePageVisibility } from "@/hooks/use-page-visibility";
import { cn } from "@/lib/utils";
import { UserMenu } from "./user-menu";

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
      <div className="mx-auto flex h-14 max-w-[1500px] items-center gap-2 px-3 sm:gap-4 sm:px-6">
        <Link href="/" className="flex shrink-0 items-center gap-2" aria-label="LLM Chess Arena home">
          <Image src="/logo.png" alt="" width={28} height={28} priority />
          <span className="hidden text-base font-semibold tracking-tight text-slate-900 sm:inline">LLM Chess Arena</span>
        </Link>
        <nav className="flex min-w-0 items-center gap-0.5 sm:gap-1" aria-label="Main">
          {NAV.map((item) => {
            const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "rounded-lg px-2 py-1.5 text-sm font-medium transition-colors sm:px-3",
                  active ? "bg-slate-100 text-slate-900" : "text-slate-500 hover:bg-slate-50 hover:text-slate-900",
                )}
                aria-current={active ? "page" : undefined}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="ml-auto flex shrink-0 items-center gap-1.5 sm:gap-2">
          {live && (
            <Link
              href={`/game/${live.id}`}
              className="hidden max-w-[20rem] items-center gap-2 truncate rounded-full px-3 py-1 text-xs font-medium text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50 md:inline-flex"
              data-testid="live-indicator"
            >
              <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-rose-500" />
              <span className="truncate">Live · {live.label}</span>
            </Link>
          )}
          <button
            onClick={onSettingsClick}
            className="inline-flex items-center gap-1.5 rounded-lg p-2 text-sm font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900 sm:px-3 sm:py-1.5"
            aria-label="Open settings"
            title="Settings: API keys and sound"
            data-testid="open-settings"
          >
            <svg aria-hidden viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
              <path
                fillRule="evenodd"
                d="M7.84 1.8A1 1 0 0 1 8.82 1h2.36a1 1 0 0 1 .98.8l.28 1.42c.47.2.9.45 1.3.75l1.37-.47a1 1 0 0 1 1.19.45l1.18 2.04a1 1 0 0 1-.21 1.25l-1.09.95a6.1 6.1 0 0 1 0 1.5l1.09.95a1 1 0 0 1 .21 1.25l-1.18 2.04a1 1 0 0 1-1.19.45l-1.37-.47c-.4.3-.83.55-1.3.75l-.28 1.42a1 1 0 0 1-.98.8H8.82a1 1 0 0 1-.98-.8l-.28-1.42a6 6 0 0 1-1.3-.75l-1.37.47a1 1 0 0 1-1.19-.45L2.52 12.9a1 1 0 0 1 .21-1.25l1.09-.95a6.1 6.1 0 0 1 0-1.5l-1.09-.95a1 1 0 0 1-.21-1.25L3.7 4.96a1 1 0 0 1 1.19-.45l1.37.47c.4-.3.83-.55 1.3-.75l.28-1.42ZM10 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z"
                clipRule="evenodd"
              />
            </svg>
            <span className="hidden sm:inline">Settings</span>
          </button>
          <UserMenu />
        </div>
      </div>
    </header>
  );
}
