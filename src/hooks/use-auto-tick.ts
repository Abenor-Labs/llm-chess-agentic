"use client";

import { useEffect, useRef } from "react";
import { usePageVisibility } from "@/hooks/use-page-visibility";
import { POLLING_INTERVALS } from "@/lib/config";

/**
 * Drives the game loop from the browser while a live game is on screen and the
 * tab is visible. A tick can run for many seconds (it plays moves until its
 * budget is spent), so a new tick is never sent while one is in flight.
 */
export function useAutoTick(enabled: boolean, onTicked?: () => void) {
  const visible = usePageVisibility();
  const inFlight = useRef(false);
  const callback = useRef(onTicked);
  callback.current = onTicked;

  useEffect(() => {
    if (!enabled || !visible) return;
    let cancelled = false;
    const tick = async () => {
      if (inFlight.current) return;
      inFlight.current = true;
      try {
        await fetch("/api/cron/tick", { method: "POST" });
        if (!cancelled) callback.current?.();
      } catch {
        // offline or server busy; the next interval retries
      } finally {
        inFlight.current = false;
      }
    };
    void tick();
    const timer = setInterval(tick, POLLING_INTERVALS.AUTO_TICK_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [enabled, visible]);
}
