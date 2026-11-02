import * as Schema from "effect/Schema";
import * as Option from "effect/Option";
import type { DevContainer, DevDatabaseKind } from "@t3tools/contracts/fork";
import { checkoutKey } from "./servers.ts";

export const composeProject = (root: string) => `loomdev-${checkoutKey(root)}`;
const Publisher = Schema.Struct({
  PublishedPort: Schema.optionalKey(Schema.Number),
  TargetPort: Schema.optionalKey(Schema.Number),
  URL: Schema.optionalKey(Schema.String),
});
const ComposeRow = Schema.Struct({
  ID: Schema.String,
  Name: Schema.String,
  Service: Schema.String,
  State: Schema.String,
  Health: Schema.optionalKey(Schema.String),
  Publishers: Schema.optionalKey(Schema.NullOr(Schema.Array(Publisher))),
  Ports: Schema.optionalKey(Schema.String),
});
const decodeJson = Schema.decodeSync(Schema.fromJsonString(Schema.Unknown));
const decodeRows = Schema.decodeUnknownSync(Schema.Array(ComposeRow));
export function parseComposeStatus(text: string): DevContainer[] {
  if (!text.trim()) return [];
  const raw: unknown = text.trim().startsWith("[")
    ? decodeJson(text)
    : text
        .trim()
        .split("\n")
        .map((line) => decodeJson(line));
  return decodeRows(raw).map((row) => ({
    id: row.ID,
    name: row.Name,
    service: row.Service,
    state: row.State,
    health: row.Health ?? "",
    ports:
      row.Ports ??
      (row.Publishers ?? [])
        .map((port) => `${port.URL ?? ""}:${port.PublishedPort ?? ""} → ${port.TargetPort ?? ""}`)
        .join(", "),
  }));
}
const Resource = Schema.Struct({
  external: Schema.optionalKey(Schema.Unknown),
  name: Schema.optionalKey(Schema.String),
});
const ComposeConfig = Schema.Struct({
  services: Schema.optionalKey(
    Schema.Record(
      Schema.String,
      Schema.Struct({ container_name: Schema.optionalKey(Schema.Unknown) }),
    ),
  ),
  volumes: Schema.optionalKey(Schema.Record(Schema.String, Schema.NullOr(Resource))),
  networks: Schema.optionalKey(Schema.Record(Schema.String, Schema.NullOr(Resource))),
  secrets: Schema.optionalKey(Schema.Record(Schema.String, Schema.NullOr(Resource))),
  configs: Schema.optionalKey(Schema.Record(Schema.String, Schema.NullOr(Resource))),
});
const decodeConfig = Schema.decodeUnknownOption(ComposeConfig);
export function validateComposeConfig(input: unknown, project?: string): boolean {
  const decoded = decodeConfig(input);
  if (Option.isNone(decoded)) return false;
  const config = decoded.value;
  if (Object.values(config.services ?? {}).some((service) => service.container_name !== undefined))
    return false;
  for (const key of ["volumes", "networks", "secrets", "configs"] as const) {
    for (const resource of Object.values(config[key] ?? {})) {
      if (
        resource?.external ||
        (resource?.name && (!project || !resource.name.startsWith(`${project}_`)))
      )
        return false;
    }
  }
  return true;
}
export function databaseSpec(root: string, kind: DevDatabaseKind) {
  const name = `${composeProject(root)}-${kind}`;
  return {
    name,
    volume: `${name}-data`,
    secret: `${name}-password`,
    port: kind === "postgres" ? 5432 : 6379,
    publish: `127.0.0.1::${kind === "postgres" ? 5432 : 6379}`,
    image: kind === "postgres" ? "postgres:17-alpine" : "valkey/valkey:8-alpine",
    mount: kind === "postgres" ? "/var/lib/postgresql/data" : "/data",
  };
}
