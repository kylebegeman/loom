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
  expect(importCurl("curl https://example.com --data-urlencode '=hello world'").body.body).toBe(
    "hello%20world",
  );
  for (const source of [
    "curl https://example.com; touch /tmp/pwn",
    "curl https://example.com -d @/etc/passwd",
    "curl https://example.com --data-urlencode name@/etc/passwd",
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
it("honors operation servers and parameter overrides, including cookie parameters", () => {
  const result = importOpenApi(
    JSON.stringify({
      openapi: "3.0.3",
      info: { title: "Overrides" },
      servers: [{ url: "https://root.test" }],
      paths: {
        "/x": {
          servers: [{ url: "https://path.test" }],
          parameters: [{ name: "q", in: "query", required: true, example: "old" }],
          get: {
            operationId: "get",
            servers: [{ url: "https://{region}.test", variables: { region: { default: "west" } } }],
            parameters: [
              { name: "q", in: "query", required: true, example: "new" },
              { name: "session", in: "cookie", required: true },
            ],
            responses: {},
          },
        },
      },
    }),
  );
  const parsed = importHoppscotch(result.collection, "openapi.json");
  if (parsed.kind !== "collections") throw new Error("Expected collection");
  expect(parsed.requests[0]!.source).toMatchObject({
    endpoint: "https://<<region>>.test/x",
    params: [{ key: "q", value: "new", active: true }],
    headers: [{ key: "Cookie", value: "session=<<session>>", active: true }],
  });
  expect(parsed.requests[0]!.variables).toContainEqual({
    key: "region",
    value: "west",
    secret: false,
  });
});
