import { expect, it } from "vite-plus/test";
import { explainVariables } from "./variableResolution";
it("explains precedence, nested missing values, cycles, script captures and Vault without revealing secrets", () => {
  const request = {
    endpoint: "<<url>>/<<id>>/<<cycle>>/<<private>>/<<scripted>>",
    requestVariables: [{ key: "id", value: "request" }],
    preRequestScript: 'pw.env.set("scripted", "ok")',
  };
  const rows = explainVariables(
    request,
    [{ key: "id", value: "collection", secret: false }],
    [
      { key: "url", value: "https://<<host>>", secret: false },
      { key: "id", value: "environment", secret: false },
      { key: "cycle", value: "<<cycle>>", secret: false },
      { key: "private", value: "must-not-display", secret: true },
    ],
    "Staging",
  );
  expect(rows.find((r) => r.key === "id")).toMatchObject({
    value: "request",
    source: "Request variable",
  });
  expect(rows.find((r) => r.key === "url")?.status).toBe("host: Missing value");
  expect(rows.find((r) => r.key === "cycle")?.status).toContain("Circular reference");
  expect(rows.find((r) => r.key === "scripted")?.status).toBe("Set by a script at runtime");
  expect(rows.find((r) => r.key === "private")?.value).toBe("");
});
