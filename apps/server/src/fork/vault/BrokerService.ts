import * as HostProcess from "@t3tools/shared/HostProcess";
import { resolveCommandPath } from "@t3tools/shared/shell";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as ProcessRunner from "../../processRunner.ts";
import * as BrokerIdentity from "./BrokerIdentity.ts";
import * as BrokerDaemon from "./BrokerDaemon.ts";

const LABEL = "com.loom.vault-broker";
const UNIT = "loom-vault-broker.service";
const STATE_VARIABLE = "LOOM_VAULT_BROKER_STATE_DIR";
const quoteUnit = (value: string) =>
  `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"').replaceAll("%", "%%")}"`;
const xml = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
const safePath = (value: string) =>
  [...value].every((character) => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127);
export class BrokerServiceError extends Schema.TaggedError<BrokerServiceError>()(
  "BrokerServiceError",
  {
    reason: Schema.Literals([
      "unsupported",
      "configuration",
      "ownership",
      "manager-unavailable",
      "manager-operation",
      "filesystem",
    ]),
  },
) {
  override get message() {
    switch (this.reason) {
      case "unsupported":
        return "Managed Vault brokers support macOS launchd and Linux systemd user services.";
      case "configuration":
        return "Enroll the broker first and use an absolute installed Loom executable outside the identity directory. Check its private state directory.";
      case "ownership":
        return "This service belongs to another broker configuration or has unsafe permissions. Inspect it before changing it.";
      case "manager-unavailable":
        return "The user service manager is unavailable. Check the macOS login session or Linux systemd user session.";
      case "manager-operation":
        return "The service manager did not complete the operation. Inspect the service status and local manager logs before retrying.";
      case "filesystem":
        return "The Vault broker service files could not be read or written.";
    }
  }
}
type Action = "install" | "start" | "stop" | "restart" | "uninstall";
export class BrokerService extends Context.Service<
  BrokerService,
  {
    readonly plan: (
      directory: string,
      executable: string,
    ) => Effect.Effect<
      {
        readonly unitPath: string;
        readonly contents: string;
        readonly startup: string;
      },
      BrokerServiceError
    >;
    readonly manage: (
      directory: string,
      action: Action,
      executable?: string,
    ) => Effect.Effect<
      {
        readonly action: Action;
        readonly unitPath: string;
        readonly startup: string;
      },
      BrokerServiceError
    >;
    readonly status: (directory: string) => Effect.Effect<
      {
        readonly installed: boolean;
        readonly localState: "ready" | "unavailable";
        readonly heartbeatCurrent: boolean;
        readonly autostart: "enabled" | "disabled" | "unknown";
        readonly continuity: "login-session-only" | "linger-enabled" | "unknown";
        readonly process: "running" | "stopped" | "unknown";
        readonly startup: string;
        readonly diagnostics: Effect.Success<
          ReturnType<BrokerDaemon.BrokerDaemon["Service"]["inspect"]>
        > | null;
      },
      BrokerServiceError
    >;
  }
>()("t3/fork/vault/BrokerService") {}
const make = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem,
    path = yield* Path.Path,
    runner = yield* ProcessRunner.ProcessRunner,
    identity = yield* BrokerIdentity.BrokerIdentity,
    daemon = yield* BrokerDaemon.BrokerDaemon,
    platform = yield* HostProcess.Platform,
    home = yield* HostProcess.HomeDirectory,
    uid = yield* HostProcess.UserId,
    environment = yield* HostProcess.Environment;
  const context = Effect.fnUntraced(function* (directory: string, requireEnrollment = true) {
    if ((platform !== "darwin" && platform !== "linux") || uid === undefined)
      return yield* new BrokerServiceError({ reason: "unsupported" });
    const requested = directory || path.join(home, ".config", "loom", "vault-broker");
    if (!path.isAbsolute(requested))
      return yield* new BrokerServiceError({ reason: "configuration" });
    let stateDirectory = path.normalize(requested);
    if (requireEnrollment) {
      const key = yield* identity
        .read(directory, false)
        .pipe(Effect.mapError(() => new BrokerServiceError({ reason: "configuration" })));
      yield* identity
        .connection(directory)
        .pipe(Effect.mapError(() => new BrokerServiceError({ reason: "configuration" })));
      stateDirectory = key.directory;
    }
    const unitPath =
      platform === "darwin"
        ? path.join(home, "Library", "LaunchAgents", `${LABEL}.plist`)
        : path.join(home, ".config", "systemd", "user", UNIT);
    if (![unitPath, stateDirectory].every(safePath))
      return yield* new BrokerServiceError({ reason: "configuration" });
    const relative = path.relative(path.dirname(unitPath), stateDirectory);
    if (
      !relative ||
      (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))
    )
      return yield* new BrokerServiceError({ reason: "configuration" });
    return {
      directory: stateDirectory,
      unitPath,
      target: `gui/${uid}/${LABEL}`,
      domain: `gui/${uid}`,
      marker:
        platform === "darwin"
          ? `<key>${STATE_VARIABLE}</key><string>${xml(stateDirectory)}</string>`
          : `Environment=${quoteUnit(`${STATE_VARIABLE}=${stateDirectory}`)}`,
      startup:
        platform === "darwin"
          ? "macOS logged-in user session"
          : "Linux user manager; boot/logout continuity requires operator-configured linger",
    };
  });
  const readUnit = Effect.fnUntraced(function* (unitPath: string, marker: string) {
    const info = yield* fs
      .stat(unitPath)
      .pipe(Effect.mapError(() => new BrokerServiceError({ reason: "filesystem" })));
    if (
      info.type !== "File" ||
      Number(info.size) > 32_768 ||
      (info.mode & 0o022) !== 0 ||
      Option.getOrNull(info.uid) !== uid ||
      Option.isSome(yield* fs.readLink(unitPath).pipe(Effect.option))
    )
      return yield* new BrokerServiceError({ reason: "ownership" });
    if (
      (yield* fs
        .realPath(unitPath)
        .pipe(Effect.mapError(() => new BrokerServiceError({ reason: "filesystem" })))) !== unitPath
    )
      return yield* new BrokerServiceError({ reason: "ownership" });
    const text = yield* fs
      .readFileString(unitPath)
      .pipe(Effect.mapError(() => new BrokerServiceError({ reason: "filesystem" })));
    if (!text.includes(marker)) return yield* new BrokerServiceError({ reason: "ownership" });
    return text;
  });
  const manager = Effect.fnUntraced(function* () {
    const command =
      platform === "darwin"
        ? "/bin/launchctl"
        : yield* resolveCommandPath("systemctl", { env: environment }).pipe(
            Effect.provideService(FileSystem.FileSystem, fs),
            Effect.provideService(Path.Path, path),
          );
    if (!command) return yield* new BrokerServiceError({ reason: "manager-unavailable" });
    return command;
  });
  const execute = Effect.fnUntraced(function* (command: string, args: ReadonlyArray<string>) {
    return yield* runner
      .run({
        command,
        args,
        cwd: home,
        timeout: "30 seconds",
        maxOutputBytes: 16_384,
        outputMode: "truncate",
      })
      .pipe(Effect.mapError(() => new BrokerServiceError({ reason: "manager-operation" })));
  });
  const required = Effect.fnUntraced(function* (command: string, args: ReadonlyArray<string>) {
    const result = yield* execute(command, args);
    if (result.code !== 0 || result.timedOut)
      return yield* new BrokerServiceError({ reason: "manager-operation" });
  });
  const available = Effect.fnUntraced(function* (command: string, domain: string) {
    const result = yield* execute(
      command,
      platform === "darwin" ? ["print", domain] : ["--user", "show-environment"],
    );
    if (result.code !== 0) return yield* new BrokerServiceError({ reason: "manager-unavailable" });
  });
  const processState = Effect.fnUntraced(function* (command: string, target: string) {
    const result = yield* execute(
      command,
      platform === "darwin"
        ? ["print", target]
        : ["--user", "show", UNIT, "--property=LoadState,ActiveState"],
    );
    if (platform === "darwin" && result.code === 113) return "stopped" as const;
    if (result.code !== 0 || result.stdoutTruncated) return "unknown" as const;
    return platform === "darwin"
      ? /\bstate = running\b/.test(result.stdout)
        ? ("running" as const)
        : ("stopped" as const)
      : /^ActiveState=active$/m.test(result.stdout)
        ? ("running" as const)
        : ("stopped" as const);
  });
  const plan = Effect.fn("BrokerService.plan")(function* (directory: string, executable: string) {
    const ctx = yield* context(directory);
    if (
      !path.isAbsolute(executable) ||
      !safePath(executable) ||
      executable === ctx.directory ||
      executable.startsWith(`${ctx.directory}${path.sep}`)
    )
      return yield* new BrokerServiceError({ reason: "configuration" });
    const info = yield* fs
      .stat(executable)
      .pipe(Effect.mapError(() => new BrokerServiceError({ reason: "configuration" })));
    if (info.type !== "File" || !(info.mode & 0o111))
      return yield* new BrokerServiceError({ reason: "configuration" });
    const program = [executable, "vault", "broker", "run", "--state-dir", ctx.directory];
    const contents =
      platform === "darwin"
        ? [
            '<?xml version="1.0" encoding="UTF-8"?>',
            '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
            '<plist version="1.0"><dict>',
            `<key>Label</key><string>${LABEL}</string>`,
            `<key>ProgramArguments</key><array>${program.map((arg) => `<string>${xml(arg)}</string>`).join("")}</array>`,
            `<key>WorkingDirectory</key><string>${xml(path.dirname(ctx.unitPath))}</string>`,
            `<key>EnvironmentVariables</key><dict>${ctx.marker}</dict>`,
            "<key>RunAtLoad</key><true/>",
            "<key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>",
            "<key>ThrottleInterval</key><integer>30</integer>",
            "<key>ExitTimeOut</key><integer>20</integer>",
            "</dict></plist>",
            "",
          ].join("\n")
        : [
            "[Unit]",
            "Description=Loom Vault broker",
            "StartLimitIntervalSec=0",
            "",
            "[Service]",
            "Type=simple",
            `WorkingDirectory=${quoteUnit(path.dirname(ctx.unitPath))}`,
            ctx.marker,
            `ExecStart=${program.map((arg) => quoteUnit(arg.replaceAll("$", () => "$$"))).join(" ")}`,
            "UMask=0077",
            "Restart=on-failure",
            "RestartSec=30",
            "TimeoutStopSec=20",
            "StandardOutput=journal",
            "StandardError=journal",
            "",
            "[Install]",
            "WantedBy=default.target",
            "",
          ].join("\n");
    return { unitPath: ctx.unitPath, contents, startup: ctx.startup };
  });
  const manage = Effect.fn("BrokerService.manage")(function* (
    directory: string,
    action: Action,
    executable?: string,
  ) {
    const ctx = yield* context(directory, action !== "stop" && action !== "uninstall"),
      command = yield* manager();
    yield* available(command, ctx.domain);
    const exists = yield* fs
      .exists(ctx.unitPath)
      .pipe(Effect.mapError(() => new BrokerServiceError({ reason: "filesystem" })));
    if (action === "install") {
      const planned = yield* plan(directory, executable ?? "");
      if (exists) {
        if ((yield* readUnit(ctx.unitPath, ctx.marker)) !== planned.contents)
          return yield* new BrokerServiceError({ reason: "ownership" });
      } else {
        const parent = path.dirname(ctx.unitPath);
        yield* fs
          .makeDirectory(parent, { recursive: true, mode: 0o700 })
          .pipe(Effect.mapError(() => new BrokerServiceError({ reason: "filesystem" })));
        if (
          (yield* fs
            .realPath(parent)
            .pipe(Effect.mapError(() => new BrokerServiceError({ reason: "filesystem" })))) !==
          parent
        )
          return yield* new BrokerServiceError({ reason: "ownership" });
        yield* fs
          .writeFileString(ctx.unitPath, planned.contents, { flag: "wx", mode: 0o600 })
          .pipe(Effect.mapError(() => new BrokerServiceError({ reason: "filesystem" })));
      }
      if (platform === "linux") {
        yield* required(command, ["--user", "daemon-reload"]);
        yield* required(command, ["--user", "enable", UNIT]);
      } else {
        yield* required(command, ["enable", ctx.target]);
      }
    } else if (exists) {
      yield* readUnit(ctx.unitPath, ctx.marker);
      if (action === "stop" || action === "uninstall") {
        if (platform === "linux")
          yield* required(command, [
            "--user",
            action === "uninstall" ? "disable" : "stop",
            ...(action === "uninstall" ? ["--now"] : []),
            UNIT,
          ]);
        else {
          const loaded = yield* execute(command, ["print", ctx.target]);
          if (loaded.code === 0) yield* required(command, ["bootout", "--wait", ctx.target]);
          else if (loaded.code !== 113)
            return yield* new BrokerServiceError({ reason: "manager-operation" });
        }
        if (action === "uninstall") {
          yield* fs
            .remove(ctx.unitPath)
            .pipe(Effect.mapError(() => new BrokerServiceError({ reason: "filesystem" })));
          if (platform === "linux") yield* required(command, ["--user", "daemon-reload"]);
        }
      } else if (platform === "linux") {
        yield* required(command, ["--user", "reset-failed", UNIT]);
        yield* required(command, ["--user", action, UNIT]);
      } else {
        const loaded = yield* execute(command, ["print", ctx.target]);
        if (loaded.code === 113) yield* required(command, ["bootstrap", ctx.domain, ctx.unitPath]);
        else if (loaded.code !== 0)
          return yield* new BrokerServiceError({ reason: "manager-operation" });
        else
          yield* required(command, [
            "kickstart",
            ...(action === "restart" ? ["-k"] : []),
            ctx.target,
          ]);
      }
    } else if (action !== "uninstall" && action !== "stop")
      return yield* new BrokerServiceError({ reason: "configuration" });
    return { action, unitPath: ctx.unitPath, startup: ctx.startup };
  });
  const status = Effect.fn("BrokerService.status")(function* (directory: string) {
    const ctx = yield* context(directory, false);
    const installed = yield* fs
      .exists(ctx.unitPath)
      .pipe(Effect.mapError(() => new BrokerServiceError({ reason: "filesystem" })));
    if (installed) yield* readUnit(ctx.unitPath, ctx.marker);
    const process = yield* Effect.gen(function* () {
      const command = yield* manager();
      yield* available(command, ctx.domain);
      return yield* processState(command, ctx.target);
    }).pipe(Effect.orElseSucceed(() => "unknown" as const));
    const autostart = installed
      ? yield* Effect.gen(function* () {
          const command = yield* manager();
          const result = yield* execute(
            command,
            platform === "darwin" ? ["print-disabled", ctx.domain] : ["--user", "is-enabled", UNIT],
          );
          if (result.stdoutTruncated) return "unknown" as const;
          if (platform === "darwin") {
            if (result.code !== 0 || !result.stdout.includes("disabled services"))
              return "unknown" as const;
            return /"com\.loom\.vault-broker"\s*=>\s*true/.test(result.stdout)
              ? ("disabled" as const)
              : ("enabled" as const);
          }
          return result.stdout.trim() === "enabled" && result.code === 0
            ? ("enabled" as const)
            : ["disabled", "masked", "not-found"].includes(result.stdout.trim())
              ? ("disabled" as const)
              : ("unknown" as const);
        }).pipe(Effect.orElseSucceed(() => "unknown" as const))
      : ("disabled" as const);
    const continuity =
      platform === "darwin"
        ? ("login-session-only" as const)
        : yield* Effect.gen(function* () {
            const command = yield* resolveCommandPath("loginctl", { env: environment }).pipe(
              Effect.provideService(FileSystem.FileSystem, fs),
              Effect.provideService(Path.Path, path),
            );
            if (!command) return "unknown" as const;
            const result = yield* execute(command, [
              "show-user",
              String(uid),
              "--property=Linger",
              "--value",
            ]);
            return result.code === 0 && result.stdout.trim() === "yes"
              ? ("linger-enabled" as const)
              : result.code === 0 && result.stdout.trim() === "no"
                ? ("login-session-only" as const)
                : ("unknown" as const);
          }).pipe(Effect.orElseSucceed(() => "unknown" as const));
    const diagnostics = yield* daemon.inspect(directory).pipe(Effect.orElseSucceed(() => null));
    return {
      installed,
      localState: diagnostics ? ("ready" as const) : ("unavailable" as const),
      autostart,
      continuity,
      process,
      startup: ctx.startup,
      diagnostics,
      heartbeatCurrent:
        process === "running" &&
        diagnostics?.fresh === true &&
        diagnostics.report?.state === "online",
    };
  });
  return BrokerService.of({ plan, manage, status });
});
export const layer = Layer.effect(BrokerService, make);
