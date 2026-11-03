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
    prepareHoppscotchRequest(make({ contentType: "multipart/form-data", body: "invalid" }), {
      origin: "http://localhost",
      username: "user",
      password: "pass",
    }),
  ).toThrow(/body/i);
});

it("encodes native multipart text and repeated files with explicit uploads and an authoritative boundary", async () => {
  const pack = importHoppscotch(
    JSON.stringify([
      {
        ...native,
        folders: [],
        requests: [
          {
            ...native.folders[0]!.requests[0]!,
            method: "POST",
            endpoint: "http://localhost/upload",
            auth: { authType: "none" },
            params: [],
            headers: [
              { key: "Content-Type", value: "multipart/form-data; boundary=stale", active: true },
            ],
            body: {
              contentType: "multipart/form-data",
              body: [
                { key: "title", value: "<<label>>", active: true, isFile: false },
                {
                  key: "title",
                  value: "second",
                  active: true,
                  isFile: false,
                  contentType: "text/plain",
                },
                { key: "documents", value: [null], active: true, isFile: true },
                { key: "ignored", value: "<<missing>>", active: false, isFile: false },
              ],
            },
          },
        ],
      },
    ]),
    "multipart.json",
  );
  if (pack.kind !== "collections") throw Error("wrong fixture");
  const uploads = [
    {
      fieldIndex: 2,
      fileName: 'report".txt',
      contentType: "text/plain",
      base64: Buffer.from("fixture file").toString("base64"),
    },
    { fieldIndex: 2, fileName: "bytes.bin", contentType: "", base64: "AAEC/w==" },
  ];
  const prepared = prepareHoppscotchRequest(
    pack.requests[0]!,
    { label: "hello café" },
    undefined,
    uploads,
  );
  expect(prepared.bodyEncoding).toBe("base64");
  expect(prepared.headers["content-type"]).toMatch(/^multipart\/form-data; boundary=----loom-/);
  const form = await new Response(new Uint8Array(Buffer.from(prepared.body, "base64")), {
    headers: prepared.headers,
  }).formData();
  expect(form.getAll("title")).toEqual(["hello café", "second"]);
  expect(form.has("ignored")).toBe(false);
  const documents = form.getAll("documents") as File[];
  expect(documents).toHaveLength(2);
  expect(documents[0]!.name).toBe('report".txt');
  expect(await documents[0]!.text()).toBe("fixture file");
  expect(new Uint8Array(await documents[1]!.arrayBuffer())).toEqual(new Uint8Array([0, 1, 2, 255]));
  for (const invalid of [
    [],
    [{ ...uploads[0]!, base64: "invalid" }],
    [{ ...uploads[0]!, fieldIndex: 0 }],
    [{ ...uploads[0]!, fileName: "bad\r\nheader" }],
    [{ ...uploads[0]!, contentType: "text/plain\r\nInjected: yes" }],
  ])
    expect(() =>
      prepareHoppscotchRequest(pack.requests[0]!, { label: "ok" }, undefined, invalid),
    ).toThrow(/file|upload/i);
  expect(() =>
    prepareHoppscotchRequest(pack.requests[0]!, { label: "ok" }, undefined, [
      { ...uploads[0]!, base64: Buffer.alloc(131072).toString("base64") },
    ]),
  ).toThrow(/128 KiB/);
});
