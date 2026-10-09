import { ThreadId } from "@t3tools/contracts";
import type { AppleContainer } from "@t3tools/contracts/fork";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { createMemoryStorage } from "~/lib/storage";
import { groupIssuesByFile } from "./RunSummary";
import { defaultScheme, destinationOptions } from "./RunControls";
import {
  SELECTION_STORAGE_KEY,
  parseSelections,
  readSelection,
  requestFor,
  runKindFor,
  writeSelection,
} from "./selection";
import { toolchainProblems } from "./ToolchainCard";

const threadId = ThreadId.make("thread");
const project: AppleContainer = { kind: "project", path: "App.xcodeproj", name: "App" };
const pkg: AppleContainer = { kind: "package", path: "Package.swift", name: "Kit" };
const spec: AppleContainer = { kind: "xcodegen", path: "project.yml", name: "App" };
const simulator = {
  _tag: "simulator",
  udid: "SIM-1",
  name: "iPhone",
  runtime: "iOS 27.0",
  booted: false,
} as const;

describe("remembered selection", () => {
  let storage: ReturnType<typeof createMemoryStorage>;
  beforeEach(() => {
    storage = createMemoryStorage();
    vi.stubGlobal("localStorage", storage);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("treats unreadable storage as nothing remembered", () => {
    expect(parseSelections("{not json")).toEqual({});
    expect(parseSelections(JSON.stringify({ key: { scheme: 3 } }))).toEqual({});
    storage.setItem(SELECTION_STORAGE_KEY, "[]");
    expect(readSelection("env", "project")).toEqual({});
  });

  it("falls back to nothing remembered when storage throws", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("quota");
      },
    });
    expect(() => writeSelection("env", "a", { scheme: "App" })).not.toThrow();
    expect(readSelection("env", "a")).toEqual({});
  });

  it("keeps each environment and project apart", () => {
    writeSelection("env", "a", { container: project, scheme: "App" });
    writeSelection("env", "b", { container: pkg });
    writeSelection("other", "a", { scheme: "Other" });
    expect(readSelection("env", "a")).toEqual({ container: project, scheme: "App" });
    expect(readSelection("env", "b")).toEqual({ container: pkg });
    expect(readSelection("other", "a")).toEqual({ scheme: "Other" });
  });
});

describe("planning a run", () => {
  it("maps actions onto what each container can do", () => {
    expect(runKindFor(pkg, "build")).toBe("swiftBuild");
    expect(runKindFor(pkg, "test")).toBe("swiftTest");
    expect(runKindFor(pkg, "run")).toBeNull();
    expect(runKindFor(project, "generate")).toBeNull();
    expect(runKindFor(spec, "generate")).toBe("xcodegenGenerate");
    expect(runKindFor(spec, "build")).toBeNull();
    expect(runKindFor({ ...spec, generatedProjectPath: "App.xcodeproj" }, "build")).toBe("build");
  });

  it("says which choice is missing", () => {
    expect(requestFor(threadId, {}, "build")).toEqual({ missing: "Choose a project first." });
    expect(requestFor(threadId, { container: project }, "build")).toEqual({
      missing: "Choose a scheme first.",
    });
    expect(requestFor(threadId, { container: project, scheme: "App" }, "run")).toEqual({
      missing: "Choose where to run the app first.",
    });
    expect(requestFor(threadId, { container: spec }, "test")).toEqual({
      missing: "Generate the project from its XcodeGen spec first.",
    });
  });

  it("lets a single test replace the remembered test plan", () => {
    const selection = { container: project, scheme: "App", testPlan: "Unit" };
    expect(requestFor(threadId, selection, "test")).toMatchObject({
      request: { kind: "test", testPlan: "Unit" },
    });
    const single = requestFor(threadId, selection, "test", ["AppTests/LoginTests/testLogin()"]);
    expect(single).toMatchObject({
      request: { kind: "test", onlyTesting: ["AppTests/LoginTests/testLogin()"] },
    });
    expect("request" in single && "testPlan" in single.request).toBe(false);
  });

  it("builds a Swift package without a scheme", () => {
    expect(requestFor(threadId, { container: pkg }, "test")).toEqual({
      request: { workspace: { threadId }, kind: "swiftTest", container: pkg },
    });
  });
});

describe("scheme picker", () => {
  const info = {
    schemes: ["Kit", "App", "AppUITests"],
    targets: [],
    configurations: [],
    testPlans: [],
    sharedSchemes: [],
  };
  it("prefers the remembered scheme while it still exists", () => {
    expect(defaultScheme(info, project, "AppUITests")).toBe("AppUITests");
    expect(defaultScheme(info, project, "Gone")).toBe("App");
    expect(defaultScheme(info, { ...project, name: "Other" }, "Gone")).toBe("Kit");
    expect(defaultScheme({ ...info, schemes: [] }, project)).toBeUndefined();
  });
});

describe("destination picker", () => {
  it("lists booted simulators first and disables devices that cannot run yet", () => {
    const options = destinationOptions([
      simulator,
      { ...simulator, udid: "SIM-2", booted: true },
      {
        _tag: "device",
        identifier: "DEV-1",
        name: "Test Phone",
        platform: "iOS",
        osVersion: "27.0",
        paired: false,
        developerModeEnabled: null,
        connection: "connected",
      },
    ]);
    expect(options.map((option) => option.value)).toEqual([
      "simulator:SIM-2",
      "simulator:SIM-1",
      "device:DEV-1",
      "mac",
      "generic:iOS",
      "generic:iOS Simulator",
    ]);
    expect(options[2]).toMatchObject({
      disabled: true,
      hint: "Pair it in Xcode, Window > Devices and Simulators",
    });
  });
});

describe("toolchain problems", () => {
  const toolchain = {
    platform: "darwin",
    xcodeVersion: "Xcode 27.0",
    developerDir: "/Library/Developer/CommandLineTools",
    developerDirIsCommandLineTools: true,
    firstLaunchPending: false,
    runtimes: [],
    tools: {
      xcodegen: null,
      xcbeautify: null,
      mcpbridge: false,
      mcpServerHeadless: null,
      xtool: null,
    },
  } as const;

  it("gives the command that fixes each problem", () => {
    expect(toolchainProblems(toolchain).map((problem) => problem.command)).toEqual([
      "sudo xcode-select -s /Applications/Xcode.app/Contents/Developer",
      "xcodebuild -downloadPlatform iOS",
    ]);
    expect(toolchainProblems({ ...toolchain, platform: "linux" })).toEqual([]);
  });
});

describe("build issues", () => {
  it("groups by file, shows repeats once and puts issues without a file last", () => {
    const error = (message: string, file?: string, line?: number) => ({
      severity: "error" as const,
      message,
      ...(file ? { file } : {}),
      ...(line === undefined ? {} : { line }),
    });
    const groups = groupIssuesByFile([
      error("linker failed"),
      error("missing return", "A.swift", 4),
      error("missing return", "A.swift", 4),
      error("bad type", "B.swift", 1),
    ]);
    expect(groups.map(([file, issues]) => [file, issues.length])).toEqual([
      ["A.swift", 1],
      ["B.swift", 1],
      ["", 1],
    ]);
  });
});
