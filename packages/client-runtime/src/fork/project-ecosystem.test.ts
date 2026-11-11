import { expect, it } from "vite-plus/test";
import type { LibraryProject, SitesSnapshot } from "@t3tools/contracts/fork";
import {
  projectRelationships,
  projectServices,
  projectComputerCapabilities,
} from "./project-ecosystem.ts";

const project = (id: string, dependencies?: readonly string[]): LibraryProject => ({
  id,
  title: id,
  brief: "",
  revision: 1,
  resources: [],
  archived: false,
  createdAt: "2026-11-11T12:00:00Z",
  updatedAt: "2026-11-11T12:00:00Z",
  ...(dependencies ? { dependencies } : {}),
});
it("keeps unresolved dependencies visible and computes reverse relationships from explicit declarations", () => {
  const app = project("app", ["identity", "unavailable"]);
  const identity = { ...project("identity"), archived: true };
  const boop = project("boop", ["app"]);
  const result = projectRelationships(app, [app, identity, boop]);
  expect(result.dependencies).toEqual([
    { id: "identity", project: identity },
    { id: "unavailable", project: null },
  ]);
  expect(result.dependents).toEqual([boop]);
  expect(projectRelationships(identity, [app, identity, boop]).dependents).toEqual([app]);
});
it("uses registered project links and preserves stale and unknown service observations", () => {
  const snapshot: SitesSnapshot = {
    schemaVersion: 1,
    primarySiteId: "identity",
    observedAt: "2026-11-11T12:00:00Z",
    staleAfterSeconds: 60,
    sites: [
      {
        id: "identity",
        name: "Identity",
        url: "https://id.example",
        origins: ["https://id.example"],
        active: 1,
        projectIds: ["identity"],
        serviceIds: ["auth"],
      },
      {
        id: "unrelated",
        name: "Elsewhere",
        url: "https://other.example",
        origins: ["https://other.example"],
        active: 1,
        projectIds: ["other"],
        serviceIds: ["other"],
      },
    ],
    services: [
      { id: "auth", name: "Authentication", url: "https://id.example", active: 1, kind: "api" },
      { id: "other", name: "Other", url: "https://other.example", active: 1, kind: "api" },
    ],
    checks: [
      {
        id: "auth-health",
        service_id: "auth",
        name: "Health",
        url: "https://id.example/health",
        active: 1,
        state: "healthy",
        last: {
          checked_at: "2026-11-11T12:00:00Z",
          ok: 1,
          status: 200,
          duration_ms: 1,
          tls_expires_at: null,
          error: null,
        },
      },
    ],
  };
  const now = Date.parse("2026-11-11T12:00:20Z");
  expect(
    projectServices(["app", "identity"], snapshot, now).map(({ service, health }) => [
      service.id,
      health.state,
    ]),
  ).toEqual([["auth", "healthy"]]);
  expect(projectServices(["app"], snapshot, now)).toEqual([]);
  expect(projectServices(["identity"], snapshot, now + 60_000)[0]?.health.state).toBe("stale");
  expect(
    projectServices(["identity"], { ...snapshot, observedAt: "invalid" }, now)[0]?.health.state,
  ).toBe("unchecked");
  expect(
    projectServices(["identity"], { ...snapshot, observedAt: "2026-11-12T12:00:00Z" }, now)[0]
      ?.health.state,
  ).toBe("unchecked");
});

it("distinguishes an unknown computer version from a host lacking a lifecycle capability", () => {
  expect(projectComputerCapabilities(undefined).every((entry) => entry.supported === null)).toBe(
    true,
  );
  expect(
    projectComputerCapabilities(["project-workflows"]).map((entry) => [entry.id, entry.supported]),
  ).toEqual([
    ["library-repository-access", false],
    ["library-profile-readiness", false],
    ["project-workflows", true],
  ]);
});
