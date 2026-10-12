import * as NodeAssert from "node:assert/strict";
import * as NodeHttp from "node:http";
import * as NodeTest from "node:test";
const test = NodeTest.test;
import {
  validateAppIntegration,
  discoverAppIntegration,
  integratedSearchCommand,
  integratedCaptureCommand,
  integrationSearchResults,
  nativeFinder,
} from "./loom-os.mjs";

const config = {
  officeUrl: "https://office.example.test",
  atlasUrl: "https://atlas.example.test",
  officeCli: "/tools/office",
  atlasCli: "/tools/atlas",
  browserExecutable: "/tools/chromium",
};
function declaration(app = "atlas") {
  const operation = (id, write = false) => ({
    id,
    method: "POST",
    path: `/api/${app}/${id.slice(app.length + 1).replaceAll(".", "/")}`,
    command: [app, id.slice(app.length + 1).replaceAll(".", "-")],
    scopes: [`${app}:read`],
    surfaces: ["api", "cli", "mcp"],
    effect: write ? "write" : "read",
    mutation: write ? "idempotent" : "read-only",
    approval: "none",
  });
  const unavailable = { version: 1, supported: false, reason: "Use the app directly." };
  return {
    format: "loom-app-integration",
    version: { major: 1, minor: 0 },
    app,
    name: app,
    actions: [
      { id: "open", label: "Open", capability: "launch" },
      { id: "search", label: "Search", capability: "search" },
    ],
    capabilities: {
      launch: { version: 1, supported: true, path: "/app/" },
      search: {
        version: 1,
        supported: true,
        operation: operation(app === "atlas" ? "atlas.workspace.search" : "office.search"),
        format: app === "atlas" ? "atlas-workspace-search-v1" : "office-search-v1",
        queryLimit: app === "atlas" ? 200 : 500,
        queryUnit: app === "atlas" ? "utf8-bytes" : "characters",
      },
      capture: {
        version: 1,
        supported: true,
        ...(app === "office"
          ? { path: "/app/share", format: "review-in-app-v1", reviewed: true }
          : { operation: operation("atlas.sources.capture", true), format: "private-source-v1" }),
        captureUnit: app === "office" ? "utf16-units" : "utf8-bytes",
        titleLimit: 200,
        textLimit: app === "office" ? 4000 : 65536,
        urlLimit: app === "office" ? 2048 : 2000,
        destinations: [app === "office" ? "note" : "source"],
      },
      links: { ...unavailable },
      notifications: { ...unavailable },
      availability: { ...unavailable },
    },
    offline: {
      savedReading: app === "office",
      supportedWriting: app === "office",
      requiresPriorUse: app === "office",
      detail: "Prior app use required. This is not live cache status.",
    },
  };
}
const discover = (value) => async (app) => ({
  app,
  state: "available",
  manifest: validateAppIntegration(value, app),
});
const response = (value, options = {}) =>
  new Response(typeof value === "string" ? value : JSON.stringify(value), {
    headers: { "Content-Type": "application/json" },
    ...options,
  });

test("v1 accepts additive metadata and disables only capabilities it cannot understand", () => {
  const m = declaration();
  m.version.minor = 12;
  m.future = { ignored: true };
  m.capabilities.search.version = 2;
  m.actions.push({ id: "future", label: "Future", capability: "future" });
  const normalized = validateAppIntegration(m, "atlas");
  NodeAssert.equal(normalized.capabilities.launch.supported, true);
  NodeAssert.equal(normalized.capabilities.search.supported, false);
  NodeAssert.match(normalized.capabilities.search.reason, /version 2/);
  NodeAssert.equal(normalized.actions[2].available, false);
  m.version.major = 2;
  NodeAssert.throws(() => validateAppIntegration(m, "atlas"), /Unsupported/);
});

test("wrong app, missing capabilities, unsafe paths and literal CLI mismatches are rejected", () => {
  const mutations = [
    (m) => {
      m.app = "office";
    },
    (m) => {
      delete m.capabilities.links;
    },
    (m) => {
      m.capabilities.links.reason = "";
    },
    (m) => {
      m.actions.push(m.actions[0]);
    },
    (m) => {
      m.capabilities.search.operation.command = ["atlas", "workspace-search;evil"];
    },
    (m) => {
      m.capabilities.search.operation.effect = "write";
    },
    (m) => {
      m.capabilities.search.operation.mutation = "idempotent";
    },
    (m) => {
      m.capabilities.search.operation.approval = "human";
    },
  ];
  for (const mutate of mutations) {
    const m = declaration();
    mutate(m);
    NodeAssert.throws(() => validateAppIntegration(m, "atlas"));
  }
  for (const path of [
    "//evil.test/app/",
    "/app/../bad",
    "/app/%2e%2e/bad",
    "/app/\\bad",
    "/app/a?token=x",
    "https://evil.test/app/",
    "/app/%2fsecret",
  ]) {
    const m = declaration();
    m.capabilities.launch.path = path;
    NodeAssert.throws(() => validateAppIntegration(m, "atlas"), /path/);
  }
  const m = declaration();
  m.capabilities.search.format = "future-search";
  NodeAssert.equal(validateAppIntegration(m, "atlas").capabilities.search.supported, false);
});

test("discovery distinguishes missing releases from invalid, redirected and protected responses", async () => {
  for (const status of [404, 410, 401, 403, 500, 302]) {
    const report = await discoverAppIntegration("atlas", config, {
      request: async () => response("", { status }),
    });
    NodeAssert.equal(report.state, [404, 410].includes(status) ? "legacy" : "unavailable");
  }
  for (const r of [
    response("not json"),
    response(declaration("office")),
    response(declaration(), { headers: { "Content-Type": "text/html" } }),
    response(" ".repeat(128 * 1024 + 1)),
    response("{}", {
      headers: { "Content-Type": "application/json", "Content-Length": String(128 * 1024 + 1) },
    }),
  ]) {
    NodeAssert.equal(
      (await discoverAppIntegration("atlas", config, { request: async () => r })).state,
      "unavailable",
    );
  }
  const report = await discoverAppIntegration("atlas", config, {
    request: async () => {
      throw Error("secret-fixture-credential");
    },
  });
  NodeAssert.equal(report.state, "unavailable");
  NodeAssert.ok(!report.detail.includes("secret-fixture"));
  const newer = declaration();
  newer.version.major = 2;
  NodeAssert.match(
    (await discoverAppIntegration("atlas", config, { request: async () => response(newer) }))
      .detail,
    /newer LoomOS/,
  );
});

test("actual HTTP discovery is anonymous, same-origin, read-only and refuses redirects", async (t) => {
  const seen = [];
  const server = NodeHttp.createServer((req, res) => {
    seen.push({
      method: req.method,
      path: req.url,
      authorization: req.headers.authorization,
      cookie: req.headers.cookie,
    });
    if (seen.length === 1) {
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify(declaration()));
    } else {
      res.writeHead(302, { Location: "/do-not-follow" });
      res.end();
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const cfg = { ...config, atlasUrl: `http://127.0.0.1:${server.address().port}` };
  NodeAssert.equal((await discoverAppIntegration("atlas", cfg)).state, "available");
  NodeAssert.equal((await discoverAppIntegration("atlas", cfg)).state, "unavailable");
  NodeAssert.deepEqual(
    seen,
    [1, 2].map(() => ({
      method: "GET",
      path: "/.well-known/loom-app",
      authorization: undefined,
      cookie: undefined,
    })),
  );
});

test("modern search preserves literal arguments and app origin with app-specific Unicode limits", async () => {
  const query = "research & $(literal) `text`";
  const spec = await integratedSearchCommand(
    "atlas",
    query,
    config,
    {},
    { discover: discover(declaration()) },
  );
  NodeAssert.deepEqual(spec.args, [
    "atlas",
    "workspace-search",
    "--query",
    query,
    "--limit",
    "20",
    "--json",
  ]);
  NodeAssert.equal(spec.env.API_URL, config.atlasUrl);
  NodeAssert.equal(spec.resultFormat, "atlas-workspace-search-v1");
  await NodeAssert.rejects(
    integratedSearchCommand(
      "atlas",
      "é".repeat(101),
      config,
      {},
      { discover: discover(declaration()) },
    ),
    /UTF-8 bytes/,
  );
  const office = await integratedSearchCommand(
    "office",
    "😀".repeat(500),
    config,
    {},
    { discover: discover(declaration("office")) },
  );
  NodeAssert.equal(office.args[3], "😀".repeat(500));
  const legacy = await integratedSearchCommand(
    "atlas",
    query,
    config,
    {},
    { discover: async () => ({ state: "legacy" }) },
  );
  NodeAssert.equal(legacy.args[1], "sources-list");
  await NodeAssert.rejects(
    integratedSearchCommand(
      "atlas",
      query,
      config,
      {},
      { discover: async () => ({ state: "unavailable", detail: "Invalid declaration" }) },
    ),
    /Invalid declaration/,
  );
});

test("capture negotiates review, private-source saving and length units without inventing authority", async () => {
  const env = { HOME: "/tmp/loom-test-home", XDG_DATA_HOME: "/tmp/loom-test-data" };
  const office = await integratedCaptureCommand(
    "office",
    { title: "Save", text: "Literal & text" },
    config,
    env,
    { discover: discover(declaration("office")) },
  );
  NodeAssert.equal(office.reviewed, true);
  NodeAssert.ok(
    office.args.some((arg) => arg.includes("/app/share?title=Save&text=Literal+%26+text")),
  );
  const atlas = await integratedCaptureCommand(
    "atlas",
    { title: "Save", text: "Literal $(text)", url: "https://example.test/evidence" },
    config,
    env,
    { discover: discover(declaration()) },
  );
  NodeAssert.equal(atlas.reviewed, false);
  NodeAssert.deepEqual(atlas.args, [
    "atlas",
    "sources-capture",
    "--title",
    "Save",
    "--text",
    "Literal $(text)",
    "--url",
    "https://example.test/evidence",
    "--audience",
    "private",
    "--topics",
    "omarchy",
    "--json",
  ]);
  await NodeAssert.rejects(
    integratedCaptureCommand("atlas", { title: "é".repeat(101), text: "text" }, config, env, {
      discover: discover(declaration()),
    }),
    /200 utf8-bytes/,
  );
  await NodeAssert.rejects(
    integratedCaptureCommand("office", { text: "😀".repeat(2001) }, config, env, {
      discover: discover(declaration("office")),
    }),
    /4000 utf16-units/,
  );
  const m = declaration();
  m.capabilities.capture = { version: 1, supported: false, reason: "Capture inside Atlas." };
  await NodeAssert.rejects(
    integratedCaptureCommand("atlas", { title: "Save", text: "text" }, config, env, {
      discover: discover(m),
    }),
    /Capture inside Atlas/,
  );
});

test("workspace results retain exact references and sanitize terminal text", () => {
  const page = integrationSearchResults(
    "atlas",
    {
      matches: [
        {
          kind: "output",
          id: "output-1",
          revision: 3,
          versionId: "v1",
          title: "A\u001bTitle",
          snippet: "A\nSnippet",
        },
      ],
      next: "",
      coverage: "Saved current work",
    },
    "atlas-workspace-search-v1",
  );
  NodeAssert.deepEqual(page.results[0].reference, {
    kind: "output",
    id: "output-1",
    revision: 3,
    versionId: "v1",
  });
  NodeAssert.equal(page.results[0].title, "A Title");
  NodeAssert.equal(page.more, false);
  NodeAssert.throws(() =>
    integrationSearchResults(
      "atlas",
      { matches: [{ kind: "unknown" }], next: "", coverage: "Saved work" },
      "atlas-workspace-search-v1",
    ),
  );
});

test("native Finder cancellation performs no discovery, credential read or search", async () => {
  const calls = [];
  await nativeFinder(config, {}, "atlas", {
    input: async () => null,
    discover: async () => {
      calls.push("discovery");
    },
    search: async () => {
      calls.push("search");
    },
    login: async () => {
      calls.push("login");
    },
  });
  NodeAssert.deepEqual(calls, []);
});

test("native Finder consumes modern Atlas results and recovers from unavailable capabilities", async () => {
  const shown = [],
    specs = [];
  await nativeFinder(config, {}, "atlas", {
    input: async () => "topic",
    discover: discover(declaration()),
    search: async (spec) => {
      specs.push(spec);
      return { matches: [], next: "", coverage: "Research and Presence" };
    },
    show: (line) => shown.push(line),
    choose: async () => "Close",
  });
  NodeAssert.equal(specs[0].args[1], "workspace-search");
  NodeAssert.ok(shown.includes("Research and Presence"));
  const m = declaration();
  m.capabilities.search.version = 2;
  await nativeFinder(config, {}, "atlas", {
    input: async () => "topic",
    discover: discover(m),
    search: async () => NodeAssert.fail("unsupported search executed"),
    show: (line) => shown.push(line),
    choose: async () => "Close",
  });
  NodeAssert.ok(shown.some((line) => line.includes("version 2")));
});
