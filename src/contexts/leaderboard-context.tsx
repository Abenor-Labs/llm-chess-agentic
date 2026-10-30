"use client";

import { createContext, useContext, useEffect, useCallback, useRef, useState, type ReactNode } from "react";
import type { Model } from "@/db/schema";

const REFETCH_ON_VISIBLE_THROTTLE_MS = 60_000;

interface LeaderboardContextType {
  models: Model[];
  isLoading: boolean;
  isRefetching: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

const LeaderboardContext = createContext<LeaderboardContextType | undefined>(undefined);

export function LeaderboardProvider({ children }: { children: ReactNode }) {
  const [models, setModels] = useState<Model[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefetching, setIsRefetching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lastRefetchOnVisibleRef = useRef<number>(0);

  const fetchLeaderboard = useCallback(async (showRefetching = false) => {
    if (showRefetching) setIsRefetching(true);
    try {
      const res = await fetch("/api/leaderboard", { cache: "no-store" });
      if (!res.ok) {
        setError("Failed to load leaderboard");
        return;
      }
      const data = await res.json();
      setModels(data.models ?? []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch leaderboard");
    } finally {
      setIsLoading(false);
      setIsRefetching(false);
    }
  }, []);

  useEffect(() => {
    fetchLeaderboard(false);
  }, [fetchLeaderboard]);

  useEffect(() => {
    const handleVisible = () => {
      if (document.hidden) return;
      const now = Date.now();
      if (now - lastRefetchOnVisibleRef.current < REFETCH_ON_VISIBLE_THROTTLE_MS) return;
      lastRefetchOnVisibleRef.current = now;
      fetchLeaderboard(false);
    };
    document.addEventListener("visibilitychange", handleVisible);
    return () => document.removeEventListener("visibilitychange", handleVisible);
  }, [fetchLeaderboard]);

  const refetch = useCallback(() => fetchLeaderboard(true), [fetchLeaderboard]);

  return (
    <LeaderboardContext.Provider value={{ models, isLoading, isRefetching, error, refetch }}>
      {children}
    </LeaderboardContext.Provider>
  );
}

export function useLeaderboard() {
  const context = useContext(LeaderboardContext);
  if (context === undefined) {
    throw new Error("useLeaderboard must be used within a LeaderboardProvider");
  }
  return context;
}
