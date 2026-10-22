// @effect-diagnostics nodeBuiltinImport:off -- Disposable local Git aliases exercise real agent sockets, inherited streams and child cancellation without SSH hosts.
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeOS from "node:os";
import { expect, it } from "@effect/vitest";
import {
  type VaultSshAgentSession,
  type VaultSshAgentOpenInput,
  type VaultSshAgentFrame,
} from "@t3tools/contracts/fork";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Clock from "effect/Clock";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as TestClock from "effect/testing/TestClock";
import * as SshAgentClient from "./SshAgentClient.ts";
import * as SshAgentTerminal from "./SshAgentTerminal.ts";
import * as SshCrypto from "./SshCrypto.ts";
const quote = (v: string) => `'${v.replaceAll("'", "'\\''")}'`;
const fixture = Effect.gen(function* () {
  const root = yield* Effect.acquireRelease(
    Effect.promise(() =>
      NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "loom-agent-terminal-test-")),
    ),
    (p) => Effect.promise(() => NodeFSP.rm(p, { recursive: true, force: true })),
  );
  const keys = yield* SshCrypto.SshCrypto,
    key = yield* keys.create;
  const metadata: VaultSshAgentSession = {
    sessionId: "a".repeat(32),
    id: "b".repeat(32),
    version: 1,
    expiresAt: (yield* Clock.currentTimeMillis) + 300000,
    destination: "ssh://git@example.test:22",
    target: { hostname: "example.test", username: "git", port: 22, hostKey: key.publicKey },
    publicKey: key.publicKey,
  };
  const entered = yield* Deferred.make<void>();
  const state = { closed: 0, frames: 0, reject: false, hold: false };
  const opened: VaultSshAgentOpenInput[] = [],
    relayed: VaultSshAgentFrame[] = [],
    closedSessions: string[] = [];
  const report = NodePath.join(root, "environment");
  const client = SshAgentClient.SshAgentClient.of({
    open: (input) =>
      Effect.sync(() => {
        opened.push(input);
        return metadata;
      }),
    frame: (input) =>
      Effect.gen(function* () {
        state.frames++;
        relayed.push(input);
        yield* Deferred.succeed(entered, undefined);
        if (state.hold) return yield* Effect.never;
        if (state.reject)
          return yield* new SshAgentClient.SshAgentClientError({ reason: "denied" });
        return {
          response: Buffer.concat([Buffer.from([12]), SshCrypto.sshUint32(0)]).toString("base64"),
        };
      }),
    close: (sessionId) =>
      Effect.sync(() => {
        state.closed++;
        closedSessions.push(sessionId);
      }),
  });
  const terminal = yield* SshAgentTerminal.SshAgentTerminal.pipe(
    Effect.provide(SshAgentTerminal.layer),
    Effect.provideService(SshAgentClient.SshAgentClient, client),
    Effect.provideService(HostProcess.WorkingDirectory, root),
    Effect.provideService(HostProcess.Environment, {
      HOME: "/personal-home",
      SSH_AUTH_SOCK: "/personal-agent",
      LOOM_MCP_AUTHORIZATION: "private-test-bearer",
      GIT_SSH_COMMAND: "personal-ssh",
    }),
  );
  const command = {
    id: metadata.id,
    expectedVersion: 1,
    command: {
      tool: "git" as const,
      argv: [
        "-c",
        `alias.inspect=!printf '%s\\n' "$SSH_AUTH_SOCK" "$HOME" "\${LOOM_MCP_AUTHORIZATION-unset}" "\${GIT_SSH_COMMAND-unset}" > ${quote(report)}; /usr/bin/ssh-add -L; exit 7`,
        "inspect",
      ],
    },
    timeoutMs: 10000,
  };
  const read = () =>
    Effect.promise(async () => (await NodeFSP.readFile(report, "utf8")).trim().split("\n"));
  return {
    root,
    metadata,
    terminal,
    state,
    command,
    entered,
    read,
    opened,
    relayed,
    closedSessions,
  };
}).pipe(Effect.provide(SshCrypto.layer));
it.live(
  "real Git child gets only its temporary agent/configuration and preserves exit status",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture;
      expect(yield* f.terminal.execute(f.command)).toBe(7);
      const [socket, home, authorization, inheritedCommand] = yield* f.read();
      expect(authorization).toBe("unset");
      expect(inheritedCommand).toBe("unset");
      expect(home).not.toBe("/personal-home");
      expect(socket).not.toBe("/personal-agent");
      expect(f.state.frames).toBe(1);
      expect(f.state.closed).toBe(1);
      expect(
        yield* Effect.promise(() =>
          NodeFSP.stat(home!).then(
            () => true,
            () => false,
          ),
        ),
      ).toBe(false);
    }).pipe(Effect.scoped),
);
it.live("revoked signing fails the activation and cleans its socket and child", () =>
  Effect.gen(function* () {
    const f = yield* fixture;
    f.state.reject = true;
    expect(yield* f.terminal.execute(f.command).pipe(Effect.flip)).toMatchObject({
      reason: "denied",
    });
    expect(f.state.closed).toBe(1);
    const [socket] = yield* f.read();
    expect(
      yield* Effect.promise(() =>
        NodeFSP.stat(socket!).then(
          () => true,
          () => false,
        ),
      ),
    ).toBe(false);
  }).pipe(Effect.scoped),
);
it.effect("cancellation and expiration release the activation after a real child connects", () =>
  Effect.gen(function* () {
    const f = yield* fixture;
    f.state.hold = true;
    const child = yield* f.terminal.execute(f.command).pipe(Effect.forkChild);
    yield* Deferred.await(f.entered);
    yield* TestClock.adjust(10000);
    expect(yield* Fiber.join(child).pipe(Effect.flip)).toMatchObject({ reason: "timeout" });
    expect(f.state.closed).toBe(1);
    const [socket] = yield* f.read();
    expect(
      yield* Effect.promise(() =>
        NodeFSP.stat(socket!).then(
          () => true,
          () => false,
        ),
      ),
    ).toBe(false);
    const second = yield* fixture;
    second.state.hold = true;
    const cancelled = yield* second.terminal.execute(second.command).pipe(Effect.forkChild);
    yield* Deferred.await(second.entered);
    yield* Fiber.interrupt(cancelled);
    expect(second.state.closed).toBe(1);
  }).pipe(Effect.scoped),
);
it.live(
  "the launcher refuses another destination or forwarding flags before contacting an agent",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture;
      expect(
        yield* f.terminal.execute({
          ...f.command,
          command: { tool: "ssh", argv: ["other.test", "true"] },
        }),
      ).toBe(64);
      expect(
        yield* f.terminal.execute({
          ...f.command,
          command: { tool: "ssh", argv: ["-A", "git@example.test", "true"] },
        }),
      ).toBe(64);
      expect(f.state.frames).toBe(0);
      expect(f.state.closed).toBe(2);
    }).pipe(Effect.scoped),
);

it.live.each(["resource", "explicit"] as const)(
  "opens a %s selector once and pins all frames and cleanup to its returned session",
  (kind) =>
    Effect.gen(function* () {
      const f = yield* fixture;
      const connection =
        kind === "resource"
          ? { resource: "development-host", preferredItemIds: [f.metadata.id] }
          : { id: f.metadata.id, expectedVersion: f.metadata.version };
      expect(
        yield* f.terminal.execute({
          connection,
          command: f.command.command,
          timeoutMs: f.command.timeoutMs,
        }),
      ).toBe(7);
      expect(f.opened).toEqual([{ connection }]);
      expect(f.relayed).toHaveLength(1);
      expect(f.relayed[0]?.sessionId).toBe(f.metadata.sessionId);
      expect(f.closedSessions).toEqual([f.metadata.sessionId]);
      const [socket, home, authorization, inheritedCommand] = yield* f.read();
      expect(authorization).toBe("unset");
      expect(inheritedCommand).toBe("unset");
      expect(socket).not.toBe("/personal-agent");
      expect(home).not.toBe("/personal-home");
    }).pipe(Effect.scoped),
);
it.effect.each([
  { nested: false, mismatch: "id" },
  { nested: false, mismatch: "version" },
  { nested: true, mismatch: "id" },
  { nested: true, mismatch: "version" },
] as const)(
  "rejects mismatched explicit returned pins before launching a child: %j",
  ({ nested, mismatch }) =>
    Effect.gen(function* () {
      const f = yield* fixture;
      const pin = {
        id: mismatch === "id" ? "c".repeat(32) : f.metadata.id,
        expectedVersion: mismatch === "version" ? f.metadata.version + 1 : f.metadata.version,
      };
      const input = {
        ...(nested ? { connection: pin } : pin),
        command: f.command.command,
        timeoutMs: f.command.timeoutMs,
      };
      expect(yield* f.terminal.execute(input).pipe(Effect.flip)).toMatchObject({
        reason: "configuration",
      });
      expect(f.opened).toEqual([nested ? { connection: pin } : pin]);
      expect(f.relayed).toEqual([]);
      expect(f.closedSessions).toEqual([f.metadata.sessionId]);
    }).pipe(Effect.scoped),
);
