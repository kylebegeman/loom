import { expect, it } from "@effect/vitest";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import { VaultMigrationApply, VaultMigrationPrepare } from "./vault-migration.ts";

const draft = {
  id: "a".repeat(32),
  label: "Development only",
  kind: "secret",
  developmentOnly: true,
  value: "synthetic-development-private-value",
};
const decodePrepare = Schema.decodeUnknownSync(VaultMigrationPrepare);
const prepare = Schema.decodeUnknownOption(VaultMigrationPrepare);
const apply = Schema.decodeUnknownOption(VaultMigrationApply);
it("redacts private ingress and requires explicit development and review attestations", () => {
  const decoded = decodePrepare(draft);
  expect(Redacted.value(decoded.value)).toBe(draft.value);
  expect(JSON.stringify(decoded)).not.toContain(draft.value);
  for (const change of [
    { developmentOnly: false },
    { developmentOnly: undefined },
    { kind: "ssh-key" },
    { kind: "github" },
    { value: "" },
    { value: "a".repeat(65537) },
  ])
    expect(Option.isNone(prepare({ ...draft, ...change }))).toBe(true);
  expect(Option.isNone(apply({ id: draft.id, value: draft.value }))).toBe(true);
  expect(Option.isNone(apply({ id: draft.id, value: draft.value, reviewed: false }))).toBe(true);
  expect(Option.isSome(apply({ id: draft.id, value: draft.value, reviewed: true }))).toBe(true);
});
