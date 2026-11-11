import {
  EnvironmentId,
  AuthOrchestrationOperateScope,
  AuthSettingsWriteScope,
} from "@t3tools/contracts";
import { expect, it } from "vite-plus/test";
import {
  accessBlock,
  accessRepairTarget,
  libraryAccessRepairLink,
  LIBRARY_SIGN_IN_TARGET,
  type AccessTarget,
} from "./accessBlock";

// The decision reads only grant fields; the rest of the session shape is irrelevant here.
const session = (fields: {
  readonly authenticated: boolean;
  readonly scopes?: ReadonlyArray<string>;
  readonly permissions?: ReadonlyArray<string>;
}) => fields as unknown as AccessTarget["session"];

const library: AccessTarget = {
  label: "Library",
  phase: "connected",
  connectionError: null,
  identity: true,
  session: session({
    authenticated: true,
    scopes: [AuthOrchestrationOperateScope, AuthSettingsWriteScope],
  }),
  sessionFailed: false,
  requiredScopes: [AuthOrchestrationOperateScope, AuthSettingsWriteScope],
};

it("allows a connected session holding every required scope", () => {
  expect(accessBlock(library)).toBeNull();
});

it("asks for a new sign-in when expired Identity access leaves the socket connected", () => {
  expect(accessBlock({ ...library, session: session({ authenticated: false }) })).toMatchObject({
    repair: "sign-in",
    message: expect.stringContaining("expired"),
  });
});

it("asks a paired connection to pair again instead of signing in", () => {
  expect(
    accessBlock({
      ...library,
      identity: false,
      session: session({ authenticated: false }),
    }),
  ).toMatchObject({ repair: "connection", message: expect.stringContaining("Pair it again") });
});

it("names the missing permission", () => {
  expect(
    accessBlock({
      ...library,
      session: session({
        authenticated: true,
        scopes: [AuthOrchestrationOperateScope],
        permissions: [AuthOrchestrationOperateScope],
      }),
    })?.message,
  ).toContain("Change environment settings");
});

it("distinguishes blocked authentication from other connection failures", () => {
  expect(
    accessBlock({
      ...library,
      phase: "error",
      blockedReason: "authentication",
      connectionError: "Identity access expired.",
    }),
  ).toMatchObject({ repair: "sign-in" });
  expect(
    accessBlock({ ...library, phase: "error", connectionError: "Network down." }),
  ).toMatchObject({
    repair: "connection",
    message: "Library is not connected. Network down.",
  });
  expect(
    accessBlock({ ...library, phase: "reconnecting", connectionError: "Network down." }),
  ).toMatchObject({ repair: "connection", message: "Library is not connected. Network down." });
});

it("does not offer a repair while permissions are still loading", () => {
  expect(accessBlock({ ...library, session: null })).toMatchObject({ repair: null });
});

it("waits without a repair while a first connection is still on its way", () => {
  // Right after signing in the connection starts over; telling the user to reconnect would be wrong.
  expect(accessBlock({ ...library, phase: "connecting", session: null })).toEqual({
    label: "Library",
    message: "Connecting to Library...",
    repair: null,
  });
});

it("sends a turned-off or missing connection to Connections", () => {
  expect(accessBlock({ ...library, phase: null, session: null })).toMatchObject({
    repair: "connection",
    message: "Library is not connected. Reconnect it to continue.",
  });
});

it("leads an expired Library sign-in to the Library block, other computers to Connections", () => {
  const block = accessBlock({ ...library, session: session({ authenticated: false }) })!;
  expect(accessRepairTarget({ ...block, environmentId: "library" }, "library", true)).toBe(
    LIBRARY_SIGN_IN_TARGET,
  );
  expect(accessRepairTarget({ ...block, environmentId: "worker" }, "library", true)).toBeNull();
  const offline = accessBlock({ ...library, identity: false, phase: "offline" })!;
  expect(accessRepairTarget({ ...offline, environmentId: "library" }, "library", true)).toBeNull();
  expect(accessRepairTarget({ ...offline, environmentId: "library" }, "library", false)).toBe(
    LIBRARY_SIGN_IN_TARGET,
  );
});

it("keeps repair links on the exact computer and selected Vault repository", () => {
  expect(
    libraryAccessRepairLink(
      { kind: "connection", environmentId: EnvironmentId.make("library") },
      { libraryId: "library", saved: false },
    ).hash,
  ).toBe(LIBRARY_SIGN_IN_TARGET);
  const environmentId = EnvironmentId.make("worker");
  expect(libraryAccessRepairLink({ kind: "connection", environmentId })).toEqual({
    to: "/settings/connections",
    search: { machine: "worker", project: undefined, checkout: undefined },
    hash: "remote-environments",
  });
  const link = libraryAccessRepairLink({
    kind: "vault-github",
    environmentId,
    id: "1".repeat(32),
    expectedVersion: 3,
    repository: "owner/repo",
  });
  expect(link.to).toBe("/settings/vault");
  expect(link.search.machine).toBe("worker");
  expect(new URLSearchParams(link.hash.split("?")[1]).get("connection")).toBe("1".repeat(32));
  expect(new URLSearchParams(link.hash.split("?")[1]).get("repository")).toBe("owner/repo");
});
