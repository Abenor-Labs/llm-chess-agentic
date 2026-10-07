"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type { Model } from "@/db/schema";
import { useGameData } from "@/hooks/use-game-data";
import { useAutoTick } from "@/hooks/use-auto-tick";
import { useGamePlayback } from "@/hooks/use-game-playback";
import { useGameAnalysis } from "@/hooks/use-game-analysis";
import { buildPlies, fenAt, materialSummary, resultHeadline, formatDuration } from "@/lib/view-model";
import { playSound, soundForSan } from "@/lib/sounds";
import { formatElapsed, cn } from "@/lib/utils";
import { Board } from "./board";
import { EvalBar } from "./eval-bar";
import { MoveList } from "./move-list";
import { SidePanel } from "./side-panel";
import { RatedChip, SideDot } from "./badges";
import { ThinkingDots } from "./thinking";

const PIECE_GLYPH: Record<string, string> = { q: "♛", r: "♜", b: "♝", n: "♞", p: "♟" };

interface GameViewProps {
  gameId: string;
  /** Shown when the game ends (e.g. "New match" on the home page). */
  onNewGame?: () => void;
  /** Called when the game disappears (aborted before its first move). */
  onGone?: () => void;
}

/**
 * The game screen, live or finished. Moves arriving in bursts are revealed one
 * at a time; any ply can be inspected with the move list, the side panels or
 * the arrow keys, and "Live" snaps back to the latest position.
 */
export function GameView({ gameId, onNewGame, onGone }: GameViewProps) {
  const { data, loading, error, refetch } = useGameData(gameId);
  const game = data?.game;
  const moves = useMemo(() => data?.moves ?? [], [data?.moves]);
  const live = game?.status === "active";

  useAutoTick(Boolean(live), refetch);
  const analysis = useGameAnalysis(game, data?.moves, refetch);

  const plies = useMemo(() => buildPlies(moves), [moves]);
  const { shownCount, caughtUp, skipToEnd } = useGamePlayback(moves, game?.id);
  const [cursor, setCursor] = useState<number | null>(null);
  const [orientation, setOrientation] = useState<"white" | "black">("white");
  const shown = Math.min(cursor ?? shownCount, plies.length);
  const following = cursor === null || cursor >= plies.length;
  const fen = fenAt(plies, shown);
  const ply = shown > 0 ? plies[shown - 1] : null;

  const goTo = useCallback(
    (n: number) => {
      const clamped = Math.max(0, Math.min(n, plies.length));
      if (clamped >= plies.length) {
        setCursor(null);
        skipToEnd();
      } else setCursor(clamped);
    },
    [plies.length, skipToEnd],
  );

  // Keyboard navigation: ← → step, Home/End jump, F flips the board.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "ArrowLeft") goTo(shown - 1);
      else if (e.key === "ArrowRight") goTo(shown + 1);
      else if (e.key === "Home") goTo(0);
      else if (e.key === "End") goTo(plies.length);
      else if (e.key.toLowerCase() === "f") setOrientation((o) => (o === "white" ? "black" : "white"));
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [goTo, shown, plies.length]);

  // A sound for each move as playback reveals it (not when browsing history).
  const lastSounded = useRef<{ game?: string; count: number }>({ count: 0 });
  useEffect(() => {
    const prev = lastSounded.current;
    if (prev.game !== game?.id) {
      lastSounded.current = { game: game?.id, count: shownCount };
      return;
    }
    if (cursor === null && shownCount > prev.count && plies[shownCount - 1]) playSound(soundForSan(plies[shownCount - 1].san));
    lastSounded.current = { game: game?.id, count: shownCount };
  }, [shownCount, cursor, plies, game?.id]);

  useEffect(() => {
    if (error === "not-found") onGone?.();
  }, [error, onGone]);

  if (error === "not-found") {
    return (
      <Centered>
        <p className="text-slate-600">This game doesn&apos;t exist (it may have been cancelled before its first move).</p>
        <Link href="/" className="mt-3 inline-block rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white">
          Start a match
        </Link>
      </Centered>
    );
  }
  if (loading || !data || !game) {
    return (
      <Centered>
        <p className="text-slate-500">{error === "network" ? "Can't reach the server — retrying…" : "Loading game…"}</p>
      </Centered>
    );
  }

  const turn: "white" | "black" = (fenAt(plies, plies.length).split(" ")[1] ?? "w") === "w" ? "white" : "black";
  const thinkingSide = live && caughtUp && following ? turn : null;
  const lastMoveAt = moves.length ? new Date(moves[moves.length - 1].createdAt).getTime() : new Date(game.startedAt).getTime();
  const note = game.statusNote;
  const noteSide = note?.startsWith("White") ? "white" : note?.startsWith("Black") ? "black" : null;
  const material = materialSummary(fen);
  const top: "white" | "black" = orientation === "white" ? "black" : "white";
  const bottom = orientation;

  const bar = (color: "white" | "black") => (
    <PlayerBar
      color={color}
      model={color === "white" ? data.white : data.black}
      captured={color === "white" ? material.capturedByWhite : material.capturedByBlack}
      advantage={color === "white" ? material.diff : -material.diff}
      toMove={thinkingSide === color}
      winner={game.result === (color === "white" ? "1-0" : "0-1")}
    />
  );

  return (
    <div className="mx-auto w-full max-w-[1500px] px-3 py-4 sm:px-6">
      <StatusStrip
        live={live || (!caughtUp && cursor === null)}
        result={game.result}
        reason={game.resultReason}
        white={data.white}
        black={data.black}
        rated={game.rated}
        startedAt={game.startedAt}
        endedAt={game.endedAt}
        plies={plies.length}
        analysis={analysis}
        onNewGame={onNewGame}
        stoppable={live}
        onSkipToEnd={() => goTo(plies.length)}
        gameId={game.id}
        pgn={game.pgn}
      />

      {/* Mobile: board, then panels. lg: board left, panels stacked right. xl: white | board | black. */}
      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px] xl:grid-cols-[320px_minmax(0,1fr)_320px]">
        <div className="flex flex-col items-center gap-2 lg:col-start-1 lg:row-span-2 lg:row-start-1 xl:col-start-2 xl:row-span-1">
          <div className="w-full max-w-[min(100%,calc(100vh-13rem))]">
            {bar(top)}
            <div className="my-1.5 flex gap-2">
              <EvalBar fen={fen} orientation={orientation} />
              <div className="aspect-square min-w-0 flex-1" data-testid="board" data-fen={fen}>
                <Board
                  id={`game-${game.id}`}
                  fen={fen}
                  orientation={orientation}
                  lastMove={ply ? { from: ply.from, to: ply.to } : null}
                  checkSquare={ply?.checkSquare ?? null}
                />
              </div>
            </div>
            {bar(bottom)}
          </div>

          <Controls
            shown={shown}
            total={plies.length}
            following={following && caughtUp}
            live={live}
            onGo={goTo}
            onFlip={() => setOrientation((o) => (o === "white" ? "black" : "white"))}
          />

          <div className="w-full max-w-[min(100%,calc(100vh-13rem))] rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
            <div className="max-h-48 overflow-y-auto" data-scroll-box>
              <MoveList moves={moves} shown={shown} onSelectPly={goTo} />
            </div>
          </div>
        </div>

        {(["white", "black"] as const).map((color) => (
          <div
            key={color}
            className={cn(
              "flex min-h-0 lg:col-start-2 lg:max-h-[calc((100vh-11rem)/2)] xl:row-start-1 xl:max-h-[calc(100vh-10rem)]",
              color === "white" ? "lg:row-start-1 xl:col-start-1" : "lg:row-start-2 xl:col-start-3",
            )}
          >
            <SidePanel
              color={color}
              model={color === "white" ? data.white : data.black}
              mode={color === "white" ? game.whiteMode : game.blackMode}
              moves={moves}
              shown={shown}
              thinking={thinkingSide === color}
              thinkingSince={thinkingSide === color ? lastMoveAt : null}
              note={noteSide === color ? note : null}
              onSelectPly={goTo}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="flex min-h-[60vh] flex-col items-center justify-center p-6 text-center">{children}</div>;
}

function PlayerBar({
  color,
  model,
  captured,
  advantage,
  toMove,
  winner,
}: {
  color: "white" | "black";
  model: Model;
  captured: string[];
  advantage: number;
  toMove: boolean;
  winner: boolean;
}) {
  return (
    <div className={cn("flex h-8 items-center gap-2 rounded-lg px-2 text-sm transition-colors", toMove ? "bg-amber-100/80" : "bg-transparent")} data-testid={`player-bar-${color}`}>
      <SideDot color={color} />
      <span className="truncate font-medium text-slate-900">{model.name}</span>
      {winner && <span className="text-amber-600" title="Winner">♛</span>}
      {toMove && <ThinkingDots />}
      <span className="ml-auto flex items-center gap-1 text-slate-500">
        <span className="text-base leading-none tracking-tighter" aria-label={`captured: ${captured.join(" ")}`}>
          {captured.map((p, i) => (
            <span key={i}>{PIECE_GLYPH[p]}</span>
          ))}
        </span>
        {advantage > 0 && <span className="text-xs font-semibold tabular-nums">+{advantage}</span>}
      </span>
    </div>
  );
}

function Controls({
  shown,
  total,
  following,
  live,
  onGo,
  onFlip,
}: {
  shown: number;
  total: number;
  following: boolean;
  live: boolean;
  onGo: (n: number) => void;
  onFlip: () => void;
}) {
  const btn = "rounded-lg px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-40 disabled:hover:bg-transparent";
  return (
    <div className="flex items-center gap-1" role="toolbar" aria-label="Move navigation">
      <button className={btn} onClick={() => onGo(0)} disabled={shown === 0} aria-label="First move" title="First (Home)">
        ⏮
      </button>
      <button className={btn} onClick={() => onGo(shown - 1)} disabled={shown === 0} aria-label="Previous move" title="Previous (←)">
        ◀
      </button>
      <span className="min-w-[4.5rem] text-center text-xs tabular-nums text-slate-500" data-testid="ply-counter">
        {shown} / {total}
      </span>
      <button className={btn} onClick={() => onGo(shown + 1)} disabled={shown >= total} aria-label="Next move" title="Next (→)">
        ▶
      </button>
      <button className={btn} onClick={() => onGo(total)} disabled={following} aria-label="Latest move" title="Latest (End)">
        ⏭
      </button>
      {live && !following && (
        <button className="ml-1 rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-rose-700" onClick={() => onGo(total)}>
          ● Back to live
        </button>
      )}
      <button className={cn(btn, "ml-2")} onClick={onFlip} aria-label="Flip board" title="Flip board (F)">
        ⇅
      </button>
    </div>
  );
}

function StatusStrip({
  live,
  result,
  reason,
  white,
  black,
  rated,
  startedAt,
  endedAt,
  plies,
  analysis,
  onNewGame,
  stoppable,
  onSkipToEnd,
  gameId,
  pgn,
}: {
  live: boolean;
  result: "1-0" | "0-1" | "1/2-1/2" | null;
  reason: string | null;
  white: Model;
  black: Model;
  rated: boolean;
  startedAt: Date | string;
  endedAt: Date | string | null;
  plies: number;
  analysis: { done: number; total: number } | null;
  onNewGame?: () => void;
  /** The server-side game is still running (otherwise a "live" strip is a replay catching up). */
  stoppable: boolean;
  onSkipToEnd?: () => void;
  gameId: string;
  pgn: string;
}) {
  const [stopping, setStopping] = useState(false);
  const [copied, setCopied] = useState(false);
  const started = new Date(startedAt).getTime();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!live) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [live]);
  const elapsed = (endedAt ? new Date(endedAt).getTime() : now) - started;

  async function stop() {
    if (!confirm("Stop this match? It will end without a result and won't affect ratings.")) return;
    setStopping(true);
    try {
      await fetch("/api/games/destroy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ gameId }),
      });
    } finally {
      setStopping(false);
    }
  }

  async function copyPgn() {
    const headers = [
      `[Event "LLM Chess Arena"]`,
      `[White "${white.name}"]`,
      `[Black "${black.name}"]`,
      `[Result "${result ?? "*"}"]`,
    ].join("\n");
    try {
      await navigator.clipboard.writeText(`${headers}\n\n${pgn} ${result ?? "*"}`.trim());
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard blocked; nothing to do
    }
  }

  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border px-4 py-3 shadow-sm",
        live ? "border-slate-200 bg-white" : "border-amber-200 bg-gradient-to-r from-amber-50 to-orange-50",
      )}
      data-testid="status-strip"
    >
      {live && stoppable ? (
        <span className="inline-flex items-center gap-2 text-sm font-semibold text-rose-600" data-testid="live-badge">
          <span className="relative flex h-2.5 w-2.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-rose-400 opacity-75" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-rose-500" />
          </span>
          LIVE
        </span>
      ) : live ? (
        // The game already ended on the server; the board is still catching up.
        <span className="inline-flex items-center gap-2 text-sm font-semibold text-slate-600" data-testid="replay-badge">
          <span className="h-2.5 w-2.5 rounded-full bg-slate-400" />
          REPLAYING
          {onSkipToEnd && (
            <button onClick={onSkipToEnd} className="ml-1 rounded-md px-2 py-0.5 text-xs font-medium text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50">
              Skip to result
            </button>
          )}
        </span>
      ) : (
        <div className="min-w-0" data-testid="result-banner">
          <p className="text-lg font-bold text-slate-900">
            {resultHeadline(result, white.name, black.name)} <span className="ml-1 font-mono text-sm font-semibold text-slate-500">{result ?? ""}</span>
          </p>
          {reason && <p className="text-sm text-slate-600">{reason}</p>}
        </div>
      )}
      <span className="text-sm text-slate-600">
        <strong className="text-slate-900">{white.name}</strong> vs <strong className="text-slate-900">{black.name}</strong>
      </span>
      <RatedChip rated={rated} />
      <span className="text-xs tabular-nums text-slate-500">
        {formatElapsed(elapsed)} · {plies} plies{plies > 0 && !live ? ` · ${formatDuration(elapsed / Math.max(1, plies))}/ply` : ""}
      </span>
      {analysis && (
        <span className="text-xs text-violet-700" data-testid="analysis-progress">
          Stockfish review {analysis.done}/{analysis.total}…
        </span>
      )}
      <span className="ml-auto flex items-center gap-2">
        <button onClick={copyPgn} className="rounded-lg px-3 py-1.5 text-sm font-medium text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50">
          {copied ? "Copied!" : "Copy PGN"}
        </button>
        {stoppable && (
          <button
            onClick={stop}
            disabled={stopping}
            className="rounded-lg px-3 py-1.5 text-sm font-semibold text-rose-700 ring-1 ring-rose-200 hover:bg-rose-50 disabled:opacity-50"
            data-testid="stop-match"
          >
            {stopping ? "Stopping…" : "Stop match"}
          </button>
        )}
        {!live && onNewGame && (
          <button onClick={onNewGame} className="rounded-lg bg-slate-900 px-4 py-1.5 text-sm font-semibold text-white hover:bg-slate-700" data-testid="new-match">
            New match
          </button>
        )}
      </span>
    </div>
  );
}
