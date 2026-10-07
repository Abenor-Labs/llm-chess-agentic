"use client";

import { useEffect, useState } from "react";
import type { Model, Move } from "@/db/schema";
import { classifyMove, formatDuration, judgeSummary, sideAccuracy } from "@/lib/view-model";
import { describeJudgeEvent } from "@/lib/judge-types";
import { cn } from "@/lib/utils";
import { ModeChip, MoveClassChip, ProviderChip, SideDot } from "./badges";
import { ThinkingDots } from "./thinking";

interface SidePanelProps {
  color: "white" | "black";
  model: Model;
  mode: string;
  /** All moves of the game, in ply order. */
  moves: Move[];
  /** Number of plies currently shown on the board. */
  shown: number;
  thinking: boolean;
  thinkingSince: number | null;
  note: string | null;
  onSelectPly: (plyCount: number) => void;
}

/**
 * One player's corner: who they are, whether they're thinking, and what they
 * were thinking — the reasoning, plan and judge activity of the move on the
 * board, with a scrollable feed of their earlier thoughts.
 */
export function SidePanel({ color, model, mode, moves, shown, thinking, thinkingSince, note, onSelectPly }: SidePanelProps) {
  const mine = moves.map((m, i) => ({ m, ply: i + 1 })).filter(({ m }) => m.color === color);
  const visible = mine.filter(({ ply }) => ply <= shown);
  const focus = visible[visible.length - 1];
  const stats = sideAccuracy(moves, color);
  const total = model.wins + model.losses + model.draws;

  return (
    <section
      className={cn(
        "flex min-h-0 flex-col overflow-hidden rounded-xl border bg-white shadow-sm transition-colors",
        thinking ? "border-amber-300 ring-2 ring-amber-200" : "border-slate-200",
      )}
      data-testid={`side-panel-${color}`}
    >
      <header className="border-b border-slate-100 px-4 py-3">
        <div className="flex items-center gap-2">
          <SideDot color={color} />
          <h2 className="truncate font-semibold text-slate-900" title={model.id}>
            {model.name}
          </h2>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <ProviderChip modelId={model.id} />
          <ModeChip mode={mode} />
          <span className="text-[11px] tabular-nums text-slate-500">
            {model.elo} ELO{total > 0 ? ` · ${model.wins}W ${model.losses}L ${model.draws}D` : ""}
          </span>
        </div>
        {stats && (
          <p className="mt-2 text-[11px] text-slate-600" data-testid={`accuracy-${color}`}>
            Accuracy <strong className="tabular-nums">{stats.accuracy}%</strong> · ACPL <strong className="tabular-nums">{stats.acpl}</strong>
            {stats.blunders > 0 && <> · {stats.blunders} blunder{stats.blunders > 1 ? "s" : ""}</>}
          </p>
        )}
      </header>

      {thinking && (
        <div className="flex items-center gap-2 border-b border-amber-100 bg-amber-50 px-4 py-2 text-sm text-amber-900" data-testid={`thinking-${color}`}>
          <ThinkingDots />
          <span>Thinking{thinkingSince ? <Elapsed since={thinkingSince} /> : null}</span>
        </div>
      )}
      {note && (
        <div className="border-b border-rose-100 bg-rose-50 px-4 py-2 text-xs text-rose-800" role="status">
          {note}
        </div>
      )}

      {focus ? (
        <FocusMove move={focus.m} ply={focus.ply} />
      ) : (
        <p className="px-4 py-6 text-sm italic text-slate-400">No moves yet.</p>
      )}

      {visible.length > 1 && (
        <div className="min-h-0 flex-1 overflow-y-auto border-t border-slate-100">
          <h3 className="sticky top-0 bg-white/95 px-4 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-wider text-slate-400 backdrop-blur">
            Earlier thoughts
          </h3>
          <ol className="space-y-1 px-2 pb-3">
            {visible
              .slice(0, -1)
              .reverse()
              .map(({ m, ply }) => (
                <li key={m.id}>
                  <button
                    onClick={() => onSelectPly(ply)}
                    className="w-full rounded-lg px-2 py-1.5 text-left hover:bg-slate-50 focus:bg-slate-50 focus:outline-none"
                  >
                    <span className="font-mono text-xs font-semibold text-slate-700">
                      {m.moveNumber}
                      {color === "white" ? "." : "…"} {m.moveSan}
                    </span>
                    <span className="ml-2 line-clamp-2 text-xs text-slate-500">{m.reasoning}</span>
                  </button>
                </li>
              ))}
          </ol>
        </div>
      )}
    </section>
  );
}

function FocusMove({ move, ply }: { move: Move; ply: number }) {
  const cls = classifyMove(move.cpLoss);
  const summary = judgeSummary(move.judge);
  const notable = move.judge?.events.filter((e) => e.type !== "notation") ?? [];
  return (
    <div className="space-y-3 px-4 py-3" data-testid="focus-move" data-ply={ply}>
      <div className="flex items-baseline gap-2">
        <span className="font-mono text-2xl font-bold text-slate-900">{move.moveSan}</span>
        <span className="text-xs text-slate-500">
          move {move.moveNumber} · {formatDuration(move.thinkMs)}
        </span>
        <span className="ml-auto">
          <MoveClassChip cls={cls} />
        </span>
      </div>
      <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-700">{move.reasoning}</p>
      {move.plan && (
        <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
          <span className="font-semibold text-slate-700">Plan · </span>
          {move.plan}
        </p>
      )}
      {summary && (
        <details className="group rounded-lg border border-violet-100 bg-violet-50/60 px-3 py-2 text-xs text-violet-900">
          <summary className="cursor-pointer list-none font-medium">
            <span className="mr-1" aria-hidden>
              ⚖
            </span>
            Judge: {summary}
          </summary>
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
    </div>
  );
}

function Elapsed({ since }: { since: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const s = Math.max(0, Math.floor((now - since) / 1000));
  return <span className="ml-1 tabular-nums text-amber-700">{s}s</span>;
}
