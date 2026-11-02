// @effect-diagnostics nodeBuiltinImport:off - stable checkout identities use an incremental digest.
import * as NodeCrypto from "node:crypto";
import * as NodeUtil from "node:util";
import type { DevServerCandidate } from "@t3tools/contracts/fork";

export const checkoutKey = (root: string) =>
  NodeCrypto.createHash("sha256").update(root).digest("hex").slice(0, 24);
export const appendOutput = (current: string, chunk: string) =>
  NodeUtil.stripVTControlCharacters(current + chunk).slice(-8192);
const quote = (text: string) => `'${text.replaceAll("'", `'"'"'`)}'`;
export function commandLine(command: string, platform: string, shell = "sh"): string {
  if (platform === "win32") return `(${command}) & exit\r`;
  return `sh -c ${quote(command)}; exit ${/fish(?:\.exe)?$/i.test(shell) ? "$status" : "$?"}\r`;
}
export function candidatesFrom(input: {
  actions: ReadonlyArray<{
    id: string;
    name: string;
    command: string;
    previewUrl?: string | null | undefined;
    autoOpenPreview?: boolean | undefined;
  }>;
  scripts: Record<string, unknown>;
  packageManager: string;
  mappedDev?: string | undefined;
}): DevServerCandidate[] {
  const candidates: DevServerCandidate[] = [];
  const add = (candidate: DevServerCandidate) => {
    if (!candidates.some((entry) => entry.command === candidate.command))
      candidates.push(candidate);
  };
  for (const action of input.actions)
    add({
      key: `action:${action.id}`,
      name: action.name,
      command: action.command,
      previewUrl: action.previewUrl ?? null,
      autoOpenPreview: action.autoOpenPreview ?? false,
    });
  if (input.mappedDev)
    add({
      key: "profile:dev",
      name: "Dev",
      command: input.mappedDev,
      previewUrl: null,
      autoOpenPreview: false,
    });
  for (const [name, script] of Object.entries(input.scripts)) {
    if (typeof script !== "string" || !/^(dev|start|serve|preview|storybook)(:|$)/.test(name))
      continue;
    add({
      key: `package:${name}`,
      name,
      command: `${input.packageManager} run ${/^[a-zA-Z0-9:_-]+$/.test(name) ? name : quote(name)}`,
      previewUrl: null,
      autoOpenPreview: false,
    });
  }
  return candidates.slice(0, 60);
}
