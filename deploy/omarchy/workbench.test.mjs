import * as NodeTest from "node:test";
const { test } = NodeTest;
import * as NodeAssert from "node:assert/strict";
const assert = NodeAssert;
import * as NodeChildProcess from "node:child_process";
import * as NodeCrypto from "node:crypto";
const { createHash } = NodeCrypto;
import * as NodeFSP from "node:fs/promises";
const { mkdtemp, mkdir, writeFile, rm, symlink, realpath } = NodeFSP;
import * as NodeOS from "node:os";
const { tmpdir } = NodeOS;
import * as NodePath from "node:path";
const { join } = NodePath;
import * as NodeZlib from "node:zlib";
const { inflateSync } = NodeZlib;
import {
  workbenchArgs,
  formatWorkbenchProgress,
  workbenchLimits,
  loadWorkbenchContext,
  appWorkbenchContext,
  formatWorkbenchPreview,
  workbenchRequest,
  reviewedWorkbenchPayload,
  nativeWorkbench,
} from "./workbench.mjs";

const config = {
  officeUrl: "https://office.test",
  atlasUrl: "https://atlas.test",
  switchboardUrl: "https://hub.tail.test",
  browserExecutable: "/tools/chromium",
};
const image = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aXfYAAAAASUVORK5CYII=",
  "base64",
);
const cap = (app) => ({
  supported: true,
  handoff: "loom-capture-review-v1",
  format: "review-in-app-v1",
  reviewed: true,
  path: "/app/share",
  captureUnit: app === "office" ? "utf16-units" : "utf8-bytes",
  titleLimit: 200,
  textLimit: app === "office" ? 4000 : 65536,
  urlLimit: 2048,
  destinations: app === "office" ? ["note"] : ["source"],
});
const result = {
  text: "The selected error means the file is missing.",
  threadId: "thread-test",
  environment: "Workstation",
  provider: "codex",
  model: "model-test",
};
async function fixture(t) {
  const home = await realpath(await mkdtemp(join(tmpdir(), "loom-workbench-test-")));
  t.after(() => rm(home, { recursive: true, force: true }));
  return { home, env: { HOME: home, PATH: "/usr/bin:/bin" } };
}
function sequence(values) {
  return async (header, choices) => {
    const value = values.shift();
    assert.ok(value === null || choices.includes(value), `${value} is not available in ${header}`);
    return value;
  };
}
function captureOptions(app, envelopes, launches) {
  return {
    choose: sequence([
      "Choose destination",
      app === "office" ? "Office Note" : "Atlas Research source",
    ]),
    show: () => {},
    capabilities: async (selected) => ({
      state: "available",
      manifest: { capabilities: { capture: cap(selected) } },
    }),
    focus: async () => true,
    launch: async (spec) => launches.push(spec),
    watch: async (envelope) => envelopes.push(envelope),
  };
}

test("CLI context is explicit and prompt-like values remain literal", () => {
  assert.deepEqual(
    workbenchArgs([
      "--inline",
      "--text",
      "$(never execute)",
      "--operation",
      "explain",
      "--instruction",
      "--literal",
    ]),
    { inline: true, text: "$(never execute)", operation: "explain", instruction: "--literal" },
  );
  assert.deepEqual(workbenchArgs(["--selected", "--json"]), { source: "selected", json: true });
  for (const args of [
    ["--clipboard", "--selected"],
    ["--file", "a.ts", "--text", "b"],
    ["--operation", "write"],
    ["--file"],
    ["--json", "--json"],
    ["--all-apps"],
    ["--instruction", "x".repeat(2001)],
  ])
    assert.throws(() => workbenchArgs(args));
});
test("selected UTF-8 text has byte-aware limits and no implicit source", async () => {
  const context = await loadWorkbenchContext({ text: "🙂 literal \u001b[31m data" }, {});
  assert.equal(context.text, "🙂 literal \u001b[31m data");
  assert.equal(context.provenance.bytes, Buffer.byteLength(context.text));
  assert.ok(formatWorkbenchPreview(context).includes("\\u001b[31m"));
  assert.equal(formatWorkbenchPreview(context).includes("\u001b"), false);
  for (const options of [
    {},
    { text: "ok", source: "clipboard" },
    { source: "all-apps" },
    { text: "a\0b" },
    { text: "🙂".repeat(workbenchLimits.textBytes / 4 + 1) },
  ])
    await assert.rejects(loadWorkbenchContext(options, {}));
});
test("bounded text files reject binary, symlink, directory and oversized input", async (t) => {
  const { home, env } = await fixture(t);
  const file = join(home, "selected.ts");
  await writeFile(file, "const literal = '$(secret)';\n");
  const context = await loadWorkbenchContext({ file }, env);
  assert.equal(context.kind, "file");
  assert.equal(context.title, "selected.ts");
  const request = workbenchRequest("explain", context);
  assert.equal(request.context.file, undefined);
  assert.equal(request.prompt.includes(home), false);
  await writeFile(join(home, "binary.ts"), Buffer.from([0xff, 0xfe, 0]));
  await writeFile(join(home, "oversized.md"), "x".repeat(workbenchLimits.textBytes + 1));
  await writeFile(join(home, "file.exe"), "not code");
  await mkdir(join(home, "folder.md"));
  await symlink(file, join(home, "linked.ts"));
  for (const selected of ["binary.ts", "oversized.md", "file.exe", "folder.md", "linked.ts"])
    await assert.rejects(loadWorkbenchContext({ file: join(home, selected) }, env));
});
test("frozen screenshot carries validated dimensions and checksum without its local path", async (t) => {
  const { home, env } = await fixture(t);
  const file = join(home, "screen.png");
  await writeFile(file, image);
  const context = await loadWorkbenchContext({ screenshot: file }, env);
  assert.equal(context.image.width, 1);
  assert.equal(context.image.height, 1);
  assert.equal(context.provenance.sha256, createHash("sha256").update(image).digest("hex"));
  assert.equal(workbenchRequest("explain", context).context.file, undefined);
  assert.equal(
    workbenchRequest("explain", context).context.image.dataUrl,
    `data:image/png;base64,${image.toString("base64")}`,
  );
});
test("screenshots reject disguised, truncated, oversized and excessive-dimension files", async (t) => {
  const { home, env } = await fixture(t);
  const huge = Buffer.from(image);
  huge.writeUInt32BE(20000, 16);
  const inputs = [
    ["text.png", Buffer.from("not an image")],
    ["truncated.png", image.subarray(0, 33)],
    ["renamed.jpg", image],
    ["huge.png", huge],
    ["oversized.png", Buffer.alloc(workbenchLimits.imageBytes + 1)],
    ["other.webp", image],
  ];
  for (const [name, buffer] of inputs) {
    const file = join(home, name);
    await writeFile(file, buffer);
    await assert.rejects(loadWorkbenchContext({ screenshot: file }, env));
  }
});
test("app context retains exact identity and advisory permissions without accepting execution authority", async () => {
  const value = {
    format: "loom-workbench-context",
    version: 1,
    app: "atlas",
    title: "Evidence",
    text: "The deliberately exported excerpt.",
    url: "https://atlas.test/app/source/item",
    reference: { kind: "source", id: "item", revision: 4, versionId: "version-4" },
    permissions: ["sources:read"],
    command: "delete everything",
    scopes: ["admin"],
  };
  const context = appWorkbenchContext(value, config);
  assert.deepEqual(context.reference, value.reference);
  assert.deepEqual(context.permissions, ["sources:read"]);
  assert.equal(context.command, undefined);
  assert.equal(context.scopes, undefined);
  for (const invalid of [
    { ...value, version: 2 },
    { ...value, app: "other" },
    { ...value, url: "https://office.test/app/source/item" },
    { ...value, url: "https://user:secret@atlas.test/app/source/item" },
    { ...value, permissions: ["read\nwrite"] },
    { ...value, reference: { ...value.reference, revision: 0 } },
  ])
    assert.throws(() => appWorkbenchContext(invalid, config));
});
test("app export file becomes bounded, selected context with original provenance", async (t) => {
  const { home, env } = await fixture(t);
  const file = join(home, "app-context.json");
  await writeFile(
    file,
    JSON.stringify({
      format: "loom-workbench-context",
      version: 1,
      app: "office",
      text: "A selected note excerpt",
      url: "https://office.test/app/notes",
      reference: { kind: "note", id: "note-test" },
      permissions: ["notes:read"],
    }),
  );
  const context = await loadWorkbenchContext({ contextFile: file }, env, { config });
  const payload = reviewedWorkbenchPayload(context, "Summary of the excerpt", "summarize", result);
  assert.ok(payload.text.includes('Original item: {"kind":"note","id":"note-test"}'));
  assert.ok(payload.text.includes("Original permission annotations: notes:read"));
  assert.equal(payload.url, "https://office.test/app/notes");
});
test("source-picker cancellation never reads clipboard, discovers apps or starts inference", async () => {
  let touched = false;
  const output = await nativeWorkbench(
    config,
    {},
    {
      choose: sequence(["Cancel"]),
      clipboard: () => {
        touched = true;
      },
      execute: () => {
        touched = true;
      },
      capture: () => {
        touched = true;
      },
      show: () => {},
    },
  );
  assert.equal(output.state, "cancelled");
  assert.equal(touched, false);
});
test("preview cancellation reads exactly selected text and sends nothing", async () => {
  let reads = 0;
  const output = await nativeWorkbench(
    config,
    {},
    {
      source: "selected",
      clipboard: async (primary) => {
        assert.equal(primary, true);
        reads++;
        return { status: 0, stdout: "Only the deliberate selection" };
      },
      choose: sequence(["Cancel"]),
      execute: () => assert.fail("must not run"),
      capture: () => assert.fail("must not capture"),
      show: () => {},
    },
  );
  assert.equal(reads, 1);
  assert.equal(output.state, "cancelled");
});
test("failed source selection can reselect with no inference or unrelated capture", async () => {
  let inputCalls = 0;
  const output = await nativeWorkbench(
    config,
    {},
    {
      source: "clipboard",
      clipboard: async () => ({ status: 1 }),
      choose: sequence(["Choose context again", "Type or paste text", "Cancel"]),
      input: async () => {
        inputCalls++;
        return "New explicit context";
      },
      execute: () => assert.fail("must not run"),
      show: () => {},
    },
  );
  assert.equal(inputCalls, 1);
  assert.equal(output.state, "cancelled");
});
test("explanation completes with reviewed copy and source-preserving copy", async () => {
  const copies = [],
    prompts = [],
    displays = [];
  const output = await nativeWorkbench(
    config,
    {},
    {
      text: "ENOENT: missing.txt",
      choose: sequence(["Explain", "Copy result", "Copy with source", "Done"]),
      execute: async (request) => {
        prompts.push(request);
        return result;
      },
      copy: async (value) => copies.push(value),
      show: (value) => displays.push(value),
    },
  );
  assert.equal(output.state, "reviewed");
  assert.equal(output.threadId, result.threadId);
  assert.equal(prompts[0].operation, "explain");
  assert.ok(prompts[0].prompt.includes("Do not inspect other files"));
  assert.deepEqual(prompts[0].provenance, output.provenance);
  assert.equal(copies[0], result.text);
  assert.ok(copies[1].includes(`Loom thread: ${result.threadId}`));
  assert.ok(copies[1].includes(`SHA-256 ${output.provenance.sha256}`));
  assert.ok(displays.some((value) => value.includes("Owner: Workstation")));
});
test("summary uses complete Office review handoff rather than silently creating a note", async (t) => {
  const { env } = await fixture(t);
  const envelopes = [],
    launches = [];
  const output = await nativeWorkbench(config, env, {
    text: "Synthetic source information.",
    operation: "summarize",
    choose: sequence(["Run in Loom", "Review in Office", "Done"]),
    execute: async () => ({ ...result, text: "A reviewed summary." }),
    captureOptions: captureOptions("office", envelopes, launches),
    show: () => {},
  });
  assert.equal(output.state, "reviewed");
  assert.equal(envelopes.length, 1);
  assert.equal(envelopes[0].app, "office");
  assert.equal(envelopes[0].target, "note");
  assert.ok(envelopes[0].text.includes("A reviewed summary."));
  assert.ok(envelopes[0].text.includes(output.provenance.sha256));
  const url = new URL(launches[0].args.find((arg) => arg.startsWith("--app=")).slice(6));
  assert.equal(url.origin, config.officeUrl);
  assert.equal(url.search, "");
  const envelope = JSON.parse(
    inflateSync(Buffer.from(url.hash.slice("#loomCapture=v1.".length), "base64url")).toString(),
  );
  assert.deepEqual(envelope, envelopes[0]);
});
test("Atlas source capture preserves selected source and requires app-owned review without inference", async (t) => {
  const { env } = await fixture(t);
  const envelopes = [],
    launches = [];
  const output = await nativeWorkbench(config, env, {
    text: "Only this selected source text",
    choose: sequence(["Capture in Atlas"]),
    execute: () => assert.fail("capture needs no inference"),
    captureOptions: captureOptions("atlas", envelopes, launches),
    show: () => {},
  });
  assert.equal(output.state, "reviewing");
  assert.equal(envelopes[0].app, "atlas");
  assert.equal(envelopes[0].target, "source");
  assert.ok(envelopes[0].text.startsWith("Only this selected source text\n\n"));
  assert.ok(launches[0].args.some((arg) => arg.startsWith(`--app=${config.atlasUrl}/app/share#`)));
});
test("reviewed result can be refined after app-limit failure without losing original source", async () => {
  const payloads = [];
  const output = await nativeWorkbench(
    config,
    {},
    {
      text: "Original selected context",
      operation: "summarize",
      choose: sequence([
        "Run in Loom",
        "Review in Office",
        "Edit result",
        "Review in Office",
        "Done",
      ]),
      execute: async () => ({ ...result, text: "x".repeat(5000) }),
      input: async (header, value) => {
        assert.equal(value.length, 5000);
        return "A shorter reviewed result";
      },
      capture: async (_config, _env, options) => {
        payloads.push(options.payload);
        if (payloads.length === 1) throw Error("Office text limit: 4000");
        return { state: "reviewing" };
      },
      show: () => {},
    },
  );
  assert.equal(output.state, "reviewed");
  assert.ok(payloads[1].text.startsWith("A shorter reviewed result"));
  assert.ok(payloads[1].text.includes(output.provenance.sha256));
  assert.ok(payloads[1].text.includes("Loom thread: thread-test"));
});
test("direct capture can refine and retry without recapturing the original selection", async () => {
  const texts = [];
  const output = await nativeWorkbench(
    config,
    {},
    {
      text: "Original source too long",
      operation: "capture",
      choose: sequence(["Review in Atlas", "Edit capture text"]),
      input: async () => "Edited source",
      capture: async (_config, _env, options) => {
        texts.push(options.payload.text);
        if (texts.length === 1) throw Error("App text limit");
        return { state: "reviewing" };
      },
      show: () => {},
    },
  );
  assert.equal(output.state, "reviewing");
  assert.ok(texts[1].startsWith("Edited source"));
  assert.ok(texts[1].includes(output.provenance.sha256));
});
test("retry retains frozen context even when source changes between attempts", async (t) => {
  const { home, env } = await fixture(t);
  const file = join(home, "selected.log");
  await writeFile(file, "The approved original error");
  const requests = [];
  const output = await nativeWorkbench(config, env, {
    file,
    operation: "explain",
    choose: sequence(["Run in Loom", "Retry in Loom", "Done"]),
    execute: async (request) => {
      requests.push(request);
      if (requests.length === 1) {
        await writeFile(file, "Unselected replacement data");
        throw Error("Owning Loom environment is unavailable");
      }
      return result;
    },
    show: () => {},
  });
  assert.equal(output.state, "reviewed");
  assert.strictEqual(requests[0], requests[1]);
  assert.equal(requests[1].context.text, "The approved original error");
});
test("routing failure never invokes capture, copy or direct-provider fallback", async () => {
  let calls = 0;
  const output = await nativeWorkbench(
    config,
    {},
    {
      text: "Selected error",
      operation: "explain",
      choose: sequence(["Run in Loom", "Cancel"]),
      execute: async () => {
        calls++;
        throw Error("Loom environment has no Switchboard route");
      },
      capture: () => assert.fail("must not capture"),
      copy: () => assert.fail("must not copy"),
      show: () => {},
    },
  );
  assert.equal(output.state, "cancelled");
  assert.equal(calls, 1);
});
test("cancellation reaches the owning Loom run and does not expose a partial result", async () => {
  const controller = new AbortController();
  let cancellation = false;
  const output = await nativeWorkbench(
    config,
    {},
    {
      text: "Selected error",
      operation: "explain",
      signal: controller.signal,
      choose: sequence(["Run in Loom"]),
      execute: async (_request, _config, _env, { signal }) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener(
            "abort",
            () => {
              cancellation = true;
              const error = Error("cancelled");
              error.name = "AbortError";
              reject(error);
            },
            { once: true },
          );
          controller.abort();
        }),
      capture: () => assert.fail("must not capture"),
      copy: () => assert.fail("must not copy"),
      show: () => {},
    },
  );
  assert.equal(output.state, "cancelled");
  assert.equal(cancellation, true);
});
test("oversized or malformed inference results remain retryable rather than being silently truncated", async () => {
  let attempts = 0;
  const output = await nativeWorkbench(
    config,
    {},
    {
      text: "Selected context",
      operation: "summarize",
      choose: sequence(["Run in Loom", "Retry in Loom", "Retry in Loom", "Done"]),
      execute: async () =>
        ++attempts === 1
          ? { text: "x".repeat(workbenchLimits.resultBytes + 1) }
          : attempts === 2
            ? { text: "bad\0data" }
            : result,
      show: () => {},
    },
  );
  assert.equal(attempts, 3);
  assert.equal(output.state, "reviewed");
});
test("screenshot inference requires a visual preview and uses frozen bytes", async (t) => {
  const { home, env } = await fixture(t);
  const file = join(home, "selected.png");
  await writeFile(file, image);
  let viewed = false;
  const choices = ["View screenshot", "Run in Loom", "Done"];
  const output = await nativeWorkbench(config, env, {
    screenshot: file,
    operation: "explain",
    choose: async (header, values) => {
      if (!viewed) assert.equal(values.includes("Run in Loom"), false);
      const value = choices.shift();
      assert.ok(values.includes(value));
      return value;
    },
    previewImage: async (context) => {
      await writeFile(file, "Changed original");
      assert.equal(context.image.dataUrl, `data:image/png;base64,${image.toString("base64")}`);
      viewed = true;
    },
    execute: async (request) => {
      assert.equal(viewed, true);
      assert.equal(
        request.context.image.dataUrl,
        `data:image/png;base64,${image.toString("base64")}`,
      );
      return result;
    },
    show: () => {},
  });
  assert.equal(output.state, "reviewed");
});
test("unknown picker responses cannot bypass context or image review", async (t) => {
  const { home, env } = await fixture(t);
  const file = join(home, "selected.png");
  await writeFile(file, image);
  for (const options of [
    { text: "A deliberate selection", operation: "explain" },
    { screenshot: file, operation: "explain" },
  ]) {
    const output = await nativeWorkbench(config, env, {
      ...options,
      choose: async () => "unknown action",
      execute: () => assert.fail("must not run"),
      show: () => {},
    });
    assert.equal(output.state, "cancelled");
  }
});

test("structured Loom environment and progress render readable ownership without raw objects", async () => {
  const environment = { environmentId: "environment-test", label: "Workstation" };
  const progress = formatWorkbenchProgress({
    state: "running",
    environment,
    threadId: "thread-test",
    provider: "Codex",
    model: "model-test",
  });
  assert.ok(progress.includes("Working in Workstation"));
  assert.ok(progress.includes("Loom thread: thread-test"));
  assert.equal(progress.includes("[object Object]"), false);
  const displays = [];
  await nativeWorkbench(
    config,
    {},
    {
      text: "Selected context",
      operation: "explain",
      choose: sequence(["Run in Loom", "Done"]),
      show: (value) => displays.push(value),
      execute: async (_request, _config, _env, { onProgress }) => {
        onProgress({ state: "running", environment, threadId: "thread-test", provider: "Codex" });
        return { ...result, environment };
      },
    },
  );
  assert.ok(displays.some((value) => value.includes("Owner: Workstation")));
  assert.equal(
    displays.some((value) => value.includes("[object Object]")),
    false,
  );
});

test("missing native access has an explicit connection recovery action before retry", async () => {
  let attempts = 0,
    connects = 0;
  const output = await nativeWorkbench(
    config,
    {},
    {
      text: "Selected context",
      operation: "explain",
      choose: sequence(["Run in Loom", "Connect Loom native access", "Retry in Loom", "Done"]),
      show: () => {},
      execute: async () => {
        if (++attempts === 1) throw Error("Connect Loom native access first");
        return result;
      },
      connect: async () => {
        connects++;
      },
    },
  );
  assert.equal(output.state, "reviewed");
  assert.equal(connects, 1);
  assert.equal(attempts, 2);
});

test("selected named pipe is rejected immediately rather than waiting for a writer", async (t) => {
  const { home, env } = await fixture(t);
  const file = join(home, "selected.txt");
  NodeChildProcess.execFileSync("mkfifo", [file]);
  await assert.rejects(loadWorkbenchContext({ file }, env), /regular file/);
});

test("completed Loom result can open its exact owning environment and thread", async () => {
  const environment = { environmentId: "environment-test", label: "Workstation" };
  const destinations = [];
  const output = await nativeWorkbench(
    config,
    {},
    {
      text: "Selected context",
      operation: "explain",
      choose: sequence(["Run in Loom", "Open Loom thread in browser", "Done"]),
      show: () => {},
      execute: async () => ({ ...result, environment }),
      openThread: async (destination) => destinations.push(destination),
    },
  );
  assert.equal(output.state, "reviewed");
  assert.deepEqual(destinations, [
    { type: "loom-thread", environmentId: "environment-test", threadId: "thread-test" },
  ]);
});

test("failed Loom turn retains exact-thread recovery without triggering another inference", async () => {
  const environment = { environmentId: "environment-test", label: "Workstation" };
  const destinations = [];
  let attempts = 0;
  const output = await nativeWorkbench(
    config,
    {},
    {
      text: "Selected context",
      operation: "explain",
      choose: sequence(["Run in Loom", "Open Loom thread in browser", "Cancel"]),
      show: () => {},
      execute: async () => {
        attempts++;
        const error = Error("Turn needs review");
        error.threadId = "thread-test";
        error.environment = environment;
        throw error;
      },
      openThread: async (destination) => destinations.push(destination),
    },
  );
  assert.equal(output.state, "cancelled");
  assert.equal(output.threadId, "thread-test");
  assert.equal(attempts, 1);
  assert.deepEqual(destinations, [
    { type: "loom-thread", environmentId: "environment-test", threadId: "thread-test" },
  ]);
});
