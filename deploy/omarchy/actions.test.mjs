import * as NodeTest from "node:test";
import * as NodeAssert from "node:assert/strict";
import {
  loomActionCatalog,
  filterLoomActions,
  nativeActions,
  main,
  paths,
  shellQuote,
} from "./loom-os.mjs";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeOS from "node:os";
const test = NodeTest.test;
const config = {
  version: 1,
  profile: "workstation",
  officeUrl: "https://office.example.test",
  atlasUrl: "https://atlas.example.test",
  loomExecutable: "/test/loom",
  officeCli: "/test/office",
  atlasCli: "/test/atlas",
  switchboardCli: "/test/switchboard",
  switchboardUrl: "http://100.64.0.1:8317",
  switchboardDashboardUrl: "https://switchboard.example.test",
  serverExecutable: "/test/t3",
  serverBaseDir: "/test/state",
};
const context = { availableThemes: ["dark", "light"], previousRelease: true };
test("actions are discoverable by ordinary words and keep existing shortcut hints", () => {
  const actions = loomActionCatalog(config, context);
  NodeAssert.equal(new Set(actions.map((a) => a.id)).size, actions.length);
  for (const [query, id] of [
    ["mail", "open-office"],
    ["save", "capture-office"],
    ["AI", "ask-ai"],
    ["connection", "connections"],
    ["notes", "open-office"],
    ["screenshot", "workbench"],
    ["approvals", "desk"],
  ])
    NodeAssert.ok(
      filterLoomActions(actions, query).some((a) => a.id === id),
      query,
    );
  NodeAssert.equal(actions.find((a) => a.id === "find").shortcut, "Super+Ctrl+Alt+F");
  NodeAssert.ok(actions.every((a) => a.title && a.description && Array.isArray(a.args)));
});
test("missing configuration, executables, themes and rollback have clear unavailable reasons", () => {
  const actions = loomActionCatalog(
    { ...config, profile: "laptop", atlasCli: undefined, switchboardCli: undefined },
    { missingExecutables: ["loomExecutable"] },
  );
  for (const id of [
    "open-loom",
    "search-atlas",
    "connect-atlas",
    "ask-ai",
    "iris-dark",
    "rollback",
    "pair",
  ]) {
    const a = actions.find((a) => a.id === id);
    NodeAssert.equal(a.available, false, id);
    NodeAssert.ok(a.unavailableReason.length > 8, id);
  }
  NodeAssert.equal(actions.find((a) => a.id === "open-atlas").available, true);
  NodeAssert.equal(actions.find((a) => a.id === "connections").available, true);
  NodeAssert.equal(
    loomActionCatalog(config, { ...context, pendingActivation: true }).find(
      (a) => a.id === "rollback",
    ).available,
    false,
  );
});
test("opening and cancelling actions does not invoke a capability or collect live health", async () => {
  let executed = 0,
    listed = 0;
  await nativeActions(config, {}, "mail", {
    catalog: async () => {
      listed++;
      return loomActionCatalog(config, context);
    },
    filter: async (query, actions) => {
      NodeAssert.equal(query, "mail");
      NodeAssert.ok(actions.some((a) => a.id === "open-office"));
      return null;
    },
    execute: async () => {
      executed++;
    },
  });
  NodeAssert.equal(listed, 1);
  NodeAssert.equal(executed, 0);
});
test("selection executes only the exact known action and passes literal query text", async () => {
  let executed;
  const query = '"note" $(never) & spaces';
  await nativeActions(config, {}, query, {
    catalog: async () => loomActionCatalog(config, context),
    filter: async (value, actions) => {
      NodeAssert.equal(value, query);
      return actions.find((a) => a.id === "open-office").id;
    },
    show: () => {},
    execute: async (action) => {
      executed = action.args;
    },
  });
  NodeAssert.deepEqual(executed, ["open", "office"]);
  let called = false;
  await NodeAssert.rejects(
    nativeActions(config, {}, "", {
      catalog: async () => loomActionCatalog(config, context),
      filter: async () => "arbitrary; command",
      execute: async () => {
        called = true;
      },
    }),
    /unknown action/i,
  );
  NodeAssert.equal(called, false);
});
test("unavailable selection explains recovery without execution, and returns to the picker", async () => {
  let count = 0,
    executed = 0;
  const messages = [];
  await nativeActions({ ...config, atlasCli: undefined }, {}, "", {
    catalog: async () => loomActionCatalog({ ...config, atlasCli: undefined }, context),
    filter: async () => (++count === 1 ? "search-atlas" : null),
    choose: async () => "Back to actions",
    show: (value) => messages.push(value),
    execute: async () => {
      executed++;
    },
  });
  NodeAssert.equal(count, 2);
  NodeAssert.equal(executed, 0);
  NodeAssert.ok(messages.some((m) => /Atlas.*search client/i.test(m)));
});
test("failed actions provide visible retry without exposing raw errors or automatically repeating work", async () => {
  let count = 0;
  const messages = [];
  await nativeActions(config, {}, "", {
    catalog: async () => loomActionCatalog(config, context),
    filter: async () => "open-office",
    choose: async () => "Close",
    show: (value) => messages.push(value),
    execute: async () => {
      count++;
      throw new Error("private-token-fixture");
    },
  });
  NodeAssert.equal(count, 1);
  NodeAssert.ok(messages.some((m) => /did not finish/.test(m)));
  NodeAssert.ok(!messages.join(" ").includes("private-token-fixture"));
});
test("action query limits and controls are validated before opening the picker", async () => {
  for (const query of ["x".repeat(201), "x\ncommand", "x\u200b"]) {
    let called = false;
    await NodeAssert.rejects(
      nativeActions(config, {}, query, {
        catalog: async () => {
          called = true;
          return [];
        },
      }),
      /query/i,
    );
    NodeAssert.equal(called, false);
  }
  NodeAssert.deepEqual(
    filterLoomActions(loomActionCatalog(config, context), "no-such-action-fixture"),
    [],
  );
});

test("CLI listing checks local capabilities and reports actual personalized shortcuts without leaking configuration", async (t) => {
  const root = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "loom-actions-cli-"));
  t.after(() => NodeFSP.rm(root, { recursive: true, force: true }));
  const env = { HOME: root };
  const p = paths(env);
  await NodeFSP.mkdir(NodePath.dirname(p.configFile), { recursive: true });
  await NodeFSP.writeFile(p.configFile, JSON.stringify(config));
  await NodeFSP.mkdir(NodePath.join(p.config, "hypr"), { recursive: true });
  const command = shellQuote(p.bin) + " open office";
  await NodeFSP.writeFile(
    NodePath.join(p.config, "hypr/bindings.lua"),
    `o.bind("SUPER + F2", "Personal", "unsupported\\z escape")\no.bind("SUPER + F1", "Office", ${JSON.stringify(command)})\n`,
  );
  const saved = console.log;
  let output;
  console.log = (value) => {
    output = value;
  };
  t.after(() => {
    console.log = saved;
  });
  await main(["actions", "--json", "--query", "mail"], env);
  const actions = JSON.parse(output);
  const office = actions.find((a) => a.id === "open-office");
  NodeAssert.equal(office.shortcut, "Super+F1");
  NodeAssert.equal(office.available, true);
  NodeAssert.ok(!output.includes(config.officeUrl) && !output.includes(config.switchboardUrl));
  NodeAssert.equal(actions.find((a) => a.id === "search-office").available, false);
  await NodeFSP.rm(NodePath.join(p.config, "hypr/bindings.lua"));
  await NodeFSP.writeFile(
    NodePath.join(p.config, "hypr/bindings.conf"),
    `bind = SUPER SHIFT, F2, exec, ${command}\n`,
  );
  await main(["actions", "--json", "--query", "mail"], env);
  NodeAssert.equal(
    JSON.parse(output).find((a) => a.id === "open-office").shortcut,
    "Super+Shift+F2",
  );
  await main(["actions", "--json", "--query", "no-such-action-fixture"], env);
  NodeAssert.deepEqual(JSON.parse(output), []);
  for (const args of [["--json", "--inline"], ["--query"], ["--json", "--json"], ["--unknown"]])
    await NodeAssert.rejects(main(["actions", ...args], env));
  console.log = saved;
});
test("retry is explicit and rechecks the selected capability before executing again", async () => {
  let catalogs = 0,
    executes = 0;
  const messages = [];
  await nativeActions(config, {}, "", {
    catalog: async () =>
      loomActionCatalog(
        config,
        ++catalogs === 1 ? context : { ...context, missingExecutables: ["loomExecutable"] },
      ),
    filter: async () => "open-loom",
    choose: async (choices) => (choices.includes("Retry action") ? "Retry action" : "Close"),
    show: (value) => messages.push(value),
    execute: async () => {
      executes++;
      throw new Error("fixture failure");
    },
  });
  NodeAssert.equal(executes, 1);
  NodeAssert.equal(catalogs, 2);
  NodeAssert.ok(messages.some((m) => m.includes("Restore the installed Loom executable")));
});

test("workbench CLI preview works before AI connection and applies app origin validation", async (t) => {
  const root = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "loom-workbench-cli-"));
  t.after(() => NodeFSP.rm(root, { recursive: true, force: true }));
  const env = { HOME: root };
  const p = paths(env);
  await NodeFSP.mkdir(NodePath.dirname(p.configFile), { recursive: true });
  await NodeFSP.writeFile(
    p.configFile,
    JSON.stringify({
      version: 1,
      profile: "laptop",
      officeUrl: config.officeUrl,
      loomExecutable: "/test/loom",
    }),
  );
  const saved = console.log;
  let output;
  console.log = (value) => {
    output = value;
  };
  t.after(() => {
    console.log = saved;
  });
  await main(["workbench", "--text", "Deliberately selected fixture", "--json"], env);
  const preview = JSON.parse(output);
  NodeAssert.equal(preview.readOnly, true);
  NodeAssert.match(preview.preview, /Deliberately selected fixture/);
  NodeAssert.match(preview.preview, /not configured/);
  const file = NodePath.join(root, "app-context.json");
  await NodeFSP.writeFile(
    file,
    JSON.stringify({
      format: "loom-workbench-context",
      version: 1,
      app: "office",
      text: "fixture",
      url: "https://other.example.test/item",
    }),
  );
  await NodeAssert.rejects(
    main(["workbench", "--app-context", file, "--json"], env),
    /configured app/,
  );
});
