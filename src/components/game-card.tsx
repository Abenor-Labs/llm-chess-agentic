import Link from "next/link";
import type { GameListItem } from "@/types/api";
import { resultHeadline } from "@/lib/view-model";
import { cn } from "@/lib/utils";
import { Board } from "./board";
import { ModeChip, RatedChip, SideDot } from "./badges";

/** Summary card for one game in the history list. */
export function GameCard({ game }: { game: GameListItem }) {
  const white = game.whiteModel?.name ?? game.whiteId;
  const black = game.blackModel?.name ?? game.blackId;
  const ended = game.endedAt ? new Date(game.endedAt) : null;
  const tone =
    game.result === "1-0" || game.result === "0-1" ? "text-slate-900" : game.result === "1/2-1/2" ? "text-slate-600" : "text-slate-400";

  return (
    <Link
      href={`/game/${game.id}`}
      className="group flex flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
      data-testid="game-card"
    >
      <div className="pointer-events-none aspect-square w-full bg-slate-100 p-2">
        <Board id={`card-${game.id}`} fen={game.fen} animate={false} />
      </div>
      <div className="space-y-2 p-3">
        <p className={cn("text-sm font-bold", tone)}>
          {resultHeadline(game.result, white, black)} <span className="font-mono text-xs font-semibold text-slate-400">{game.result ?? ""}</span>
        </p>
        <div className="space-y-1 text-xs">
          {([["white", white, game.whiteMode], ["black", black, game.blackMode]] as const).map(([color, name, mode]) => (
            <div key={color} className="flex items-center gap-1.5">
              <SideDot color={color} />
              <span className="truncate font-medium text-slate-800">{name}</span>
              <ModeChip mode={mode} className="ml-auto" />
            </div>
          ))}
        </div>
        {game.resultReason && <p className="line-clamp-2 text-xs text-slate-500">{game.resultReason}</p>}
        <div className="flex items-center gap-2 text-[11px] text-slate-400">
          <RatedChip rated={game.rated} />
          <span>{game.moveCount} plies</span>
          {game.analyzed && <span className="text-violet-600">analyzed</span>}
          {ended && <time className="ml-auto" dateTime={ended.toISOString()}>{ended.toLocaleDateString()}</time>}
        </div>
      </div>
    </Link>
  );
}
