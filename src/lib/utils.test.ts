import { describe, it, expect } from "vitest";
import { formatElapsed } from "./utils";

describe("Utility functions", () => {
  describe("formatElapsed", () => {
    it("formats seconds correctly", () => {
      expect(formatElapsed(0)).toBe("00:00");
      expect(formatElapsed(1000)).toBe("00:01"); // 1 second
      expect(formatElapsed(59000)).toBe("00:59"); // 59 seconds
    });

    it("formats minutes correctly", () => {
      expect(formatElapsed(60000)).toBe("01:00"); // 1 minute
      expect(formatElapsed(120000)).toBe("02:00"); // 2 minutes
      expect(formatElapsed(3599000)).toBe("59:59"); // 59 minutes 59 seconds
    });

    it("formats hours correctly", () => {
      expect(formatElapsed(3600000)).toBe("01:00:00"); // 1 hour
      expect(formatElapsed(7200000)).toBe("02:00:00"); // 2 hours
      expect(formatElapsed(3661000)).toBe("01:01:01"); // 1 hour 1 min 1 sec
    });

    it("handles negative values", () => {
      expect(formatElapsed(-1000)).toBe("00:00"); // should return 00:00 for negative values
    });
  });
});
