import * as NodeTest from "node:test";
import * as NodeAssert from "node:assert/strict";
import {
  atlasDeskRows,
  collectControlDesk,
  controlDeskAction,
  deskOperation,
  formatControlDesk,
  loomDeskRows,
  loomThreadDestination,
  nativeControlDesk,
  officeDeskRows,
  scheduledDeskRows,
} from "./control-desk.mjs";
const config = {
  serverPort: 3774,
  serverBaseDir: "/owned/state",
  serverExecutable: "/owned/t3",
  browserExecutable: "/browser",
  officeUrl: "https://office.test",
  officeCli: "/office",
  atlasUrl: "https://atlas.test",
  atlasCli: "/atlas",
};
const environment = { environmentId: "env-one", label: "Workstation" };
const fullSession = {
  authenticated: true,
  permissions: ["orchestration:read", "orchestration:operate"],
};
const thread = (changes = {}) => ({
  id: "thread-one",
  title: "Existing work",
  status: "running",
  activeRunId: "run-one",
  pendingRuntimeRequest: null,
  updatedAt: "2026-10-12T12:00:00Z",
  ...changes,
});
const schedule = (changes = {}) => ({
  scheduledTaskId: "schedule-one",
  title: "Existing schedule",
  enabled: true,
  lastRunStatus: "never",
  boundThreadId: "thread-one",
  ...changes,
});
const operation = (id, command, changes = {}) => ({
  id,
  command,
  effect: "read",
  mutation: "read-only",
  approval: "none",
  surfaces: ["cli"],
  ...changes,
});
const catalogs = {
  office: [
    operation("office.models.health", "office models-health"),
    operation("office.health.overview", "office health-overview"),
    operation("approvals.list", "approvals list"),
    operation("approvals.get", "approvals get"),
  ],
  atlas: [
    operation("atlas.runs.list", "atlas runs list"),
    operation("atlas.runs.get", "atlas runs-get"),
    operation("atlas.runs.cancel", "atlas runs-cancel", {
      effect: "write",
      mutation: "idempotent",
    }),
  ],
};
function fixture(changes = {}) {
  const calls = [];
  const deps = {
    now: () => Date.parse("2026-10-12T12:00:00Z"),
    discover: async () => ({ state: "available" }),
    appEnvironment: async (_app, _origin, env) => {
      NodeAssert.equal(env.API_TOKEN, undefined);
      return env;
    },
    loomRequest: async (_config, _env, path) => {
      calls.push({ path });
      if (path.endsWith("environment")) return environment;
      if (path.endsWith("session")) return fullSession;
      if (path.endsWith("shell")) return { threads: [thread()] };
      throw Error("Unexpected request");
    },
    loomCall: async (_config, _env, name, args) => {
      calls.push({ name, args });
      if (name === "list_scheduled_tasks") return { tasks: [schedule()] };
      throw Error("Unexpected mutation");
    },
    command: async (file, args, env) => {
      calls.push({ file, args });
      const app = file.slice(1);
      NodeAssert.equal(env.API_URL, config[app + "Url"]);
      if (args[0] === "--operations") return { exit: 0, stdout: JSON.stringify(catalogs[app]) };
      if (args[1] === "runs" && args[2] === "list")
        return {
          exit: 0,
          stdout: JSON.stringify({
            runs: [
              {
                id: "atlas-one",
                kind: "brief",
                targetId: "target-one",
                status: "running",
                prompt: "PRIVATE PROMPT",
                partialText: "PRIVATE RESULT",
                toolSteps: [{ secret: "PRIVATE TOOL" }],
                createdAt: "2026-10-12T12:00:00Z",
              },
            ],
          }),
        };
      if (args[1] === "models-health")
        return {
          exit: 0,
          stdout: JSON.stringify({
            issues: [
              {
                id: "run:office-one",
                kind: "provider_failure",
                title: "Generation failed",
                message: "Review the saved work.",
                reference: { kind: "conversation", id: "office-conversation" },
              },
            ],
          }),
        };
      if (args[1] === "health-overview")
        return {
          exit: 0,
          stdout: JSON.stringify({ jobs: { running: 1, queued: 2, retry: 0, dead: 1 } }),
        };
      if (args[0] === "approvals" && args[1] === "list")
        return {
          exit: 0,
          stdout: JSON.stringify({
            items: [
              {
                id: "approval-one",
                status: "pending",
                awaiting_you: true,
                summary: "Review outgoing call",
                params: { secret: "PRIVATE PARAM" },
              },
            ],
          }),
        };
      throw Error("Unexpected app call");
    },
    ...changes,
  };
  return { deps, calls };
}

NodeTest.test(
  "opening and collecting existing work only reads owners, never starts a job or grants approval",
  async () => {
    const { deps, calls } = fixture();
    const report = await collectControlDesk(config, { API_TOKEN: "ambient-wrong-app-token" }, deps);
    NodeAssert.equal(report.readOnly, true);
    NodeAssert.equal(report.environment.environmentId, "env-one");
    NodeAssert.ok(report.rows.some((row) => row.kind === "approval" && row.state === "waiting"));
    NodeAssert.ok(report.rows.some((row) => row.owner === "atlas" && row.state === "running"));
    NodeAssert.ok(report.rows.some((row) => row.owner === "office" && row.state === "failed"));
    NodeAssert.ok(
      calls.filter((call) => call.name).every((call) => call.name === "list_scheduled_tasks"),
    );
    NodeAssert.ok(
      calls
        .filter((call) => call.file)
        .every((call) => !call.args.some((arg) => /cancel|start|decide|restart|install/.test(arg))),
    );
    NodeAssert.doesNotMatch(JSON.stringify(report), /PRIVATE|ambient-wrong/);
    NodeAssert.ok(
      report.sources
        .find((source) => source.id === "atlas-operator-jobs")
        .detail.includes("human operator"),
    );
  },
);

NodeTest.test(
  "thread work states include queued and pending review while old failures do not override new completion",
  () => {
    const cases = [
      [thread(), "running"],
      [thread({ status: "queued", activeRunId: null }), "waiting"],
      [
        thread({
          status: "waiting",
          pendingRuntimeRequest: { id: "approval-one", kind: "approval" },
        }),
        "waiting",
      ],
      [thread({ status: "failed", activeRunId: null, lastError: "Failure" }), "failed"],
      [
        thread({ status: "completed", activeRunId: null, lastError: "Earlier failure" }),
        "completed",
      ],
      [thread({ status: "idle", activeRunId: null }), "completed"],
    ];
    for (const [input, expected] of cases)
      NodeAssert.equal(
        loomDeskRows({ threads: [input] }, environment, fullSession)[0].state,
        expected,
      );
    NodeAssert.throws(
      () => loomDeskRows({ threads: [thread({ status: "new-state" })] }, environment, fullSession),
      /Unknown Loom/,
    );
  },
);

NodeTest.test("current granular permissions override broad legacy scopes for controls", () => {
  const session = {
    authenticated: true,
    scopes: ["orchestration:operate"],
    permissions: ["orchestration:read"],
  };
  const row = loomDeskRows({ threads: [thread()] }, environment, session)[0];
  NodeAssert.equal(row.controls.stop.available, false);
  NodeAssert.match(row.controls.approve.reason, /owning Loom thread/);
  NodeAssert.equal(
    loomDeskRows({ threads: [thread()] }, environment, { ...fullSession, authenticated: false })[0]
      .controls.stop.available,
    false,
  );
});

NodeTest.test(
  "scheduled task state follows upstream succeeded vocabulary and supports pause and resume",
  () => {
    const completed = scheduledDeskRows(
      { tasks: [schedule({ lastRunStatus: "succeeded" })] },
      environment,
      fullSession,
    )[0];
    NodeAssert.equal(completed.state, "completed");
    NodeAssert.equal(completed.controls.pause.available, true);
    NodeAssert.equal(completed.controls.resume.available, false);
    const paused = scheduledDeskRows(
      { tasks: [schedule({ enabled: false })] },
      environment,
      fullSession,
    )[0];
    NodeAssert.equal(paused.controls.resume.available, true);
    NodeAssert.equal(paused.controls.pause.available, false);
    NodeAssert.throws(
      () =>
        scheduledDeskRows(
          { tasks: [schedule({ lastRunStatus: "completed" })] },
          environment,
          fullSession,
        ),
      /Invalid/,
    );
  },
);

NodeTest.test(
  "unknown or duplicate identities and terminal control content are handled at the boundary",
  () => {
    NodeAssert.throws(
      () => loomDeskRows({ threads: [thread(), thread()] }, environment, fullSession),
      /identity/,
    );
    NodeAssert.throws(
      () => atlasDeskRows({ runs: [{ id: "../other", status: "running" }] }),
      /identity/,
    );
    NodeAssert.throws(
      () =>
        officeDeskRows({
          issues: [{ id: "issue-one", reference: { kind: "account", id: "account-one" } }],
        }),
      /invalid/,
    );
    const row = loomDeskRows(
      { threads: [thread({ title: "Unsafe\u001b[31m\nrow" })] },
      environment,
      fullSession,
    )[0];
    NodeAssert.ok([...row.title].every((character) => character.charCodeAt(0) >= 32));
  },
);

NodeTest.test(
  "operation discovery refuses executable syntax, wrong effects, approval gates and unsupported surfaces",
  () => {
    const op = operation("atlas.runs.list", "atlas runs list");
    NodeAssert.deepEqual(deskOperation([op], "atlas.runs.list"), ["atlas", "runs", "list"]);
    for (const changes of [
      { command: "atlas runs list; rm x" },
      { effect: "write" },
      { mutation: "non-idempotent" },
      { approval: "owner" },
      { surfaces: ["api"] },
    ])
      NodeAssert.equal(deskOperation([{ ...op, ...changes }], "atlas.runs.list"), null);
    NodeAssert.equal(deskOperation([op, op], "atlas.runs.list"), null);
    const cancel = operation("atlas.runs.cancel", "atlas runs-cancel", {
      effect: "write",
      mutation: "idempotent",
    });
    NodeAssert.deepEqual(deskOperation([cancel], cancel.id, { mutation: true }), [
      "atlas",
      "runs-cancel",
    ]);
    NodeAssert.equal(
      deskOperation([{ ...cancel, mutation: "destructive" }], cancel.id, { mutation: true }),
      null,
    );
  },
);

NodeTest.test(
  "disconnected or refused sources replace work with explicit states, never stale success",
  async () => {
    const { deps } = fixture({
      loomRequest: async () => {
        throw Object.assign(Error("Denied"), { code: "permission" });
      },
      command: async () => ({ exit: 3, stdout: "raw credential failure" }),
    });
    const report = await collectControlDesk(config, {}, deps);
    NodeAssert.equal(report.rows.length, 0);
    NodeAssert.ok(
      report.sources.every((source) => ["unavailable", "disconnected"].includes(source.state)),
    );
    NodeAssert.doesNotMatch(JSON.stringify(report), /raw credential failure/);
    const network = fixture({
      loomRequest: async () => {
        throw Object.assign(Error("offline"), { code: "unavailable" });
      },
    });
    NodeAssert.equal(
      (await collectControlDesk({}, {}, network.deps)).sources.find(
        (source) => source.owner === "loom",
      ).state,
      "disconnected",
    );
  },
);

NodeTest.test("read permission failure makes no shell or schedule request", async () => {
  const calls = [];
  const { deps } = fixture({
    loomRequest: async (_c, _e, path) => {
      calls.push(path);
      return path.endsWith("environment") ? environment : { authenticated: true, permissions: [] };
    },
    loomCall: async () => {
      throw Error("must not call");
    },
  });
  const report = await collectControlDesk({}, {}, deps);
  NodeAssert.deepEqual(calls, ["/.well-known/t3/environment", "/api/auth/session"]);
  NodeAssert.equal(report.sources.find((source) => source.owner === "loom").state, "unavailable");
});

NodeTest.test(
  "exact thread destinations use owner environment and id without credentials or generic app launch",
  async () => {
    const row = loomDeskRows({ threads: [thread()] }, environment, fullSession)[0],
      launched = [];
    const result = await controlDeskAction(
      "open",
      row,
      config,
      {},
      { collect: async () => ({ rows: [row] }), launch: async (spec) => launched.push(spec) },
    );
    NodeAssert.equal(result.url, "http://127.0.0.1:3774/env-one/thread-one");
    NodeAssert.deepEqual(launched, [{ command: "/browser", args: [result.url], env: {} }]);
    NodeAssert.throws(
      () => loomThreadDestination(row.destination, { ...config, serverPort: "3774" }),
      /invalid/,
    );
    NodeAssert.throws(
      () => loomThreadDestination({ ...row.destination, threadId: "../wrong" }, config),
      /Invalid/,
    );
  },
);

NodeTest.test(
  "exact Office item handoff uses validated owner reference and no ambiguous search",
  async () => {
    const row = officeDeskRows({
        issues: [{ id: "run:one", reference: { kind: "conversation", id: "conversation-one" } }],
      })[0],
      opened = [];
    await controlDeskAction(
      "open",
      row,
      config,
      {},
      {
        collect: async () => ({ rows: [row] }),
        openItem: async (...args) => opened.push(args.slice(0, 2)),
      },
    );
    NodeAssert.deepEqual(opened, [["office", { kind: "conversation", id: "conversation-one" }]]);
  },
);

NodeTest.test(
  "stop is scoped to the reviewed current run and changed or ended work is not interrupted",
  async () => {
    const row = loomDeskRows({ threads: [thread()] }, environment, fullSession)[0],
      calls = [];
    const deps = {
      collect: async () => ({ rows: [row] }),
      loomCall: async (_c, _e, name, args) => {
        calls.push({ name, args });
        return { threadId: row.id, runId: row.runId, status: "interrupt_requested" };
      },
    };
    const result = await controlDeskAction("stop", row, config, {}, deps);
    NodeAssert.equal(result.state, "interrupt_requested");
    NodeAssert.equal(calls[0].name, "t3_thread_interrupt");
    NodeAssert.deepEqual(
      { threadId: calls[0].args.threadId, runId: calls[0].args.runId },
      { threadId: "thread-one", runId: "run-one" },
    );
    await NodeAssert.rejects(
      controlDeskAction(
        "stop",
        row,
        config,
        {},
        { ...deps, collect: async () => ({ rows: [{ ...row, runId: "run-two" }] }) },
      ),
      /changed since review/,
    );
    await NodeAssert.rejects(
      controlDeskAction("stop", row, config, {}, { ...deps, collect: async () => ({ rows: [] }) }),
      /no longer visible/,
    );
    NodeAssert.equal(calls.length, 1);
  },
);

NodeTest.test(
  "owner permission denial performs one request and never retries or claims stop succeeded",
  async () => {
    const row = loomDeskRows({ threads: [thread()] }, environment, fullSession)[0];
    let calls = 0;
    await NodeAssert.rejects(
      controlDeskAction(
        "stop",
        row,
        config,
        {},
        {
          collect: async () => ({ rows: [row] }),
          loomCall: async () => {
            calls++;
            throw Object.assign(Error("Permission refused"), { code: "permission" });
          },
        },
      ),
      /Permission refused/,
    );
    NodeAssert.equal(calls, 1);
  },
);

NodeTest.test(
  "scheduled controls have reverse behavior and reject concurrent changes",
  async () => {
    let row = scheduledDeskRows({ tasks: [schedule()] }, environment, fullSession)[0];
    const calls = [];
    const deps = {
      collect: async () => ({ rows: [row] }),
      loomCall: async (_c, _e, name, args) => {
        calls.push({ name, args });
        return { scheduledTaskId: args.scheduledTaskId, enabled: args.enabled };
      },
    };
    NodeAssert.equal((await controlDeskAction("pause", row, config, {}, deps)).state, "paused");
    row = scheduledDeskRows({ tasks: [schedule({ enabled: false })] }, environment, fullSession)[0];
    NodeAssert.equal((await controlDeskAction("resume", row, config, {}, deps)).state, "resumed");
    NodeAssert.deepEqual(
      calls.map((call) => call.args),
      [
        { scheduledTaskId: "schedule-one", enabled: false },
        { scheduledTaskId: "schedule-one", enabled: true },
      ],
    );
    await NodeAssert.rejects(
      controlDeskAction(
        "resume",
        row,
        config,
        {},
        { ...deps, collect: async () => ({ rows: [{ ...row, enabled: true }] }) },
      ),
      /changed since review/,
    );
    NodeAssert.equal(calls.length, 2);
  },
);

NodeTest.test(
  "Atlas cancellation dispatches only the exact current run using its supported app operation",
  async () => {
    const row = atlasDeskRows({
      runs: [{ id: "atlas-one", kind: "brief", status: "running" }],
    })[0];
    const calls = [];
    const { deps } = fixture({
      collect: async () => ({ rows: [row] }),
      command: async (_file, args) => {
        calls.push(args);
        return {
          exit: 0,
          stdout: JSON.stringify(args[0] === "--operations" ? catalogs.atlas : { ok: true }),
        };
      },
    });
    NodeAssert.equal(
      (await controlDeskAction("stop", row, config, {}, deps)).state,
      "stop-requested",
    );
    NodeAssert.deepEqual(calls[1], ["atlas", "runs-cancel", "--id", "atlas-one", "--json"]);
  },
);

NodeTest.test(
  "exact saved job inspector rejects another returned identity and omits raw prompts",
  async () => {
    const row = atlasDeskRows({
      runs: [{ id: "atlas-one", kind: "brief", status: "running" }],
    })[0];
    const { deps } = fixture({
      collect: async () => ({ rows: [row] }),
      command: async (_file, args) => ({
        exit: 0,
        stdout: JSON.stringify(
          args[0] === "--operations"
            ? catalogs.atlas
            : { id: "atlas-one", status: "completed", prompt: "PRIVATE", partialText: "PRIVATE" },
        ),
      }),
    });
    const result = await controlDeskAction("inspect", row, config, {}, deps);
    NodeAssert.match(result.row.detail, /atlas-one: completed/);
    NodeAssert.doesNotMatch(JSON.stringify(result), /PRIVATE/);
    const malformed = fixture({
      ...deps,
      command: async (_file, args) => ({
        exit: 0,
        stdout: JSON.stringify(
          args[0] === "--operations" ? catalogs.atlas : { id: "atlas-two", status: "completed" },
        ),
      }),
    });
    await NodeAssert.rejects(
      controlDeskAction("inspect", row, config, {}, malformed.deps),
      /another job identity/,
    );
  },
);

NodeTest.test(
  "opening the native desk or cancelling a reviewed control starts no work",
  async () => {
    const row = loomDeskRows({ threads: [thread()] }, environment, fullSession)[0];
    const report = { rows: [row], sources: [] };
    let mutations = 0;
    await nativeControlDesk(
      config,
      {},
      {
        collect: async () => report,
        show() {},
        choose: async () => null,
        act: async () => {
          mutations++;
        },
      },
    );
    const choices = ["001  running  Existing work", "Stop this run", "Cancel", "Done"];
    await nativeControlDesk(
      config,
      {},
      {
        collect: async () => report,
        show() {},
        choose: async () => choices.shift(),
        act: async () => {
          mutations++;
        },
      },
    );
    NodeAssert.equal(mutations, 0);
  },
);

NodeTest.test(
  "native refresh is explicit and bounded with no polling while the picker waits",
  async () => {
    let time = 10000,
      reads = 0;
    const choices = ["Refresh current work", "Refresh current work", "Done"];
    await nativeControlDesk(
      config,
      {},
      {
        now: () => time,
        collect: async () => {
          reads++;
          return { rows: [], sources: [] };
        },
        show() {},
        choose: async () => {
          const value = choices.shift();
          if (choices.length === 1) time += 5000;
          return value;
        },
      },
    );
    NodeAssert.equal(reads, 2);
  },
);

NodeTest.test("metadata lists and native rendering are bounded to the current visible page", () => {
  const threads = Array.from({ length: 150 }, (_, i) =>
    thread({ id: `thread-${i}`, updatedAt: String(i) }),
  );
  NodeAssert.equal(loomDeskRows({ threads }, environment, fullSession).length, 100);
  const rows = threads.map((t) => ({ state: "running", title: t.id, detail: "active" }));
  const rendered = formatControlDesk({ rows, sources: [] });
  NodeAssert.match(rendered, /thread-99/);
  NodeAssert.doesNotMatch(rendered, /thread-100/);
});

NodeTest.test(
  "native connection and its reverse are explicit confirmed actions that preserve running work",
  async () => {
    let connected = false;
    const calls = [];
    const choices = [
      "Connect Loom native access",
      "Cancel",
      "Connect Loom native access",
      "Connect existing environment",
      "Disconnect Loom native access",
      "Cancel",
      "Disconnect Loom native access",
      "Disconnect native access",
      "Done",
    ];
    await nativeControlDesk(
      config,
      {},
      {
        collect: async () => ({
          rows: [],
          sources: [
            {
              owner: "loom",
              state: connected ? "connected" : "unavailable",
              detail: "Native access",
            },
          ],
        }),
        show() {},
        choose: async () => choices.shift(),
        connect: async () => {
          connected = true;
          calls.push("connect");
        },
        disconnect: async () => {
          connected = false;
          calls.push("disconnect");
        },
      },
    );
    NodeAssert.deepEqual(calls, ["connect", "disconnect"]);
  },
);

NodeTest.test(
  "older Atlas producers disable task reads instead of reading unrelated workspace state",
  async () => {
    const calls = [];
    const oldCatalog = [operation("atlas.state", "atlas state")];
    const { deps } = fixture({
      command: async (file, args) => {
        if (file === "/atlas") {
          calls.push(args);
          if (args[0] !== "--operations") throw Error("Must not call broad Atlas state");
          return { exit: 0, stdout: JSON.stringify(oldCatalog) };
        }
        return { exit: 3, stdout: "" };
      },
    });
    const report = await collectControlDesk(config, {}, deps);
    NodeAssert.deepEqual(calls, [["--operations", "--json"]]);
    NodeAssert.ok(!report.rows.some((row) => row.owner === "atlas"));
    const source = report.sources.find((source) => source.id === "atlas.runs.list");
    NodeAssert.equal(source.state, "unavailable");
    NodeAssert.match(source.detail, /Open Atlas to review existing jobs/);
  },
);

NodeTest.test(
  "Atlas bounded metadata preserves pagination guidance and refuses oversized pages",
  async () => {
    const { deps } = fixture();
    const normal = deps.command;
    deps.command = async (file, args, env) =>
      file === "/atlas" && args[1] === "runs" && args[2] === "list"
        ? { exit: 0, stdout: JSON.stringify({ runs: [], nextCursor: "opaque-next-page" }) }
        : normal(file, args, env);
    const report = await collectControlDesk(config, {}, deps);
    NodeAssert.equal(
      report.sources.find((source) => source.id === "atlas.runs.list").truncated,
      true,
    );
    NodeAssert.match(
      report.sources.find((source) => source.id === "atlas.runs.list").detail,
      /More history is available in Atlas/,
    );
    NodeAssert.equal(report.truncated, true);
    NodeAssert.throws(() => atlasDeskRows({ runs: [], nextCursor: {} }), /Invalid/);
    NodeAssert.throws(
      () =>
        atlasDeskRows({
          runs: Array.from({ length: 101 }, (_, index) => ({
            id: `run-${index}`,
            kind: "brief",
            status: "running",
          })),
        }),
      /unbounded/,
    );
  },
);
