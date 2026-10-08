import { describe, it, expect } from "vitest";
import { playbackDelay } from "./use-game-playback";
import { MOVE_PLAYBACK_MS } from "@/lib/config";

describe("playbackDelay", () => {
  it("plays at the normal pace when caught up and speeds up with a backlog", () => {
    expect(playbackDelay(0)).toBe(MOVE_PLAYBACK_MS);
    expect(playbackDelay(1)).toBe(MOVE_PLAYBACK_MS);
    expect(playbackDelay(4)).toBe(MOVE_PLAYBACK_MS / 2);
    expect(playbackDelay(16)).toBeLessThan(playbackDelay(4));
    expect(playbackDelay(10_000)).toBe(120);
  });
});
