// @effect-diagnostics nodeBuiltinImport:off -- Runs the generated POSIX launcher in a real shell.
import * as NodeChildProcess from "node:child_process";
import { expect, it } from "@effect/vitest";
import type { VaultSshAgentSession } from "@t3tools/contracts/fork";
import { renderAgentSshLauncher } from "./ssh-agent-launcher.ts";

const session: VaultSshAgentSession = {
  sessionId: "a".repeat(32),
  id: "b".repeat(32),
  version: 1,
  expiresAt: 0,
  destination: "ssh://deploy@vps.example.test:2222",
  target: { hostname: "vps.example.test", username: "deploy", port: 2222, hostKey: null },
  publicKey: `ssh-ed25519 ${"A".repeat(68)}`,
};
const paths = { socket: "/agent", identity: "/identity.pub", knownHosts: "/known_hosts" };
// Swap only the final exec for echo so the test sees what ssh would receive, with no network.
const launch = (argv: ReadonlyArray<string>, aliases?: ReadonlyArray<string>) => {
  const script = renderAgentSshLauncher(session, paths, aliases).replace(
    "exec /usr/bin/ssh ",
    "exec /bin/echo ",
  );
  const result = NodeChildProcess.spawnSync("/bin/sh", ["-c", script, "ssh", ...argv], {
    encoding: "utf8",
  });
  return { status: result.status, stdout: result.stdout.trim() };
};

it("lets the selected resource name stand in for the pinned destination", () => {
  for (const destination of ["personal-vps", "deploy@personal-vps", "vps.example.test"]) {
    const result = launch([destination, "cat > f.gz"], ["personal-vps"]);
    expect(result.status).toBe(0);
    expect(result.stdout.endsWith("-p 2222 -l deploy -- vps.example.test cat > f.gz")).toBe(true);
  }
});

it("still refuses other destinations, other users and unsafe aliases", () => {
  expect(launch(["other.test", "true"], ["personal-vps"]).status).toBe(64);
  expect(launch(["root@personal-vps", "true"], ["personal-vps"]).status).toBe(64);
  expect(launch(["personal-vps", "true"]).status).toBe(64);
  for (const alias of ["-oProxyCommand=x", "a b", "x;y", "user@host"])
    expect(launch([alias, "true"], [alias]).status).toBe(64);
});
