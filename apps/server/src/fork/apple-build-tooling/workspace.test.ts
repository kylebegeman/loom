// @effect-diagnostics nodeBuiltinImport:off - Builds a scratch workspace to walk.
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { afterEach, describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Layer from "effect/Layer";
import * as ProcessRunner from "../../processRunner.ts";
import {
  classifyContainers,
  findEntries,
  parseSchemeList,
  parseTestPlans,
  walkWorkspace,
  WALK_MAX_ENTRIES,
  workspaceProjectRefs,
  xcodegenSpecName,
} from "./detect.ts";
import { makeExec } from "./process.ts";
import {
  applicationProduct,
  evaluateReadiness,
  parseBuildSettings,
  rollUp,
  type ReadinessFacts,
} from "./readiness.ts";
import { xcodegenReport } from "./xcodegen.ts";

describe("detect", () => {
  it("lists containers without embedded workspaces or generated projects", () => {
    expect(
      classifyContainers(
        [
          "App.xcodeproj",
          "App.xcodeproj/project.xcworkspace",
          "App.xcworkspace",
          "project.yml",
          "Gen.xcodeproj",
          "Packages/Core/Package.swift",
        ],
        new Map([["project.yml", "Gen"]]),
      ),
    ).toEqual([
      { kind: "workspace", path: "App.xcworkspace", name: "App" },
      { kind: "xcodegen", path: "project.yml", name: "Gen", generatedProjectPath: "Gen.xcodeproj" },
      { kind: "project", path: "App.xcodeproj", name: "App" },
      { kind: "package", path: "Packages/Core/Package.swift", name: "Core" },
    ]);
  });

  it("reads the XcodeGen project name", () => {
    expect(
      xcodegenSpecName("project.yml", "options:\n  x: 1\nname: 'Sample App' # comment\n"),
    ).toBe("Sample App");
    expect(xcodegenSpecName("project.json", '{"name":"Json"}')).toBe("Json");
    expect(xcodegenSpecName("project.yml", "targets: {}")).toBeNull();
  });

  const roots: Array<string> = [];
  afterEach(() => {
    for (const root of roots.splice(0)) NodeFS.rmSync(root, { recursive: true, force: true });
  });

  const scratch = () => {
    const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "loom-apple-detect-"));
    roots.push(root);
    return root;
  };

  it.effect("walks the workspace, skipping build and dot directories", () =>
    Effect.gen(function* () {
      const root = scratch();
      for (const dir of [
        "App.xcodeproj",
        "node_modules/x.xcodeproj",
        ".build/y.xcodeproj",
        "Pods/Pods.xcodeproj",
        "a/b/c/d/Deep.xcodeproj",
        "Pkg",
      ])
        NodeFS.mkdirSync(NodePath.join(root, dir), { recursive: true });
      NodeFS.writeFileSync(NodePath.join(root, "Pkg/Package.swift"), "");
      NodeFS.writeFileSync(NodePath.join(root, "project.yml"), "name: App\n");
      const result = yield* walkWorkspace(root);
      expect(result).toEqual({
        truncated: false,
        containers: [
          {
            kind: "xcodegen",
            path: "project.yml",
            name: "App",
            generatedProjectPath: "App.xcodeproj",
          },
          { kind: "package", path: "Pkg/Package.swift", name: "Pkg" },
        ],
      });
    }),
  );

  it.effect("stops at the entry limit", () =>
    Effect.gen(function* () {
      const root = scratch();
      for (let index = 0; index <= WALK_MAX_ENTRIES; index++)
        NodeFS.writeFileSync(NodePath.join(root, `f${index}`), "");
      expect((yield* walkWorkspace(root)).truncated).toBe(true);
    }),
  );
});

const goodFacts: ReadinessFacts = {
  buildSettings: {
    PRODUCT_BUNDLE_IDENTIFIER: "dev.loom.app",
    MARKETING_VERSION: "1.0",
    CURRENT_PROJECT_VERSION: "12.1",
    DEVELOPMENT_TEAM: "TEAM",
    IPHONEOS_DEPLOYMENT_TARGET: "18.0",
    INFOPLIST_KEY_ITSAppUsesNonExemptEncryption: "NO",
  },
  schemeShared: true,
  appIconFound: true,
  privacyManifestFound: true,
  infoPlistDeclaresEncryption: false,
  gitClean: true,
  xcodegen: null,
  lastCommitAt: "2026-10-08T12:00:00-07:00",
  latestReleaseBuild: { status: "succeeded", finishedAt: "2026-10-08T20:00:00.000Z" },
  latestTest: { status: "succeeded", finishedAt: "2026-10-08T20:00:00.000Z" },
};

const severities = (facts: ReadinessFacts) =>
  Object.fromEntries(evaluateReadiness(facts).checks.map((check) => [check.code, check.severity]));

describe("readiness", () => {
  it("passes a ready app", () => {
    expect(evaluateReadiness(goodFacts).overall).toBe("pass");
  });

  it("fails release metadata and warns on the rest", () => {
    expect(
      severities({
        ...goodFacts,
        buildSettings: {
          PRODUCT_BUNDLE_IDENTIFIER: "com.example.app",
          CURRENT_PROJECT_VERSION: "1b",
        },
        schemeShared: false,
        appIconFound: null,
        privacyManifestFound: false,
        gitClean: false,
        xcodegen: "out-of-date",
      }),
    ).toMatchObject({
      "scheme-shared": "warning",
      "bundle-id": "fail",
      version: "fail",
      "build-number": "fail",
      "signing-team": "warning",
      "app-icon": "warning",
      "privacy-manifest": "warning",
      "export-compliance": "warning",
      "deployment-target": "pass",
      "git-clean": "warning",
      "xcodegen-sync": "warning",
    });
  });

  it("treats missing or stale runs as unknown and failed runs as warnings", () => {
    expect(
      severities({
        ...goodFacts,
        latestReleaseBuild: null,
        latestTest: { status: "succeeded", finishedAt: "2026-10-08T18:59:00.000Z" },
      }),
    ).toMatchObject({ "release-build": "unknown", tests: "unknown" });
    expect(
      severities({
        ...goodFacts,
        latestTest: { status: "failed", finishedAt: "2026-10-09T00:00:00Z" },
      }).tests,
    ).toBe("warning");
  });

  it("rolls up fail, then warning, then unknown, then pass", () => {
    const of = (...list: Array<"pass" | "warning" | "fail" | "unknown">) =>
      rollUp(list.map((severity) => ({ code: "c", title: "t", severity, message: "" })));
    expect(of("pass", "unknown", "warning", "fail")).toBe("fail");
    expect(of("pass", "unknown", "warning")).toBe("warning");
    expect(of("pass", "unknown")).toBe("unknown");
    expect(of("pass")).toBe("pass");
  });
});

describe("xcodebuild output", () => {
  it("reads schemes from a project or workspace listing", () => {
    expect(
      parseSchemeList(
        '{"project":{"name":"App","schemes":["App","AppTests"],"targets":["App"],"configurations":["Debug","Release"]}}',
      ),
    ).toEqual({
      schemes: ["App", "AppTests"],
      targets: ["App"],
      configurations: ["Debug", "Release"],
    });
    expect(parseSchemeList('{"workspace":{"name":"App","schemes":["App"]}}')).toEqual({
      schemes: ["App"],
      targets: [],
      configurations: [],
    });
    expect(parseSchemeList("xcodebuild: error")).toEqual({
      schemes: [],
      targets: [],
      configurations: [],
    });
  });

  it("reads test plans, which are null when the scheme has none", () => {
    expect(parseTestPlans('{"testPlans":[{"name":"Unit"},{"name":"UI"}]}')).toEqual(["Unit", "UI"]);
    expect(parseTestPlans('{"testPlans":null}')).toEqual([]);
  });

  it("lists the projects a workspace references", () => {
    const contents = `<Workspace version = "1.0">
   <FileRef location = "group:App/App.xcodeproj"></FileRef>
   <FileRef location = "container:Libs/Core.xcodeproj"></FileRef>
   <FileRef location = "group:Package"></FileRef>
</Workspace>`;
    expect(workspaceProjectRefs(contents)).toEqual(["App/App.xcodeproj", "Libs/Core.xcodeproj"]);
  });

  it("finds the one application a scheme builds", () => {
    const entries = parseBuildSettings(
      NodeFS.readFileSync(
        new URL("./__fixtures__/show-build-settings.json", import.meta.url),
        "utf8",
      ),
    );
    expect(applicationProduct(entries)).toMatchObject({
      appPath: "/Users/test/scratch/dd/Build/Products/Debug-iphonesimulator/SampleApp.app",
      bundleId: "dev.loom.sample.SampleApp",
    });
    const app = entries.find((entry) => entry.target === "SampleApp")!;
    expect(applicationProduct([app, { ...app, target: "Other" }])).toEqual({
      error: "The scheme builds 2 applications; choose a scheme that builds one.",
    });
    expect(applicationProduct([])).toMatchObject({
      error: expect.stringContaining("0 applications"),
    });
    expect(parseBuildSettings("not json")).toEqual([]);
  });
});

describe("files", () => {
  const roots: Array<string> = [];
  afterEach(() => {
    for (const root of roots.splice(0)) NodeFS.rmSync(root, { recursive: true, force: true });
  });
  const scratch = () => {
    const root = NodeFS.realpathSync(
      NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "loom-apple-files-")),
    );
    roots.push(root);
    return root;
  };

  it.effect("finds entries by name, skipping dot and build folders", () =>
    Effect.gen(function* () {
      const root = scratch();
      for (const dir of [
        "App/Assets.xcassets/AppIcon.appiconset",
        ".git/x.appiconset",
        "node_modules/y.appiconset",
      ])
        NodeFS.mkdirSync(NodePath.join(root, dir), { recursive: true });
      NodeFS.writeFileSync(NodePath.join(root, "App/PrivacyInfo.xcprivacy"), "");
      const found = yield* findEntries(
        root,
        (name) => name.endsWith(".appiconset") || name === "PrivacyInfo.xcprivacy",
      );
      expect(found.map((path) => NodePath.relative(root, path)).sort()).toEqual([
        "App/Assets.xcassets/AppIcon.appiconset",
        "App/PrivacyInfo.xcprivacy",
      ]);
    }),
  );

  /**
   * A stub XcodeGen: `dump` prints the spec name, `generate` writes the pbxproj from
   * `<root>/generated` and one shared scheme into the project folder it is given.
   */
  const xcodegenStub = (root: string) => {
    const path = NodePath.join(root, "xcodegen");
    NodeFS.writeFileSync(
      path,
      `#!/bin/sh
case "$1" in
  dump) grep -q invalid "$3" && { echo "Spec is invalid" >&2; exit 1; }; printf '{"name":"Gen"}' ;;
  generate) mkdir -p "$5/Gen.xcodeproj/xcshareddata/xcschemes"
    cp '${root}/generated' "$5/Gen.xcodeproj/project.pbxproj"
    echo scheme > "$5/Gen.xcodeproj/xcshareddata/xcschemes/Gen.xcscheme" ;;
esac
`,
      { mode: 0o755 },
    );
    return path;
  };

  it.effect("compares what a spec would generate with the project on disk", () =>
    Effect.gen(function* () {
      const root = scratch();
      const cwd = NodePath.join(root, "app");
      NodeFS.mkdirSync(NodePath.join(cwd, "Sources"), { recursive: true });
      NodeFS.writeFileSync(NodePath.join(cwd, "project.yml"), "name: Gen\n");
      NodeFS.writeFileSync(NodePath.join(cwd, "Sources/Info.plist"), "<plist/>");
      NodeFS.writeFileSync(NodePath.join(root, "generated"), "objects = {\n  App\n}\n");
      const exec = yield* makeExec;
      const report = (spec = "project.yml") =>
        xcodegenReport({
          exec,
          xcodegen: xcodegenStub(root),
          cwd,
          spec,
          scratchDir: NodePath.join(root, "scratch"),
        });

      expect((yield* report()).state).toBe("not-generated");

      const project = NodePath.join(cwd, "Gen.xcodeproj");
      NodeFS.mkdirSync(NodePath.join(project, "xcshareddata/xcschemes"), { recursive: true });
      NodeFS.writeFileSync(NodePath.join(project, "project.pbxproj"), "objects = {\n  App\n}\n");
      NodeFS.writeFileSync(
        NodePath.join(project, "xcshareddata/xcschemes/Gen.xcscheme"),
        "scheme\n",
      );
      expect(yield* report()).toMatchObject({ state: "in-sync", valid: true, diff: null });

      NodeFS.writeFileSync(NodePath.join(root, "generated"), "objects = {\n  App\n  Widget\n}\n");
      NodeFS.writeFileSync(NodePath.join(project, "xcshareddata/xcschemes/Old.xcscheme"), "old\n");
      const outOfDate = yield* report();
      expect(outOfDate).toMatchObject({ state: "out-of-date", changedSchemes: ["Old"] });
      expect(outOfDate.diff).toContain("+  Widget");
      // Generating in the mirror never touches the real project or its links' targets.
      expect(NodeFS.readFileSync(NodePath.join(project, "project.pbxproj"), "utf8")).not.toContain(
        "Widget",
      );
      expect(NodeFS.readdirSync(NodePath.join(root, "scratch"))).toEqual([]);

      NodeFS.writeFileSync(NodePath.join(cwd, "bad.yml"), "invalid: true\n");
      expect(yield* report("bad.yml")).toMatchObject({
        state: "invalid",
        valid: false,
        error: "Spec is invalid",
      });
      expect(
        yield* xcodegenReport({ exec, xcodegen: null, cwd, spec: "project.yml", scratchDir: root }),
      ).toMatchObject({ state: "xcodegen-missing", valid: false });
    }).pipe(Effect.provide(ProcessRunner.layer.pipe(Layer.provide(NodeServices.layer)))),
  );
});
