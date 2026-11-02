import { describe, expect, it } from "@effect/vitest";
import {
  composeProject,
  parseComposeStatus,
  validateComposeConfig,
  databaseSpec,
} from "./containers.ts";

describe("isolated development containers", () => {
  it("isolates Compose projects by checkout and reads both Compose JSON formats", () => {
    expect(composeProject("/work/a")).not.toBe(composeProject("/work/b"));
    const row = {
      ID: "abc",
      Name: "stack-web",
      Service: "web",
      State: "running",
      Health: "healthy",
      Publishers: [{ PublishedPort: 8080, TargetPort: 80, URL: "127.0.0.1" }],
    };
    expect(parseComposeStatus(JSON.stringify([row]))).toEqual(
      parseComposeStatus(JSON.stringify(row) + "\n"),
    );
    expect(parseComposeStatus(JSON.stringify(row))[0]?.ports).toContain("8080");
    expect(() => parseComposeStatus("invalid")).toThrow();
  });
  it("rejects shared named resources and gives each database an owned loopback-only volume", () => {
    expect(validateComposeConfig({ services: { web: { image: "nginx" } } })).toBe(true);
    expect(validateComposeConfig({ services: { web: { container_name: "global" } } })).toBe(false);
    expect(validateComposeConfig({ services: {}, volumes: { data: { external: true } } })).toBe(
      false,
    );
    expect(validateComposeConfig({ services: {}, networks: { net: { name: "global" } } })).toBe(
      false,
    );
    for (const kind of ["postgres", "valkey"] as const) {
      const spec = databaseSpec("/work/a", kind);
      expect(spec.name).not.toBe(databaseSpec("/work/b", kind).name);
      expect(spec.publish).toMatch(/^127\.0\.0\.1::/);
      expect(spec.volume).toContain(spec.name);
    }
  });
});
