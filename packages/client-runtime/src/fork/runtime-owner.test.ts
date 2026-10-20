import {
  EnvironmentId,
  ORCHESTRATION_PROTOCOL_VERSION,
  type ExecutionEnvironmentDescriptor,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { orchestrationProtocolCompatibilityError } from "../connection/compatibility.ts";
import { runtimeManagedByOperatingSystem } from "./capabilities.ts";

const olderMini = (
  capabilities: Partial<ExecutionEnvironmentDescriptor["capabilities"]>,
): ExecutionEnvironmentDescriptor => ({
  environmentId: EnvironmentId.make("mini"),
  label: "Mini",
  platform: { os: "linux", arch: "arm64" },
  serverVersion: "0.0.80",
  orchestrationProtocolVersion: ORCHESTRATION_PROTOCOL_VERSION - 1,
  capabilities: { repositoryIdentity: true, ...capabilities },
});

describe("runtimeManagedByOperatingSystem", () => {
  it("is true only when the server names the operating system as its runtime's owner", () => {
    expect(
      runtimeManagedByOperatingSystem({
        repositoryIdentity: true,
        serverRuntimeOwner: "operating-system",
      }),
    ).toBe(true);
    expect(
      runtimeManagedByOperatingSystem({
        repositoryIdentity: true,
        serverSelfUpdate: "boot-service",
      }),
    ).toBe(false);
    expect(runtimeManagedByOperatingSystem(undefined)).toBe(false);
  });
});

describe("an older server whose operating system owns the runtime", () => {
  it("asks for an update through the operating system and offers no remote update", () => {
    const error = orchestrationProtocolCompatibilityError(
      olderMini({ serverRuntimeOwner: "operating-system" }),
    );
    expect(error?.message).toBe(
      "This client requires a newer server. Update Mini through its operating system to connect.",
    );
    expect(error).not.toHaveProperty("serverUpdateRequired");
  });

  it("keeps the usual guidance for a server without an owner", () => {
    expect(orchestrationProtocolCompatibilityError(olderMini({}))?.message).toBe(
      "This client requires a newer server. Update T3 Code on Mini to connect.",
    );
  });
});
