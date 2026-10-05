import { describe, expect, it } from "vite-plus/test";
import { createOutlineCache } from "./outlineCache";
describe("outline cache", () => {
  it("reuses the current file's result while refreshing changed text and language", () => {
    const cache = createOutlineCache();
    const source = "export function run() {}";
    const first = cache("file.ts", source);
    expect(cache("file.ts", source)).toBe(first);
    expect(
      cache("file.ts", source + "\nexport function stop() {}")?.symbols.map(
        (symbol) => symbol.name,
      ),
    ).toEqual(["run", "stop"]);
    expect(cache("file.py", "def work(): pass")?.symbols[0]?.name).toBe("work");
    expect(cache("file.json", source)).toBeNull();
  });
});
