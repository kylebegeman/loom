import * as NodeAssert from "node:assert/strict";
import * as NodeTest from "node:test";
const test = NodeTest.test;
import {
  itemReference,
  itemDestination,
  resolveExactItem,
  launchExactItem,
  validateAppIntegration,
  nativeFinder,
  focusExistingApp,
} from "./loom-os.mjs";
const config = {
  officeUrl: "https://office.example.test",
  atlasUrl: "https://atlas.example.test",
  officeCli: "/tools/office",
  atlasCli: "/tools/atlas",
  browserExecutable: "/tools/chromium",
};
function discovery(app) {
  const unavailable = { version: 1, supported: false, reason: "Use the app." };
  return {
    app,
    state: "available",
    manifest: validateAppIntegration(
      {
        format: "loom-app-integration",
        version: { major: 1, minor: 1 },
        app,
        name: app,
        actions: [],
        offline: {
          savedReading: false,
          supportedWriting: false,
          requiresPriorUse: false,
          detail: "Use the app.",
        },
        capabilities: {
          launch: { version: 1, supported: true, path: "/app/" },
          search: unavailable,
          capture: unavailable,
          notifications: unavailable,
          availability: unavailable,
          links: {
            version: 1,
            supported: true,
            path: "/app/",
            format: `${app}-item-links-v1`,
            handoff: "loom-item-handoff-v1",
            operation: {
              id: `${app}.items.resolve`,
              method: "POST",
              path: `/api/${app}/items/resolve`,
              command: [app, "items-resolve"],
              effect: "read",
              mutation: "read-only",
              approval: "none",
              surfaces: ["api", "cli", "mcp"],
              scopes: [],
            },
          },
        },
      },
      app,
    ),
  };
}
const officeRef = { kind: "event", id: "café & saved/id", recurrenceDate: "2026-10-12" };
const atlasRef = { kind: "source", id: "saved", revision: 2, versionId: "immutable-original" };
const route = (ref) =>
  `/app/?${new URLSearchParams({ item: ref.kind, id: ref.id, ...(ref.recurrenceDate ? { occurrence: ref.recurrenceDate } : {}), ...(ref.revision ? { revision: String(ref.revision) } : {}), ...(ref.versionId ? { version: ref.versionId } : {}) })}`;
test("typed Office records and Atlas retained versions reach the owning read-only CLI with literal JSON", async () => {
  for (const [app, ref] of [
    ["office", officeRef],
    ["atlas", atlasRef],
  ]) {
    const specs = [];
    const destination = await resolveExactItem(
      app,
      ref,
      config,
      {},
      {
        discover: async () => discovery(app),
        resolve: async (spec) => {
          specs.push(spec);
          return app === "office"
            ? { items: [{ reference: ref, canonicalURL: route(ref), status: "live" }] }
            : { reference: ref, path: route(ref) };
        },
      },
    );
    NodeAssert.equal(destination.origin, config[`${app}Url`]);
    NodeAssert.equal(destination.searchParams.get("id"), ref.id);
    NodeAssert.equal(specs[0].env.API_URL, config[`${app}Url`]);
    NodeAssert.deepEqual(specs[0].args.slice(0, 2), [app, "items-resolve"]);
    NodeAssert.equal(specs[0].args.at(-1), "--json");
    NodeAssert.deepEqual(JSON.parse(specs[0].args[3]), ref);
    if (app === "office") NodeAssert.ok(specs[0].args.includes("--header-only=true"));
  }
});
test("destinations reject foreign origins, ambiguous identity, credentials and mismatched retained versions", () => {
  for (const [app, ref] of [
    ["office", officeRef],
    ["atlas", atlasRef],
  ]) {
    for (const path of [
      "https://evil.test" + route(ref),
      "//evil.test" + route(ref),
      route(ref) + "#private",
      route(ref) + "&id=other",
      route(ref) + "&token=secret",
      route({ ...ref, id: "wrong" }),
    ])
      NodeAssert.throws(() => itemDestination(app, path, ref, config[`${app}Url`]));
  }
  NodeAssert.throws(() =>
    itemDestination(
      "atlas",
      route({ ...atlasRef, versionId: "different" }),
      atlasRef,
      config.atlasUrl,
    ),
  );
  for (const ref of [
    { ...atlasRef, revision: 0 },
    { ...atlasRef, versionId: "" },
    { ...atlasRef, id: "\u202econcealed" },
    { ...atlasRef, id: "é".repeat(76) },
  ])
    NodeAssert.throws(() => itemReference("atlas", ref));
});
test("deleted, missing and future-format items do not silently open the app", async () => {
  for (const items of [
    [],
    [{ reference: officeRef, canonicalURL: "/app/?view=deleted", status: "deleted" }],
  ])
    await NodeAssert.rejects(
      resolveExactItem(
        "office",
        officeRef,
        config,
        {},
        { discover: async () => discovery("office"), resolve: async () => ({ items }) },
      ),
      /deleted|access/,
    );
  await NodeAssert.rejects(
    resolveExactItem(
      "atlas",
      atlasRef,
      config,
      {},
      { discover: async () => ({ state: "legacy" }) },
    ),
    /does not support/,
  );
  const raw = discovery("atlas").manifest;
  raw.capabilities.links.handoff = "future-v2";
  NodeAssert.equal(validateAppIntegration(raw, "atlas").capabilities.links.supported, false);
  raw.capabilities.links.operation.effect = "write";
  NodeAssert.throws(() => validateAppIntegration(raw, "atlas"), /read-only/);
});
test("merged Office people use only their resolved canonical identity", async () => {
  const next = { kind: "person", id: "survivor" };
  const value = await resolveExactItem(
    "office",
    { kind: "person", id: "merged" },
    config,
    {},
    {
      discover: async () => discovery("office"),
      resolve: async () => ({
        items: [{ reference: next, canonicalURL: route(next), status: "live" }],
      }),
    },
  );
  NodeAssert.equal(value.searchParams.get("id"), "survivor");
});
test("native handoff closes only its nonce-labelled stateless window and focuses the reused app", async () => {
  let nonce;
  const dispatch = [];
  let focused = 0;
  let target;
  const result = await launchExactItem(
    "office",
    new URL(route(officeRef), config.officeUrl),
    config,
    { HOME: "/tmp/loom-item-fixture" },
    {
      focus: async () => {
        focused++;
        return true;
      },
      launch: async (spec) => {
        target = new URL(spec.args.find((v) => v.startsWith("--app=")).slice(6));
        nonce = target.searchParams.get("loomHandoff");
      },
      query: async (args) => {
        dispatch.push(args);
        if (args[0] === "clients")
          return {
            stdout: JSON.stringify([
              { class: "unrelated", address: "0x99", title: `Loom handoff ${nonce}: complete` },
              {
                class: "chrome-office.example.test__app_-Default",
                address: "0x02",
                title: "Office workspace",
              },
              {
                class: "chrome-office.example.test__app_-Default",
                address: "0x03",
                title: `Loom handoff ${nonce}: complete`,
              },
            ]),
          };
        return { stdout: "ok" };
      },
    },
  );
  NodeAssert.equal(result.state, "handed-off");
  NodeAssert.equal(target.searchParams.get("loomReuse"), "1");
  NodeAssert.equal(target.searchParams.get("id"), officeRef.id);
  NodeAssert.equal(focused, 2);
  NodeAssert.ok(JSON.stringify(dispatch).includes("address:0x03"));
  NodeAssert.ok(!JSON.stringify(dispatch).includes("address:0x02"));
  NodeAssert.ok(!JSON.stringify(dispatch).includes("address:0x99"));
});
test("native login and business windows are never closed, and unavailable delivery has explicit recovery", async () => {
  for (const unavailable of [false, true]) {
    let nonce;
    const calls = [];
    const work = launchExactItem(
      "atlas",
      new URL(route(atlasRef), config.atlasUrl),
      config,
      { HOME: "/tmp/loom-item-fixture" },
      {
        focus: async () => true,
        launch: async (spec) => {
          nonce = new URL(spec.args.find((v) => v.startsWith("--app=")).slice(6)).searchParams.get(
            "loomHandoff",
          );
        },
        pause: async () => {},
        query: async (args) => {
          calls.push(args);
          return {
            stdout:
              args[0] === "clients"
                ? JSON.stringify([
                    {
                      class: "chrome-atlas.example.test__app_-Default",
                      address: "0x04",
                      title: unavailable
                        ? `Loom handoff ${nonce}: unavailable`
                        : "Sign in to Atlas",
                    },
                  ])
                : "ok",
          };
        },
      },
    );
    if (unavailable) await NodeAssert.rejects(work, /could not accept/);
    else {
      NodeAssert.equal((await work).state, "launched");
      NodeAssert.ok(calls.every((args) => args[0] === "clients"));
    }
  }
});
test("ordinary launch focus ignores stateless handoff windows", async () => {
  const focused = [];
  await focusExistingApp("office", config, {}, async (args) => {
    if (args[0] === "clients")
      return {
        stdout: JSON.stringify([
          {
            class: "chrome-office.example.test__app_-Default",
            address: "0x11",
            title: "Loom handoff 10000000-0000-4000-8000-000000000001: waiting",
          },
          { class: "chrome-office.example.test__app_-Default", address: "0x12", title: "Office" },
        ]),
      };
    focused.push(args);
    return { stdout: "ok" };
  });
  NodeAssert.ok(JSON.stringify(focused).includes("address:0x12"));
  NodeAssert.ok(!JSON.stringify(focused).includes("address:0x11"));
});
test("Finder Open item passes the selected typed identity without writing the clipboard", async () => {
  const choices = ["1. Saved note (notes)", "Open item"];
  const opened = [];
  await nativeFinder(config, { HOME: "/tmp/loom-item-fixture" }, "office", {
    discover: async () => ({ state: "legacy" }),
    input: async () => "query never becomes a URL",
    search: async () => ({
      items: [
        {
          reference: { kind: "note", id: "saved" },
          title: "Saved note",
          snippet: "https://evil.test",
          app: "notes",
        },
      ],
    }),
    show: () => {},
    choose: async () => choices.shift(),
    copy: async () => {
      NodeAssert.fail("Opening must not alter the clipboard");
    },
    openItem: async (...args) => opened.push(args),
  });
  NodeAssert.deepEqual(opened, [["office", { kind: "note", id: "saved" }]]);
});
