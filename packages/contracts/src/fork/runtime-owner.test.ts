import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import {
  ExecutionEnvironmentCapabilities,
  ExecutionEnvironmentDescriptor,
} from "../environment.ts";

const decodeDescriptor = Schema.decodeUnknownSync(ExecutionEnvironmentDescriptor);

// A client built before the field existed.
const OlderCapabilities = ExecutionEnvironmentCapabilities.mapFields(
  ({ serverRuntimeOwner: _owner, ...fields }) => fields,
);
const decodeOlderDescriptor = Schema.decodeUnknownSync(
  ExecutionEnvironmentDescriptor.mapFields((fields) => ({
    ...fields,
    capabilities: OlderCapabilities,
  })),
);

const descriptor = (capabilities: Record<string, unknown>) => ({
  environmentId: "mini",
  label: "Mini",
  platform: { os: "linux", arch: "arm64" },
  serverVersion: "0.0.85",
  capabilities: { repositoryIdentity: true, ...capabilities },
});

describe("serverRuntimeOwner", () => {
  it("names the operating system and is absent on servers that update themselves", () => {
    expect(
      decodeDescriptor(descriptor({ serverRuntimeOwner: "operating-system" })).capabilities
        .serverRuntimeOwner,
    ).toBe("operating-system");
    expect(
      decodeDescriptor(descriptor({ serverSelfUpdate: "boot-service" })).capabilities
        .serverRuntimeOwner,
    ).toBeUndefined();
  });

  it("reads an owner this client does not know as absent instead of failing the descriptor", () => {
    expect(
      decodeDescriptor(descriptor({ serverRuntimeOwner: "library" })).capabilities
        .serverRuntimeOwner,
    ).toBeUndefined();
  });

  it("is dropped by an older client that does not know the key", () => {
    const decoded = decodeOlderDescriptor(descriptor({ serverRuntimeOwner: "operating-system" }));
    expect(decoded.capabilities).not.toHaveProperty("serverRuntimeOwner");
    expect(decoded.capabilities.serverSelfUpdate).toBeUndefined();
  });

  it("is never carried as a self-update capability, which every client decodes as a closed set", () => {
    expect(() => decodeDescriptor(descriptor({ serverSelfUpdate: "operating-system" }))).toThrow();
  });
});
