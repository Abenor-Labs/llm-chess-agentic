"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { GameListItem } from "@/types/api";
import { usePageVisibility } from "@/hooks/use-page-visibility";
import { POLLING_INTERVALS } from "@/lib/config";
import { SideDot } from "./badges";
import { useSessionUser } from "./user-menu";

/** Human vs Human rooms waiting for a second player. */
export function OpenRooms({ onJoined }: { onJoined: (gameId: string) => void }) {
  const visible = usePageVisibility();
  const { user } = useSessionUser();
  const [rooms, setRooms] = useState<GameListItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [joining, setJoining] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    const load = () =>
      fetch("/api/games?status=active&open=1&limit=10", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : { games: [] }))
        .then((d) => !cancelled && setRooms(d.games ?? []))
        .catch(() => {});
    void load();
    const t = setInterval(load, POLLING_INTERVALS.GAMES_LIST_REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [visible]);

  if (rooms.length === 0) return null;

  async function join(id: string) {
    setJoining(id);
    setError(null);
    const res = await fetch(`/api/games/${id}/join`, { method: "POST" }).catch(() => null);
    setJoining(null);
    if (res?.ok) onJoined(id);
    else setError((await res?.json().catch(() => null))?.error ?? "Couldn't join that room.");
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm" aria-label="Open rooms" data-testid="open-rooms">
      <h2 className="text-sm font-semibold text-slate-900">Open rooms</h2>
      <p className="mt-0.5 text-xs text-slate-500">Players waiting for an opponent.</p>
      <ul className="mt-3 space-y-2">
        {rooms.map((g) => {
          const host = g.whiteUserId ? { name: g.whiteUserName ?? "Player", color: "white" as const } : { name: g.blackUserName ?? "Player", color: "black" as const };
          const mine = user && (g.whiteUserId === user.id || g.blackUserId === user.id);
          const seat = host.color === "white" ? "black" : "white";
          return (
            <li key={g.id} className="flex items-center gap-2 text-sm">
              <SideDot color={host.color} />
              <span className="min-w-0 flex-1 truncate">
                <strong className="font-medium text-slate-900">{host.name}</strong> <span className="text-slate-500">plays {host.color}</span>
              </span>
              {mine ? (
                <Link href={`/game/${g.id}`} className="text-xs font-medium text-slate-600 underline underline-offset-2">
                  Your room
                </Link>
              ) : user ? (
                <button
                  onClick={() => join(g.id)}
                  disabled={joining !== null}
                  className="rounded-lg bg-slate-900 px-3 py-1 text-xs font-semibold text-white hover:bg-slate-700 disabled:opacity-50"
                >
                  {joining === g.id ? "Joining…" : `Join as ${seat}`}
                </button>
              ) : (
                <Link href="/auth/sign-in?next=/" className="text-xs font-medium text-slate-600 underline underline-offset-2">
                  Sign in to join
                </Link>
              )}
            </li>
          );
        })}
      </ul>
      {error && (
        <p className="mt-2 text-xs text-rose-600" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
