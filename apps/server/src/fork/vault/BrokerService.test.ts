import * as NodeServices from "@effect/platform-node/NodeServices";
import * as HostProcess from "@t3tools/shared/HostProcess";
import { expect, it } from "@effect/vitest";
import { VaultBrokerError } from "@t3tools/contracts/fork";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as ProcessRunner from "../../processRunner.ts";
import * as BrokerCrypto from "./BrokerCrypto.ts";
import * as BrokerIdentity from "./BrokerIdentity.ts";
import * as BrokerRunner from "./BrokerRunner.ts";
import * as BrokerDaemon from "./BrokerDaemon.ts";
import * as BrokerService from "./BrokerService.ts";

const fixture = Effect.fnUntraced(function* (platform: "darwin" | "linux") {
  const fs = yield* FileSystem.FileSystem,
    path = yield* Path.Path;
  const root = yield* fs
    .makeTempDirectoryScoped({ prefix: "loom-broker-service-" })
    .pipe(Effect.flatMap(fs.realPath));
  const home = path.join(root, "home"),
    state = path.join(root, "private state%$"),
    bin = path.join(root, "bin");
  yield* fs.makeDirectory(home);
  yield* fs.makeDirectory(bin);
  const executable = path.join(bin, 'loom special%$"&');
  for (const file of [executable, path.join(bin, "systemctl"), path.join(bin, "loginctl")])
    yield* fs.writeFileString(file, "#!/bin/sh\nexit 0\n", { mode: 0o700 });
  const identity = yield* BrokerIdentity.BrokerIdentity.pipe(
    Effect.provide(BrokerIdentity.layer.pipe(Layer.provide(BrokerCrypto.layer))),
  );
  const key = yield* identity.read(state);
  yield* identity.connect(state, {
    protocol: 1,
    origin: "https://loom.example",
    environmentId: "test-environment",
    machineId: key.fingerprint.slice(0, 32),
  });
  const commands: string[] = [];
  const control = {
    loaded: false,
    running: false,
    available: true,
    fail: "",
    unknownPrint: false,
    linger: "yes",
    enabled: false,
  };
  const processLayer = Layer.succeed(
    ProcessRunner.ProcessRunner,
    ProcessRunner.ProcessRunner.of({
      run: (input) =>
        Effect.sync(() => {
          const command = input.args.join(" ");
          commands.push(command);
          let code = 0,
            stdout = "";
          if (command === control.fail) code = 1;
          else if (
            command === "--user show-environment" ||
            command === `print gui/${process.getuid?.()}`
          )
            code = control.available ? 0 : 1;
          else if (input.args[0] === "print-disabled") {
            stdout = "disabled services = { }";
          } else if (input.args[0] === "show-user") {
            stdout = control.linger;
          } else if (command === "--user is-enabled loom-vault-broker.service") {
            stdout = control.enabled ? "enabled" : "disabled";
            code = control.enabled ? 0 : 1;
          } else if (command === "--user enable loom-vault-broker.service") {
            control.enabled = true;
          } else if (input.args[0] === "print") {
            code = control.unknownPrint ? 5 : control.loaded ? 0 : 113;
            stdout = control.running ? "state = running" : "state = not running";
          } else if (command.includes("--property=LoadState"))
            stdout = `LoadState=loaded\nActiveState=${control.running ? "active" : "inactive"}\n`;
          else if (
            command.includes("--user start") ||
            command.includes("--user restart") ||
            input.args[0] === "bootstrap" ||
            input.args[0] === "kickstart"
          ) {
            control.loaded = true;
            control.running = true;
          } else if (
            command.includes("--user stop") ||
            command.includes("--user disable") ||
            input.args[0] === "bootout"
          ) {
            control.loaded = false;
            control.running = false;
          }
          return {
            code: code as ProcessRunner.ProcessRunOutput["code"],
            stdout,
            stderr: "private manager output",
            timedOut: false,
            stdoutTruncated: false,
            stderrTruncated: false,
            stdoutInvalidUtf8: false,
            stderrInvalidUtf8: false,
          };
        }),
    }),
  );
  const dependencies = Layer.mergeAll(
    Layer.succeed(BrokerIdentity.BrokerIdentity, identity),
    Layer.mock(BrokerRunner.BrokerRunner)({
      check: () => Effect.fail(new VaultBrokerError({ reason: "disabled" })),
    }),
  );
  const service = yield* BrokerService.BrokerService.pipe(
    Effect.provide(
      BrokerService.layer.pipe(
        Layer.provide(
          Layer.mergeAll(
            dependencies,
            processLayer,
            BrokerDaemon.layer.pipe(Layer.provide(dependencies)),
          ),
        ),
      ),
    ),
    Effect.provideService(HostProcess.Platform, platform),
    Effect.provideService(HostProcess.HomeDirectory, home),
    Effect.provideService(HostProcess.Environment, { PATH: bin }),
  );
  return { fs, path, root, home, state, executable, identity, service, commands, control };
});
it.effect.each(["darwin", "linux"] as const)(
  "%s: plans without installing, controls one service and preserves enrollment on uninstall",
  (platform) =>
    Effect.gen(function* () {
      const f = yield* fixture(platform);
      const plan = yield* f.service.plan(f.state, f.executable);
      expect(yield* f.fs.exists(plan.unitPath)).toBe(false);
      expect(f.commands).toEqual([]);
      expect(plan.contents).not.toContain("privateKey");
      if (platform === "linux") {
        expect(plan.contents).toContain("Restart=on-failure");
        expect(plan.contents).toContain("%%$$");
        expect(plan.contents).toContain('private state%%$"');
      } else {
        expect(plan.contents).toContain("<key>SuccessfulExit</key><false/>");
        expect(plan.contents).toContain("&quot;&amp;");
      }
      const before = yield* f.fs.readFileString(f.path.join(f.state, "identity.json"));
      yield* f.service.manage(f.state, "install", f.executable);
      yield* f.service.manage(f.state, "install", f.executable);
      expect(f.control.running).toBe(false);
      expect((yield* f.fs.stat(plan.unitPath)).mode & 0o077).toBe(0);
      yield* f.service.manage(f.state, "start");
      const running = yield* f.service.status(f.state);
      expect(running.process).toBe("running");
      expect(running.autostart).toBe("enabled");
      expect(running.continuity).toBe(
        platform === "linux" ? "linger-enabled" : "login-session-only",
      );
      expect(running.heartbeatCurrent).toBe(false);
      expect((yield* f.service.status(f.state)).diagnostics?.report).toBeNull();
      yield* f.service.manage(f.state, "restart");
      yield* f.service.manage(f.state, "stop");
      expect((yield* f.service.status(f.state)).process).toBe("stopped");
      yield* f.service.manage(f.state, "uninstall");
      yield* f.service.manage(f.state, "uninstall");
      expect(yield* f.fs.exists(plan.unitPath)).toBe(false);
      expect(yield* f.fs.readFileString(f.path.join(f.state, "identity.json"))).toBe(before);
      expect(f.commands.some((command) => command.includes("t3code"))).toBe(false);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.effect.each(["darwin", "linux"] as const)(
  "%s: refuses another broker's service and keeps the unit if stopping fails",
  (platform) =>
    Effect.gen(function* () {
      const f = yield* fixture(platform);
      const plan = yield* f.service.plan(f.state, f.executable);
      yield* f.service.manage(f.state, "install", f.executable);
      yield* f.service.manage(f.state, "start");
      f.control.fail =
        platform === "linux"
          ? "--user disable --now loom-vault-broker.service"
          : `bootout --wait gui/${process.getuid?.()}/com.loom.vault-broker`;
      expect((yield* f.service.manage(f.state, "uninstall").pipe(Effect.flip)).reason).toBe(
        "manager-operation",
      );
      expect(yield* f.fs.exists(plan.unitPath)).toBe(true);
      yield* f.fs.writeFileString(plan.unitPath, "unrelated service", { mode: 0o600 });
      const count = f.commands.length;
      expect((yield* f.service.manage(f.state, "stop").pipe(Effect.flip)).reason).toBe("ownership");
      expect(f.commands.slice(count)).toHaveLength(1); // Only the user-manager availability check.
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);
it.effect("reports unavailable user managers without installing or claiming online readiness", () =>
  Effect.gen(function* () {
    const f = yield* fixture("linux");
    f.control.available = false;
    const plan = yield* f.service.plan(f.state, f.executable);
    expect(
      (yield* f.service.manage(f.state, "install", f.executable).pipe(Effect.flip)).reason,
    ).toBe("manager-unavailable");
    expect(yield* f.fs.exists(plan.unitPath)).toBe(false);
    const status = yield* f.service.status(f.state);
    expect(status.process).toBe("unknown");
    expect(status.diagnostics?.fresh).toBe(false);
    expect(status.diagnostics?.localUnlock).toBe("not-required");
    expect(status.diagnostics?.custody).toBe("owner-only-file");
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);
it.effect("status and startup never generate a missing identity or directory", () =>
  Effect.gen(function* () {
    const f = yield* fixture("linux");
    const missing = f.path.join(f.root, "missing");
    expect((yield* f.service.status(missing)).localState).toBe("unavailable");
    expect(yield* f.fs.exists(missing)).toBe(false);
    yield* f.fs.remove(f.path.join(f.state, "identity.json"));
    expect((yield* f.identity.read(f.state, false).pipe(Effect.flip)).reason).toBe("local-state");
    expect(yield* f.fs.exists(f.path.join(f.state, "identity.json"))).toBe(false);
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.effect("reports disabled autostart and absent linger independently of a running process", () =>
  Effect.gen(function* () {
    const f = yield* fixture("linux");
    yield* f.service.manage(f.state, "install", f.executable);
    yield* f.service.manage(f.state, "start");
    f.control.enabled = false;
    f.control.linger = "no";
    const status = yield* f.service.status(f.state);
    expect(status.process).toBe("running");
    expect(status.autostart).toBe("disabled");
    expect(status.continuity).toBe("login-session-only");
    expect(status.heartbeatCurrent).toBe(false);
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);
it.effect(
  "keeps enrollment and owned service files untouched when descriptor permissions become unsafe",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture("linux");
      const plan = yield* f.service.plan(f.state, f.executable);
      yield* f.service.manage(f.state, "install", f.executable);
      yield* f.fs.chmod(plan.unitPath, 0o666);
      expect((yield* f.service.manage(f.state, "uninstall").pipe(Effect.flip)).reason).toBe(
        "ownership",
      );
      expect(yield* f.fs.exists(plan.unitPath)).toBe(true);
      expect(yield* f.fs.exists(f.path.join(f.state, "identity.json"))).toBe(true);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.effect("can stop and uninstall an owned service after losing identity files", () =>
  Effect.gen(function* () {
    const f = yield* fixture("linux");
    const plan = yield* f.service.plan(f.state, f.executable);
    yield* f.service.manage(f.state, "install", f.executable);
    yield* f.service.manage(f.state, "start");
    yield* f.fs.remove(f.state, { recursive: true });
    const status = yield* f.service.status(f.state);
    expect(status.localState).toBe("unavailable");
    expect(status.diagnostics).toBeNull();
    expect(status.heartbeatCurrent).toBe(false);
    expect((yield* f.service.manage(f.state, "restart").pipe(Effect.flip)).reason).toBe(
      "configuration",
    );
    yield* f.service.manage(f.state, "stop");
    yield* f.service.manage(f.state, "uninstall");
    expect(yield* f.fs.exists(plan.unitPath)).toBe(false);
    expect(yield* f.fs.exists(f.state)).toBe(false);
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);
