import * as HostProcess from "@t3tools/shared/HostProcess";
import { setupGitHubHost } from "./github.ts";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Terminal from "effect/Terminal";
import { Command, Flag, GlobalFlag, Prompt } from "effect/cli";
import { FetchHttpClient } from "effect/http";

import packageJson from "../../package.json" with { type: "json" };
import * as BootService from "../cloud/bootService.ts";
import { compareExactServiceVersions } from "../cloud/serviceProtocol.ts";
import type * as ServerConfig from "../config.ts";
import * as ProcessRunner from "../processRunner.ts";
import { projectLocationFlags, resolveCliAuthConfig } from "./config.ts";
import { resolveEntryPath } from "./invocation.ts";

export const layer = (config: ServerConfig.ServerConfig["Service"]) =>
  BootService.layer({
    baseDir: config.baseDir,
    logsDir: config.logsDir,
    cliVersion: packageJson.version,
  }).pipe(Layer.provide(ProcessRunner.layer), Layer.provide(FetchHttpClient.layer));

export type ServiceReconcileResult =
  | {
      readonly changed: false;
      readonly status: BootService.BootServiceStatus;
    }
  | {
      readonly changed: true;
      readonly previouslyInstalled: boolean;
      readonly plan: BootService.BootServicePlan;
    };

const reconcileService = Effect.fn("cli.service.reconcile")(function* (options?: {
  readonly allowDowngrade?: boolean;
  readonly start?: boolean;
}) {
  const service = yield* BootService.BootService;
  const status = yield* service.status;
  if (status.installed && status.current) {
    return { changed: false, status } satisfies ServiceReconcileResult;
  }
  if (
    status.installedVersion !== undefined &&
    options?.allowDowngrade !== true &&
    compareExactServiceVersions(packageJson.version, status.installedVersion) < 0
  ) {
    return yield* new BootService.BootServiceDowngradeRefusedError({
      installedVersion: status.installedVersion,
      targetVersion: packageJson.version,
    });
  }
  const plan = yield* service.install(options);
  return {
    changed: true,
    previouslyInstalled: status.installed,
    plan,
  } satisfies ServiceReconcileResult;
});

function formatServiceChange(
  result: Extract<ServiceReconcileResult, { readonly changed: true }>,
): string {
  if (result.plan.handedOff === true) {
    // fork: brand
    return `Handed the Loom service switch to t3@${packageJson.version} to a separate systemd unit, since this session runs inside the service and disconnects when it restarts.\nResult: ${result.plan.logPath}`;
  }
  // fork: brand
  return `${result.previouslyInstalled ? "Updated" : "Installed"} Loom service with t3@${packageJson.version}.\nLogs: ${result.plan.logPath}`;
}

function formatServiceStatus(status: BootService.BootServiceStatus, cliVersion: string): string {
  if (!status.supported) {
    // fork: brand
    return "Loom service\n  Status: unavailable on this machine\n  Supported on: Linux with systemd, macOS with launchd";
  }
  if (!status.installed) {
    // fork: brand
    return "Loom service\n  Status: not installed\n  Next: Run `t3 service install`.";
  }
  const installedVersion = status.installedVersion ?? cliVersion;
  const problems = (status.problems ?? []).map(
    (problem) => `  [${problem}] ${BootService.formatBootServiceProblem(problem)}`,
  );
  if (
    !status.current &&
    status.installedVersion !== undefined &&
    compareExactServiceVersions(status.installedVersion, cliVersion) > 0
  ) {
    return [
      "Loom service", // fork: brand
      `  Status: installed · t3@${installedVersion} (newer than this t3@${cliVersion} CLI)`,
      `  Unit: ${status.unitPath}`,
      `  Logs: ${status.logPath}`,
      ...problems,
      `  Next: Run \`t3 update ${installedVersion}\` to match it, or pass \`--allow-downgrade\` to \`t3 service install\` explicitly.`,
    ].join("\n");
  }
  return [
    "Loom service", // fork: brand
    `  Status: ${status.current ? `installed · t3@${installedVersion}` : "needs an update or repair"}`,
    `  Unit: ${status.unitPath}`,
    `  Logs: ${status.logPath}`,
    ...problems,
    ...(status.current ? [] : ["  Next: Run `t3 service install` to repair it."]),
  ].join("\n");
}

const runServiceCommand = Effect.fn("cli.service.run")(function* <A, E, R>(
  flags: { readonly baseDir: Parameters<typeof resolveCliAuthConfig>[0]["baseDir"] },
  run: Effect.Effect<A, E, R>,
) {
  const logLevel = yield* GlobalFlag.LogLevel;
  const config = yield* resolveCliAuthConfig(flags, logLevel);
  return yield* run.pipe(Effect.provide(layer(config)));
});

const serviceReconcileFlags = {
  ...projectLocationFlags,
  allowDowngrade: Flag.Boolean("allow-downgrade").pipe(
    Flag.withDescription("Allow replacing a newer installed service with this older CLI version."),
    Flag.withDefault(false),
  ),
};

const serviceInstallCommand = Command.make("install", {
  ...serviceReconcileFlags,
  github: Flag.Boolean("github").pipe(
    Flag.withDescription("Prepare persistent GitHub access, including device sign-in when needed."),
    Flag.withDefault(false),
  ),
}).pipe(
  Command.withDescription("Install Loom as a background service for this user."), // fork: brand
  Command.withHandler((flags) =>
    runServiceCommand(
      flags,
      Effect.gen(function* () {
        if (flags.github) yield* setupGitHubHost(true);
        const result = yield* reconcileService({ allowDowngrade: flags.allowDowngrade });
        if (!result.changed) {
          yield* Console.log(
            // fork: brand
            `Loom service is already installed with t3@${packageJson.version} (${yield* resolveEntryPath}).`,
          );
          return;
        }
        yield* Console.log(formatServiceChange(result));
      }),
    ),
  ),
);

const serviceUpdateCommand = Command.make("update", serviceReconcileFlags).pipe(
  Command.withDescription("Deprecated. Run `t3 update` to move to a newer release."),
  Command.unlisted,
  Command.withHandler((flags) =>
    runServiceCommand(
      flags,
      Effect.gen(function* () {
        yield* Console.log(
          "`t3 service update` is deprecated: run `t3 update` to move to a newer release, or `t3 service install` to repair the service. Repairing now.",
        );
        const result = yield* reconcileService({ allowDowngrade: flags.allowDowngrade });
        if (!result.changed) {
          // fork: brand
          yield* Console.log(
            `Loom service is already using t3@${packageJson.version} (${yield* resolveEntryPath}).`,
          );
          return;
        }
        yield* Console.log(formatServiceChange(result));
      }),
    ),
  ),
);

const serviceRestartCommand = Command.make("restart", projectLocationFlags).pipe(
  Command.withDescription(
    "Restart the background service. Picks up a version installed by `t3 update` that was not restarted at the time.",
  ),
  Command.withHandler((flags) =>
    runServiceCommand(
      flags,
      Effect.gen(function* () {
        const service = yield* BootService.BootService;
        const status = yield* service.status;
        const outcome = yield* service.restart;
        const onVersion =
          status.installedVersion === undefined ? "" : ` on t3@${status.installedVersion}`;
        yield* Console.log(
          outcome === "restarted"
            ? `Restarted the Loom service${onVersion}.` // fork: brand
            : outcome === "queued"
              ? // fork: brand
                `Queued a restart of the Loom service${onVersion}. This session runs inside the service and disconnects when it goes down.\nLogs: ${status.logPath}`
              : "Loom service is not installed.", // fork: brand
        );
      }),
    ),
  ),
);

const serviceUninstallCommand = Command.make("uninstall", projectLocationFlags).pipe(
  Command.withDescription("Stop and remove the Loom background service."), // fork: brand
  Command.withHandler((flags) =>
    runServiceCommand(
      flags,
      Effect.gen(function* () {
        const service = yield* BootService.BootService;
        const removed = yield* service.uninstall;
        yield* Console.log(
          removed ? "Removed the Loom service." : "Loom service is not installed.", // fork: brand
        );
      }),
    ),
  ),
);

const serviceStatusCommand = Command.make("status", projectLocationFlags).pipe(
  Command.withDescription("Show whether the Loom background service is installed."), // fork: brand
  Command.withHandler((flags) =>
    runServiceCommand(
      flags,
      Effect.gen(function* () {
        const service = yield* BootService.BootService;
        yield* Console.log(formatServiceStatus(yield* service.status, packageJson.version));
      }),
    ),
  ),
);

export type ServiceOnboardingOutcome = "ready" | "pending" | "skipped";

export const offerServiceDuringOnboarding = Effect.gen(function* () {
  const service = yield* BootService.BootService;
  const status = yield* service.status;
  const { supported, installed, current } = status;
  if (!supported) {
    return "skipped" as const;
  }
  if (installed && current) {
    // fork: brand
    yield* Console.log("Loom is already set up to run in the background on this machine.");
    return "ready" as const;
  }
  for (const problem of status.problems ?? []) {
    yield* Console.warn(`[${problem}] ${BootService.formatBootServiceProblem(problem)}`);
  }
  if (
    installed &&
    status.installedVersion !== undefined &&
    compareExactServiceVersions(status.installedVersion, packageJson.version) > 0
  ) {
    yield* Console.log(
      `A newer t3@${status.installedVersion} background service is installed. Leaving it unchanged.`,
    );
    return "skipped" as const;
  }
  const platform = yield* HostProcess.Platform;
  const wanted = yield* Prompt.run(
    Prompt.Confirm({
      message: installed
        ? "The installed Loom service needs an update or repair. Update it now?" // fork: brand
        : platform === "darwin"
          ? "Run Loom in the background whenever you log in to this Mac? " + // fork: brand
            "It stays reachable through T3 Connect while you are logged in."
          : "Run Loom in the background whenever this machine boots? " + // fork: brand
            "It stays reachable through T3 Connect even after you log out.",
      initial: true,
    }),
  );
  if (!wanted) {
    return "skipped" as const;
  }
  const result = yield* reconcileService();
  if (result.changed) {
    yield* Console.log(
      result.plan.handedOff === true
        ? formatServiceChange(result)
        : `Background service ${result.previouslyInstalled ? "updated" : "installed"}. Logs: ${result.plan.logPath}`,
    );
  }
  return result.changed && result.plan.handedOff === true
    ? ("pending" as const)
    : ("ready" as const);
});

const reportServiceSetupFailure = (error: BootService.BootServiceError) =>
  Console.warn(`Background setup did not finish: ${error.message}`).pipe(
    Effect.as("skipped" as const),
  );

export const recoverServiceOnboardingOffer = <R>(
  offer: Effect.Effect<
    ServiceOnboardingOutcome,
    BootService.BootServiceError | Terminal.QuitError,
    R
  >,
) =>
  offer.pipe(
    Effect.catchTags({
      QuitError: () => Effect.succeed("skipped" as const),
      BootServiceUnsupportedError: (error) =>
        Console.log(`Skipping background setup: ${error.message}`).pipe(
          Effect.as("skipped" as const),
        ),
      BootServiceCommandError: reportServiceSetupFailure,
      BootServiceInstallError: reportServiceSetupFailure,
      BootServicePrerequisiteError: reportServiceSetupFailure,
      BootServiceUpdatePendingError: reportServiceSetupFailure,
      BootServiceDowngradeRefusedError: reportServiceSetupFailure,
    }),
  );

export const serviceCommand = Command.make("service").pipe(
  Command.withDescription("Manage the Loom background service."), // fork: brand
  Command.withSubcommands([
    serviceInstallCommand,
    serviceRestartCommand,
    serviceUninstallCommand,
    serviceStatusCommand,
    serviceUpdateCommand,
  ]),
);
