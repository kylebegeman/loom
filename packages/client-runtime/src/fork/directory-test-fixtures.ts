import { EnvironmentId } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import type {
  DirectoryEnvironment,
  DirectoryListing,
  DirectoryMachine,
  LoomIdentityMetadata,
} from "@t3tools/contracts/fork";

export const NOW = Date.parse("2026-10-20T12:00:00.000Z");
export const ago = (ms: number) => DateTime.formatIso(DateTime.makeUnsafe(NOW - ms));
export const MINUTES = 60_000;

export const STUDIO = EnvironmentId.make("studio");
export const LIBRARY = EnvironmentId.make("library");
export const LIBRARY_ISSUER = "https://login.example.com";
export const APP_ORIGIN = "https://app.example.com";
export const BOOK = EnvironmentId.make("book");
export const DESK = EnvironmentId.make("desk");

export function reported(
  environmentId: EnvironmentId,
  overrides: Partial<DirectoryEnvironment> = {},
): DirectoryEnvironment {
  return {
    environmentId,
    label: environmentId,
    serverVersion: "1.4.0",
    platform: { os: "darwin", arch: "arm64" },
    supportsExecution: true,
    loomFeatures: [],
    routes: [{ kind: "tailnet", url: `https://${environmentId}.example.ts.net` }],
    providers: [],
    sequence: 1,
    reportedAt: ago(MINUTES),
    keyFingerprint: "a".repeat(64),
    firstSeenAt: ago(60 * MINUTES),
    receivedAt: ago(MINUTES),
    ...overrides,
  };
}

export function machine(
  reportedBy: EnvironmentId,
  overrides: Partial<DirectoryMachine> = {},
): DirectoryMachine {
  return {
    keyFingerprint: "b".repeat(64),
    installationId: null,
    hostname: `${reportedBy}-mini`,
    release: null,
    reportedBy,
    firstSeenAt: ago(60 * MINUTES),
    lastSeenAt: ago(MINUTES),
    ...overrides,
  };
}

export const listing = (
  environments: readonly DirectoryEnvironment[],
  machines: readonly DirectoryMachine[] = [],
): DirectoryListing => ({ environments, machines, generatedAt: ago(0) });

export function identity(
  environmentId: EnvironmentId,
  overrides: Partial<LoomIdentityMetadata> = {},
): LoomIdentityMetadata {
  return {
    enabled: true,
    browserLoginEnabled: true,
    issuer: LIBRARY_ISSUER,
    clientId: "loom-web",
    nativeClientId: "loom-native",
    authorizationEndpoint: "https://login.example.com/authorize",
    tokenEndpoint: "https://login.example.com/token",
    scopes: ["openid"],
    audience: "loom",
    environmentId,
    sessionExchangeEnabled: true,
    browserOrigins: [APP_ORIGIN],
    ...overrides,
  };
}
