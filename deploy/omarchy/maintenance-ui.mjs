import { finderChoice, paths } from "./loom-os.mjs";
import { connectionCommand } from "./connections.mjs";
import {
  applyMaintenance,
  formatMaintenanceReport,
  maintenanceCandidates,
  maintenanceReport,
  recoverMaintenance,
  stageMaintenance,
  verifyMaintenance,
} from "./maintenance.mjs";

export const maintenanceRefreshIntervalMs = 5000;
const candidateLimit = 100;
const isHash = (value) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const text = (value, limit = 1500) =>
  typeof value === "string"
    ? Array.from(value.slice(0, limit), (character) => {
        const code = character.charCodeAt(0);
        return code < 32 ||
          code === 127 ||
          (code >= 0x202a && code <= 0x202e) ||
          (code >= 0x2066 && code <= 0x2069)
          ? " "
          : character;
      }).join("")
    : "unknown";
const ownerNames = { loom: "Loom", office: "Office", atlas: "Atlas", switchboard: "Switchboard" };
const retryPhases = new Set(["applying", "verifying", "recovering", "failed"]);

function updateChoices(report) {
  const update = report?.update;
  if (!update || !isHash(update.reviewHash)) return [];
  const choices = [];
  if (update.phase === "staged") {
    choices.push("Apply reviewed update");
    if (update.attempts === 0) choices.push("Discard unapplied update");
  } else if (retryPhases.has(update.phase)) choices.push("Retry interrupted update");
  else if (update.phase === "complete") {
    choices.push("Verify installed update");
    if (
      update.kind === "pack" &&
      isHash(update.rollbackSha256) &&
      report.release?.previous?.verified === true &&
      report.release.previous.sha256 === update.rollbackSha256
    )
      choices.push("Roll back reviewed integration");
  }
  return choices;
}

export function formatMaintenanceReview(update) {
  if (!update || !isHash(update.sha256) || !isHash(update.reviewHash))
    throw Error("This update has no exact reviewed plan. Refresh status before continuing.");
  return [
    `${update.kind === "kit" ? "Portable setup kit" : "Integration pack"}: ${text(update.pack?.version, 100)}`,
    `Profile: ${text(update.profile, 50)}`,
    `Candidate SHA256: ${update.sha256}`,
    `Review SHA256: ${update.reviewHash}`,
    `Changed components: ${(update.changedComponents ?? []).map((name) => text(name, 100)).join(", ") || (update.kind === "kit" ? "no local client pin changes" : "integration pack only")}`,
    ...(update.plan
      ? [
          `Exact owner plan: ${text(update.plan.kind, 50)} for ${text(update.plan.profile, 50)}; pack ${text(update.plan.pack?.version, 100)} (${text(update.plan.pack?.sha256, 100)}).`,
          ...(update.plan.components ?? []).map(
            (component) =>
              `${text(component.name, 100)}: ${text(component.previousVersion, 100)} to ${text(component.version, 100)}; component pin SHA256 ${text(component.sha256, 100)}.`,
          ),
          `Component activation: ${update.plan.activationPending ? "pinned server awaits its owner" : "no separate server activation requested"}.`,
        ]
      : []),
    ...(update.rollbackSha256
      ? [`Retained rollback SHA256: ${text(update.rollbackSha256, 100)}`]
      : []),
    ...(update.activationPending
      ? [
          "The new server payload stays pinned. Activating it remains a separate action in its owning environment.",
        ]
      : []),
    "Applying uses the existing verified installer. Running services, personal data and credentials remain with their owners.",
  ].join("\n");
}

/** Owner statuses describe reachability, never permission to update their releases. */
export function formatMaintenanceSources(report) {
  const sources = report?.ownerMetadata?.sources ?? [];
  const identities = report?.identities ?? {};
  const components = report?.commissioned?.components ?? [];
  const pin = (name) => text(components.find((component) => component.name === name)?.version, 100);
  return [
    `Local client pins: Loom desktop ${pin("loom")}; Office CLI ${pin("office")}; Atlas CLI ${pin("atlas")}; Switchboard CLI ${pin("switchboard")}.`,
    `Observed Loom server: ${text(identities.loom?.state, 80)} (${text(identities.loom?.serverVersion, 100)}). Pinned server payload: ${pin("server")}. Release channel: ${text(identities.loom?.channel, 80)}.`,
    `Observed Switchboard controller: ${text(identities.switchboard?.state, 80)} (${text(identities.switchboard?.controllerVersion, 100)}), cached health only. Release channel: ${text(identities.switchboard?.channel, 80)}. Gateway release: unknown. Inference activity: ${text(identities.switchboard?.inferenceActivity, 80)}.`,
    `Installed Omarchy: ${text(identities.omarchy?.state, 80)} (${text(identities.omarchy?.version, 100)}). Release channel: ${text(identities.omarchy?.channel, 80)}.`,
    "Current hosted app release identities:",
    ...(report?.apps ?? []).map(
      (app) =>
        `${ownerNames[app.owner] ?? "Unknown owner"} hosted web: ${text(app.state, 80)}${app.version ? ` (${text(app.version, 100)})` : ""}. Release channel: ${text(app.channel, 80)}.`,
    ),
    "Pins identify stored local payloads. Hosted and running identities are separate observations; matching versions do not establish update availability.",
    "Current owner sources:",
    ...Object.entries(ownerNames).map(([owner, name]) => {
      const selected = sources.filter((source) => source.owner === owner);
      return selected.length
        ? `${name}: ${selected.map((source) => `${text(source.id, 100)} ${text(source.state, 80)}${source.truncated ? " (partial)" : ""}`).join("; ")}`
        : `${name}: unknown. This report has no verified live release or complete work inventory from this owner.`;
    }),
    ...(report?.ownerMetadata?.detail ? [text(report.ownerMetadata.detail)] : []),
    ...(report?.compatibility
      ? [
          `Native compatibility: ${report.compatibility.errors === 0 ? "verified by current read-only checks" : Number.isSafeInteger(report.compatibility.errors) ? "needs review" : "unknown"}`,
          ...(report.compatibility.checks ?? []).map(
            (check) => `${text(check.id, 100)}: ${text(check.state, 80)}. ${text(check.detail)}`,
          ),
        ]
      : ["Native compatibility: unknown. This report has no current native verification result."]),
    "Office and Atlas publish their web releases in their own apps. Switchboard owns shared AI accounts, routing and hub releases. Loom owns its running environment and provider runtimes.",
    "Opening an owner never reloads its app, applies an update, restarts a service or deploys a server on your behalf.",
  ].join("\n");
}

/** The ordinary screen distinguishes observed identities from pins without dumping diagnostics. */
export function formatMaintenanceSummary(report) {
  const identities = report?.identities ?? {};
  const components = report?.commissioned?.components ?? [];
  const serverPin = components.find((component) => component.name === "server");
  const sources = report?.ownerMetadata?.sources ?? [];
  const count = (value) => (Number.isSafeInteger(value) && value >= 0 ? String(value) : "unknown");
  const coverage =
    !sources.length || report?.ownerMetadata?.state === "unavailable"
      ? "unknown coverage"
      : report.ownerMetadata.truncated ||
          sources.some((source) => source.truncated || source.state !== "connected")
        ? "partial or unavailable sources"
        : "owner-filtered coverage";
  const hosted = (owner) => {
    const app = report?.apps?.find((item) => item.owner === owner);
    return `${ownerNames[owner]} hosted web: ${text(app?.version, 100)} (${text(app?.state, 80)}).`;
  };
  const active = report?.release?.active;
  const recoveryPack = report?.commissioned?.pack;
  const recoveryCoverage =
    report?.commissioned?.state === "complete" &&
    active?.verified === true &&
    active.matchesInstalled === true &&
    !report.release.pending &&
    isHash(active.sha256) &&
    isHash(recoveryPack?.sha256)
      ? active.sha256 === recoveryPack.sha256
        ? "matches installed integration"
        : "differs from installed integration"
      : "coverage unknown";
  const compatibility = report?.compatibility;
  const warnings =
    compatibility?.warnings ??
    (Number.isSafeInteger(compatibility?.errors)
      ? compatibility?.checks?.filter((check) => check.state === "warning").length
      : undefined);
  const update = report?.update;
  return [
    "Updates and recovery",
    `Installed pack: ${text(active?.version, 100)} · ${text(report?.profile, 50)} · ${active?.verified === true && active.matchesInstalled === true ? "verified" : "needs review"}.`,
    `Commissioned setup: ${text(report?.commissioned?.state, 80)}. Recovery pin: ${text(recoveryPack?.version, 100)}; ${recoveryCoverage}.`,
    `Loom server: observed ${text(identities.loom?.serverVersion, 100)} (${text(identities.loom?.state, 80)}); pinned ${text(serverPin?.version, 100)}.`,
    `Switchboard: cached controller ${text(identities.switchboard?.controllerVersion, 100)} (${text(identities.switchboard?.state, 80)}); inference activity ${text(identities.switchboard?.inferenceActivity, 80)}.`,
    hosted("office"),
    hosted("atlas"),
    `System base: Omarchy ${text(identities.omarchy?.version, 100)} (${text(identities.omarchy?.state, 80)}); channel ${text(identities.omarchy?.channel, 80)}.`,
    `Visible owner work: ${count(report?.ownerMetadata?.visibleRunning)} running, ${count(report?.ownerMetadata?.visibleWaiting)} waiting; ${coverage}. Counts cannot prove all work idle.`,
    `Native compatibility: ${count(compatibility?.errors)} errors, ${count(warnings)} warnings.`,
    update
      ? `Update: ${text(update.kind, 50)} ${text(update.pack?.version, 100)}, ${text(update.phase, 80)}${update.activationPending ? "; server activation stays with its owner" : ""}.`
      : "Update: no staged candidate.",
    ...(report?.attention?.length
      ? ["Some owner checks need review. View detailed status for current diagnostics."]
      : []),
    "Opening reads status only. Review exact plans before changing local releases; app and system updates stay with their owners.",
  ].join("\n");
}

/** One cached native screen, explicit refresh and exact owner receipts. No updater runs on open. */
export async function nativeMaintenance(config, env, deps = {}) {
  const choose =
    deps.choose ??
    (async (args) => {
      const selection = await finderChoice(args, env);
      if (process.stdout.isTTY) process.stdout.write("\u001b[2J\u001b[H");
      return selection;
    });
  const show = deps.show ?? console.log;
  const reportOwner = deps.report ?? maintenanceReport;
  const candidatesOwner = deps.candidates ?? maintenanceCandidates;
  const stage = deps.stage ?? stageMaintenance;
  const apply = deps.apply ?? applyMaintenance;
  const recover = deps.recover ?? recoverMaintenance;
  const verify = deps.verify ?? verifyMaintenance;
  const command = deps.command ?? connectionCommand;
  const now = deps.now ?? Date.now;
  let report;
  let refreshedAt;
  let ownerMutationStarted = false;
  async function refresh() {
    // Kit application can move configured CLI pins. The owner re-reads configuration
    // rather than treating this utility's opening snapshot as the new installed setup.
    report = await reportOwner(undefined, env, deps);
    refreshedAt = now();
  }
  const pick = (header, choices) => choose(["choose", "--header", header, "--", ...choices]);
  async function inspectCandidates() {
    const candidates = (await candidatesOwner(env, deps))
      .filter(
        (candidate) =>
          ["pack", "kit"].includes(candidate.kind) &&
          isHash(candidate.sha256) &&
          typeof candidate.directory === "string" &&
          (candidate.kind !== "kit" || candidate.profile === report.profile),
      )
      .slice(0, candidateLimit);
    if (!candidates.length) {
      show(
        "No verified local release is available for this profile. Retained pack releases and recovery kits stay with their existing owners; nothing was downloaded or staged.",
      );
      return;
    }
    const labels = candidates.map(
      (candidate, index) =>
        `${String(index + 1).padStart(3, "0")}  ${candidate.kind}  ${text(candidate.version, 100)}${candidate.name ? `  ${text(candidate.name, 100)}` : ""}`,
    );
    const selected = await pick("Verified local releases", ["Back", ...labels]);
    if (!selected || selected === "Back") return;
    const candidate = candidates[labels.indexOf(selected)];
    if (!candidate) throw Error("Choose a verified local release from this list.");
    show(
      [
        `${candidate.kind === "kit" ? "Portable setup kit" : "Integration pack"}: ${text(candidate.version, 100)}`,
        `Profile: ${text(candidate.profile ?? report.profile, 50)}`,
        `Local bundle: ${text(candidate.directory)}`,
        `Candidate SHA256: ${candidate.sha256}`,
        "Staging copies and verifies these exact local bytes. It does not install, restart or grant access. Review the resulting owner plan before applying.",
      ].join("\n"),
    );
    if (
      (await pick("Stage this verified local release?", ["Cancel", "Stage selected release"])) !==
      "Stage selected release"
    )
      return;
    ownerMutationStarted = true;
    const receipt = await stage(
      {
        kind: candidate.kind,
        directory: candidate.directory,
        expected: candidate.sha256,
        profile: report.profile,
      },
      undefined,
      env,
      deps,
    );
    if (
      receipt?.phase !== "staged" ||
      receipt.sha256 !== candidate.sha256 ||
      !isHash(receipt.reviewHash)
    )
      throw Error(
        "The staging owner did not confirm this exact plan. Refresh status; no installation success was inferred.",
      );
    show(formatMaintenanceReview(receipt));
    await refresh();
  }
  async function reviewedAction(action) {
    const update = report.update;
    show(formatMaintenanceReview(update));
    const details = {
      "Apply reviewed update": "Apply only this staged plan using its verified owners?",
      "Retry interrupted update":
        update.recoveryAction === "rollback"
          ? `Resume restoring the exact retained integration ${update.rollbackSha256} using its owner recovery record?`
          : "Resume only this exact interrupted plan using its retained owner recovery records?",
      "Roll back reviewed integration": `Restore the exact retained integration ${update.rollbackSha256}? App data, services and personal settings stay with their owners.`,
      "Discard unapplied update":
        "Remove only this unapplied staged candidate? The current installation stays in place.",
    };
    if ((await pick(details[action], ["Keep current", action])) !== action) return;
    // The core binds this digest to the candidate, baseline and rollback identity,
    // then rechecks ownership under its operation lock before changing anything.
    ownerMutationStarted = true;
    const result =
      action === "Apply reviewed update"
        ? await apply(update.reviewHash, undefined, env, deps)
        : await recover(
            {
              "Retry interrupted update": "retry",
              "Roll back reviewed integration": "rollback",
              "Discard unapplied update": "discard",
            }[action],
            update.reviewHash,
            undefined,
            env,
            deps,
          );
    const wantedPhase =
      ["Roll back reviewed integration", "Discard unapplied update"].includes(action) ||
      (action === "Retry interrupted update" && update.recoveryAction === "rollback")
        ? "discarded"
        : "complete";
    if (result?.reviewHash !== update.reviewHash || result.phase !== wantedPhase)
      throw Error(
        "The owner did not confirm this reviewed operation. Refresh status and preserve the recovery record; no success was inferred.",
      );
    show(
      wantedPhase === "complete"
        ? "The owning installer confirmed completion and verified its installed identities. Server activation, app releases and provider updates remain with their owners."
        : action === "Discard unapplied update"
          ? "The owner confirmed the unapplied candidate was discarded. The current installation is preserved."
          : "The release owner confirmed the exact retained integration was restored and verified.",
    );
    await refresh();
  }
  await refresh();
  for (;;) {
    show(formatMaintenanceSummary(report));
    const owners = [
      "loom",
      ...(config.officeUrl ? ["office"] : []),
      ...(config.atlasUrl ? ["atlas"] : []),
      ...(config.switchboardDashboardUrl ? ["switchboard"] : []),
    ];
    const ownerChoices = owners.map((owner) => `Open ${ownerNames[owner]} update owner`);
    const choices = [
      "Done",
      ...(!report.update || ["complete", "discarded"].includes(report.update.phase)
        ? ["Browse verified local releases"]
        : []),
      ...updateChoices(report),
      ...(report.update && isHash(report.update.reviewHash) ? ["Review exact staged plan"] : []),
      "View detailed status",
      "Refresh status",
      ...ownerChoices,
      "Open system maintenance menu",
    ];
    const action = await pick("Updates and recovery", choices);
    if (!action || action === "Done") return { state: "closed" };
    if (!choices.includes(action)) throw Error("Choose a visible maintenance action.");
    ownerMutationStarted = false;
    try {
      if (action === "Refresh status") {
        if (now() - refreshedAt < maintenanceRefreshIntervalMs) {
          show("Refresh is limited to once every five seconds. The current result stays visible.");
          continue;
        }
        await refresh();
      } else if (action === "View detailed status") {
        show(formatMaintenanceReport(report));
        show(formatMaintenanceSources(report));
        await pick("Detailed status", ["Back"]);
      } else if (action === "Browse verified local releases") await inspectCandidates();
      else if (action === "Review exact staged plan") {
        show(formatMaintenanceReview(report.update));
        await pick("Reviewed local update", ["Back"]);
      } else if (action === "Verify installed update") {
        const result = await verify(undefined, env, deps);
        if (
          result?.verified !== true ||
          result.reviewHash !== report.update.reviewHash ||
          result.phase !== "complete"
        )
          throw Error(
            "The owner did not verify this exact installed update. Refresh status; nothing was changed.",
          );
        show(
          "The owning verifier confirmed the installed update. Verification changed no release or service.",
        );
        await refresh();
      } else if (ownerChoices.includes(action)) {
        const owner = owners[ownerChoices.indexOf(action)];
        const opened = await command(paths(env).bin, ["open", owner], env);
        if (opened.exit !== 0)
          throw Error("The update owner did not open. Check its configured app and retry.");
        show(
          `Opened ${ownerNames[owner]}. Review updates in that owner; no reload, restart or deployment was requested.`,
        );
      } else if (action === "Open system maintenance menu") {
        const opened = await command("omarchy-menu", ["summon", "update"], env);
        if (opened.exit !== 0)
          throw Error(
            "The stock Omarchy maintenance menu is unavailable. Use its normal system menu when the shell is ready.",
          );
        show(
          "Opened the stock Omarchy update menu. Its existing update actions remain under your control.",
        );
      } else await reviewedAction(action);
    } catch (error) {
      show(text(error.message));
      if (ownerMutationStarted) {
        try {
          await refresh();
        } catch {
          show(
            "Current owner status is unavailable. Preserve the retained recovery record and reopen this screen when the owner is reachable.",
          );
        }
      }
    }
  }
}
