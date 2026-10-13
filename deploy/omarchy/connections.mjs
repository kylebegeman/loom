import * as NodeChildProcess from "node:child_process";
import {
  appCliEnvironment,
  connectSearch,
  discoverAppIntegration,
  finderChoice,
  main,
  searchSecret,
  searchBrowserCommand,
  validateAppIntegration,
} from "./loom-os.mjs";
import { collectConnections } from "./health.mjs";

const names = { office: "Office", atlas: "Atlas" };
const row = (id, title, state, detail) => ({ id, title, state, detail });

// Capture no credential-bearing output in the report. Only validated owner metadata survives.
export function connectionCommand(file, args, env, input) {
  return new Promise((resolve) => {
    const child = NodeChildProcess.execFile(
      file,
      args,
      { env, encoding: "utf8", timeout: 15_000, maxBuffer: 256 * 1024 },
      (error, stdout) =>
        resolve({ exit: error ? (typeof error.code === "number" ? error.code : null) : 0, stdout }),
    );
    child.stdin.on("error", () => {});
    child.stdin.end(input ?? "");
  });
}

export async function probeAppConnection(app, config, env, dependencies = {}) {
  const command = dependencies.command ?? connectionCommand;
  let check = row(
    app,
    names[app] + " CLI",
    "setup-needed",
    "This app's address and command-line client must be configured.",
  );
  let declaration = null;
  if (config[`${app}Cli`] && config[`${app}Url`]) {
    declaration = await (dependencies.discover ?? discoverAppIntegration)(app, config);
    if (declaration.state !== "available") {
      check = row(
        app,
        names[app] + " CLI",
        "unavailable",
        "Update or reconnect the app server, then retry. App opening remains available.",
      );
    } else {
      const cliEnv = await (dependencies.appEnvironment ?? appCliEnvironment)(
        app,
        config[`${app}Url`],
        env,
      );
      const result = await command(config[`${app}Cli`], [app, "integration-describe", "--json"], {
        ...cliEnv,
        API_URL: config[`${app}Url`],
      });
      let valid = false;
      if (result.exit === 0) {
        try {
          validateAppIntegration(JSON.parse(result.stdout), app);
          valid = true;
        } catch {
          /* Refuse invalid success. */
        }
      }
      check = row(
        app,
        names[app] + " CLI",
        valid ? "connected" : [3, 4].includes(result.exit) ? "approval-needed" : "unavailable",
        valid
          ? "The app accepts its existing CLI access. App permissions still apply."
          : [3, 4].includes(result.exit)
            ? "Sign in or review the app's CLI permissions. Browser sign-in is separate."
            : "The CLI could not verify access. Retry after checking the app and secret store; existing access is preserved.",
      );
    }
  }
  return { step: check, declaration };
}

export async function guidedConnectionReport(config, env, dependencies = {}) {
  const command = dependencies.command ?? connectionCommand;
  const health = await (dependencies.health ?? collectConnections)(config, env);
  const checks = health.diagnostics;
  const tailnet = checks.find((check) => check.id === "client-tailnet");
  // Inspect Tailscale independently: the client's doctor can stop early on an endpoint mismatch.
  let network = tailnet?.state === "ok" ? "connected" : "unavailable";
  if (!tailnet || tailnet.state !== "ok") {
    const result = await command("tailscale", ["status", "--json"], env);
    try {
      const value = JSON.parse(result.stdout);
      if (result.exit === 0 && typeof value.BackendState === "string")
        network =
          value.BackendState === "Running" && value.Self?.Online === true
            ? "connected"
            : "approval-needed";
    } catch {
      /* Unreadable status remains unavailable. */
    }
  }
  const credential = checks.find((check) => check.id === "client-credential");
  const endpoint = checks.find((check) => check.id === "client-endpoint");
  const catalog = checks.find((check) => check.id === "client-catalog");
  const readiness = checks.find((check) => check.id === "switchboard-readiness");
  const clientError = checks.some(
    (check) => check.id.startsWith("client-") && check.state === "error",
  );
  const ai =
    !clientError && catalog?.state === "ok" && (!readiness || readiness.state === "ok")
      ? "connected"
      : endpoint?.state === "error"
        ? "setup-needed"
        : credential?.state === "error"
          ? "approval-needed"
          : "unavailable";
  const steps = [
    row(
      "tailscale",
      "Private network",
      network,
      network === "connected"
        ? "Tailscale is connected."
        : "Open Tailscale to connect or check this device.",
    ),
    row(
      "switchboard",
      "Shared AI",
      ai,
      ai === "connected"
        ? "Switchboard has verified client access and a private model catalog."
        : credential?.state === "error"
          ? "Unlock this desktop's secret store and retry. Import a client key only if it is missing."
          : endpoint?.state === "error"
            ? "Restore this device's commissioned Switchboard address."
            : "Check the private network and Switchboard hub. Existing access is preserved.",
    ),
  ];
  const apps = await Promise.all(
    Object.keys(names).map(
      async (app) => (await probeAppConnection(app, config, env, dependencies)).step,
    ),
  );
  steps.push(...apps);
  return { version: 1, steps, ready: steps.every((step) => step.state === "connected") };
}

export function formatGuidedConnections(report) {
  return [
    "Loom connections",
    ...report.steps.map((step) => `[${step.state.toUpperCase()}] ${step.title}: ${step.detail}`),
    "App-window sign-in stays in Office and Atlas. CLI access powers Find in apps and exact-item opening.",
    "Setup resumes from current owner sessions. Closing this screen keeps completed connections.",
    "AI stays on the private Switchboard hub. These checks never run inference or restart services.",
  ].join("\n");
}

export async function nativeGuidedConnections(config, env, dependencies = {}) {
  const show = dependencies.show ?? console.log;
  const choose =
    dependencies.choose ??
    (async (header, choices) => {
      const selection = await finderChoice(["choose", "--header", header, "--", ...choices], env);
      // Gum headers of different heights otherwise leave fragments of previous screens.
      if (process.stdout.isTTY) process.stdout.write("\u001b[2J\u001b[H");
      return selection;
    });
  const report = dependencies.report ?? (() => guidedConnectionReport(config, env));
  const command = dependencies.command ?? connectionCommand;
  const dispatch = dependencies.dispatch ?? ((args) => main(args, env));
  const openPage =
    dependencies.openPage ??
    (async (app, url) => {
      const spec = searchBrowserCommand(app, config, env, url);
      const child = NodeChildProcess.spawn(spec.command, spec.args, {
        env,
        stdio: "ignore",
        detached: true,
      });
      await new Promise((resolve, reject) => {
        child.once("spawn", resolve);
        child.once("error", reject);
      });
      child.unref();
    });
  async function connect(step) {
    if (step.id === "tailscale") {
      if ((await command("omarchy-shell", ["omarchy.tailscale", "open"], env)).exit !== 0)
        show(
          "Open Tailscale from the system bar. Local authentication may be required by its normal setup.",
        );
    } else if (step.id === "switchboard") {
      if (!config.switchboardCli || !config.switchboardUrl) {
        show("The Switchboard client and private gateway need commissioning on this machine.");
        return;
      }
      const choice = await choose("Shared AI: " + step.detail, [
        "Retry after unlocking secret store",
        "Use commissioned gateway",
        "Import personal client key",
        "Open Switchboard access settings",
        "Back",
      ]);
      if (choice === "Use commissioned gateway") {
        show("Gateway: " + config.switchboardUrl);
        if (
          (await choose("Use this commissioned gateway?", [
            "Keep current settings",
            "Use this gateway",
          ])) === "Use this gateway"
        )
          if (
            (
              await command(
                config.switchboardCli,
                ["client", "configure", config.switchboardUrl],
                env,
              )
            ).exit !== 0
          )
            show("The client address could not be saved. Retry from this screen.");
      } else if (choice === "Import personal client key") {
        if (
          (await choose(
            "Replace this device's saved client key? Provider accounts remain on the hub.",
            ["Keep saved access", "Enter client key"],
          )) !== "Enter client key"
        )
          return;
        const key = await (
          dependencies.password ??
          (() =>
            finderChoice(
              [
                "input",
                "--password",
                "--header",
                "Personal Switchboard client key",
                "--placeholder",
                "Stored only in the OS secret store",
                "--char-limit",
                "64",
              ],
              env,
            ))
        )();
        if (key === null) return;
        if (!/^[a-f0-9]{64}$/.test(key)) {
          show("Enter the 64-character client key provided by Switchboard.");
          return;
        }
        if ((await command(config.switchboardCli, ["client", "import-key"], env, key)).exit !== 0)
          show(
            "The client key could not be saved. Unlock Secret Service and retry; no key was written to LoomOS files.",
          );
        else show("Client key saved. The next connection check verifies gateway access.");
      } else if (choice === "Open Switchboard access settings")
        await dispatch(["open", "switchboard"]);
    } else {
      const app = step.id;
      const options = [
        "Open " + names[app],
        ...(step.state !== "connected" ? ["Sign in to CLI"] : []),
        "Open access settings",
        "Disconnect CLI access",
        "Back",
      ];
      const choice = await choose(names[app] + ": " + step.detail, options);
      if (choice === "Open " + names[app]) await dispatch(["open", app]);
      else if (choice === "Open access settings")
        await openPage(
          app,
          new URL(
            app === "office" ? "/app/?view=connections" : "/account/api-keys",
            config[`${app}Url`],
          ).href,
        );
      else if (choice === "Sign in to CLI")
        await (dependencies.login ?? connectSearch)(app, config, env);
      else if (choice === "Disconnect CLI access") {
        if (
          (await choose(
            "Disconnect " + names[app] + " CLI? App windows, data and browser sign-in are kept.",
            ["Keep connected", "Disconnect CLI"],
          )) !== "Disconnect CLI"
        )
          return;
        const cliEnv = { ...env, API_URL: config[`${app}Url`] };
        delete cliEnv.API_TOKEN;
        const result = await command(config[`${app}Cli`], ["logout"], cliEnv);
        if (result.exit !== 0) {
          show("The CLI could not disconnect. Retry or revoke it in the app's access settings.");
          return;
        }
        try {
          await (dependencies.secret ?? searchSecret)("clear", app, config[`${app}Url`], env);
        } catch {
          show("The secret store could not remove a saved search key. Unlock it and retry.");
        }
        show(
          "Local CLI sign-in removed. Review access settings to confirm server revocation, especially while offline, and revoke any API key there.",
        );
      }
    }
  }
  while (true) {
    const current = await report();
    show(formatGuidedConnections(current));
    const available = current.steps.filter(
      (step) =>
        step.id === "tailscale" ||
        step.id === "switchboard" ||
        (config[`${step.id}Cli`] && config[`${step.id}Url`]),
    );
    const pending = available.find((step) => step.state !== "connected");
    const labels = available.map((step) => `${step.title} · ${step.state}`);
    const selected = await choose(current.ready ? "Connections ready" : "Set up connections", [
      ...(pending ? ["Continue setup"] : []),
      ...labels,
      "Check again",
      "Close",
    ]);
    if (!selected || selected === "Close") return;
    const step = selected === "Continue setup" ? pending : available[labels.indexOf(selected)];
    if (!step) continue;
    try {
      await connect(step);
    } catch {
      show(
        "This connection did not finish. If an approval expired or was cancelled, retry this step. Other completed connections are kept.",
      );
    }
  }
}
