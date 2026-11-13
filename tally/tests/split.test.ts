import { describe, expect, it } from "vitest";
import { splitEqually } from "../src/split.ts";

describe("splitEqually", () => {
  it("splits an evenly divisible amount", () => {
    expect([...splitEqually(900, ["a", "b", "c"]).values()]).toEqual([300, 300, 300]);
  });

  it("gives the whole amount to a single member", () => {
    expect(splitEqually(1234, ["a"]).get("a")).toBe(1234);
  });

  it("refuses to split among nobody", () => {
    expect(() => splitEqually(100, [])).toThrow();
  });
});
