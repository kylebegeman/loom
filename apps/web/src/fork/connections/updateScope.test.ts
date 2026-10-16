import {
  BearerConnectionTarget,
  PrimaryConnectionTarget,
} from "@t3tools/client-runtime/connection";
import { EnvironmentId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";
import { updateEnvironmentInScope } from "./updateScope";

const primary = new PrimaryConnectionTarget({
  environmentId: EnvironmentId.make("primary"),
  label: "This computer",
  httpBaseUrl: "http://localhost:3773",
  wsBaseUrl: "ws://localhost:3773",
});
const bearer = (connectionId: string) =>
  new BearerConnectionTarget({
    environmentId: EnvironmentId.make(connectionId),
    label: connectionId,
    connectionId,
  });

describe("machine update scope", () => {
  it("keeps remote connections out of the desktop footer, including loopback SSH routes", () => {
    expect(updateEnvironmentInScope(primary, "local", true)).toBe(true);
    expect(updateEnvironmentInScope(bearer("local:wsl:Ubuntu"), "local", true)).toBe(true);
    for (const id of ["remote", "ssh:localhost", "relay:other-mac"]) {
      expect(updateEnvironmentInScope(bearer(id), "local", true)).toBe(false);
      expect(updateEnvironmentInScope(bearer(id), "fleet", true)).toBe(true);
    }
  });

  it("does not treat a browser's primary server as the client computer", () => {
    expect(updateEnvironmentInScope(primary, "local", false)).toBe(false);
    expect(updateEnvironmentInScope(bearer("local:wsl:Ubuntu"), "local", false)).toBe(false);
    expect(updateEnvironmentInScope(primary, "fleet", false)).toBe(true);
  });
});
