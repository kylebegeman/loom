import { expect, it } from "@effect/vitest";
import { cacheKey, pruneList, createStemProtection } from "./renderCache.ts";
it("keys every rendering input and normalizes override order", () => {
  const key = cacheKey("source", { x: "1", y: "2" }, "set", "sidecar", "v", "auto", "stl", [
    ["include", "1"],
  ]);
  expect(
    cacheKey("source", { y: "2", x: "1" }, "set", "sidecar", "v", "auto", "stl", [
      ["include", "1"],
    ]),
  ).toBe(key);
  expect(
    cacheKey("source", { x: "1", y: "2" }, "set", "sidecar", "v", "auto", "stl", [
      ["include", "2"],
    ]),
  ).not.toBe(key);
  const input: Parameters<typeof cacheKey> = [
    "source",
    { x: "1", y: "2" },
    "set",
    "sidecar",
    "v",
    "auto",
    "stl",
    [["include", "1"]],
  ];
  const changed: Parameters<typeof cacheKey>[] = [
    ["changed", input[1], input[2], input[3], input[4], input[5], input[6], input[7]],
    [input[0], { x: "3" }, input[2], input[3], input[4], input[5], input[6], input[7]],
    [input[0], input[1], "other set", input[3], input[4], input[5], input[6], input[7]],
    [input[0], input[1], input[2], "other sidecar", input[4], input[5], input[6], input[7]],
    [input[0], input[1], input[2], input[3], "other version", input[5], input[6], input[7]],
    [input[0], input[1], input[2], input[3], input[4], "cgal", input[6], input[7]],
    [input[0], input[1], input[2], input[3], input[4], input[5], "3mf", input[7]],
  ];
  for (const variant of changed) expect(cacheKey(...variant)).not.toBe(key);
});
it("evicts oldest entries by count and bytes", () => {
  const files = [
    { path: "old", size: 10, modified: 1 },
    { path: "new", size: 10, modified: 3 },
    { path: "middle", size: 10, modified: 2 },
  ];
  expect(pruneList(files, 2, 100)).toEqual(["old"]);
  expect(pruneList(files, 10, 15)).toEqual(["middle", "old"]);
});

it("retains cache protection until every concurrent consumer releases a stem", () => {
  const protection = createStemProtection();
  const first = protection.acquire("mesh"),
    second = protection.acquire("mesh");
  first();
  first();
  expect([...protection.stems()]).toEqual(["mesh"]);
  second();
  expect([...protection.stems()]).toEqual([]);
});
