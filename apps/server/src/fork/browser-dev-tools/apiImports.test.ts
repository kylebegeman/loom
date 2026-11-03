import { expect, it } from "@effect/vitest";
import { importCurl, importOpenApi } from "./apiImports.ts";
import { applyRequestEdits, importHoppscotch } from "./hoppscotch.ts";
it("parses copied cURL as data and refuses shell programs, file reads and unsupported flags", () => {
  expect(
    importCurl(
      `curl 'https://example.com/api' -H 'Content-Type: application/json' --data-raw '{"name":"$(never executed)"}'`,
    ),
  ).toMatchObject({
    method: "POST",
    endpoint: "https://example.com/api",
    body: { contentType: "application/json", body: '{"name":"$(never executed)"}' },
  });
  for (const source of [
    "curl https://example.com; touch /tmp/pwn",
    "curl https://example.com -d @/etc/passwd",
    "curl https://example.com --config /tmp/config",
    "curl https://example.com | sh",
  ])
    expect(() => importCurl(source)).toThrow();
});
it("imports OpenAPI parameters, examples, auth and stable operation identities across reordering", () => {
  const source = {
    openapi: "3.1.0",
    info: { title: "Fixture" },
    servers: [{ url: "https://example.com" }],
    components: { securitySchemes: { token: { type: "http", scheme: "bearer" } } },
    security: [{ token: [] }],
    paths: {
      "/accounts/{id}": {
        get: {
          operationId: "readAccount",
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string", example: "one" } },
          ],
          responses: {},
        },
      },
    },
  };
  const result = importOpenApi(JSON.stringify(source));
  const parsed = importHoppscotch(result.collection, "openapi.json");
  if (parsed.kind !== "collections") throw new Error("Expected collection");
  expect(parsed.requests[0]).toMatchObject({
    id: "openapi.json/operation:readAccount",
    source: {
      endpoint: "https://example.com/accounts/<<id>>",
      auth: { authType: "bearer", token: "<<token>>" },
    },
  });
  const edited = applyRequestEdits(result.collection, "openapi.json", {
    [parsed.requests[0]!.id]: JSON.stringify({ ...parsed.requests[0]!.source, name: "My label" }),
  });
  expect(edited).toContain("My label");
  expect(JSON.parse(result.environment).variables).toContainEqual({
    key: "id",
    initialValue: "one",
    secret: false,
  });
  expect(() =>
    importOpenApi("openapi: 3.1.0\npaths:\n  /x:\n    $ref: https://example.com/untrusted"),
  ).toThrow();
});
