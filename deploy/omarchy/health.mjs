import * as NodeChildProcess from "node:child_process";
export const usageMaxAgeMs = 15 * 60_000;

function execute(file, args, env) {
  return new Promise((resolve) =>
    NodeChildProcess.execFile(
      file,
      args,
      { env, timeout: 20_000, maxBuffer: 256 * 1024, encoding: "utf8" },
      (error, stdout) =>
        resolve({ exit: error ? (typeof error.code === "number" ? error.code : null) : 0, stdout }),
    ),
  );
}
const record = (id, title, state, detail, repair = null) => ({ id, title, state, detail, repair });
const safeText = (value) =>
  // oxlint-disable-next-line no-control-regex -- Diagnostic fields must remain printable single-line text.
  typeof value === "string" && value.length <= 2048 && !/[\x00-\x1f\x7f]/.test(value);

export async function collectConnections(
  config,
  env,
  { request = fetch, command = execute, now = Date.now() } = {},
) {
  const endpoints = {},
    diagnostics = [];
  const appChecks = Object.entries({
    office: config.officeUrl,
    ...(config.atlasUrl ? { atlas: config.atlasUrl } : {}),
  }).map(async ([id, origin]) => {
    const title = id === "office" ? "Office" : "Atlas";
    try {
      const response = await request(`${origin}/app/`, {
        method: "GET",
        redirect: "manual",
        signal: AbortSignal.timeout(4000),
      });
      endpoints[id] = response.status;
      await response.body?.cancel();
      const reachable = response.ok || [301, 302, 303, 307, 308].includes(response.status);
      const signIn = response.status === 401 || response.status === 403;
      return record(
        id,
        title,
        reachable ? "ok" : signIn ? "warning" : "error",
        reachable
          ? "The app server is reachable; sign-in stays in the app."
          : signIn
            ? "The server is reachable and requires app sign-in."
            : `The app returned HTTP ${response.status}.`,
        reachable
          ? null
          : signIn
            ? `Open ${title} and use its existing account.`
            : `Check ${title}'s server and retry. Local app storage is preserved.`,
      );
    } catch {
      endpoints[id] = "unreachable";
      return record(
        id,
        title,
        "error",
        "The app server is unreachable.",
        `Check network access and ${title}'s server, then retry. Local app storage is preserved.`,
      );
    }
  });
  const cacheCheck = async () => {
    if (!config.switchboardStatusUrl)
      return config.switchboardUrl
        ? record(
            "switchboard-cache",
            "Shared AI limits",
            "warning",
            "The cached status endpoint is not configured.",
            "Configure Switchboard's private cached status URL.",
          )
        : null;
    try {
      const response = await request(config.switchboardStatusUrl, {
        method: "GET",
        redirect: "manual",
        signal: AbortSignal.timeout(4000),
      });
      endpoints.switchboard = response.status;
      if (!response.ok) {
        await response.body?.cancel();
        return record(
          "switchboard-cache",
          "Shared AI limits",
          "error",
          `The cached status endpoint returned HTTP ${response.status}.`,
          "Check Tailscale and Dorothy's private dashboard.",
        );
      }
      const status = await response.json(),
        age = now - Date.parse(status?.updatedAt);
      const valid =
        Number.isFinite(age) &&
        age >= -60_000 &&
        age <= usageMaxAgeMs &&
        Array.isArray(status?.accounts);
      return record(
        "switchboard-cache",
        "Shared AI limits",
        valid ? "ok" : "warning",
        valid
          ? "The shared cached status is fresh."
          : "The cached status is stale or invalid; its limits should not be trusted.",
        valid
          ? null
          : "Open Switchboard and inspect the controller on Dorothy. Local checks do not refresh provider usage.",
      );
    } catch {
      endpoints.switchboard = "unreachable";
      return record(
        "switchboard-cache",
        "Shared AI limits",
        "error",
        "The cached status endpoint is unreachable or unreadable.",
        "Check Tailscale and Dorothy's private dashboard, then retry.",
      );
    }
  };
  const serviceCheck = async () => {
    if (config.profile !== "workstation") return null;
    if (!config.serverExecutable || !config.serverBaseDir)
      return record(
        "workstation",
        "Background Loom",
        "warning",
        "No workstation server is configured.",
        "Configure the custom server and explicitly install its service when you want background agents.",
      );
    try {
      const result = await command("systemctl", ["--user", "is-active", "t3code.service"], env);
      const active = result.exit === 0 && result.stdout.trim() === "active";
      return record(
        "workstation",
        "Background Loom",
        active ? "ok" : "error",
        active
          ? "The workstation service is running."
          : "The workstation service is stopped or could not be inspected.",
        active
          ? null
          : "Run loom-os service status. Review active work before installing or restarting its service.",
      );
    } catch {
      return record(
        "workstation",
        "Background Loom",
        "error",
        "The user service manager could not be inspected.",
        "Run loom-os service status in your normal user session.",
      );
    }
  };
  const [apps, cache, clients, service] = await Promise.all([
    Promise.all(appChecks),
    cacheCheck(),
    clientConnections(config, env, command),
    serviceCheck(),
  ]);
  diagnostics.push(...apps, ...(cache ? [cache] : []), ...clients, ...(service ? [service] : []));
  return { endpoints, diagnostics };
}
export function connectionSummary(report) {
  return {
    errors: report.diagnostics.filter((check) => check.state === "error").length,
    warnings: report.diagnostics.filter((check) => check.state === "warning").length,
  };
}
export function formatConnections(report) {
  const { errors, warnings } = connectionSummary(report);
  return [
    `Connections: ${errors} errors, ${warnings} warnings`,
    ...report.diagnostics.flatMap((check) => [
      `[${check.state.toUpperCase()}] ${check.title}: ${check.detail}`,
      ...(check.repair ? [`  Next: ${check.repair}`] : []),
    ]),
  ].join("\n");
}

async function clientConnections(config, env, command) {
  if (!config.switchboardUrl && !config.switchboardCli) return [];
  if (!config.switchboardUrl || !config.switchboardCli)
    return [
      record(
        "switchboard-client",
        "OS AI routing",
        "error",
        "The gateway or client executable is not configured.",
        "Configure both switchboard-url and switchboard-cli.",
      ),
    ];
  try {
    const result = await command(
      config.switchboardCli,
      ["client", "doctor", "--json", "--expected-url", config.switchboardUrl],
      env,
    );
    const report = JSON.parse(result.stdout);
    if (
      !Array.isArray(report.checks) ||
      !report.checks.length ||
      !report.checks.every(
        (check) =>
          safeText(check.id) &&
          check.id.startsWith("client-") &&
          safeText(check.title) &&
          safeText(check.detail) &&
          ["ok", "warning", "error"].includes(check.state) &&
          (check.repair === null || safeText(check.repair)),
      )
    )
      throw new Error();
    const checks = report.checks.map(({ id, title, state, detail, repair }) => ({
      id,
      title,
      state,
      detail,
      repair,
    }));
    if (result.exit !== 0 && !checks.some((check) => check.state === "error"))
      checks.push(
        record(
          "switchboard-client",
          "OS AI routing",
          "error",
          "The client check did not complete successfully.",
          "Check connections again before launching AI.",
        ),
      );
    return checks;
  } catch {
    return [
      record(
        "switchboard-client",
        "OS AI routing",
        "error",
        "The client diagnostic could not be read.",
        "Run switchboard client doctor; update the installed portable client if this command is unavailable.",
      ),
    ];
  }
}

/** Read-only private route checks shared by the bar, recovery console and AI launch preflight. */
export async function collectPrivateConnections(
  config,
  env,
  { command = execute, request = fetch, now = Date.now(), includeServer = true } = {},
) {
  const loomCheck = async () => {
    if (!includeServer || config.profile !== "workstation") return null;
    if (!config.serverExecutable || !config.serverBaseDir)
      return record(
        "loom",
        "Loom server",
        "warning",
        "Background hosting is not configured.",
        "Use LoomOS connection status to review this workstation's setup.",
      );
    try {
      const service = await command("systemctl", ["--user", "is-active", "t3code.service"], env);
      if (service.exit !== 0 || service.stdout.trim() !== "active")
        return record(
          "loom",
          "Loom server",
          "error",
          "The background service is stopped.",
          "Review loom-os service status and active work before starting or restarting it.",
        );
      const host = ["0.0.0.0", "::"].includes(config.serverHost)
        ? "127.0.0.1"
        : config.serverHost || "127.0.0.1";
      const address = host.includes(":") ? `[${host}]` : host;
      const response = await request(`http://${address}:${config.serverPort || 3773}/`, {
        method: "GET",
        redirect: "manual",
        signal: AbortSignal.timeout(3000),
      });
      await response.body?.cancel();
      const ready = response.ok || [301, 302, 303, 307, 308, 401, 403].includes(response.status);
      return record(
        "loom",
        "Loom server",
        ready ? "ok" : "error",
        ready
          ? "Running and reachable."
          : "The service is running but its interface is unavailable.",
        ready
          ? null
          : "Review loom-os service status and its logs. Active agents are left running.",
      );
    } catch {
      return record(
        "loom",
        "Loom server",
        "error",
        "The background interface could not be reached.",
        "Review loom-os service status and its logs. Active agents are left running.",
      );
    }
  };
  const [clients, loom] = await Promise.all([clientConnections(config, env, command), loomCheck()]);
  const tailnet = clients.find((check) => check.id === "client-tailnet");
  const failure = clients.find((check) => check.state === "error");
  const catalog = clients.find((check) => check.id === "client-catalog");
  const aiReady = !failure && catalog?.state === "ok";
  const components = [
    record(
      "tailscale",
      "Tailscale",
      tailnet?.state || "unknown",
      tailnet?.state === "ok"
        ? "Connected to the private network."
        : tailnet?.state === "error"
          ? "Disconnected or awaiting sign-in."
          : "Private network status is not confirmed.",
      tailnet?.state === "ok" ? null : "Open Tailscale to check this device's private connection.",
    ),
    record(
      "switchboard",
      "Switchboard",
      failure ? "error" : aiReady ? "ok" : "warning",
      aiReady
        ? "Private AI is available."
        : failure
          ? failure.detail
          : "No usable private model catalog is available.",
      aiReady
        ? null
        : failure?.repair ||
            catalog?.repair ||
            "Open Switchboard to review the private gateway and client access.",
    ),
    ...(loom ? [loom] : []),
  ];
  const state = !aiReady
    ? "offline"
    : components.some((check) => check.state !== "ok")
      ? "attention"
      : "ok";
  return { version: 1, generatedAt: new Date(now).toISOString(), state, aiReady, components };
}
export function formatPrivateConnections(report) {
  return [
    report.aiReady
      ? "Private AI is ready through Switchboard."
      : "Private AI is unavailable. Your existing accounts and work are preserved.",
    ...report.components.flatMap((check) => [
      `[${check.state.toUpperCase()}] ${check.title}: ${check.detail}`,
      ...(check.repair ? [`  Next: ${check.repair}`] : []),
    ]),
    "Check again after reconnecting. These checks never restart a service or contact a provider for inference.",
  ].join("\n");
}
