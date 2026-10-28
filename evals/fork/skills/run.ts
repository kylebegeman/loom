// @effect-diagnostics nodeBuiltinImport:off
import * as NodeChildProcess from "node:child_process";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";
import { WORKFLOW_PIPELINES } from "../../../apps/server/src/fork/workflows/recipes.ts";
import { SKILL_CASES } from "./cases.ts";

const args = process.argv.slice(2);
const outIndex = args.indexOf("--out");
const out = outIndex < 0 ? undefined : args[outIndex + 1];
if (!out)
  throw new Error("Pass --out <artifact directory> plus the mcp-tool-use model/sample flags.");
const root = NodeURL.fileURLToPath(new URL("../../..", import.meta.url));
const skillsRoot = NodePath.join(root, ".agents/skills");
const runtime = await NodeFSP.readFile(
  NodePath.join(skillsRoot, "loom-workflows/references/runtime.md"),
  "utf8",
);
const generated = await Promise.all(
  SKILL_CASES.map(async ({ skills, recipes, testCase }) => {
    const loaded = await Promise.all(
      skills.map(
        async (name) =>
          `Available skill ${name}, from current source:\n${await NodeFSP.readFile(NodePath.join(skillsRoot, name, "SKILL.md"), "utf8")}`,
      ),
    );
    for (const pattern of [
      ...(testCase.expect.textMust ?? []),
      ...(testCase.expect.textMustNot ?? []),
      ...(testCase.expect.shellMustNot ?? []),
    ])
      RegExp(pattern);
    return {
      ...testCase,
      setup: {
        ...testCase.setup,
        context: [
          testCase.setup.context,
          runtime,
          ...loaded,
          ...(recipes ?? []).map((id) => {
            const recipe = WORKFLOW_PIPELINES.find((item) => item.id === id);
            if (!recipe) throw new Error(`Unknown workflow recipe ${id}`);
            return `Current workflow recipe:\n${JSON.stringify(recipe)}`;
          }),
        ].join("\n\n"),
      },
    };
  }),
);
await NodeFSP.mkdir(out, { recursive: true });
const cases = NodePath.resolve(out, "cases.ndjson");
await NodeFSP.writeFile(cases, generated.map((item) => JSON.stringify(item)).join("\n") + "\n");
const child = NodeChildProcess.spawn(
  process.execPath,
  [NodePath.join(root, "evals/mcp-tool-use/run.ts"), "--cases", cases, ...args],
  { stdio: "inherit" },
);
process.exitCode = await new Promise<number>((resolve, reject) => {
  child.once("error", reject);
  child.once("exit", (code) => resolve(code ?? 1));
});
