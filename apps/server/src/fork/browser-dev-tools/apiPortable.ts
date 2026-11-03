import type { DevApiWorkflow, LibraryApiBundle } from "@t3tools/contracts/fork";
import { importHoppscotch } from "./hoppscotch.ts";
const credentialKey = /token|password|secret|credential|api[-_]?key|authorization|cookie/i;
const template = (value: unknown) =>
  typeof value === "string" && /^(?:(?:Bearer|Basic) )?<<[^<>]+>>$/i.test(value);
const queryKey = (key: string) => {
  try {
    return decodeURIComponent(key);
  } catch {
    return key;
  }
};
export function portableApiJson(text: string): string {
  const source: unknown = JSON.parse(text);
  const secrets = new Set<string>();
  const collect = (value: unknown, context = "") => {
    if (Array.isArray(value)) {
      value.forEach((v) => collect(v, context));
      return;
    }
    if (!value || typeof value !== "object") return;
    const object = value as Record<string, unknown>;
    const privateRow =
      object.secret === true ||
      Boolean(object.vault) ||
      (typeof object.key === "string" && credentialKey.test(object.key));
    for (const [name, item] of Object.entries(object)) {
      if (
        typeof item === "string" &&
        item &&
        !template(item) &&
        ((privateRow && ["value", "initialValue", "currentValue"].includes(name)) ||
          credentialKey.test(name) ||
          (context === "auth" && name === "value"))
      )
        secrets.add(item);
      else collect(item, name);
    }
  };
  collect(source);
  const secretValues = [...secrets].sort((a, b) => b.length - a.length);
  const redactKnown = (value: string) =>
    value
      .split(/(<<[^<>]+>>)/g)
      .map((part) =>
        template(part)
          ? part
          : secretValues.reduce((text, secret) => text.replaceAll(secret, "[redacted]"), part),
      )
      .join("");
  const walk = (value: unknown, context = ""): unknown => {
    if (Array.isArray(value)) return value.map((v) => walk(v, context));
    if (!value || typeof value !== "object") return value;
    const object = value as Record<string, unknown>;
    const key = typeof object.key === "string" ? object.key : "";
    const secret = object.secret === true || Boolean(object.vault) || credentialKey.test(key);
    const result: Record<string, unknown> = {};
    for (const [name, item] of Object.entries(object)) {
      if (name === "vault") continue;
      if (
        (secret && ["value", "initialValue", "currentValue"].includes(name)) ||
        (credentialKey.test(name) && typeof item === "string") ||
        (context === "auth" && name === "value")
      )
        result[name] = template(item) ? item : "";
      else if (name === "endpoint" && typeof item === "string")
        result[name] = redactKnown(
          item
            .replace(
              /([?&])([^?&=]+)=([^&]*)/g,
              (match, separator: string, param: string, content: string) =>
                credentialKey.test(queryKey(param)) && !template(content)
                  ? `${separator}${param}=`
                  : match,
            )
            .replace(/^(https?:\/\/)[^/@]*@/, "$1"),
        );
      else if (
        name === "body" &&
        typeof object.contentType === "string" &&
        /(?:application\/json|[+]json)(?:;|$)/i.test(object.contentType) &&
        typeof item === "string"
      ) {
        try {
          result[name] = JSON.stringify(walk(JSON.parse(item)));
        } catch {
          result[name] = redactKnown(item);
        }
      } else result[name] = typeof item === "string" ? redactKnown(item) : walk(item, name);
    }
    if (key && secret && Object.hasOwn(object, "secret")) result.secret = true;
    return result;
  };
  return JSON.stringify(walk(source), null, 2);
}
export function portableApiWorkflows(workflows: readonly DevApiWorkflow[]) {
  return workflows.map((workflow) => ({
    ...workflow,
    datasets: workflow.datasets.map((row) =>
      Object.fromEntries(
        Object.entries(row).map(([key, value]) => [
          key,
          credentialKey.test(key) && !template(value) ? "" : value,
        ]),
      ),
    ),
  }));
}
export function apiBundleDifferences(local: LibraryApiBundle, remote: LibraryApiBundle) {
  const requests = (bundle: LibraryApiBundle) =>
    new Map(
      bundle.files.flatMap((file) => {
        const parsed = importHoppscotch(file.content, file.name);
        return parsed.kind === "collections" ? parsed.requests.map((r) => [r.id, r] as const) : [];
      }),
    );
  const left = requests(local),
    right = requests(remote);
  const changes: string[] = [];
  for (const key of new Set([...left.keys(), ...right.keys()])) {
    const a = left.get(key),
      b = right.get(key);
    if (!a || !b) {
      changes.push(`${a?.name ?? b?.name}: ${a ? "only on this computer" : "only in Library"}`);
      continue;
    }
    const fields = [...new Set([...Object.keys(a.source), ...Object.keys(b.source)])].filter(
      (name) => JSON.stringify(a.source[name]) !== JSON.stringify(b.source[name]),
    );
    if (fields.length) changes.push(`${a.name}: ${fields.join(", ")}`);
  }
  if (JSON.stringify(local.workflows) !== JSON.stringify(remote.workflows))
    changes.push("Workflow definitions differ");
  if (
    JSON.stringify(
      local.files.filter((f) => importHoppscotch(f.content, f.name).kind === "environments"),
    ) !==
    JSON.stringify(
      remote.files.filter((f) => importHoppscotch(f.content, f.name).kind === "environments"),
    )
  )
    changes.push("Environment definitions differ");
  return changes.slice(0, 1000);
}
