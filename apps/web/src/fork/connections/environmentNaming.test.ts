import { describe, expect, it } from "vite-plus/test";
import { EnvironmentId, type ServerConfig } from "@t3tools/contracts";
import {
  BearerConnectionTarget,
  BearerConnectionProfile,
  type EnvironmentPresentation,
} from "@t3tools/client-runtime/connection";
import * as Option from "effect/Option";
import { projectEnvironmentPresentation } from "~/state/environments";

const environmentId = EnvironmentId.make("named-host");
const entry = {
  target: new BearerConnectionTarget({
    environmentId,
    connectionId: "paired-route",
    label: "Fleet QA Mac",
  }),
  enabled: true,
  profile: Option.some(
    new BearerConnectionProfile({
      environmentId,
      connectionId: "paired-route",
      label: "Fleet QA Mac",
      httpBaseUrl: "https://host.example",
      wsBaseUrl: "wss://host.example",
    }),
  ),
};
const presentation = (label: string, capable = true): EnvironmentPresentation => ({
  entry,
  connection: { phase: "connected", error: null, traceId: null },
  serverConfig: {
    environment: {
      environmentId,
      label,
      capabilities: { repositoryIdentity: true, loomFeatures: capable ? ["computer-naming"] : [] },
    },
  } as unknown as ServerConfig,
});

describe("web computer name projection", () => {
  it("updates an already paired client when a rename or reset arrives in live config", () => {
    const renamed = projectEnvironmentPresentation(environmentId, presentation("Fleet QA Mac"));
    const reset = projectEnvironmentPresentation(environmentId, presentation("Dorothy"));
    expect(renamed.label).toBe("Fleet QA Mac");
    expect(reset.label).toBe("Dorothy");
    expect(reset.entry).toBe(renamed.entry);
    expect(reset.environmentId).toBe(renamed.environmentId);
    expect(reset.displayUrl).toBe(renamed.displayUrl);
    expect(Option.getOrThrow(reset.entry.profile)).toBe(Option.getOrThrow(renamed.entry.profile));
  });
  it("retains device aliases for hosts without canonical naming support", () => {
    expect(
      projectEnvironmentPresentation(environmentId, presentation("Dorothy", false)).label,
    ).toBe("Fleet QA Mac");
  });
});
