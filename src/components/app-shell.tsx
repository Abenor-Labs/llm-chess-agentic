"use client";

import { useCallback, useState } from "react";
import { Header } from "./header";
import { SettingsModal } from "./settings-modal";
import { SettingsProvider } from "@/contexts/settings-context";
import { LeaderboardProvider } from "@/contexts/leaderboard-context";

export function AppShell({ children }: { children: React.ReactNode }) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const openSettings = useCallback(() => setSettingsOpen(true), []);
  const closeSettings = useCallback(() => setSettingsOpen(false), []);

  return (
    <SettingsProvider openSettings={openSettings}>
      <LeaderboardProvider>
        <div className="flex min-h-screen flex-col">
          <Header onSettingsClick={openSettings} />
          <main className="flex-1">{children}</main>
        </div>
        <SettingsModal isOpen={settingsOpen} onClose={closeSettings} />
      </LeaderboardProvider>
    </SettingsProvider>
  );
}
