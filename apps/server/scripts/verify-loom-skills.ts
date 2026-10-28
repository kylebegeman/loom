// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";
import * as Schema from "effect/Schema";
import { validateSkill } from "../src/fork/skill-registry/validation.ts";

const root = NodeURL.fileURLToPath(new URL("../../../.agents/skills/", import.meta.url));
const catalog = Schema.decodeSync(
  Schema.fromJsonString(
    Schema.Struct({
      version: Schema.Literal(1),
      skills: Schema.Array(
        Schema.Struct({
          name: Schema.String,
          requires: Schema.Array(Schema.String),
          deliveryMode: Schema.String,
          sourceRevision: Schema.String,
          license: Schema.Literal("MIT"),
        }),
      ),
    }),
  ),
)(NodeFS.readFileSync(NodePath.join(root, "loom-workflows/catalog.json"), "utf8"));
const failures: string[] = [];
for (const skill of catalog.skills) {
  const directory = NodePath.join(root, skill.name);
  const text = NodeFS.readFileSync(NodePath.join(directory, "SKILL.md"), "utf8");
  const validation = validateSkill(text, skill.name);
  failures.push(
    ...validation.issues
      .filter((issue) => issue.severity === "error")
      .map((issue) => `${skill.name}: ${issue.message}`),
  );
  if (validation.name !== skill.name)
    failures.push(`${skill.name}: provider name differs from catalog`);
  if (!NodeFS.existsSync(NodePath.join(directory, "LICENSE")))
    failures.push(`${skill.name}: missing source license`);
  if (!/^[a-f0-9]{40}$/.test(skill.sourceRevision))
    failures.push(`${skill.name}: source revision is not pinned`);
  for (const dependency of skill.requires)
    if (!NodeFS.existsSync(NodePath.join(root, dependency, "SKILL.md")))
      failures.push(`${skill.name}: missing dependency ${dependency}`);
  if (skill.deliveryMode === "explicit") {
    if (!validation.userInvocationOnly)
      failures.push(`${skill.name}: Claude implicit invocation is enabled`);
    const policy = NodeFS.readFileSync(NodePath.join(directory, "agents/openai.yaml"), "utf8");
    if (!/^  allow_implicit_invocation: false$/m.test(policy))
      failures.push(`${skill.name}: Codex implicit invocation is enabled`);
  }
  for (const match of text.matchAll(/\]\(([^)]+)\)/g)) {
    const link = match[1]!;
    if (/^[a-z]+:/.test(link) || link.startsWith("#")) continue;
    if (!NodeFS.existsSync(NodePath.resolve(directory, link.split("#")[0]!)))
      failures.push(`${skill.name}: broken resource ${link}`);
  }
}
if (failures.length) {
  process.stderr.write(failures.join("\n") + "\n");
  process.exitCode = 1;
} else
  process.stdout.write(
    JSON.stringify({
      skills: catalog.skills.length,
      dependencies: "complete",
      nativeValidation: "passed",
      explicitInvocation: "Claude and Codex",
      licenses: "present",
    }) + "\n",
  );
