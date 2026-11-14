import { describe, expect, it } from "@effect/vitest";
import { EnvironmentId } from "@t3tools/contracts";
import type { AccountLinkStatus } from "@t3tools/contracts/fork";
import { accountLinkedComputers, agentReachable, reachesOverLinks } from "./account-links.ts";

const DESK = EnvironmentId.make("desk");
const BOOK = EnvironmentId.make("book");
const STUDIO = EnvironmentId.make("studio");
const machines = [DESK, BOOK, STUDIO].map((environmentId) => ({ environmentId }));

/** Outbound account links, each held until a time or still waiting for its first grant (null). */
const status = (outbound: ReadonlyArray<readonly [EnvironmentId, string | null]>) =>
  ({
    state: "linked",
    policy: null,
    outbound: outbound.map(([environmentId, expiresAt]) => ({
      environmentId,
      label: environmentId,
      access: "full-access",
      expiresAt,
      lastError: null,
    })),
    inbound: [],
    checkedAt: null,
    lastError: null,
  }) satisfies AccountLinkStatus;

describe("agentReachable", () => {
  it.each([
    {
      name: "the beta reaches every machine, account links or not",
      offers: true,
      held: null,
      reached: [DESK, BOOK, STUDIO],
    },
    {
      name: "without the beta, only computers it holds an account link to",
      offers: false,
      held: status([
        [BOOK, "2026-12-01T00:00:00.000Z"],
        [STUDIO, null],
      ]),
      reached: [BOOK],
    },
    {
      name: "without the beta or a held account link, nothing",
      offers: false,
      held: status([[STUDIO, null]]),
      reached: [],
    },
    {
      name: "without the beta while its status is unknown, nothing",
      offers: false,
      held: null,
      reached: [],
    },
  ])("$name", ({ offers, held, reached }) => {
    const reach = { offers, accountLinked: accountLinkedComputers(held) };
    expect(agentReachable(reach, machines).map(({ environmentId }) => environmentId)).toEqual(
      reached,
    );
    expect(reachesOverLinks(reach)).toBe(reached.length > 0);
  });
});
