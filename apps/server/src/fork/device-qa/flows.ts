// @effect-diagnostics nodeBuiltinImport:off - Walks the workspace's flow folder on disk.
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import {
  DEVICE_QA_FLOWS_DIR,
  isArgentFlowName,
  type DeviceQaFlow,
  type DeviceQaFlowKind,
} from "@t3tools/contracts/fork";
import * as Effect from "effect/Effect";
import * as YAML from "yaml";

/** Flow discovery stops after this many files and reports `truncated`. */
export const FLOW_WALK_LIMIT = 1_000;
const BASELINES_DIR = "__baselines__";

export const INVALID_NAME_MESSAGE =
  "argent cannot run a flow whose file name has other characters than letters, numbers, _ and -.";

type JsonObject = Record<string, unknown>;
const isObject = (value: unknown): value is JsonObject =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** A step's directive is its first known key (`tap`, `launch`, `when`, ...). */
const STEP_KINDS = [
  "echo",
  "launch",
  "run",
  "when",
  "tool",
  "tap",
  "long-press",
  "swipe",
  "type",
  "await",
  "assert",
  "wait",
  "scroll-to",
  "pinch",
  "rotate",
  "snapshot",
  "script",
];
const kindOf = (step: unknown) =>
  isObject(step) ? (STEP_KINDS.find((kind) => kind in step) ?? null) : null;

const countSnapshots = (steps: ReadonlyArray<unknown>): number =>
  steps.reduce<number>((total, step) => {
    const kind = kindOf(step);
    if (kind === "snapshot") return total + 1;
    if (kind === "when" && isObject(step) && Array.isArray(step.steps))
      return total + countSnapshots(step.steps);
    return total;
  }, 0);

const LAUNCH_PLATFORMS = new Set(["native", "ios", "android", "chromium", "vega", "ios-remote"]);

const platformsOf = (steps: ReadonlyArray<unknown>, into = new Set<string>()) => {
  for (const step of steps) {
    if (!isObject(step)) continue;
    const kind = kindOf(step);
    if (kind === "launch" && isObject(step.launch))
      for (const key of Object.keys(step.launch)) if (LAUNCH_PLATFORMS.has(key)) into.add(key);
    if (kind === "when") {
      if (isObject(step.when) && typeof step.when.platform === "string")
        into.add(step.when.platform);
      if (Array.isArray(step.steps)) platformsOf(step.steps, into);
    }
  }
  return into;
};

/** YAML anchors, aliases and tags: argent's YAML safety rules reject them, so Loom does too. */
const usesAnchorsOrTags = (document: YAML.Document) => {
  let found = false;
  YAML.visit(document, {
    Alias: () => {
      found = true;
      return YAML.visit.BREAK;
    },
    Node: (_key, node) => {
      if (node.anchor !== undefined || node.tag !== undefined) {
        found = true;
        return YAML.visit.BREAK;
      }
      return undefined;
    },
  });
  return found;
};

/** Splits a workspace-relative flow path into its folder under `.argent/flows` and its name. */
export const flowLocation = (relativePath: string) => {
  const inside = NodePath.posix.relative(DEVICE_QA_FLOWS_DIR, relativePath);
  const folder = NodePath.posix.dirname(inside);
  return {
    name: NodePath.posix.basename(relativePath, ".yaml"),
    folder: folder === "." ? "" : folder,
  };
};

/**
 * Describes one flow file. The first step that is not `echo` or `script` decides the kind
 * (argent's rule): `launch` makes an e2e flow, anything else a fragment.
 */
export const classifyFlow = (input: {
  readonly path: string;
  readonly text: string;
  readonly modifiedAt: string;
}): DeviceQaFlow => {
  const { name, folder } = flowLocation(input.path);
  const base = {
    path: input.path,
    name,
    folder,
    prerequisite: null,
    firstEcho: null,
    stepCount: 0,
    snapshotSteps: 0,
    platforms: [],
    modifiedAt: input.modifiedAt,
  };
  const invalid = (parseError: string): DeviceQaFlow => ({
    ...base,
    kind: "invalid",
    parseError,
  });
  if (!isArgentFlowName(name)) return invalid(INVALID_NAME_MESSAGE);
  const document = YAML.parseDocument(input.text, { prettyErrors: false });
  const problem = document.errors[0] ?? document.warnings[0];
  if (problem !== undefined) return invalid(`Invalid YAML: ${problem.message}`);
  if (usesAnchorsOrTags(document)) return invalid("argent flows cannot use YAML anchors or tags.");
  const parsed: unknown = document.toJS();
  if (!isObject(parsed) || !Array.isArray(parsed.steps))
    return invalid("A flow is an object with a steps list.");
  const steps: ReadonlyArray<unknown> = parsed.steps;
  const leading = steps.find((step) => {
    const kind = kindOf(step);
    return kind !== "echo" && kind !== "script";
  });
  const kind: DeviceQaFlowKind = kindOf(leading) === "launch" ? "e2e" : "fragment";
  const firstStep = steps[0];
  const firstEcho =
    kindOf(firstStep) === "echo" && isObject(firstStep) ? String(firstStep.echo) : null;
  const prerequisite =
    typeof parsed.executionPrerequisite === "string" && parsed.executionPrerequisite !== ""
      ? parsed.executionPrerequisite
      : null;
  return {
    ...base,
    kind,
    prerequisite,
    firstEcho,
    stepCount: steps.length,
    snapshotSteps: countSnapshots(steps),
    platforms: [...platformsOf(steps)].toSorted(),
    parseError: null,
  };
};

/** Every `*.yaml` under `<cwd>/.argent/flows`, skipping dot folders and baselines. */
export const walkFlows = (cwd: string, limit = FLOW_WALK_LIMIT) =>
  Effect.promise(async () => {
    const root = NodePath.join(cwd, DEVICE_QA_FLOWS_DIR);
    const flows: Array<DeviceQaFlow> = [];
    let truncated = false;
    const visit = async (relativeDir: string): Promise<void> => {
      const entries = await NodeFSP.readdir(NodePath.join(root, relativeDir), {
        withFileTypes: true,
      }).catch(() => []);
      entries.sort((left, right) => left.name.localeCompare(right.name));
      for (const entry of entries) {
        if (flows.length >= limit) {
          truncated = true;
          return;
        }
        if (entry.name.startsWith(".")) continue;
        const relative = relativeDir === "" ? entry.name : `${relativeDir}/${entry.name}`;
        if (entry.isDirectory()) {
          if (entry.name !== BASELINES_DIR) await visit(relative);
          continue;
        }
        if (!entry.isFile() || !entry.name.endsWith(".yaml")) continue;
        const file = NodePath.join(root, relative);
        const [text, stat] = await Promise.all([
          NodeFSP.readFile(file, "utf8").catch(() => null),
          NodeFSP.stat(file).catch(() => null),
        ]);
        if (text === null || stat === null) continue;
        flows.push(
          classifyFlow({
            path: `${DEVICE_QA_FLOWS_DIR}/${relative}`,
            text,
            modifiedAt: stat.mtime.toISOString(),
          }),
        );
      }
    };
    await visit("");
    return { flows, truncated };
  });

/**
 * A client-sent flow path as an absolute file inside `<cwd>/.argent/flows`, or null. argent
 * refuses `..` segments, so they are refused here before any resolution.
 */
export const resolveFlowPath = (cwd: string, relativePath: string) => {
  if (NodePath.isAbsolute(relativePath)) return null;
  const segments = relativePath.split(/[\\/]+/);
  if (segments.includes("..") || !relativePath.endsWith(".yaml")) return null;
  const root = NodePath.resolve(cwd, DEVICE_QA_FLOWS_DIR);
  const absolute = NodePath.resolve(cwd, relativePath);
  const inside = NodePath.relative(root, absolute);
  if (inside === "" || inside.startsWith("..") || NodePath.isAbsolute(inside)) return null;
  return absolute;
};
