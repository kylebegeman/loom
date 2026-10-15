import * as NodeAssert from "node:assert/strict";
import * as NodeCrypto from "node:crypto";
import * as NodeTest from "node:test";
import {
  connectLoomEnvironment,
  disconnectLoomEnvironment,
  environmentCall,
  environmentConfig,
  environmentOrigin,
  environmentRequest,
  environmentRouting,
  runWorkbench,
  workbenchSelection,
} from "./loom-environment.mjs";

const config = {
  serverExecutable: "/bin/t3",
  serverBaseDir: "/home/test/t3",
  serverPort: 3774,
  switchboardUrl: "http://100.64.0.1:8317",
};
const routing = { gateway: config.switchboardUrl, baseDir: config.serverBaseDir };
const server = {
  environment: { environmentId: "fixture-env", displayName: "Fixture" },
  settings: { switchboardEnabled: true },
  providers: [
    {
      instanceId: "fixture-claude",
      driver: "claudeAgent",
      enabled: true,
      installed: true,
      status: "ready",
      auth: { status: "authenticated" },
      models: [{ slug: "fixture-model", isDefault: true }],
    },
  ],
};
const json = (value, status = 200, headers = {}) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
const secret = async () => JSON.stringify({ token: "fixture.bearer", mcpToken: "fixture.mcp" });
const selection = {
  operation: "explain",
  prompt: "Explain this selected context: fixture selected text",
  context: { kind: "text", title: "Fixture selection", text: "fixture selected text" },
};

function workflow(overrides = {}) {
  const calls = [];
  const call = async (_config, _env, name, args, deps) => {
    calls.push({ name, args, signal: deps?.signal });
    if (overrides[name]) return overrides[name](args, deps);
    if (name === "t3_thread_launch")
      return { threadId: "fixture-thread", runId: null, status: null };
    if (name === "t3_thread_send" || name === "t3_thread_send_attachments")
      return { threadId: "fixture-thread", runId: "fixture-run" };
    if (name === "t3_thread_wait")
      return {
        threadId: "fixture-thread",
        runId: "fixture-run",
        status: "completed",
        timedOut: false,
      };
    if (name === "t3_thread_read")
      return {
        thread: { threadId: "fixture-thread" },
        items: [
          {
            itemId: "answer",
            type: "assistant_message",
            runId: "fixture-run",
            text: "Fixture explanation",
            textTruncated: false,
          },
        ],
        hasMore: false,
        nextPosition: null,
      };
    if (name === "t3_thread_interrupt")
      return { threadId: "fixture-thread", runId: "fixture-run", status: "interrupt_requested" };
    if (name === "t3_attachment_discard") return {};
    throw new Error(`Unexpected fixture call ${name}`);
  };
  return { calls, deps: { config: async () => server, routing: async () => routing, call } };
}

NodeTest.test("native origin requires an existing environment and stays loopback", () => {
  NodeAssert.equal(environmentOrigin(config), "http://127.0.0.1:3774");
  NodeAssert.throws(() => environmentOrigin({}), { code: "setup" });
  NodeAssert.throws(() => environmentOrigin({ ...config, serverPort: 0 }), { code: "setup" });
});

NodeTest.test(
  "reading a desk performs only an authenticated bounded GET and never commissions",
  async () => {
    const lookedUp = [],
      requests = [];
    const result = await environmentRequest(config, {}, "/api/orchestration/shell", {
      secret: async (operation, origin) => {
        lookedUp.push({ operation, origin });
        return "fixture.bearer";
      },
      request: async (url, options) => {
        requests.push({ url, options });
        return json({ schemaVersion: 2, threads: [] });
      },
    });
    NodeAssert.deepEqual(result.threads, []);
    NodeAssert.equal(lookedUp.length, 1);
    NodeAssert.equal(lookedUp[0].operation, "lookup");
    NodeAssert.equal(requests[0].options.method, "GET");
    NodeAssert.equal(requests[0].options.headers.authorization, "Bearer fixture.bearer");
    NodeAssert.equal(requests[0].options.headers["x-t3-orchestration-protocol"], "2");
    NodeAssert.equal(requests[0].options.redirect, "manual");
    NodeAssert.equal(requests[0].options.credentials, "omit");
  },
);

NodeTest.test(
  "uncommissioned reads are setup while descriptor discovery needs no secret",
  async () => {
    let fetched = 0;
    await NodeAssert.rejects(
      environmentRequest(config, {}, "/api/orchestration/shell", {
        secret: async () => "",
        request: async () => {
          fetched++;
        },
      }),
      { code: "setup" },
    );
    NodeAssert.equal(fetched, 0);
    await environmentRequest(config, {}, "/.well-known/t3/environment", {
      secret: async () => {
        throw Error("must not lookup");
      },
      request: async (_url, options) => {
        NodeAssert.equal(options.headers.authorization, undefined);
        return json({ environmentId: "fixture-env" });
      },
    });
  },
);

NodeTest.test(
  "native reads distinguish permission and unavailable without echoing diagnostics",
  async () => {
    for (const [status, code] of [
      [401, "setup"],
      [403, "permission"],
      [404, "unavailable"],
      [500, "unavailable"],
    ]) {
      await NodeAssert.rejects(
        environmentRequest(config, {}, "/api/orchestration/shell", {
          secret,
          request: async () => new Response("fixture secret error", { status }),
        }),
        (error) => error.code === code && !error.message.includes("fixture secret"),
      );
    }
    await NodeAssert.rejects(environmentRequest(config, {}, "/api/auth/clients", { secret }), {
      code: "protocol",
    });
    await NodeAssert.rejects(
      environmentRequest(
        config,
        {},
        "/api/orchestration/threads/fixture-thread/bounded?itemLimit=1",
        { secret },
      ),
      { code: "protocol" },
    );
  },
);

NodeTest.test("native response size is bounded even when content length is missing", async () => {
  await NodeAssert.rejects(
    environmentRequest(config, {}, "/api/orchestration/shell", {
      secret,
      request: async () => new Response(" ".repeat(4 * 1024 * 1024 + 1)),
    }),
    { code: "protocol" },
  );
});

NodeTest.test(
  "MCP handshake replays negotiated session and parses structured owner results",
  async () => {
    const requests = [];
    const result = await environmentCall(
      config,
      {},
      "list_scheduled_tasks",
      {},
      {
        secret,
        request: async (_url, options) => {
          const message = JSON.parse(options.body);
          requests.push({ message, headers: options.headers });
          if (message.method === "initialize")
            return json(
              { jsonrpc: "2.0", id: message.id, result: { protocolVersion: "2025-06-18" } },
              200,
              { "mcp-session-id": "fixture-session" },
            );
          if (message.method === "notifications/initialized")
            return new Response(null, { status: 202 });
          return json({
            jsonrpc: "2.0",
            id: message.id,
            result: { structuredContent: { tasks: [], nextCursor: null }, content: [] },
          });
        },
      },
    );
    NodeAssert.deepEqual(result.tasks, []);
    NodeAssert.equal(requests[1].headers["mcp-session-id"], "fixture-session");
    NodeAssert.equal(requests[2].message.params.name, "list_scheduled_tasks");
    await NodeAssert.rejects(environmentCall(config, {}, "shell_exec", {}, { secret }), {
      code: "protocol",
    });
  },
);

NodeTest.test(
  "MCP supports bounded SSE responses and authoritative permission denials",
  async () => {
    const fixture = (denied) => ({
      secret,
      request: async (_url, options) => {
        const message = JSON.parse(options.body);
        if (message.method === "initialize")
          return json({ id: message.id, result: { protocolVersion: "2025-06-18" } });
        if (message.method === "notifications/initialized")
          return new Response(null, { status: 202 });
        const result = denied
          ? {
              isError: true,
              structuredContent: {
                code: "permission_denied",
                message: "Do not echo sensitive diagnostics",
              },
            }
          : { structuredContent: { status: "interrupt_requested" } };
        return new Response(
          `event: message\ndata: ${JSON.stringify({ id: message.id, result })}\n\n`,
          { headers: { "content-type": "text/event-stream" } },
        );
      },
    });
    NodeAssert.equal(
      (
        await environmentCall(
          config,
          {},
          "t3_thread_interrupt",
          { threadId: "fixture-thread" },
          fixture(false),
        )
      ).status,
      "interrupt_requested",
    );
    await NodeAssert.rejects(
      environmentCall(
        config,
        {},
        "t3_thread_interrupt",
        { threadId: "fixture-thread" },
        fixture(true),
      ),
      (error) => error.code === "permission" && !error.message.includes("sensitive"),
    );
  },
);

NodeTest.test("configuration uses the supported ticket and one JSON RPC request", async () => {
  const sockets = [];
  class Socket extends globalThis.EventTarget {
    constructor(url) {
      super();
      this.url = url;
      sockets.push(this);
      queueMicrotask(() => this.dispatchEvent(new globalThis.Event("open")));
    }
    send(value) {
      const request = JSON.parse(value);
      NodeAssert.equal(request._tag, "Request");
      NodeAssert.equal(request.tag, "server.getConfig");
      NodeAssert.deepEqual(request.payload, {});
      queueMicrotask(() => {
        const event = new globalThis.Event("message");
        event.data = JSON.stringify({
          _tag: "Exit",
          requestId: request.id,
          exit: { _tag: "Success", value: server },
        });
        this.dispatchEvent(event);
      });
    }
    close() {
      this.closed = true;
    }
  }
  const result = await environmentConfig(
    config,
    {},
    {
      secret,
      WebSocket: Socket,
      request: async (_url, options) => {
        NodeAssert.equal(options.method, "POST");
        return json({ ticket: "fixture-ticket" });
      },
    },
  );
  NodeAssert.equal(result.environment.environmentId, "fixture-env");
  NodeAssert.equal(new URL(sockets[0].url).searchParams.get("wsTicket"), "fixture-ticket");
  NodeAssert.equal(new URL(sockets[0].url).searchParams.get("orchestrationProtocol"), "2");
  NodeAssert.equal(sockets[0].closed, true);
});

function commissionFixture(saved = "", verify = true) {
  const commands = [],
    secrets = [];
  let stored = saved;
  return {
    commands,
    secrets,
    deps: {
      secret: async (operation, _origin, _env, value) => {
        secrets.push(operation);
        if (operation === "store") stored = value;
        if (operation === "clear") stored = "";
        return operation === "lookup" ? stored : "";
      },
      command: async (file, args) => {
        commands.push({ file, args });
        const subject = args[args.indexOf("--subject") + 1];
        const scopes = args.filter((_arg, i) => args[i - 1] === "--scope");
        return {
          stdout: JSON.stringify({
            sessionId: subject === "mcp-client" ? "mcp-session" : "new-session",
            token: "fixture.bearer",
            scopes,
            subject,
            expiresAt: "2026-11-12T00:00:00Z",
          }),
        };
      },
      request: async (_url, options) => {
        if (_url.endsWith("/mcp")) {
          const message = JSON.parse(options.body);
          if (message.method === "initialize")
            return json({ id: message.id, result: { protocolVersion: "2025-06-18" } });
          if (message.method === "notifications/initialized")
            return new Response(null, { status: 202 });
          return json({ id: message.id, result: { structuredContent: { providers: [] } } });
        }
        return json({
          authenticated: verify,
          permissions: ["orchestration:read", "orchestration:operate"],
        });
      },
    },
  };
}

NodeTest.test(
  "explicit connection issues only two scoped grants and stores secrets without returning them",
  async () => {
    const fixture = commissionFixture();
    const result = await connectLoomEnvironment(config, {}, fixture.deps);
    NodeAssert.equal(result.connected, true);
    NodeAssert.equal(result.reused, false);
    const args = fixture.commands[1].args;
    NodeAssert.deepEqual(
      fixture.commands[0].args.filter((_arg, i) => fixture.commands[0].args[i - 1] === "--scope"),
      ["orchestration:read", "orchestration:operate"],
    );
    NodeAssert.equal(args[args.indexOf("--subject") + 1], "mcp-client");
    NodeAssert.deepEqual(
      args.filter((_arg, i) => args[i - 1] === "--scope"),
      ["orchestration:read", "orchestration:operate"],
    );
    NodeAssert.equal(args[args.indexOf("--ttl") + 1], "30d");
    NodeAssert.equal(JSON.stringify(result).includes("fixture.bearer"), false);
    NodeAssert.deepEqual(fixture.secrets, ["lookup", "store", "lookup", "lookup"]);
  },
);

NodeTest.test(
  "still-valid connection is reused without creating sessions, jobs or service changes",
  async () => {
    const fixture = commissionFixture(
      JSON.stringify({
        token: "fixture.bearer",
        mcpToken: "fixture.mcp",
        sessionId: "existing",
        mcpSessionId: "existing-mcp",
        expiresAt: "2026-11-01",
      }),
    );
    const result = await connectLoomEnvironment(config, {}, fixture.deps);
    NodeAssert.equal(result.reused, true);
    NodeAssert.equal(result.expiresAt, "2026-11-01");
    NodeAssert.deepEqual(fixture.commands, []);
    NodeAssert.equal(fixture.secrets.includes("store"), false);
  },
);

NodeTest.test("disconnect revokes only its own saved session and removes the secret", async () => {
  const fixture = commissionFixture(
    JSON.stringify({ token: "fixture.bearer", sessionId: "owned-session" }),
  );
  const result = await disconnectLoomEnvironment(config, {}, fixture.deps);
  NodeAssert.equal(result.revoked, true);
  NodeAssert.deepEqual(fixture.commands[0].args, [
    "auth",
    "session",
    "revoke",
    "--base-dir",
    config.serverBaseDir,
    "owned-session",
  ]);
  NodeAssert.deepEqual(fixture.secrets, ["lookup", "clear"]);
});

NodeTest.test("secret-store failure revokes the just-issued session", async () => {
  const fixture = commissionFixture();
  const oldSecret = fixture.deps.secret;
  fixture.deps.secret = async (...args) => {
    if (args[0] === "store") throw Error("fixture keyring locked");
    return oldSecret(...args);
  };
  await NodeAssert.rejects(connectLoomEnvironment(config, {}, fixture.deps), /keyring locked/);
  NodeAssert.equal(fixture.commands.length, 4);
  NodeAssert.equal(fixture.commands[2].args.at(-1), "new-session");
  NodeAssert.equal(fixture.commands[3].args.at(-1), "mcp-session");
});

NodeTest.test("reconnecting replaces and revokes a stale owned credential", async () => {
  const fixture = commissionFixture(
    JSON.stringify({
      token: "fixture.old",
      mcpToken: "fixture.old-mcp",
      sessionId: "old-session",
      mcpSessionId: "old-mcp-session",
    }),
  );
  let n = 0;
  const request = fixture.deps.request;
  fixture.deps.request = async (...args) => (++n === 1 ? json({}, 401) : request(...args));
  await connectLoomEnvironment(config, {}, fixture.deps);
  NodeAssert.equal(fixture.commands.length, 4);
  NodeAssert.equal(fixture.commands[2].args.at(-1), "old-session");
  NodeAssert.equal(fixture.commands[3].args.at(-1), "old-mcp-session");
});

NodeTest.test("routing reads just the unique listener's gateway and data directory", async () => {
  const inspected = [];
  const result = await environmentRouting(
    config,
    {},
    {
      command: async (_file, args) => {
        NodeAssert.deepEqual(args, ["-H", "-ltnp", "sport = :3774"]);
        return { stdout: 'LISTEN 0 511 127.0.0.1:3774 *:* users:(("t3",pid=1234,fd=1))' };
      },
      readFile: async (path) => {
        inspected.push(path);
        return Buffer.from(
          `SECRET=not-returned\0LOOM_SWITCHBOARD_URL=${config.switchboardUrl}\0T3CODE_HOME=${config.serverBaseDir}\0`,
        );
      },
    },
  );
  NodeAssert.deepEqual(result, routing);
  NodeAssert.deepEqual(inspected, ["/proc/1234/environ"]);
  await NodeAssert.rejects(
    environmentRouting(config, {}, { command: async () => ({ stdout: "pid=1 pid=2" }) }),
    { code: "routing" },
  );
});

NodeTest.test(
  "Switchboard selection uses instanceId and refuses disabled, mismatched, unknown or direct drivers",
  () => {
    NodeAssert.equal(workbenchSelection(server, routing, config).instanceId, "fixture-claude");
    for (const next of [
      { ...server, settings: { switchboardEnabled: false } },
      { ...server, providers: [{ ...server.providers[0], driver: "openai-direct" }] },
      { ...server, providers: [{ ...server.providers[0], auth: { status: "unknown" } }] },
      { ...server, providers: [{ ...server.providers[0], enabled: false }] },
    ])
      NodeAssert.throws(() => workbenchSelection(next, routing, config), { code: "routing" });
    NodeAssert.throws(
      () => workbenchSelection(server, { ...routing, gateway: "http://127.0.0.1:8317" }, config),
      { code: "routing" },
    );
    NodeAssert.throws(
      () => workbenchSelection(server, { ...routing, baseDir: "/unrelated" }, config),
      {
        code: "routing",
      },
    );
  },
);

NodeTest.test(
  "workbench uses fresh visible scratch thread, normal permission modes and selected prompt only",
  async () => {
    const fixture = workflow();
    const progress = [];
    const result = await runWorkbench(
      selection,
      config,
      {},
      { ...fixture.deps, onProgress: (value) => progress.push(value) },
    );
    NodeAssert.equal(result.text, "Fixture explanation");
    NodeAssert.equal(result.environment.environmentId, "fixture-env");
    const launch = fixture.calls.find((call) => call.name === "t3_thread_launch");
    NodeAssert.equal(launch.args.scratch, true);
    NodeAssert.equal(launch.args.projectId, undefined);
    NodeAssert.equal(launch.args.message, undefined);
    NodeAssert.equal(launch.args.interactionMode, "plan");
    NodeAssert.equal(launch.args.runtimeMode, "approval-required");
    NodeAssert.equal(launch.args.modelSelection.instanceId, "fixture-claude");
    const sent = fixture.calls.find((call) => call.name === "t3_thread_send");
    NodeAssert.match(sent.args.message, /Do not use tools/);
    NodeAssert.match(sent.args.message, /fixture selected text/);
    NodeAssert.match(sent.args.clientRequestId, /^loom-workbench-/);
    NodeAssert.equal(progress.at(-1).threadId, "fixture-thread");
    NodeAssert.equal(
      fixture.calls.some((call) => /schedule|project_create/.test(call.name)),
      false,
    );
  },
);

NodeTest.test(
  "context and routing failures happen before any workbench thread is created",
  async () => {
    const fixture = workflow();
    await NodeAssert.rejects(
      runWorkbench({ ...selection, prompt: "x".repeat(120_001) }, config, {}, fixture.deps),
      { code: "context" },
    );
    await NodeAssert.rejects(
      runWorkbench(
        selection,
        config,
        {},
        {
          ...fixture.deps,
          routing: async () => ({ ...routing, gateway: "https://direct.invalid" }),
        },
      ),
      { code: "routing" },
    );
    NodeAssert.deepEqual(fixture.calls, []);
  },
);

NodeTest.test(
  "routing is rechecked immediately before inference and refusal retains only idle thread",
  async () => {
    const fixture = workflow();
    let n = 0;
    await NodeAssert.rejects(
      runWorkbench(
        selection,
        config,
        {},
        {
          ...fixture.deps,
          config: async () =>
            ++n === 1 ? server : { ...server, settings: { switchboardEnabled: false } },
        },
      ),
      { code: "routing", threadId: "fixture-thread" },
    );
    NodeAssert.deepEqual(
      fixture.calls.map((call) => call.name),
      ["t3_thread_launch"],
    );
  },
);

NodeTest.test(
  "cancelling an allocated workbench run interrupts that exact service-owned turn",
  async () => {
    const controller = new AbortController();
    const fixture = workflow({
      t3_thread_send: async () => {
        controller.abort();
        return { threadId: "fixture-thread", runId: "fixture-run" };
      },
    });
    await NodeAssert.rejects(
      runWorkbench(selection, config, {}, { ...fixture.deps, signal: controller.signal }),
      { code: "cancelled", threadId: "fixture-thread" },
    );
    const stop = fixture.calls.find((call) => call.name === "t3_thread_interrupt");
    NodeAssert.equal(stop.args.threadId, "fixture-thread");
    NodeAssert.equal(stop.args.runId, "fixture-run");
    NodeAssert.equal(stop.signal, undefined);
    NodeAssert.equal(
      fixture.calls.some((call) => call.name === "t3_thread_wait"),
      false,
    );
  },
);

NodeTest.test("time limit requests exact interruption and reports retry state", async () => {
  const fixture = workflow();
  await NodeAssert.rejects(
    runWorkbench(selection, config, {}, { ...fixture.deps, maxDurationMs: 0 }),
    {
      code: "timeout",
    },
  );
  NodeAssert.equal(fixture.calls.at(-1).name, "t3_thread_interrupt");
});

NodeTest.test("workbench awaits durable terminal milestone without timer sleeps", async () => {
  let waits = 0;
  const fixture = workflow({
    t3_thread_wait: async () => ({
      threadId: "fixture-thread",
      runId: "fixture-run",
      status: ++waits === 1 ? "running" : "completed",
      timedOut: waits === 1,
    }),
  });
  const result = await runWorkbench(selection, config, {}, fixture.deps);
  NodeAssert.equal(result.text, "Fixture explanation");
  NodeAssert.equal(waits, 2);
});

NodeTest.test(
  "failed or truncated results cannot be silently treated as completed summaries",
  async () => {
    const failed = workflow({
      t3_thread_wait: async () => ({
        threadId: "fixture-thread",
        runId: "fixture-run",
        status: "failed",
        timedOut: false,
      }),
    });
    await NodeAssert.rejects(runWorkbench(selection, config, {}, failed.deps), {
      code: "failed",
      threadId: "fixture-thread",
    });
    const truncated = workflow({
      t3_thread_read: async () => ({
        thread: { threadId: "fixture-thread" },
        items: [
          { type: "assistant_message", runId: "fixture-run", text: "partial", textTruncated: true },
        ],
        hasMore: false,
      }),
    });
    await NodeAssert.rejects(runWorkbench(selection, config, {}, truncated.deps), {
      code: "result",
    });
  },
);

NodeTest.test(
  "image workflow sends frozen bytes using app-owned signed upload and attachment tool",
  async () => {
    const bytes = Buffer.from("fixture image bytes");
    const image = {
      mime: "image/png",
      bytes: bytes.length,
      dataUrl: "data:image/png;base64," + bytes.toString("base64"),
      sha256: NodeCrypto.createHash("sha256").update(bytes).digest("hex"),
    };
    const fixture = workflow({
      t3_attachment_prepare_upload: async () => ({
        attachmentId: "fixture-image",
        relativeUrl: "/api/attachments/upload/fixture.signature",
      }),
    });
    const posted = [];
    const result = await runWorkbench(
      { ...selection, context: { kind: "image", title: "Fixture screenshot.png", image } },
      config,
      {},
      {
        ...fixture.deps,
        secret,
        request: async (url, options) => {
          posted.push({ url, options });
          return json({});
        },
      },
    );
    NodeAssert.equal(result.text, "Fixture explanation");
    NodeAssert.equal(posted.length, 1);
    NodeAssert.deepEqual(posted[0].options.body, bytes);
    NodeAssert.equal(
      fixture.calls.some((call) => call.name === "t3_thread_send_attachments"),
      true,
    );
    NodeAssert.equal(
      fixture.calls.some((call) => call.name === "t3_attachment_discard"),
      false,
    );
    await NodeAssert.rejects(
      runWorkbench(
        { ...selection, context: { kind: "image", image: { ...image, sha256: "changed" } } },
        config,
        {},
        fixture.deps,
      ),
      { code: "context" },
    );
  },
);

NodeTest.test("MCP credential audience stays separate from HTTP/WS credentials", async () => {
  const headers = [];
  await environmentCall(
    config,
    {},
    "orchestrator_capabilities",
    {},
    {
      secret,
      request: async (_url, options) => {
        headers.push(options.headers.authorization);
        const message = JSON.parse(options.body);
        if (message.method === "initialize")
          return json({ id: message.id, result: { protocolVersion: "2025-06-18" } });
        if (message.method === "notifications/initialized")
          return new Response(null, { status: 202 });
        return json({ id: message.id, result: { structuredContent: { providers: [] } } });
      },
    },
  );
  NodeAssert.deepEqual(headers, ["Bearer fixture.mcp", "Bearer fixture.mcp", "Bearer fixture.mcp"]);
  await NodeAssert.rejects(
    environmentCall(
      config,
      {},
      "orchestrator_capabilities",
      {},
      { secret: async () => "http-only.fixture" },
    ),
    { code: "setup" },
  );
});

NodeTest.test("disconnect revokes both saved audience sessions", async () => {
  const fixture = commissionFixture(
    JSON.stringify({
      token: "fixture.bearer",
      mcpToken: "fixture.mcp",
      sessionId: "owned-http",
      mcpSessionId: "owned-mcp",
    }),
  );
  await disconnectLoomEnvironment(config, {}, fixture.deps);
  NodeAssert.deepEqual(
    fixture.commands.map((call) => call.args.at(-1)),
    ["owned-http", "owned-mcp"],
  );
  NodeAssert.deepEqual(fixture.secrets, ["lookup", "clear"]);
});

NodeTest.test(
  "connection verification failure revokes new sessions and clears their stored bundle",
  async () => {
    const fixture = commissionFixture("", false);
    await NodeAssert.rejects(connectLoomEnvironment(config, {}, fixture.deps), { code: "setup" });
    NodeAssert.deepEqual(
      fixture.commands.slice(2).map((call) => call.args.at(-1)),
      ["new-session", "mcp-session"],
    );
    NodeAssert.equal(fixture.secrets.at(-1), "clear");
  },
);

NodeTest.test("uncertain cancellation retains exact owner and thread for recovery", async () => {
  const controller = new AbortController();
  const fixture = workflow({
    t3_thread_send: async () => {
      controller.abort();
      return { threadId: "fixture-thread", runId: "fixture-run" };
    },
    t3_thread_interrupt: async () => {
      throw Error("fixture disconnected");
    },
  });
  await NodeAssert.rejects(
    runWorkbench(selection, config, {}, { ...fixture.deps, signal: controller.signal }),
    (error) =>
      error.code === "cancelled" &&
      error.threadId === "fixture-thread" &&
      error.runId === "fixture-run" &&
      error.environment.environmentId === "fixture-env" &&
      /could not confirm/.test(error.message),
  );
});

NodeTest.test(
  "uncertain message delivery interrupts only the known fresh workbench thread",
  async () => {
    const fixture = workflow({
      t3_thread_send: async () => {
        const error = Error("fixture disconnected");
        error.code = "unavailable";
        throw error;
      },
    });
    await NodeAssert.rejects(runWorkbench(selection, config, {}, fixture.deps), {
      code: "unavailable",
      threadId: "fixture-thread",
    });
    const stop = fixture.calls.find((call) => call.name === "t3_thread_interrupt");
    NodeAssert.equal(stop.args.threadId, "fixture-thread");
    NodeAssert.equal(stop.args.runId, undefined);
  },
);

NodeTest.test(
  "real T3 namespaced thread IDs are accepted as one encoded path component",
  async () => {
    let requested;
    const path =
      "/api/orchestration/threads/" +
      encodeURIComponent("mcp:45a57660-f37e-4831-818d-4de3fa26ce6a") +
      "/bounded";
    await environmentRequest(config, {}, path, {
      secret,
      request: async (url) => {
        requested = url;
        return json({ projection: { turnItems: [] } });
      },
    });
    NodeAssert.equal(requested, "http://127.0.0.1:3774" + path);
    for (const id of ["..", "%2e%2e", "bad%2Fother", "bad%5Cother", "bad%00", "%ZZ"])
      await NodeAssert.rejects(
        environmentRequest(config, {}, "/api/orchestration/threads/" + id + "/bounded", { secret }),
        { code: "protocol" },
      );
  },
);

function sessionLifecycleFixture(outcome, controller = new AbortController()) {
  const requests = [],
    active = new Set();
  const request = async (_url, options) => {
    requests.push(options);
    if (options.method === "DELETE") {
      NodeAssert.equal(options.headers["mcp-session-id"], "fixture-owned-session");
      NodeAssert.equal(options.headers["mcp-protocol-version"], "2025-06-18");
      NodeAssert.equal(options.headers.authorization, "Bearer fixture.mcp");
      NodeAssert.equal(options.signal.aborted, false);
      if (outcome === "cleanup-failure") throw Error("fixture cleanup offline");
      active.delete("fixture-owned-session");
      return new Response(null, { status: 204 });
    }
    const message = JSON.parse(options.body);
    if (message.method === "initialize") {
      active.add("fixture-owned-session");
      if (outcome === "initialize-body-cancel") {
        controller.abort();
        return new Response(
          new ReadableStream({
            start(stream) {
              stream.error(Error("fixture body interrupted"));
            },
          }),
          { headers: { "mcp-session-id": "fixture-owned-session" } },
        );
      }
      return json({ id: message.id, result: { protocolVersion: "2025-06-18" } }, 200, {
        "mcp-session-id": "fixture-owned-session",
      });
    }
    if (message.method === "notifications/initialized") return new Response(null, { status: 202 });
    if (outcome === "cancel") {
      controller.abort();
      throw Error("fixture request cancelled");
    }
    if (outcome === "tool-failure")
      return json({
        id: message.id,
        result: {
          isError: true,
          structuredContent: { code: "permission_denied", message: "fixture owner denial" },
        },
      });
    return json({ id: message.id, result: { structuredContent: { providers: [] } } });
  };
  return { requests, active, deps: { request, secret, signal: controller.signal } };
}

NodeTest.test(
  "each MCP operation releases its allocated transport session after success",
  async () => {
    const fixture = sessionLifecycleFixture("success");
    const result = await environmentCall(config, {}, "orchestrator_capabilities", {}, fixture.deps);
    NodeAssert.deepEqual(result.providers, []);
    NodeAssert.equal(fixture.active.size, 0);
    NodeAssert.deepEqual(
      fixture.requests.map((request) => request.method),
      ["POST", "POST", "POST", "DELETE"],
    );
  },
);

NodeTest.test(
  "MCP tool failure still releases the session and preserves authoritative denial",
  async () => {
    const fixture = sessionLifecycleFixture("tool-failure");
    await NodeAssert.rejects(
      environmentCall(config, {}, "orchestrator_capabilities", {}, fixture.deps),
      { code: "permission" },
    );
    NodeAssert.equal(fixture.active.size, 0);
    NodeAssert.equal(fixture.requests.at(-1).method, "DELETE");
  },
);

NodeTest.test(
  "MCP cancellation releases the session with a separate non-aborted cleanup signal",
  async () => {
    const fixture = sessionLifecycleFixture("cancel");
    await NodeAssert.rejects(
      environmentCall(config, {}, "orchestrator_capabilities", {}, fixture.deps),
      { code: "cancelled" },
    );
    NodeAssert.equal(fixture.active.size, 0);
    NodeAssert.equal(fixture.requests.at(-1).method, "DELETE");
  },
);

NodeTest.test(
  "cancellation while reading initialization retains its header session for cleanup",
  async () => {
    const fixture = sessionLifecycleFixture("initialize-body-cancel");
    await NodeAssert.rejects(
      environmentCall(config, {}, "orchestrator_capabilities", {}, fixture.deps),
      { code: "cancelled" },
    );
    NodeAssert.equal(fixture.active.size, 0);
    NodeAssert.deepEqual(
      fixture.requests.map((request) => request.method),
      ["POST", "DELETE"],
    );
  },
);

NodeTest.test("MCP cleanup network failure preserves the completed operation result", async () => {
  const fixture = sessionLifecycleFixture("cleanup-failure");
  const result = await environmentCall(config, {}, "orchestrator_capabilities", {}, fixture.deps);
  NodeAssert.deepEqual(result.providers, []);
  NodeAssert.equal(fixture.requests.at(-1).method, "DELETE");
});
