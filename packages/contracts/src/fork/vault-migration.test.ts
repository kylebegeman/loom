import { expect, it } from "@effect/vitest";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import {
  VaultTypedMigrationPrepare,
  VaultTypedMigrationApply,
  VaultTypedMigrationResult,
} from "./vault-migration.ts";
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

it("requires separate development and reviewed attestations for typed imports and redacts private ingress", () => {
  const prepare = Schema.decodeUnknownOption(VaultTypedMigrationPrepare),
    apply = Schema.decodeUnknownOption(VaultTypedMigrationApply);
  const credential = {
    type: "github",
    account: "dev-bot",
    repositories: ["team/repo"],
    credential: { type: "token", token: "synthetic_development_token" },
  };
  const request = { id: "a".repeat(32), label: "Development", developmentOnly: true, credential };
  const parsed = prepare(request);
  expect(Option.isSome(parsed)).toBe(true);
  if (
    Option.isSome(parsed) &&
    parsed.value.credential.type === "github" &&
    parsed.value.credential.credential.type === "token"
  )
    expect(Redacted.isRedacted(parsed.value.credential.credential.token)).toBe(true);
  expect(Option.isNone(prepare({ ...request, developmentOnly: false }))).toBe(true);
  expect(Option.isNone(apply({ ...request, reviewed: false }))).toBe(true);
  expect(Option.isNone(apply({ ...request, reviewed: true, developmentOnly: false }))).toBe(true);
  expect(Option.isSome(apply({ ...request, reviewed: true }))).toBe(true);
  const result = Schema.decodeUnknownOption(VaultTypedMigrationResult);
  const value = {
    plan: {
      id: request.id,
      itemId: "b".repeat(32),
      label: "Development",
      kind: "service-connection",
      details: {
        type: "github",
        account: "dev-bot",
        repositories: ["team/repo"],
        mechanism: "token",
        appId: null,
        installationId: null,
      },
      developmentOnly: true,
      state: "prepared",
      createdAt: 0,
      expiresAt: 600000,
    },
    item: null,
    canArchive: false,
    accessVerification: "not-performed",
    workloadAuthorization: "not-evaluated",
    canCutover: false,
    canRollback: false,
    configurationWrites: false,
  };
  expect(Option.isSome(result(value))).toBe(true);
  for (const patch of [
    { canCutover: true },
    { canRollback: true },
    { configurationWrites: true },
    { accessVerification: "passed" },
  ])
    expect(Option.isNone(result({ ...value, ...patch }))).toBe(true);
});
