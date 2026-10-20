import { expect, it } from "@effect/vitest";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import {
  VaultReplacementPrepare,
  VaultReplacementReview,
  VaultReplacementResult,
} from "./vault-migration-inventory.ts";
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
