import { describe, it, expect } from "vitest";
import { soundForSan } from "./sounds";

describe("soundForSan", () => {
  it.each([
    ["e4", "move"],
    ["Nxe5", "capture"],
    ["Qh5+", "check"],
    ["Qxf7#", "checkmate"],
    ["O-O", "castle"],
    ["O-O-O+", "check"],
    ["e8=Q", "promotion"],
    ["exd8=Q#", "checkmate"],
  ])("%s → %s", (san, kind) => {
    expect(soundForSan(san)).toBe(kind);
  });
});
