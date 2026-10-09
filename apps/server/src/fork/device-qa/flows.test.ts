// @effect-diagnostics nodeBuiltinImport:off - Builds a flow folder in a temp directory.
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { classifyFlow, INVALID_NAME_MESSAGE, resolveFlowPath, walkFlows } from "./flows.ts";

const classify = (text: string, path = ".argent/flows/checkout/pay.yaml") =>
  classifyFlow({ path, text, modifiedAt: "2026-09-27T00:00:00.000Z" });

describe("classifyFlow", () => {
  it("makes a flow whose first real step is launch an e2e flow", () => {
    const flow = classify(
      [
        "steps:",
        "  - echo: Start signed out",
        "  - script: setup.js",
        "  - launch: { ios: com.example.app, android: com.example.app }",
        "  - tap: { text: Pay }",
        "  - when: { platform: ios }",
        "    steps:",
        "      - snapshot: { name: receipt }",
        "  - snapshot: { name: done }",
      ].join("\n"),
    );
    expect(flow).toMatchObject({
      name: "pay",
      folder: "checkout",
      kind: "e2e",
      firstEcho: "Start signed out",
      prerequisite: null,
      stepCount: 6,
      snapshotSteps: 2,
      platforms: ["android", "ios"],
      parseError: null,
    });
  });

  it("makes anything else a fragment with its prerequisite", () => {
    const flow = classify(
      [
        "executionPrerequisite: Signed in on the home screen",
        "steps:",
        "  - tap: { text: Pay }",
      ].join("\n"),
      ".argent/flows/pay.yaml",
    );
    expect(flow).toMatchObject({
      folder: "",
      kind: "fragment",
      prerequisite: "Signed in on the home screen",
      firstEcho: null,
    });
  });

  it("marks invalid YAML, anchors, wrong shapes and bad names", () => {
    expect(classify("steps: [tap: {").kind).toBe("invalid");
    const anchored = classify("x: &a { tap: b }\nsteps:\n  - *a\n");
    expect(anchored).toMatchObject({
      kind: "invalid",
      parseError: "argent flows cannot use YAML anchors or tags.",
    });
    expect(classify("tap: a").parseError).toBe("A flow is an object with a steps list.");
    expect(classify("steps: []", ".argent/flows/my flow.yaml")).toMatchObject({
      name: "my flow",
      kind: "invalid",
      parseError: INVALID_NAME_MESSAGE,
    });
  });
});

describe("walkFlows", () => {
  const workspace = () => {
    const cwd = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "device-qa-flows-"));
    const write = (relative: string, text = "steps:\n  - tap: { text: Go }\n") => {
      const file = NodePath.join(cwd, ".argent/flows", relative);
      NodeFS.mkdirSync(NodePath.dirname(file), { recursive: true });
      NodeFS.writeFileSync(file, text);
    };
    return { cwd, write };
  };

  it.effect("skips baselines, dot folders and other files", () =>
    Effect.gen(function* () {
      const { cwd, write } = workspace();
      write("a.yaml");
      write("nested/b.yaml");
      write("__baselines__/a/c.yaml");
      write(".hidden/d.yaml");
      write("notes.md");
      const { flows, truncated } = yield* walkFlows(cwd);
      expect(flows.map((flow) => flow.path)).toEqual([
        ".argent/flows/a.yaml",
        ".argent/flows/nested/b.yaml",
      ]);
      expect(truncated).toBe(false);
      NodeFS.rmSync(cwd, { recursive: true, force: true });
    }),
  );

  it.effect("stops at the limit and says so", () =>
    Effect.gen(function* () {
      const { cwd, write } = workspace();
      for (const name of ["a", "b", "c"]) write(`${name}.yaml`);
      const { flows, truncated } = yield* walkFlows(cwd, 2);
      expect(flows).toHaveLength(2);
      expect(truncated).toBe(true);
      NodeFS.rmSync(cwd, { recursive: true, force: true });
    }),
  );

  it.effect("finds nothing in a workspace without flows", () =>
    Effect.gen(function* () {
      const { cwd } = workspace();
      expect(yield* walkFlows(cwd)).toEqual({ flows: [], truncated: false });
      NodeFS.rmSync(cwd, { recursive: true, force: true });
    }),
  );
});

describe("resolveFlowPath", () => {
  it("accepts only YAML files inside .argent/flows", () => {
    expect(resolveFlowPath("/w", ".argent/flows/a/b.yaml")).toBe("/w/.argent/flows/a/b.yaml");
    expect(resolveFlowPath("/w", ".argent/flows/../secrets.yaml")).toBeNull();
    expect(resolveFlowPath("/w", "src/app.yaml")).toBeNull();
    expect(resolveFlowPath("/w", "/etc/passwd.yaml")).toBeNull();
    expect(resolveFlowPath("/w", ".argent/flows/a.yml")).toBeNull();
  });
});
