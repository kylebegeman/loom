import * as NodeChildProcess from "node:child_process";
import * as NodeReadline from "node:readline";
import { finderChoice, main } from "./loom-os.mjs";
// Reject terminal control characters at the private API boundary.
const safeText = (value, limit = 2048) =>
  // eslint-disable-next-line no-control-regex -- Private API text must exclude terminal control characters.
  typeof value === "string" && value.length <= limit && !/[\u0000-\u001f\u007f]/.test(value);
const states = new Set(["ready", "credits", "unavailable", "unknown", "provider-mismatch"]);
export function hubOrigin(config) {
  const origin = config.switchboardDashboardUrl || config.switchboardStatusUrl;
  if (!origin) throw Error("Configure Switchboard's private controller address first.");
  const url = new URL(origin);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw Error("The commissioned controller address is invalid.");
  return url.origin;
}
/** Consume Switchboard's decisions, never infer eligibility from a model catalog or recompute account policy. */
export function validateHubStatus(
  value,
  now = Date.now(),
  { client = "kyle", provider, model } = {},
) {
  if (
    !value ||
    value.version !== 1 ||
    value.service !== "switchboard" ||
    value.kind !== "hub-readiness-v1" ||
    value.client !== client ||
    value.provider !== (provider || null) ||
    !states.has(value.state) ||
    !safeText(value.evaluatedAt, 40) ||
    !Number.isFinite(Date.parse(value.evaluatedAt)) ||
    now - Date.parse(value.evaluatedAt) < -60_000 ||
    now - Date.parse(value.evaluatedAt) >= 60_000 ||
    !value.health ||
    typeof value.health.stale !== "boolean" ||
    !["ok", "warning", "error"].includes(value.health.state) ||
    !Array.isArray(value.models) ||
    value.models.length > 512 ||
    !value.summary
  )
    throw Error("Hub readiness could not be verified.");
  const ids = new Set(),
    counts = { readyModels: 0, creditModels: 0, unavailableModels: 0, unknownModels: 0 };
  for (const item of value.models) {
    if (
      !item ||
      !safeText(item.id, 180) ||
      !/^[a-zA-Z0-9][a-zA-Z0-9._:/-]*$/.test(item.id) ||
      ids.has(item.id) ||
      !["claude", "codex"].includes(item.provider) ||
      (provider && item.provider !== provider) ||
      !states.has(item.state) ||
      !safeText(item.reason) ||
      !["none", "possible", "required", "unknown"].includes(item.creditUse) ||
      !Number.isSafeInteger(item.eligibleRoutes) ||
      item.eligibleRoutes < 0 ||
      item.eligibleRoutes > 4096 ||
      (["ready", "credits"].includes(item.state) && (value.health.stale || !item.eligibleRoutes)) ||
      (client !== "kyle" && item.provider !== "codex" && ["ready", "credits"].includes(item.state))
    )
      throw Error("Hub model readiness could not be verified.");
    ids.add(item.id);
    if (item.state === "ready") counts.readyModels++;
    else if (item.state === "credits") counts.creditModels++;
    else if (item.state === "unknown") counts.unknownModels++;
    else counts.unavailableModels++;
  }
  if (
    Object.entries(counts).some(([key, count]) => value.summary[key] !== count) ||
    (value.state === "ready" && !counts.readyModels) ||
    (value.state === "credits" && !counts.creditModels) ||
    (model
      ? value.selected?.model !== model || value.selected.state !== value.state
      : value.selected !== null)
  )
    throw Error("Hub selection or summary could not be verified.");
  if (model) {
    const selected = value.selected;
    if (
      selected.version !== 1 ||
      selected.client !== client ||
      !["claude", "codex", null].includes(selected.provider) ||
      (provider && selected.provider !== provider) ||
      !safeText(selected.reason) ||
      !selected.reason.length ||
      !["none", "possible", "required", "unknown"].includes(selected.creditUse)
    )
      throw Error("Selected hub guidance could not be verified.");
    if (["ready", "credits"].includes(selected.state)) {
      const item = value.models.find((item) => item.id === model);
      if (
        !item ||
        item.provider !== selected.provider ||
        item.state !== selected.state ||
        item.creditUse !== selected.creditUse
      )
        throw Error("Selected hub guidance is inconsistent.");
    }
  }
  return {
    version: 1,
    state: value.state,
    reachable: true,
    provider: provider || null,
    client,
    updatedAt: value.updatedAt,
    health: { state: value.health.state, stale: value.health.stale },
    summary: counts,
    models: value.models.map(
      ({ id, provider, state, reason, creditUse, eligibleRoutes, resetAt }) => ({
        id,
        provider,
        state,
        reason,
        creditUse,
        eligibleRoutes,
        resetAt: Number.isFinite(resetAt) ? resetAt : null,
      }),
    ),
    selected: model
      ? {
          model,
          state: value.state,
          reason: safeText(value.selected.reason)
            ? value.selected.reason
            : "Review the selected route in Switchboard.",
        }
      : null,
    detail:
      value.state === "ready"
        ? `${counts.readyModels} cached models have plan allowance; request-time policy still applies.`
        : value.state === "credits"
          ? "Only credit-backed routes are eligible under the applied model and client restrictions."
          : value.state === "unavailable"
            ? "No selected model is eligible under current account and client restrictions."
            : value.state === "provider-mismatch"
              ? "The selected model belongs to a different provider. Its model is kept unchanged."
              : "Cached account or client readiness is unconfirmed. Review Switchboard's collection status.",
  };
}
export async function collectHubStatus(
  config,
  env,
  { request = fetch, now = Date.now(), client = "kyle", provider, model, signal } = {},
) {
  try {
    const url = new URL("/api/v1/readiness", hubOrigin(config));
    url.searchParams.set("client", client);
    if (provider) url.searchParams.set("provider", provider);
    if (model) url.searchParams.set("model", model);
    const response = await request(url.href, {
      method: "GET",
      redirect: "error",
      cache: "no-store",
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(3000)])
        : AbortSignal.timeout(3000),
    });
    if (!response.ok || !response.headers.get("content-type")?.startsWith("application/json")) {
      await response.body?.cancel();
      throw Error();
    }
    const reader = response.body?.getReader();
    if (!reader) throw Error();
    const chunks = [];
    let size = 0;
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > 1024 * 1024) throw Error();
        chunks.push(value);
      }
    } finally {
      await reader.cancel().catch(() => {});
    }
    if (signal?.aborted) throw Error();
    return validateHubStatus(JSON.parse(Buffer.concat(chunks).toString("utf8")), now, {
      client,
      provider,
      model,
    });
  } catch {
    return {
      version: 1,
      state: signal?.aborted ? "cancelled" : "unreachable",
      reachable: false,
      client,
      provider: provider || null,
      selected: null,
      models: [],
      summary: { readyModels: 0, creditModels: 0, unavailableModels: 0, unknownModels: 0 },
      detail: signal?.aborted
        ? "Readiness checking was cancelled. No work was resubmitted."
        : "The private hub is unreachable or its cached readiness is unverified. Sleep is not confirmed. Check Tailscale or the commissioned recovery controls.",
    };
  }
}
export function formatHubStatus(report) {
  return [
    "Private AI hub",
    report.detail,
    ...(report.updatedAt
      ? [`Cached reading: ${report.updatedAt}. Checking this view never polls providers.`]
      : []),
    ...(report.selected
      ? [`Selected model: ${report.selected.model}. ${report.selected.reason}`]
      : []),
    ...report.models.map(
      (item) =>
        `${item.id}: ${item.state}${item.creditUse === "required" ? " (credits required)" : item.creditUse === "possible" ? " (credits possible)" : ""}. ${item.reason}`,
    ),
    "Switchboard owns account failover, model eligibility and client restrictions. An additional hub and local-model route are not commissioned.",
    "Wake requests do not start AI. Reconnection never resubmits interrupted work or switches a provider/model.",
  ].join("\n");
}
async function command(file, args, env, signal, timeout = 20_000) {
  return new Promise((resolve) => {
    NodeChildProcess.execFile(
      file,
      args,
      { env, signal, timeout, maxBuffer: 1024 * 1024, encoding: "utf8" },
      (error, stdout) =>
        resolve({ exit: error ? (typeof error.code === "number" ? error.code : null) : 0, stdout }),
    );
  });
}
export async function hubRecovery(config, env, execute = command) {
  if (!config.switchboardCli || !config.switchboardUrl) return { supported: false };
  try {
    // The owner refreshes only its cached API and retains its own origin-bound wake declaration.
    const result = await execute(
      config.switchboardCli,
      [
        "client",
        "readiness",
        "--json",
        "--controller-origin",
        hubOrigin(config),
        "--expected-url",
        config.switchboardUrl,
      ],
      env,
    );
    const report = JSON.parse(result.stdout),
      wake = report.wake;
    if (
      result.exit !== 0 ||
      report.version !== 1 ||
      !wake ||
      typeof wake.supported !== "boolean" ||
      (wake.supported &&
        (!/^[a-z][a-z0-9-]{0,63}$/.test(wake.hub) || !/^[a-f0-9]{64}$/.test(wake.reviewSHA256)))
    )
      throw Error();
    return {
      configured: wake.configured === true,
      onLocalNetwork: wake.onLocalNetwork === true,
      supported: wake.supported,
      hub: wake.supported ? wake.hub : null,
      reviewSHA256: wake.supported ? wake.reviewSHA256 : null,
    };
  } catch {
    return { supported: false, hub: null, reviewSHA256: null };
  }
}
export async function nativeHub(config, env, dependencies = {}) {
  const show = dependencies.show ?? console.log;
  const choose =
    dependencies.choose ??
    (async (header, items) => {
      const selected = await finderChoice(["choose", "--header", header, "--", ...items], env);
      if (process.stdout.isTTY) process.stdout.write("\u001b[2J\u001b[H");
      return selected;
    });
  const execute = dependencies.command ?? command;
  const collect = dependencies.collect ?? ((selection) => collectHubStatus(config, env, selection));
  const dispatch = dependencies.dispatch ?? ((args) => main(args, env));
  let selection = dependencies.initialSelection ?? {},
    message = "";
  while (true) {
    const [report, wake] = await Promise.all([
      collect(selection),
      (dependencies.recovery ?? hubRecovery)(config, env, execute),
    ]);
    show(
      formatHubStatus(report) +
        (message ? "\n" + message : "") +
        (!wake.supported
          ? wake.configured && !wake.onLocalNetwork
            ? "\nWake is commissioned for the hub, but this device is not on its local network. Tailscale cannot carry the LAN wake packet."
            : "\nWake is not commissioned for this device, or its retained declaration has expired."
          : ""),
    );
    message = "";
    const action = await choose("Private AI hub", [
      "Check readiness",
      "Claude Code models",
      "Codex models",
      "Office restrictions",
      "Atlas restrictions",
      ...(wake.supported ? ["Wake " + wake.hub + " on the local network"] : []),
      "Wait for hub readiness",
      "Open Switchboard",
      "Close",
    ]);
    if (!action || action === "Close") return;
    if (action === "Claude Code models") selection = { provider: "claude" };
    else if (action === "Codex models") selection = { provider: "codex" };
    else if (action === "Office restrictions") selection = { client: "office", provider: "codex" };
    else if (action === "Atlas restrictions") selection = { client: "atlas", provider: "codex" };
    else if (action === "Open Switchboard") await dispatch(["open", "switchboard"]);
    else if (action.startsWith("Wake ") && wake.supported) {
      if (
        (await choose(
          "Send one reviewed local-network wake request? Readiness is checked separately; no AI task is retried.",
          ["Keep current state", "Send wake request"],
        )) !== "Send wake request"
      )
        continue;
      const sent = await execute(
        config.switchboardCli,
        [
          "client",
          "wake",
          "--json",
          "--controller-origin",
          hubOrigin(config),
          "--expected-url",
          config.switchboardUrl,
          "--review-sha256",
          wake.reviewSHA256,
        ],
        env,
      );
      message =
        sent.exit === 0
          ? "Wake requested through Switchboard. This does not confirm readiness; check or wait before starting AI."
          : "Wake did not finish or its reviewed declaration changed. Existing accounts and work are preserved.";
    } else if (action === "Wait for hub readiness") {
      const abort = new AbortController();
      const onKey = (_, key) => {
        if (key?.name === "escape" || (key?.ctrl && key?.name === "c")) abort.abort();
      };
      const raw = process.stdin.isRaw;
      if (!dependencies.command && process.stdin.isTTY) {
        NodeReadline.emitKeypressEvents(process.stdin);
        process.stdin.setRawMode(true);
        process.stdin.resume();
        process.stdin.on("keypress", onKey);
      }
      show(
        "Waiting for fresh cached hub readiness for up to 90 seconds. Press Escape to cancel. No provider polling or task retry.",
      );
      try {
        const waited = await execute(
          config.switchboardCli,
          [
            "client",
            "wait",
            "--json",
            "--verify-access",
            "--controller-origin",
            hubOrigin(config),
            "--expected-url",
            config.switchboardUrl,
            ...(selection.provider ? ["--provider", selection.provider] : []),
            ...(selection.client ? ["--client", selection.client] : []),
          ],
          env,
          abort.signal,
          95_000,
        );
        let result;
        try {
          result = JSON.parse(waited.stdout);
        } catch {
          /* No private subprocess errors reach the terminal. */
        }
        message = abort.signal.aborted
          ? "Waiting cancelled. No work was resubmitted."
          : waited.exit === 0 && result?.state === "finished"
            ? "Readiness check finished. Review the current route before starting AI."
            : "Readiness waiting timed out or could not be verified. Existing accounts and work are preserved.";
      } finally {
        if (!dependencies.command && process.stdin.isTTY) {
          process.stdin.off("keypress", onKey);
          process.stdin.setRawMode(raw);
          process.stdin.pause();
        }
      }
    }
  }
}
