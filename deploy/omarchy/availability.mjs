import * as NodeCrypto from "node:crypto";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import {
  paths,
  validateAppIntegration,
  discoverAppIntegration,
  finderChoice,
  main,
} from "./loom-os.mjs";
import { probeAppConnection } from "./connections.mjs";
import { collectPrivateConnections } from "./health.mjs";

// Retained declarations describe build support, never a session, grant or cached personal data.
export const declarationMaxAgeMs = 7 * 24 * 60 * 60_000;
const names = { office: "Office", atlas: "Atlas" };
function declarationFile(app, origin, env) {
  const key = NodeCrypto.createHash("sha256").update(origin).digest("hex");
  return NodePath.join(paths(env).state, "loom-os/capabilities", app + "-" + key + ".json");
}
async function retainDeclaration(app, origin, manifest, now, env) {
  const file = declarationFile(app, origin, env);
  await NodeFSP.mkdir(NodePath.dirname(file), { mode: 0o700, recursive: true });
  const temp = file + "." + NodeCrypto.randomUUID();
  try {
    await NodeFSP.writeFile(
      temp,
      JSON.stringify({
        version: 1,
        app,
        origin,
        observedAt: new Date(now).toISOString(),
        manifest,
      }),
      { mode: 0o600, flag: "wx" },
    );
    await NodeFSP.rename(temp, file);
  } finally {
    await NodeFSP.rm(temp, { force: true });
  }
}
async function retainedDeclaration(app, origin, now, env) {
  try {
    const file = declarationFile(app, origin, env);
    const info = await NodeFSP.lstat(file);
    if (!info.isFile() || info.isSymbolicLink() || info.size > 128 * 1024) return null;
    const value = JSON.parse(await NodeFSP.readFile(file, "utf8"));
    const age = now - Date.parse(value.observedAt);
    if (
      value.version !== 1 ||
      value.app !== app ||
      value.origin !== origin ||
      !Number.isFinite(age) ||
      age < -60_000 ||
      age >= declarationMaxAgeMs
    )
      return null;
    return validateAppIntegration(value.manifest, app);
  } catch {
    return null;
  }
}
const capability = (state, detail) => ({ state, detail });

/** Only anonymous build declarations are retained. Device state stays in the owning profile. */
export async function appAvailabilityDeclaration(app, config, env, dependencies = {}) {
  if (!Object.hasOwn(names, app) || !config[`${app}Url`])
    throw Error("Configure the app address before reviewing this device.");
  const now = dependencies.now ?? Date.now();
  const declaration =
    dependencies.declaration ??
    (await (dependencies.discover ?? discoverAppIntegration)(app, config));
  const origin = config[`${app}Url`];
  if (declaration?.state === "available") {
    const manifest = validateAppIntegration(declaration.manifest, app);
    try {
      await retainDeclaration(app, origin, manifest, now, env);
    } catch {
      /* A read-only desktop still gets live build support. */
    }
    return { state: "live", manifest };
  }
  const retained = await retainedDeclaration(app, origin, now, env);
  return { state: retained ? "retained" : "unknown", manifest: retained };
}

export function appAvailability(app, { step, declaration }, retained = null) {
  const manifest = declaration?.state === "available" ? declaration.manifest : retained;
  const live = declaration?.state === "available";
  const connected = step.state === "connected";
  const offline = manifest?.offline;
  return {
    id: app,
    title: names[app],
    server: live ? "reachable" : "unavailable",
    cli: step.state,
    declaration: live ? "live" : retained ? "retained" : "unknown",
    reading: offline
      ? offline.savedReading
        ? capability(
            "conditional",
            "Saved copies are supported after prior use. Check this browser profile in the app.",
          )
        : capability("unsupported", "This app declares no durable offline reading.")
      : capability("unknown", "Offline reading support could not be confirmed."),
    writing: offline
      ? offline.supportedWriting
        ? capability(
            "conditional",
            "Supported changes can be queued after prior use. Sending, AI and other actions still need a connection.",
          )
        : capability("unsupported", "This app declares no durable offline write queue.")
      : capability("unknown", "Offline writing support could not be confirmed."),
    search: !live
      ? capability("unavailable", "Live search needs the app server. Reconnect and check again.")
      : !manifest.capabilities.search.supported
        ? capability("unsupported", "This app release does not expose supported OS search.")
        : connected
          ? capability(
              "available",
              "The CLI is connected; search checks the app's current permissions at execution.",
            )
          : capability(
              step.state === "approval-needed" ? "approval-needed" : "unavailable",
              "Connect or retry this app's CLI access. Browser sign-in is separate.",
            ),
    deviceReview: manifest?.capabilities.availability.supported
      ? capability(
          "available",
          retained && !live
            ? "Open this profile's device status using the last verified app declaration."
            : "Review this profile's saved copies, pending changes, conflicts and storage in the app.",
        )
      : capability(
          manifest ? "unsupported" : "unknown",
          manifest
            ? "This app release has no supported device-status route. Open the app to inspect saved work."
            : "This app's device status route could not be confirmed. Open the app to inspect saved work.",
        ),
    // Build support and CLI access never reveal a browser profile's personal queue.
    pending: capability(
      "unknown",
      "The app has not reported this profile's pending changes. Open the app to inspect them.",
    ),
    pendingCount: null,
  };
}

export async function collectAvailability(config, env, dependencies = {}) {
  const now = dependencies.now ?? Date.now();
  const appChecks = Object.keys(names)
    .filter((app) => config[`${app}Url`])
    .map(async (app) => {
      const probe = await (dependencies.probe ?? probeAppConnection)(app, config, env);
      if (!probe.declaration)
        probe.declaration = await (dependencies.discover ?? discoverAppIntegration)(app, config);
      const support = await appAvailabilityDeclaration(app, config, env, {
        now,
        declaration: probe.declaration,
      });
      return appAvailability(app, probe, support.state === "retained" ? support.manifest : null);
    });
  const [privateReport, apps] = await Promise.all([
    (dependencies.privateReport ?? collectPrivateConnections)(config, env),
    Promise.all(appChecks),
  ]);
  const anyReady =
    privateReport.aiReady ||
    privateReport.components.some((part) => part.id === "loom" && part.state === "ok") ||
    apps.some((app) => app.server === "reachable");
  const attention =
    privateReport.components.some((part) => part.state !== "ok") ||
    apps.some((app) => app.server !== "reachable" || app.cli !== "connected");
  return {
    version: 2,
    generatedAt: new Date(now).toISOString(),
    state: !anyReady ? "offline" : attention ? "attention" : "ok",
    aiReady: privateReport.aiReady,
    components: privateReport.components,
    apps,
  };
}
export function formatAvailability(report) {
  const labels = {
    available: "Available",
    conditional: "Check in app",
    unsupported: "Not supported",
    unknown: "Not confirmed",
    unavailable: "Unavailable",
    "approval-needed": "Approval needed",
  };
  return [
    "What works now",
    ...report.components.map((part) => `${part.title}: ${part.detail}`),
    ...report.apps.flatMap((app) => [
      `${app.title}: server ${app.server}; CLI ${app.cli}${app.declaration === "retained" ? "; offline support from a retained declaration" : ""}`,
      ...[
        ["Saved reading", app.reading],
        ["Offline writing", app.writing],
        ["Live search", app.search],
        ["Pending changes", app.pending],
        ["Device review", app.deviceReview],
      ].map(([title, value]) => `  ${title}: ${labels[value.state]}. ${value.detail}`),
    ]),
    "App sign-in, cached copies and queued work stay in their owning apps. Unknown pending changes does not mean zero.",
    "Check again after reconnecting. Recovery never resubmits work or restarts agents.",
  ].join("\n");
}
export async function nativeAvailability(config, env, dependencies = {}) {
  const show = dependencies.show ?? console.log;
  const choose =
    dependencies.choose ??
    (async (choices) => {
      const value = await finderChoice(
        ["choose", "--header", "What works now", "--", ...choices],
        env,
      );
      if (process.stdout.isTTY) process.stdout.write("\u001b[2J\u001b[H");
      return value;
    });
  const collect = dependencies.collect ?? (() => collectAvailability(config, env));
  const dispatch = dependencies.dispatch ?? ((args) => main(args, env));
  while (true) {
    show(formatAvailability(await collect()));
    const apps = Object.keys(names).filter((app) => config[`${app}Url`]);
    const choice = await choose([
      "Check again",
      "Set up connections",
      "Private AI hub",
      ...apps.map((app) => "Review " + names[app] + " device"),
      ...apps.map((app) => "Open " + names[app]),
      "Loom service status",
      "Close",
    ]);
    if (!choice || choice === "Close") return;
    try {
      if (choice === "Set up connections") await dispatch(["setup", "--inline"]);
      else if (choice === "Private AI hub") await dispatch(["hub", "--inline"]);
      else if (choice === "Loom service status") await dispatch(["service", "status"]);
      else {
        const deviceApp = apps.find((app) => choice === "Review " + names[app] + " device");
        if (deviceApp) await dispatch(["device", deviceApp]);
        else {
          const app = apps.find((app) => choice === "Open " + names[app]);
          if (app) await dispatch(["open", app]);
        }
      }
    } catch {
      show(
        "The selected recovery action did not finish. Check again or open the owning app; existing work is kept.",
      );
    }
  }
}
