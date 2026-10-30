"use client";

import { useEffect, useState } from "react";
import type { Model, Move } from "@/db/schema";
import { classifyMove, formatDuration, judgeSummary, sideAccuracy } from "@/lib/view-model";
import { describeJudgeEvent } from "@/lib/judge-types";
import { modeConfig } from "@/lib/modes";
import { cn } from "@/lib/utils";
import { ModeChip, MoveClassChip, ProviderChip, SideDot } from "./badges";
import { ThinkingDots } from "./thinking";

type Color = "white" | "black";
const SIDE: Record<Color, string> = { white: "White", black: "Black" };

interface Players {
  white: Model;
  black: Model;
  whiteMode: string;
  blackMode: string;
}

/** Both players at a glance: side, model, provider, mode, accuracy, and who is to move. */
export function PlayerCards({ players, moves, toMove }: { players: Players; moves: Move[]; toMove: Color | null }) {
  return (
    <div className="grid grid-cols-2 gap-2" data-testid="player-cards">
      {(["white", "black"] as const).map((color) => {
        const model = players[color];
        const stats = sideAccuracy(moves, color);
        return (
          <div
            key={color}
            className={cn(
              "min-w-0 rounded-xl border bg-white p-3 transition-colors",
              toMove === color ? "border-amber-300 bg-amber-50/60" : "border-slate-200",
            )}
            data-testid={`side-panel-${color}`}
          >
            <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              <SideDot color={color} />
              {SIDE[color]}
              {toMove === color && <span className="ml-auto normal-case tracking-normal text-amber-700">to move</span>}
            </div>
            <p className="mt-1 truncate text-sm font-semibold text-slate-900" title={model.id}>
              {model.name}
            </p>
            <div className="mt-1.5 flex flex-wrap gap-1">
              <ProviderChip modelId={model.id} />
              <ModeChip mode={color === "white" ? players.whiteMode : players.blackMode} />
            </div>
            <p className="mt-1.5 text-[11px] tabular-nums text-slate-500" data-testid={`accuracy-${color}`}>
              {model.elo} ELO
              {stats && (
                <>
                  {" · "}
                  {stats.accuracy}% acc{stats.blunders > 0 ? ` · ${stats.blunders}??` : ""}
                </>
              )}
            </p>
          </div>
        );
      })}
    </div>
  );
}

/**
 * One timeline of the game: every entry says which side and model spoke, the
 * move, and why. Newest first; the move on the board is expanded.
 */
export function Commentary({
  players,
  moves,
  shown,
  thinking,
  thinkingSince,
  note,
  onSelectPly,
}: {
  players: Players;
  moves: Move[];
  /** Plies currently shown on the board. */
  shown: number;
  thinking: Color | null;
  thinkingSince: number | null;
  /** The game's status note (e.g. a failed attempt), already attributed to a side. */
  note: { color: Color | null; text: string } | null;
  onSelectPly: (ply: number) => void;
}) {
  const visible = moves.slice(0, shown).map((m, i) => ({ m, ply: i + 1 }));
  const who = (c: Color) => (
    <span className="inline-flex min-w-0 items-center gap-1.5">
      <SideDot color={c} />
      <span className="truncate font-semibold text-slate-900">{players[c].name}</span>
      <span className="shrink-0 text-slate-400">
        {SIDE[c]} · {modeConfig(c === "white" ? players.whiteMode : players.blackMode).label}
      </span>
    </span>
  );

  return (
    <section className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white" aria-label="Commentary">
      <h2 className="border-b border-slate-100 px-4 py-2.5 text-sm font-semibold text-slate-900">Commentary</h2>
      <ol className="min-h-0 flex-1 divide-y divide-slate-100 overflow-y-auto" aria-live="polite">
        {thinking && (
          <li className="flex items-center gap-2 bg-amber-50 px-4 py-3 text-sm" data-testid={`thinking-${thinking}`}>
            <span className="min-w-0 flex-1 truncate text-xs">{who(thinking)}</span>
            <span className="flex shrink-0 items-center gap-1.5 text-xs font-medium text-amber-800">
              <ThinkingDots />
              thinking{thinkingSince ? <Elapsed since={thinkingSince} /> : null}
            </span>
          </li>
        )}
        {note && (
          <li className="bg-rose-50 px-4 py-3 text-xs text-rose-800" role="status">
            {note.color && <div className="mb-1">{who(note.color)}</div>}
            {note.text}
          </li>
        )}
        {visible.length === 0 && !thinking && <li className="px-4 py-8 text-center text-sm text-slate-400">No moves yet. White moves first.</li>}
        {[...visible].reverse().map(({ m, ply }) => (
          <Entry key={m.id} move={m} ply={ply} expanded={ply === shown} who={who(m.color)} onSelect={() => onSelectPly(ply)} />
        ))}
      </ol>
    </section>
  );
}

function Entry({ move, ply, expanded, who, onSelect }: { move: Move; ply: number; expanded: boolean; who: React.ReactNode; onSelect: () => void }) {
  const cls = classifyMove(move.cpLoss);
  const summary = judgeSummary(move.judge);
  const notable = move.judge?.events.filter((e) => e.type !== "notation") ?? [];
  const head = (
    <>
      <div className="flex items-center gap-2 text-xs">
        <span className="min-w-0 flex-1 truncate">{who}</span>
        <MoveClassChip cls={cls} />
      </div>
      <div className="mt-1 flex items-baseline gap-2">
        <span className="font-mono text-lg font-bold text-slate-900">
          <span className="mr-1 text-sm font-medium text-slate-400">
            {move.moveNumber}
            {move.color === "white" ? "." : "…"}
          </span>
          {move.moveSan}
        </span>
        <span className="text-[11px] tabular-nums text-slate-400">{formatDuration(move.thinkMs)}</span>
      </div>
    </>
  );

  if (!expanded) {
    return (
      <li>
        <button onClick={onSelect} className="w-full px-4 py-2.5 text-left transition-colors hover:bg-slate-50 focus-visible:bg-slate-50" aria-label={`Show move ${move.moveNumber} ${move.moveSan}`}>
          {head}
          <p className="mt-0.5 line-clamp-2 text-xs text-slate-500">{move.reasoning}</p>
        </button>
      </li>
    );
  }
  return (
    <li className="space-y-2 border-l-2 border-slate-900 px-4 py-3" data-testid="focus-move" data-ply={ply}>
      {head}
      <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-700">{move.reasoning}</p>
      {move.plan && (
        <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
          <span className="font-semibold text-slate-700">Plan · </span>
          {move.plan}
        </p>
      )}
      {summary && (
        <details className="rounded-lg border border-violet-100 bg-violet-50/60 px-3 py-2 text-xs text-violet-900">
          <summary className="cursor-pointer font-medium">Judge: {summary}</summary>
          {notable.length > 0 && (
            <ul className="mt-2 list-disc space-y-1 pl-4 text-violet-800">
              {notable.map((e, i) => (
                <li key={i}>{describeJudgeEvent(e)}</li>
              ))}
            </ul>
          )}
        </details>
      )}
      {move.cpLoss != null && (
        <p className="text-[11px] text-slate-500">
          Stockfish: {move.cpLoss === 0 ? "no loss" : `−${(move.cpLoss / 100).toFixed(2)} pawns`} · accuracy {move.moveAccuracy}%
        </p>
      )}
    </li>
  );
}

function Elapsed({ since }: { since: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  return <span className="ml-0.5 tabular-nums">{Math.max(0, Math.floor((now - since) / 1000))}s</span>;
}
