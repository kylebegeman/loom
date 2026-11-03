import type { LibraryApiBundle } from "@t3tools/contracts/fork";
import { importHoppscotch } from "./hoppscotch.ts";
const credentialKey =
  /^(?:.*token|.*password|.*secret|.*credential|api[-_]?key|authorization|proxy-authorization|cookie|set-cookie)$/i;
const template = (value: unknown) => typeof value === "string" && /<<[^<>]+>>/.test(value);
export function portableApiJson(text: string): string {
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
        result[name] = item
          .replace(
            /([?&])([^?&=]+)=([^&]*)/g,
            (match, separator: string, param: string, content: string) =>
              credentialKey.test(decodeURIComponent(param)) && !template(content)
                ? `${separator}${param}=`
                : match,
          )
          .replace(/^(https?:\/\/)[^/@]*@/, "$1");
      else if (
        name === "body" &&
        object.contentType === "application/json" &&
        typeof item === "string"
      ) {
        try {
          result[name] = JSON.stringify(walk(JSON.parse(item)));
        } catch {
          result[name] = item;
        }
      } else result[name] = walk(item, name);
    }
    if (key && secret && Object.hasOwn(object, "secret")) result.secret = true;
    return result;
  };
  return JSON.stringify(walk(JSON.parse(text)), null, 2);
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
