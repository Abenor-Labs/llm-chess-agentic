import { cn } from "@/lib/utils";
import { PROVIDER_LABEL, providerOf } from "@/lib/provider-ids";
import { providerStyle } from "@/lib/providers-ui";
import { modeConfig } from "@/lib/modes";
import type { MoveClass } from "@/lib/view-model";

export function ProviderChip({ modelId, className }: { modelId: string; className?: string }) {
  const style = providerStyle(modelId);
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset", style.chip, className)}>
      <span aria-hidden>{style.glyph}</span>
      {PROVIDER_LABEL[providerOf(modelId)]}
    </span>
  );
}

export function ModeChip({ mode, className }: { mode: string; className?: string }) {
  return (
    <span className={cn("inline-flex items-center rounded-full bg-slate-900/5 px-2 py-0.5 text-[11px] font-medium text-slate-700 ring-1 ring-inset ring-slate-900/10", className)}>
      {modeConfig(mode).label}
    </span>
  );
}

export function RatedChip({ rated }: { rated: boolean }) {
  return rated ? (
    <span className="inline-flex items-center rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-800 ring-1 ring-inset ring-emerald-200" title="Both sides played the same mode, so this game counts toward ratings">
      Rated
    </span>
  ) : (
    <span className="inline-flex items-center rounded-full bg-slate-50 px-2 py-0.5 text-[11px] font-medium text-slate-500 ring-1 ring-inset ring-slate-200" title="Sides played different modes, so ratings are unaffected">
      Unrated
    </span>
  );
}

const CLASS_STYLE: Record<Exclude<MoveClass, null>, string> = {
  blunder: "bg-rose-100 text-rose-800",
  mistake: "bg-orange-100 text-orange-800",
  inaccuracy: "bg-amber-100 text-amber-800",
  good: "bg-emerald-50 text-emerald-700",
};

export function MoveClassChip({ cls }: { cls: MoveClass }) {
  if (!cls) return null;
  return <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide", CLASS_STYLE[cls])}>{cls}</span>;
}

/** White or black disc. */
export function SideDot({ color, className }: { color: "white" | "black"; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-block h-3 w-3 shrink-0 rounded-full ring-1",
        color === "white" ? "bg-white ring-slate-400" : "bg-slate-900 ring-slate-900",
        className,
      )}
    />
  );
}
