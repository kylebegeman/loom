import { expect, it } from "@effect/vitest";
import { readBrowserDiagnostics } from "./browserDiagnostics.ts";
it("reads bounded existing captures and removes credentials and queries from network URLs", () => {
  const result = readBrowserDiagnostics({
    page: { url: () => "https://example.test/app?token=hidden" },
    consoleEntries: Array.from({ length: 120 }, () => ({
      level: "error",
      text: "x".repeat(3000),
      timestamp: "2026-11-02T00:00:00Z",
    })),
    networkEntries: [
      {
        url: "https://user:password@example.test/api?token=hidden",
        method: "GET",
        status: 503,
        failed: false,
        timestamp: "2026-11-02T00:00:00Z",
      },
    ],
  });
  expect(result.consoleEntries).toHaveLength(100);
  expect(result.consoleEntries[0]?.text).toHaveLength(2000);
  expect(result.url).toBe("https://example.test/app");
  expect(result.networkEntries[0]?.url).toBe("https://example.test/api");
});
