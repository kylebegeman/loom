import * as NodeChildProcess from "node:child_process";
import {
  appCliEnvironment,
  discoverAppIntegration,
  finderChoice,
  itemReference,
  openExactItem,
  paths,
} from "./loom-os.mjs";
import { connectionCommand } from "./connections.mjs";
import { environmentOrigin } from "./loom-environment.mjs";

export const deskRefreshIntervalMs = 5000;
export const deskRowLimit = 100;
const states = new Set(["running", "waiting", "failed", "completed", "disconnected"]);
const identity = (v) => typeof v === "string" && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,149}$/.test(v);
const text = (v, max = 512) =>
  typeof v === "string"
    ? Array.from(v.slice(0, max), (character) => {
        const code = character.charCodeAt(0);
        return code < 32 ||
          code === 127 ||
          (code >= 0x202a && code <= 0x202e) ||
          (code >= 0x2066 && code <= 0x2069)
          ? " "
          : character;
      }).join("")
    : "";
const permission = (session, scope) =>
  session?.authenticated === true && (session.permissions ?? session.scopes ?? []).includes(scope);
const failureState = (error) =>
  ["permission", "setup"].includes(error?.code) ? "unavailable" : "disconnected";
const failureDetail = (owner, error) =>
  error?.code === "permission"
    ? `${owner} refused this read. Review access in the owning app; no approval was granted.`
    : error?.code === "setup"
      ? `${owner} native access is not connected. ${owner === "Loom" ? "Connect Loom native access" : "Sign in to its CLI through Loom connections"}, then refresh.`
      : `${owner} could not confirm its current work. Check connections and refresh; no work was restarted.`;
const unavailableControl = (reason) => ({ available: false, reason });
const visibleLoomThread = (thread) => !thread.deletedAt && !thread.archivedAt;
const sourceInventory = (rawCount, count, filteredCount = 0) => {
  const omittedCount = rawCount - filteredCount - count;
  return { rawCount, count, filteredCount, omittedCount, truncated: omittedCount > 0 };
};
const omissionDetail = (inventory) =>
  (inventory.omittedCount
    ? ` ${inventory.omittedCount} received rows omitted by the source limit. Open the owner for more work.`
    : "") +
  (inventory.filteredCount
    ? ` ${inventory.filteredCount} archived or deleted threads are excluded from this view.`
    : "");

/** The shell contains statuses and identities, not conversation or provider history. */
export function loomDeskRows(snapshot, environment, session) {
  if (!identity(environment?.environmentId) || !Array.isArray(snapshot?.threads))
    throw Object.assign(Error("Invalid Loom work metadata."), { code: "protocol" });
  const seen = new Set();
  return [...snapshot.threads]
    .filter(visibleLoomThread)
    .sort((a, b) => String(b.updatedAt ?? "").localeCompare(String(a.updatedAt ?? "")))
    .slice(0, deskRowLimit)
    .map((thread) => {
      if (!identity(thread.id) || seen.has(thread.id))
        throw Object.assign(Error("Invalid Loom thread identity."), { code: "protocol" });
      seen.add(thread.id);
      if (
        ![
          "idle",
          "preparing",
          "queued",
          "starting",
          "running",
          "waiting",
          "completed",
          "interrupted",
          "failed",
          "cancelled",
          "rolled_back",
        ].includes(thread.status)
      )
        throw Object.assign(
          Error("Unknown Loom work status. Update the integration before acting."),
          { code: "protocol" },
        );
      const raw = thread.activityRunStatus ?? thread.status;
      const active = ["preparing", "starting", "running", "waiting"].includes(raw);
      const pending = thread.pendingRuntimeRequest;
      const state =
        pending || ["queued", "waiting"].includes(raw) || thread.pendingBackgroundTasks?.length
          ? "waiting"
          : active
            ? "running"
            : thread.status === "failed"
              ? "failed"
              : "completed";
      const runId = identity(thread.activeRunId) ? thread.activeRunId : null;
      const canStop = active && runId && permission(session, "orchestration:operate");
      return {
        key: `loom:thread:${thread.id}`,
        owner: "loom",
        kind: "thread",
        id: thread.id,
        title: text(thread.title) || "Untitled Loom thread",
        state,
        outcome: text(thread.status, 40),
        detail: pending
          ? `Waiting for ${text(pending.kind, 60) || "your review"} in Loom. Review the exact thread; the desk never grants approval.`
          : raw === "waiting"
            ? "The owning agent is waiting. Open its thread for the current reason."
            : thread.pendingBackgroundTasks?.length
              ? "Existing background work is pending in this thread."
              : state === "failed"
                ? text(thread.lastError, 800) ||
                  "The last run failed. Review its existing history before retrying."
                : active
                  ? "The existing agent run is active."
                  : thread.status === "idle"
                    ? "Idle. No agent run is active."
                    : `The last run is ${text(thread.status, 40) || "finished"}; retained work stays in Loom.`,
        runId,
        destination: {
          type: "loom-thread",
          environmentId: environment.environmentId,
          threadId: thread.id,
        },
        controls: {
          stop: canStop
            ? { available: true, runId }
            : unavailableControl(
                active
                  ? "This connection has no permission to stop the current run."
                  : "There is no active run to stop.",
              ),
          resume: unavailableControl(
            "Continue or retry from the owning Loom thread after reviewing its context.",
          ),
          approve: unavailableControl(
            "Approvals and user questions must be reviewed in their owning Loom thread.",
          ),
        },
      };
    });
}

export function scheduledDeskRows(value, environment, session) {
  if (!Array.isArray(value?.tasks) || value.tasks.length > 1000)
    throw Object.assign(Error("Invalid Loom schedule metadata."), { code: "protocol" });
  const seen = new Set();
  return value.tasks.slice(0, deskRowLimit).map((task) => {
    if (
      !identity(task.scheduledTaskId) ||
      seen.has(task.scheduledTaskId) ||
      typeof task.enabled !== "boolean" ||
      !["never", "running", "succeeded", "failed"].includes(task.lastRunStatus)
    )
      throw Object.assign(Error("Invalid scheduled task identity."), { code: "protocol" });
    seen.add(task.scheduledTaskId);
    const state =
      task.lastRunStatus === "running"
        ? "running"
        : task.lastRunStatus === "failed"
          ? "failed"
          : task.lastRunStatus === "succeeded"
            ? "completed"
            : "waiting";
    const canChange = permission(session, "orchestration:operate");
    return {
      key: `loom:schedule:${task.scheduledTaskId}`,
      owner: "loom",
      kind: "schedule",
      id: task.scheduledTaskId,
      title: text(task.title) || "Untitled scheduled task",
      state,
      enabled: task.enabled,
      detail: task.enabled
        ? `Schedule enabled. ${task.nextRunAt ? `Next run: ${text(task.nextRunAt, 80)}.` : "Waiting for its next trigger."} Pausing affects future triggers, not an active run.`
        : "Schedule paused. Resume restores future triggers without running a job immediately.",
      destination: identity(task.boundThreadId)
        ? {
            type: "loom-thread",
            environmentId: environment.environmentId,
            threadId: task.boundThreadId,
          }
        : null,
      controls: {
        pause:
          task.enabled && canChange
            ? { available: true }
            : unavailableControl(
                task.enabled ? "This connection cannot change schedules." : "Already paused.",
              ),
        resume:
          !task.enabled && canChange
            ? { available: true }
            : unavailableControl(
                task.enabled ? "Already enabled." : "This connection cannot change schedules.",
              ),
        stop: unavailableControl(
          "Pausing stops future triggers. Stop an active run from its exact thread.",
        ),
      },
    };
  });
}

/** Producer CLI metadata selects literal words; it never authorizes an operation. */
export function deskOperation(operations, id, { mutation = false } = {}) {
  if (!Array.isArray(operations) || operations.length > 3000)
    throw Error("Invalid app operation catalog.");
  const found = operations.filter((op) => op.id === id);
  if (found.length !== 1) return null;
  const op = found[0];
  if (
    !op.surfaces?.includes("cli") ||
    op.approval !== "none" ||
    (mutation
      ? op.effect !== "write" || op.mutation !== "idempotent"
      : op.effect !== "read" || op.mutation !== "read-only") ||
    typeof op.command !== "string" ||
    !/^[a-z][a-z0-9-]*(?: [a-z][a-z0-9-]*){0,3}$/.test(op.command)
  )
    return null;
  return op.command.split(" ");
}

async function appDeskClient(app, config, env, deps) {
  if (!config[app + "Url"] || !config[app + "Cli"])
    throw Object.assign(Error("App is not configured."), { code: "setup" });
  const declaration = await (deps.discover ?? discoverAppIntegration)(app, config);
  if (declaration.state !== "available")
    throw Object.assign(Error("The app declaration is unavailable."), { code: "unavailable" });
  const command = deps.command ?? connectionCommand;
  const credentialEnv = { ...env };
  delete credentialEnv.API_TOKEN;
  delete credentialEnv.API_URL;
  const appEnv = await (deps.appEnvironment ?? appCliEnvironment)(
    app,
    config[app + "Url"],
    credentialEnv,
  );
  const operationEnv = { ...appEnv, API_URL: config[app + "Url"] };
  const catalog = await command(config[app + "Cli"], ["--operations", "--json"], operationEnv);
  if (catalog.exit !== 0)
    throw Object.assign(Error("App operation catalog is unavailable."), { code: "unavailable" });
  let operations;
  try {
    operations = JSON.parse(catalog.stdout);
  } catch {
    throw Error("Invalid app operation catalog.");
  }
  return {
    operations,
    async call(id, args = [], mutation = false) {
      const words = deskOperation(operations, id, { mutation });
      if (!words)
        throw Object.assign(
          Error("This app release does not expose this operation to native clients."),
          { code: "unsupported" },
        );
      const result = await command(
        config[app + "Cli"],
        [...words, ...args, "--json"],
        operationEnv,
      );
      if (result.exit !== 0)
        throw Object.assign(Error("The owning app refused or could not confirm this operation."), {
          code: [3, 4].includes(result.exit) ? "permission" : "unavailable",
        });
      try {
        return JSON.parse(result.stdout);
      } catch {
        throw Error("Invalid app work response.");
      }
    },
  };
}

export function atlasDeskRows(value) {
  const runs = value?.runs;
  if (
    !Array.isArray(runs) ||
    runs.length > deskRowLimit ||
    (value.nextCursor !== undefined &&
      value.nextCursor !== null &&
      (typeof value.nextCursor !== "string" || !value.nextCursor || value.nextCursor.length > 2048))
  )
    throw Error("Invalid or unbounded Atlas work metadata.");
  const seen = new Set();
  return [...runs]
    .sort((a, b) => String(b.createdAt ?? "").localeCompare(String(a.createdAt ?? "")))
    .slice(0, deskRowLimit)
    .map((run) => {
      if (
        !identity(run.id) ||
        seen.has(run.id) ||
        !["queued", "running", "completed", "failed", "cancelled"].includes(run.status)
      )
        throw Error("Invalid Atlas run identity or status.");
      seen.add(run.id);
      return {
        key: `atlas:run:${run.id}`,
        owner: "atlas",
        kind: "run",
        id: run.id,
        title: text(run.label) || `Atlas ${text(run.kind, 80) || "background"} run`,
        state:
          run.status === "queued"
            ? "waiting"
            : run.status === "cancelled"
              ? "completed"
              : run.status,
        outcome: run.status,
        detail:
          run.status === "failed"
            ? text(run.error, 800) || "This run failed. Review the saved attempt in Atlas."
            : `Saved run ${run.id}. Content and tool history stay in Atlas.`,
        destination: { type: "app-job", app: "atlas", operation: "atlas.runs.get", id: run.id },
        controls: {
          stop: ["running", "queued"].includes(run.status)
            ? { available: true }
            : unavailableControl("This run has finished."),
          resume: unavailableControl(
            "Atlas exposes no native resume operation. Review retained work and continue in Atlas.",
          ),
        },
      };
    });
}

export function officeDeskRows(value) {
  if (!Array.isArray(value?.issues) || value.issues.length > 200)
    throw Error("Invalid Office work metadata.");
  return value.issues.map((issue) => {
    if (!identity(issue.id)) throw Error("Invalid Office issue identity.");
    let reference = null;
    if (issue.reference) reference = itemReference("office", issue.reference);
    return {
      key: `office:issue:${issue.id}`,
      owner: "office",
      kind: "issue",
      id: issue.id,
      title: text(issue.title) || "Office background work",
      state: ["queue_delay", "budget", "paid_limit", "uncertain_delivery"].includes(issue.kind)
        ? "waiting"
        : "failed",
      detail: text(issue.message, 800),
      destination: reference ? { type: "app-item", app: "office", reference } : null,
      controls: {
        stop: unavailableControl(
          "Review this job in Office. Native cancellation does not have a supported permission contract.",
        ),
        resume: unavailableControl(
          "Review the exact owning item before retrying. Uncertain deliveries must be reconciled in Office.",
        ),
      },
    };
  });
}

function approvalRows(value, app) {
  if (!Array.isArray(value?.items) || value.items.length > 200)
    throw Error("Invalid approval metadata.");
  return value.items.slice(0, deskRowLimit).map((approval) => {
    if (!identity(approval.id)) throw Error("Invalid approval identity.");
    return {
      key: `${app}:approval:${approval.id}`,
      owner: app,
      kind: "approval",
      id: approval.id,
      title: text(approval.summary) || text(approval.operation) || "App approval",
      state:
        approval.status === "pending"
          ? "waiting"
          : approval.status === "rejected"
            ? "failed"
            : "completed",
      detail: `Approval ${text(approval.status, 50)}. ${approval.awaiting_you ? "Waiting for your review in the owning app." : "The existing app decides who can review this call."}`,
      destination: { type: "app-approval", app, operation: "approvals.get", id: approval.id },
      controls: {
        approve: unavailableControl(
          "The owning app keeps approval previews, current authority, edits, expiry and signatures. Review there; native access does not grant an approval.",
        ),
      },
    };
  });
}

async function collectLoom(config, env, deps) {
  const request = deps.loomRequest ?? (await import("./loom-environment.mjs")).environmentRequest;
  const call = deps.loomCall ?? (await import("./loom-environment.mjs")).environmentCall;
  const [environment, session] = await Promise.all([
    request(config, env, "/.well-known/t3/environment", deps),
    request(config, env, "/api/auth/session", deps),
  ]);
  if (!permission(session, "orchestration:read"))
    throw Object.assign(Error("Loom read access is required."), { code: "permission" });
  const [shell, schedules] = await Promise.allSettled([
    request(config, env, "/api/orchestration/shell", deps),
    call(config, env, "list_scheduled_tasks", {}, deps),
  ]);
  const rows = [],
    sources = [];
  for (const [index, result] of [shell, schedules].entries()) {
    const id = index ? "loom-schedules" : "loom-threads";
    if (result.status === "rejected")
      sources.push({
        id,
        owner: "loom",
        state: failureState(result.reason),
        detail: failureDetail("Loom", result.reason),
      });
    else {
      const added = index
        ? scheduledDeskRows(result.value, environment, session)
        : loomDeskRows(result.value, environment, session);
      const archived = index ? [] : (result.value.archivedThreads ?? []);
      if (!Array.isArray(archived)) throw Error("Invalid archived Loom work metadata.");
      const rawCount = index
        ? result.value.tasks.length
        : result.value.threads.length + archived.length;
      const filteredCount = index
        ? 0
        : rawCount - result.value.threads.filter(visibleLoomThread).length;
      const inventory = sourceInventory(rawCount, added.length, filteredCount);
      rows.push(...added);
      sources.push({
        id,
        owner: "loom",
        state: "connected",
        detail:
          (index
            ? "Existing schedules only. Prompts and webhook URLs are omitted."
            : "Existing thread statuses and pending review identities only.") +
          omissionDetail(inventory),
        ...inventory,
      });
    }
  }
  return {
    rows,
    sources,
    environment: { environmentId: environment.environmentId, label: text(environment.label) },
  };
}

async function collectApp(app, config, env, deps) {
  const client = await appDeskClient(app, config, env, deps);
  const requested =
    app === "atlas"
      ? ["atlas.runs.list"]
      : ["office.models.health", "office.health.overview", "approvals.list"];
  const replies = await Promise.allSettled(
    requested.map((id) =>
      client.call(id, id === "atlas.runs.list" ? ["--limit", String(deskRowLimit)] : []),
    ),
  );
  const rows = [],
    sources = [];
  for (const [index, result] of replies.entries()) {
    const id = requested[index];
    if (result.status === "rejected") {
      sources.push({
        id,
        owner: app,
        state: result.reason.code === "unsupported" ? "unavailable" : failureState(result.reason),
        detail:
          result.reason.code === "unsupported"
            ? id === "atlas.runs.list"
              ? "Update Atlas and its CLI to list background work here. Open Atlas to review existing jobs; unrelated workspace content was not read."
              : "This app release does not expose this native read. Review work in the app."
            : failureDetail(app === "office" ? "Office" : "Atlas", result.reason),
      });
      continue;
    }
    const value = result.value;
    if (id === "office.health.overview") {
      const jobs = value?.jobs;
      if (
        !jobs ||
        ["queued", "running", "retry", "dead"].some(
          (k) => !Number.isSafeInteger(jobs[k]) || jobs[k] < 0,
        )
      )
        throw Error("Invalid Office job gauges.");
      sources.push({
        id,
        owner: app,
        state: "connected",
        detail: `Office background work: ${jobs.running} running, ${jobs.queued} queued, ${jobs.retry} retrying, ${jobs.dead} failed. Job controls remain in Office.`,
        jobs: { running: jobs.running, queued: jobs.queued, retry: jobs.retry, dead: jobs.dead },
      });
    } else {
      const added =
        id === "atlas.runs.list"
          ? atlasDeskRows(value)
          : id === "approvals.list"
            ? approvalRows(value, app)
            : officeDeskRows(value);
      if (
        app === "atlas" &&
        !deskOperation(client.operations, "atlas.runs.cancel", { mutation: true })
      )
        for (const row of added)
          row.controls.stop = unavailableControl(
            "This Atlas client has no supported cancellation operation.",
          );
      const rawCount =
        id === "atlas.runs.list"
          ? value.runs.length
          : id === "approvals.list"
            ? value.items.length
            : value.issues.length;
      const inventory = sourceInventory(rawCount, added.length);
      rows.push(...added);
      sources.push({
        id,
        owner: app,
        state: "connected",
        detail:
          (id === "atlas.runs.list"
            ? `Bounded owner-filtered Atlas run metadata only. ${value.nextCursor ? "More history is available in Atlas. " : ""}Prompts, evidence, output and tools are not read.`
            : "Existing owner-filtered app work only; app permissions still apply.") +
          omissionDetail(inventory),
        ...inventory,
        truncated: inventory.truncated || (id === "atlas.runs.list" && Boolean(value.nextCursor)),
      });
    }
  }
  sources.push({
    id: app + "-operator-jobs",
    owner: app,
    state: "unavailable",
    detail:
      "The operator queue requires the owning app's human operator session. The desk does not substitute CLI access or read another account's work.",
  });
  return { rows, sources };
}

/** A refresh does bounded read-only requests. It never installs, starts or restarts work. */
export async function collectControlDesk(config, env, deps = {}) {
  const results = await Promise.allSettled([
    collectLoom(config, env, deps),
    ...["office", "atlas"].map((app) => collectApp(app, config, env, deps)),
  ]);
  const owners = ["loom", "office", "atlas"],
    rows = [],
    sources = [];
  let environment = null;
  for (const [index, result] of results.entries()) {
    if (result.status === "fulfilled") {
      rows.push(...result.value.rows);
      sources.push(...result.value.sources);
      environment ??= result.value.environment ?? null;
    } else
      sources.push({
        id: owners[index],
        owner: owners[index],
        state: failureState(result.reason),
        detail: failureDetail(
          owners[index] === "loom" ? "Loom" : owners[index] === "office" ? "Office" : "Atlas",
          result.reason,
        ),
      });
  }
  rows.sort(
    (a, b) =>
      ["failed", "waiting", "running", "completed"].indexOf(a.state) -
      ["failed", "waiting", "running", "completed"].indexOf(b.state),
  );
  const shown = Math.min(rows.length, deskRowLimit);
  // Counts cover received, owner-filtered metadata only, never a service-wide idle proof.
  const total = rows.length + sources.reduce((sum, source) => sum + (source.omittedCount ?? 0), 0);
  return {
    version: 1,
    checkedAt: new Date((deps.now ?? Date.now)()).toISOString(),
    readOnly: true,
    environment,
    sources,
    rows,
    refreshIntervalMs: deskRefreshIntervalMs,
    truncated: rows.length > deskRowLimit || sources.some((source) => source.truncated),
    total,
    shown,
    omittedCount: total - shown,
  };
}

export function formatControlDesk(report) {
  if (!Array.isArray(report?.rows) || report.rows.some((row) => !states.has(row.state)))
    throw Error("Invalid desk report.");
  return [
    "Workstation control desk",
    "",
    ...report.sources.map((source) => `${source.owner}: ${source.state}. ${source.detail}`),
    ...(report.truncated
      ? [
          `Showing ${report.shown} of ${report.total} observed rows; ${report.omittedCount} known rows omitted by desk limits. Further owner history may be available. This view cannot confirm all work is idle.`,
        ]
      : []),
    "",
    ...report.rows
      .slice(0, deskRowLimit)
      .map((row) => `${row.state.toUpperCase()}  ${row.title}\n  ${row.detail}`),
    ...(!report.rows.length
      ? ["No current work could be listed. Review source access above or open an owning app."]
      : []),
    "",
    "Refresh is explicit and limited to once every five seconds. Opening the desk starts no job. Approvals stay with the owning app.",
  ].join("\n");
}

async function launch(spec) {
  const child = NodeChildProcess.spawn(spec.command, spec.args, {
    env: spec.env,
    detached: true,
    stdio: "ignore",
  });
  await new Promise((resolve, reject) => {
    child.once("spawn", resolve);
    child.once("error", reject);
  });
  child.unref();
}

export function loomThreadDestination(destination, config) {
  if (
    destination?.type !== "loom-thread" ||
    !identity(destination.environmentId) ||
    !identity(destination.threadId)
  )
    throw Error("Invalid exact Loom destination.");
  const origin = environmentOrigin(config);
  const url = new URL(origin);
  if (
    !(
      (url.protocol === "https:" && !url.username && !url.password) ||
      (url.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname))
    ) ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    url.username ||
    url.password
  )
    throw Error("Use the configured private Loom environment origin.");
  return new URL(
    `/${encodeURIComponent(destination.environmentId)}/${encodeURIComponent(destination.threadId)}`,
    url,
  ).href;
}

/** The owning web surface has an exact thread route; native desktop has no route ingress yet. */
export async function openLoomThread(destination, config, env, deps = {}) {
  const url = loomThreadDestination(destination, config);
  await (deps.launch ?? launch)({
    command: config.browserExecutable ?? "chromium",
    args: [url],
    env,
  });
  return { state: "opened", url, threadId: destination.threadId, surface: "web" };
}

/** Controls re-read the owner and bind to the exact reviewed run or schedule. */
export async function controlDeskAction(action, row, config, env, deps = {}) {
  if (
    !row ||
    !identity(row.id) ||
    !["open", "handoff", "inspect", "stop", "pause", "resume"].includes(action)
  )
    throw Error("Choose an existing desk action.");
  const report = await (deps.collect ?? collectControlDesk)(config, env, deps);
  const current = report.rows.find(
    (item) =>
      item.key === row.key &&
      item.owner === row.owner &&
      item.kind === row.kind &&
      item.id === row.id,
  );
  if (!current) throw Error("This work is no longer visible. Refresh the desk; nothing changed.");
  if (action === "handoff") {
    const { nativeHandoff } = await import("./continuity.mjs");
    const destination = current.destination;
    if (destination?.type === "loom-thread")
      return nativeHandoff("loom", destination, config, env, deps);
    if (destination?.type === "app-item")
      return nativeHandoff(destination.app, destination.reference, config, env, deps);
    throw Error("This owner has no exact cross-device destination for this work.");
  }
  if (action === "open") {
    const destination = current.destination;
    if (destination?.type === "loom-thread") {
      return openLoomThread(destination, config, env, deps);
    }
    if (destination?.type === "app-item") {
      await (deps.openItem ?? openExactItem)(
        destination.app,
        destination.reference,
        config,
        env,
        deps,
      );
      return { state: "opened", reference: destination.reference };
    }
    throw Error(
      "This owner does not expose an exact app route for this job. Inspect its saved status here or open the owning app.",
    );
  }
  if (action === "inspect") {
    const destination = current.destination;
    if (!["app-job", "app-approval"].includes(destination?.type))
      return { state: "inspected", row: current };
    const client = await appDeskClient(current.owner, config, env, deps);
    const saved = await client.call(destination.operation, [
      current.kind === "approval" ? "--approval-id" : "--id",
      current.id,
    ]);
    if (saved.id !== current.id)
      throw Error("The owning app returned another job identity; nothing changed.");
    return {
      state: "inspected",
      row: {
        ...current,
        detail:
          current.kind === "approval"
            ? `Approval ${text(saved.status, 50)}. Review this exact call in its owning app; no decision was made.`
            : `Run ${current.id}: ${text(saved.status, 50)}. ${text(saved.error, 800)}`,
      },
    };
  }
  if (!current.controls?.[action]?.available)
    throw Error(current.controls?.[action]?.reason ?? "This control is unavailable.");
  if (current.owner === "loom") {
    const call = deps.loomCall ?? (await import("./loom-environment.mjs")).environmentCall;
    if (current.kind === "schedule") {
      if (current.enabled !== row.enabled)
        throw Error("The schedule changed since review. Refresh before changing it.");
      const enabled = action === "resume";
      if (!["pause", "resume"].includes(action)) throw Error("Unsupported schedule control.");
      const value = await call(
        config,
        env,
        "update_scheduled_task",
        { scheduledTaskId: current.id, enabled },
        deps,
      );
      if (value.scheduledTaskId !== current.id || value.enabled !== enabled)
        throw Error("Loom did not confirm the schedule change. Refresh its current state.");
      return { state: enabled ? "resumed" : "paused", id: current.id };
    }
    if (action !== "stop" || current.runId !== row.runId || !identity(current.runId))
      throw Error("The active run changed since review. Refresh before stopping work.");
    const value = await call(
      config,
      env,
      "t3_thread_interrupt",
      {
        threadId: current.id,
        runId: current.runId,
        reason: "Stopped after explicit review in the LoomOS control desk.",
      },
      deps,
    );
    if (value.threadId !== current.id || (value.runId && value.runId !== current.runId))
      throw Error("Loom did not confirm this exact run. Refresh; no retry was sent.");
    return { state: text(value.status, 50), threadId: current.id, runId: current.runId };
  }
  if (current.owner === "atlas" && current.kind === "run" && action === "stop") {
    const client = await appDeskClient("atlas", config, env, deps);
    const value = await client.call("atlas.runs.cancel", ["--id", current.id], true);
    if (value.ok !== true)
      throw Error("Atlas did not confirm the stop. Refresh before trying again.");
    return { state: "stop-requested", id: current.id };
  }
  throw Error("Use the owning app for this control.");
}

export async function nativeControlDesk(config, env, deps = {}) {
  const choose = deps.choose ?? ((args) => finderChoice(args, env));
  const show = deps.show ?? console.log;
  const collect = deps.collect ?? collectControlDesk;
  const now = deps.now ?? Date.now;
  let report = await collect(config, env, deps),
    refreshedAt = now();
  for (;;) {
    show(formatControlDesk(report));
    const visible = report.rows.slice(0, deskRowLimit);
    const labels = visible.map(
      (row, index) => `${String(index + 1).padStart(3, "0")}  ${row.state}  ${row.title}`,
    );
    const action = await choose([
      "choose",
      "--header",
      "Workstation control desk",
      ...labels,
      "Refresh current work",
      "Connect Loom native access",
      "Disconnect Loom native access",
      "Open Loom",
      ...(config.officeUrl ? ["Open Office"] : []),
      ...(config.atlasUrl ? ["Open Atlas"] : []),
      "Done",
    ]);
    if (!action || action === "Done") return { state: "closed" };
    if (action === "Refresh current work") {
      if (now() - refreshedAt < deskRefreshIntervalMs) {
        show("Refresh is limited to once every five seconds. The current result stays visible.");
        continue;
      }
      report = await collect(config, env, deps);
      refreshedAt = now();
      continue;
    }
    if (action === "Connect Loom native access") {
      const confirm = await choose([
        "choose",
        "--header",
        "Authorize the existing Loom environment for native status and reviewed controls?",
        "Connect existing environment",
        "Cancel",
      ]);
      if (confirm === "Connect existing environment") {
        try {
          const connect =
            deps.connect ?? (await import("./loom-environment.mjs")).connectLoomEnvironment;
          await connect(config, env, deps);
          report = await collect(config, env, deps);
          refreshedAt = now();
        } catch (error) {
          show(text(error.message, 1000));
        }
      }
      continue;
    }
    if (action === "Disconnect Loom native access") {
      const confirm = await choose([
        "choose",
        "--header",
        "Revoke only this desk and workbench connection? Existing agents and app logins keep running.",
        "Disconnect native access",
        "Cancel",
      ]);
      if (confirm === "Disconnect native access") {
        try {
          const disconnect =
            deps.disconnect ?? (await import("./loom-environment.mjs")).disconnectLoomEnvironment;
          await disconnect(config, env, deps);
          report = await collect(config, env, deps);
          refreshedAt = now();
        } catch (error) {
          show(text(error.message, 1000));
        }
      }
      continue;
    }
    if (["Open Loom", "Open Office", "Open Atlas"].includes(action)) {
      const app = action.slice(5).toLowerCase();
      const result = await (deps.command ?? connectionCommand)(paths(env).bin, ["open", app], env);
      if (result.exit !== 0) show("The owning app did not open. Check connections and retry.");
      continue;
    }
    const row = visible[labels.indexOf(action)];
    if (!row) throw Error("Choose an existing desk row.");
    show(
      `${row.title}\n${row.state}: ${row.detail}\n\n${Object.entries(row.controls)
        .filter(([, control]) => !control.available)
        .map(([id, control]) => `${id}: ${control.reason}`)
        .join("\n")}`,
    );
    const controls = Object.entries(row.controls)
      .filter(([, control]) => control.available)
      .map(([id]) => id);
    const choice = await choose([
      "choose",
      "--header",
      row.title,
      ...(row.destination?.type === "loom-thread" || row.destination?.type === "app-item"
        ? [
            row.destination.type === "loom-thread"
              ? "Open Loom thread in browser"
              : "Open exact item",
            "Continue on another device",
          ]
        : []),
      "Inspect saved status",
      ...controls
        .map(
          (id) =>
            ({
              stop: "Stop this run",
              pause: "Pause future triggers",
              resume: "Resume future triggers",
            })[id],
        )
        .filter(Boolean),
      "Back",
    ]);
    const selected = {
      "Open Loom thread in browser": "open",
      "Open exact item": "open",
      "Continue on another device": "handoff",
      "Inspect saved status": "inspect",
      "Stop this run": "stop",
      "Pause future triggers": "pause",
      "Resume future triggers": "resume",
    }[choice];
    if (!selected) continue;
    if (
      ["stop", "pause", "resume"].includes(selected) &&
      (await choose([
        "choose",
        "--header",
        `${choice}: ${row.title}? ${selected === "stop" ? "Retained work stays in the owner. Resume requires review there." : "Existing active runs are preserved."}`,
        "Apply reviewed control",
        "Cancel",
      ])) !== "Apply reviewed control"
    )
      continue;
    try {
      const result = await (deps.act ?? controlDeskAction)(selected, row, config, env, deps);
      show(
        result.row
          ? `${result.row.title}\n${result.row.detail}`
          : `Owner response: ${result.state}.`,
      );
      if (!["open", "inspect"].includes(selected)) {
        report = await collect(config, env, deps);
        refreshedAt = now();
      }
    } catch (error) {
      show(text(error.message, 1000));
    }
  }
}
