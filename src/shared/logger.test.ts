import { describe, it, expect, vi } from "vitest";
import { logger } from "@/shared/logger";

describe("logger", () => {
  it("does not throw when called with arguments", () => {
    expect(() => logger.log("test message")).not.toThrow();
    expect(() => logger.log("a", "b", "c")).not.toThrow();
    expect(() => logger.error("error message")).not.toThrow();
  });

  it("has log and error methods", () => {
    expect(typeof logger.log).toBe("function");
    expect(typeof logger.error).toBe("function");
  });
});
