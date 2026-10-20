import { expect, it } from "@effect/vitest";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import {
  VaultReplacementPrepare,
  VaultReplacementReview,
  VaultReplacementResult,
  VaultReplacementVerify,
  VaultReplacementVerificationReceipt,
} from "./vault-migration-inventory.ts";
const receipt = Schema.decodeUnknownOption(VaultReplacementVerificationReceipt);
const verify = Schema.decodeUnknownOption(VaultReplacementVerify);
const prepare = Schema.decodeUnknownOption(VaultReplacementPrepare),
  review = Schema.decodeUnknownOption(VaultReplacementReview),
  result = Schema.decodeUnknownOption(VaultReplacementResult);
const request = {
  id: "a".repeat(32),
  projectId: "project",
  dependency: {
    remote: "origin",
    direction: "fetch",
    position: 0,
    transport: "ssh",
    hostname: "github.com",
    port: 22,
    repository: "dev/repo",
    gitPath: "dev/repo.git",
    embeddedAuthentication: false,
  },
  replacement: { adapter: "ssh", itemId: "b".repeat(32), expectedVersion: 1 },
  developmentOnly: true,
};
it("requires explicit development and review statements and a current item version", () => {
  expect(Option.isSome(prepare(request))).toBe(true);
  for (const patch of [
    { developmentOnly: false },
    { developmentOnly: undefined },
    { replacement: { ...request.replacement, expectedVersion: 0 } },
    { replacement: { ...request.replacement, adapter: "personal-ssh-agent" } },
  ])
    expect(Option.isNone(prepare({ ...request, ...patch }))).toBe(true);
  expect(Option.isNone(review({ id: request.id, reviewed: false }))).toBe(true);
  expect(Option.isNone(review({ id: request.id }))).toBe(true);
  expect(Option.isSome(review({ id: request.id, reviewed: true }))).toBe(true);
});
it("cannot represent a verified or cutover-authorizing replacement result", () => {
  const plan = {
    id: request.id,
    projectId: request.projectId,
    projectTitle: "Project",
    dependency: request.dependency,
    replacement: {
      ...request.replacement,
      label: "Development",
      destination: "ssh://git@github.com:22",
      hostTrust: "pinned",
      scope: "ssh-git-transport",
    },
    developmentOnly: true,
    state: "reviewed",
    createdAt: 0,
    expiresAt: 600000,
  };
  const valid = { plan, validation: "current", verification: "required", canCutover: false };
  expect(Option.isSome(result(valid))).toBe(true);
  expect(Option.isNone(result({ ...valid, canCutover: true }))).toBe(true);
  expect(Option.isNone(result({ ...valid, verification: "passed" }))).toBe(true);
});

it("requires explicit provider-contact confirmation and a stable expected receipt", () => {
  const request = {
    id: "a".repeat(32),
    operationId: "b".repeat(32),
    expectedOperationId: null,
    contactDestination: true,
  };
  expect(Option.isSome(verify(request))).toBe(true);
  expect(Option.isNone(verify({ ...request, contactDestination: false }))).toBe(true);
  expect(Option.isNone(verify({ ...request, contactDestination: undefined }))).toBe(true);
  expect(Option.isNone(verify({ ...request, expectedOperationId: undefined }))).toBe(true);
});

it("rejects a completed success without completion, lifetime or pinned SSH host evidence", () => {
  const value = {
    operationId: "a".repeat(32),
    planId: "b".repeat(32),
    itemId: "c".repeat(32),
    itemVersion: 1,
    scope: "ssh-git-transport",
    destination: "ssh://git@repo.invalid:22",
    gitPath: "/team/repo.git",
    state: "passed",
    startedAt: 0,
    deadlineAt: 30000,
    completedAt: 1,
    validUntil: 60001,
    failure: null,
    hostFingerprint: "synthetic-host",
  };
  expect(Option.isSome(receipt(value))).toBe(true);
  for (const patch of [
    { completedAt: null },
    { validUntil: null },
    { hostFingerprint: null },
    { failure: "failed" },
  ])
    expect(Option.isNone(receipt({ ...value, ...patch }))).toBe(true);
});
