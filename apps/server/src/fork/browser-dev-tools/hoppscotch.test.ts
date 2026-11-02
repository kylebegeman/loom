import { expect, it } from "@effect/vitest";
import { importHoppscotch, prepareHoppscotchRequest, resolveVariables } from "./hoppscotch.ts";
const native = {
  v: 12,
  name: "Workflow",
  folders: [
    {
      v: 12,
      name: "Accounts",
      folders: [],
      requests: [
        {
          v: "17",
          id: "login",
          name: "Read account",
          method: "GET",
          endpoint: "<<origin>>/account",
          auth: { authType: "inherit", authActive: true },
          params: [{ key: "q", value: "<<query>>", active: true }],
          headers: [],
          body: { contentType: null, body: null },
          requestVariables: [],
          preRequestScript: 'pw.env.set("token", "captured");',
          testScript: 'pw.test("ok", () => pw.expect(pw.response.status).toBe(200));',
          responses: {},
          customFutureField: { preserved: true },
        },
      ],
    },
  ],
  requests: [],
  auth: { authType: "bearer", authActive: true, token: "<<token>>" },
  headers: [{ key: "X-Workspace", value: "fixture", active: true }],
  variables: [],
};
it("preserves native hierarchy, scripts and unknown fields while resolving inherited authentication and explicit variables", () => {
  const pack = importHoppscotch(JSON.stringify([native]), "collections.json");
  expect(pack.kind).toBe("collections");
  if (pack.kind !== "collections") return;
  expect(pack.source).toEqual([native]);
  expect(pack.requests).toHaveLength(1);
  const request = pack.requests[0]!;
  expect(request.folders).toEqual(["Workflow", "Accounts"]);
  expect(request.preScripts).toEqual([native.folders[0]!.requests[0]!.preRequestScript]);
  const resolved = prepareHoppscotchRequest(request, {
    origin: "http://localhost:3000",
    query: "a & b",
    token: "captured",
  });
  expect(resolved.url).toBe("http://localhost:3000/account?q=a+%26+b");
  expect(resolved.headers).toEqual({ authorization: "Bearer captured", "x-workspace": "fixture" });
  expect(() =>
    prepareHoppscotchRequest(request, { origin: "http://localhost:3000", token: "captured" }),
  ).toThrow(/variable/i);
});
it("accepts environment objects and arrays without replacing cleared current values with initial values", () => {
  const env = {
    v: 2,
    name: "Local",
    variables: [
      { key: "token", initialValue: "old", currentValue: "", secret: true },
      { key: "origin", initialValue: "http://localhost", currentValue: "", secret: false },
    ],
  };
  const parsed = importHoppscotch(JSON.stringify(env), "local.environment.json");
  expect(parsed.kind).toBe("environments");
  if (parsed.kind !== "environments") return;
  expect(parsed.source).toEqual(env);
  expect(parsed.environments[0]!.variables.map((v) => v.value)).toEqual(["", "http://localhost"]);
  expect(importHoppscotch(JSON.stringify([env]), "environments.json").kind).toBe("environments");
});
it("rejects ambiguous, malformed and future formats without silently dropping requests", () => {
  for (const value of [
    [],
    [{}],
    [{ ...native, v: 999 }],
    [{ ...native, requests: [null] }],
    { openapi: "3.1.0" },
  ]) {
    expect(() => importHoppscotch(JSON.stringify(value), "input.json")).toThrow();
  }
  expect(() =>
    resolveVariables("<<first>>", { first: "<<second>>", second: "<<first>>" }),
  ).toThrow();
});
it("encodes form bodies and basic auth and refuses unsupported bodies before dispatch", () => {
  const make = (body: unknown) => {
    const parsed = importHoppscotch(
      JSON.stringify([
        {
          ...native,
          folders: [],
          requests: [
            {
              ...native.folders[0]!.requests[0]!,
              method: "POST",
              auth: {
                authType: "basic",
                authActive: true,
                username: "<<username>>",
                password: "<<password>>",
              },
              params: [],
              body,
            },
          ],
        },
      ]),
      "collection.json",
    );
    if (parsed.kind !== "collections") throw new Error("wrong fixture");
    return parsed.requests[0]!;
  };
  const request = make({
    contentType: "application/x-www-form-urlencoded",
    body: [{ key: "message", value: "<<message>>", active: true }],
  });
  const resolved = prepareHoppscotchRequest(request, {
    origin: "http://localhost",
    username: "user",
    password: "pass",
    message: "a & b",
  });
  expect(resolved.body).toBe("message=a+%26+b");
  expect(resolved.headers.authorization).toBe("Basic dXNlcjpwYXNz");
  const upload = prepareHoppscotchRequest(
    make({ contentType: "application/octet-stream", body: null }),
    { origin: "http://localhost", username: "user", password: "pass" },
    "AAEC/w==",
  );
  expect(upload.bodyEncoding).toBe("base64");
  expect(Buffer.from(upload.body, "base64")).toEqual(Buffer.from([0, 1, 2, 255]));
  expect(() =>
    prepareHoppscotchRequest(make({ contentType: "application/octet-stream", body: null }), {
      origin: "http://localhost",
      username: "user",
      password: "pass",
    }),
  ).toThrow(/body/i);
  expect(() =>
    prepareHoppscotchRequest(make({ contentType: "multipart/form-data", body: [] }), {
      origin: "http://localhost",
      username: "user",
      password: "pass",
    }),
  ).toThrow(/body/i);
});
