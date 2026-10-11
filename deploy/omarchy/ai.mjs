import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeFS from "node:fs";

import { collectPrivateConnections, formatPrivateConnections, usageMaxAgeMs } from "./health.mjs";
export { usageMaxAgeMs } from "./health.mjs";

const providers = ["claude", "codex"];
const quote = (value) => `'${value.replaceAll("'", "'\\''")}'`;
export const aiBin = (p) => NodePath.join(p.root, "ai/bin");
export const aiPath = (p, path = "/usr/local/bin:/usr/bin:/bin") =>
  [aiBin(p), ...path.split(":").filter((entry) => entry && entry !== aiBin(p))].join(":");

export function aiFiles(p) {
  const files = new Map();
  for (const [name, action] of Object.entries({
    "omarchy-agent": "agent",
    "omarchy-default-agent": "default-agent",
    "omarchy-agent-usage-update": "ai-usage",
  }))
    files.set(NodePath.join(aiBin(p), name), {
      content: `#!/bin/sh\nexec ${quote(p.bin)} ${action} "$@"\n`,
      mode: 0o755,
    });
  files.set(NodePath.join(aiBin(p), "omarchy"), {
    content: `#!/bin/bash\n# Omarchy's dispatcher resolves package scripts absolutely; intercept AI routes.\nif [[ \${1:-} == agent ]]; then\n  shift\n  case "\${1:-}" in\n    prompt|crash) operation="$1"; shift; exec "/usr/bin/omarchy-agent-$operation" "$@" ;;\n    usage-update) shift; exec ${quote(p.bin)} ai-usage "$@" ;;\n    usage-claude|usage-codex) operation="\${1#usage-}"; shift; exec ${quote(p.bin)} ai-usage-record "$operation" "$@" ;;\n    --help|-h|help) exec /usr/bin/omarchy agent "$@" ;;\n    ""|--inline|--pick|--prompt) exec ${quote(p.bin)} agent "$@" ;;\n    *) echo "This OS AI action needs a Switchboard adapter." >&2; exit 1 ;;\n  esac\nelif [[ \${1:-} == default && \${2:-} == agent ]]; then\n  shift 2\n  exec ${quote(p.bin)} default-agent "$@"\nelse\n  exec /usr/bin/omarchy "$@"\nfi\n`,
    mode: 0o755,
  });
  // Shadow the bundled direct-provider desktop entry without changing its package.
  files.set(NodePath.join(p.data, "applications/chatgpt.desktop"), {
    content: "[Desktop Entry]\nType=Application\nName=ChatGPT\nHidden=true\n",
    mode: 0o644,
  });
  files.set(NodePath.join(aiBin(p), "loom-ai-terminal"), {
    content: `#!/bin/bash
while true; do
  ${quote(p.bin)} agent --inline "$@"
  status=$?
  (( status == 0 )) && exit 0
  if ! command -v gum >/dev/null 2>&1; then
    printf '\nRun loom-os connections --human for recovery guidance. Press Enter to close. '
    read -r _
    exit "$status"
  fi
  while true; do
    choice=$(gum choose --header 'Ask AI recovery' 'Retry Ask AI' 'Connection status' 'Open Tailscale' 'Open Switchboard' 'Close') || exit "$status"
    case "$choice" in
      'Retry Ask AI') break ;;
      'Connection status') ${quote(p.bin)} connections --human ;;
      'Open Tailscale') omarchy-shell omarchy.tailscale open || printf '%s\n' 'Open Tailscale from the system bar.' ;;
      'Open Switchboard') ${quote(p.bin)} open switchboard ;;
      *) exit "$status" ;;
    esac
  done
done
`,
    mode: 0o755,
  });
  files.set(NodePath.join(p.config, "uwsm/env.d/90-loom-ai.sh"), {
    content: aiEnvironment(p),
    mode: 0o600,
  });
  files.set(NodePath.join(p.data, "applications/loom-os-ask-ai.desktop"), {
    content: `[Desktop Entry]\nType=Application\nName=Ask AI\nComment=Private AI through Switchboard\nExec="${p.bin.replaceAll("%", "%%").replaceAll('"', '\\"')}" agent\nIcon=utilities-terminal\nTerminal=false\nCategories=Utility;\n`,
    mode: 0o644,
  });
  return files;
}
export function aiEnvironment(p) {
  return `# Route native AI actions through the user-owned Loom integration.\ncase ":$PATH:" in\n  *:${quote(aiBin(p))}:*) ;;\n  *) export PATH=${quote(aiBin(p))}:"$PATH" ;;\nesac\n`;
}
export function aiBindings(p) {
  const launch = `${quote(p.bin)} agent`;
  return [
    // Defaults set PATH first; hl.env updates the keybinding dispatch environment.
    `hl.env("PATH", ${JSON.stringify(aiBin(p) + ":")} .. (os.getenv("PATH") or "/usr/local/bin:/usr/bin:/bin"))`,
    ...["SUPER + SHIFT + A", "SUPER + SHIFT + ALT + A", "SUPER + SHIFT + CTRL + A"].flatMap(
      (key) => [
        `hl.unbind(${JSON.stringify(key)})`,
        `o.bind(${JSON.stringify(key)}, "Ask AI (Switchboard)", ${JSON.stringify(launch)})`,
      ],
    ),
  ].join("\n");
}
export function aiMenu(p) {
  const command = (suffix) => `${quote(p.bin)} ${suffix}`;
  const entries = {
    "loomos.ask-ai": {
      label: "Ask AI",
      description: "Private AI through Switchboard",
      action: command("agent"),
    },
    "loomos.ai-usage": { label: "AI usage", action: command("open switchboard") },
    "setup.default.agent": {
      icon: "󰚩",
      label: "Agent",
      title: "Switchboard Agent",
      description: "Choose the CLI for private OS AI",
    },
  };
  for (const provider of providers)
    entries[`setup.default.agent.${provider}`] = {
      label: provider === "claude" ? "Claude Code" : "Codex",
      checked: `[[ "$(${quote(p.bin)} default-agent)" == "${provider}" ]]`,
      action: command(`default-agent ${provider}`),
    };
  for (const provider of [
    "copilot",
    "crush",
    "cursor-agent",
    "gemini",
    "grok",
    "hermes",
    "muse",
    "omp",
    "openclaw",
    "opencode",
    "pi",
  ])
    entries[`setup.default.agent.${provider}`] = { when: "false" };
  for (const app of [
    "chatgpt",
    "grok-bot",
    "lm-studio",
    "ollama",
    "t3-code",
    "hermes",
    "openclaw",
    "perplexity",
  ])
    entries[`install.ai.${app}`] = { when: "false" };
  entries["install.ai.switchboard"] = {
    label: "Switchboard",
    description: "Manage AI models and shared accounts",
    action: command("open switchboard"),
  };
  return entries;
}
export async function defaultAgent(p) {
  let value = "claude";
  try {
    value = (
      await NodeFSP.readFile(NodePath.join(p.config, "omarchy/defaults/agent"), "utf8")
    ).trim();
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  if (!providers.includes(value))
    throw new Error(
      "This agent has no Switchboard route. Choose Claude Code or Codex in Setup → Default → Agent.",
    );
  return value;
}
export function agentArgs(args) {
  let inline = false,
    prompt;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--inline") inline = true;
    else if (args[i] === "--pick") continue;
    else if (args[i] === "--prompt" && typeof args[i + 1] === "string") prompt = args[++i];
    else throw new Error("Usage: loom-os agent [--inline] [--pick] [--prompt TEXT]");
  }
  return { inline, prompt };
}
/** Require the commissioned hub; an unset/invalid Switchboard config cannot fall back to localhost. */
export async function routedEnvironment(config, env, p) {
  if (!config.switchboardCli || !config.switchboardUrl)
    throw new Error("Configure Switchboard's private gateway and CLI before using AI.");
  const state = env.SWITCHBOARD_STATE_DIR || NodePath.join(p.home, ".config/switchboard");
  let client;
  try {
    client = JSON.parse(await NodeFSP.readFile(NodePath.join(state, "client.json"), "utf8"));
  } catch {
    throw new Error(
      "Switchboard's endpoint is unavailable. Run switchboard client configure with the private gateway origin.",
    );
  }
  if (client.version !== 1 || client.baseUrl !== config.switchboardUrl)
    throw new Error(
      "Loom and Switchboard disagree on the AI gateway. Review their private endpoint configuration.",
    );
  await NodeFSP.access(config.switchboardCli, NodeFS.constants.X_OK);
  return { ...env, PATH: aiPath(p, env.PATH) };
}

export function usageRecords(status, now = Date.now()) {
  const stamp = Date.parse(status?.updatedAt);
  const current =
    Number.isFinite(stamp) &&
    stamp <= now + 60_000 &&
    now - stamp <= usageMaxAgeMs &&
    Array.isArray(status?.accounts);
  return providers.map((provider) => {
    const accounts = current
      ? status.accounts
          .filter((account) => account.provider === provider && account.state !== "signed-out")
          .sort(
            (a, b) =>
              (b.applied?.priority ?? b.priority ?? -1000) -
              (a.applied?.priority ?? a.priority ?? -1000),
          )
          .slice(0, 1)
      : [];
    const limits = [];
    for (const account of accounts) {
      const measured = Date.parse(account.usageAt);
      if (!Number.isFinite(measured) || now - measured > usageMaxAgeMs || measured > now + 60_000)
        continue;
      for (const [window, title] of [
        ["session", "Session (5-hour)"],
        ["weekly", "Weekly (7-day)"],
      ]) {
        const value = account.usage?.[window];
        if (
          !value ||
          !Number.isFinite(value.usedPercent) ||
          value.usedPercent < 0 ||
          value.usedPercent > 100
        )
          continue;
        if (value.resetsAt !== null && (!Number.isFinite(value.resetsAt) || value.resetsAt <= now))
          continue;
        limits.push({
          label: `Routed account: ${title}`,
          percent: value.usedPercent / 100,
          resetsAt: value.resetsAt === null ? null : new Date(value.resetsAt).toISOString(),
        });
      }
    }
    return {
      schemaVersion: 1,
      id: provider,
      name: `${provider === "claude" ? "Claude Code" : "Codex"} · Switchboard`,
      updatedAt: new Date(now).toISOString(),
      ready: true,
      hasLocalStats: false,
      limits,
      tierLabel: "Switchboard cached limits",
      usageStatusText: current && limits.length ? "" : "Switchboard limits unavailable",
      authHelpText:
        current && limits.length
          ? ""
          : "Connect Tailscale and open Switchboard to check the hub. No provider login is needed here.",
      retryAdvised: !current,
    };
  });
}
export async function updateUsage(config, p, args, fetchStatus = fetch, printRecord = false) {
  const excluded = new Set(),
    only = [];
  for (let i = 0; i < args.length; i++) {
    if (["--force", "--limits-only"].includes(args[i])) continue;
    if (args[i] === "--except" && args[i + 1]) excluded.add(args[++i]);
    else if (providers.includes(args[i])) only.push(args[i]);
    else
      throw new Error(
        "Usage: loom-os ai-usage [--force|--limits-only] [--except AGENT] [claude|codex]",
      );
  }
  if (
    providers.every(
      (provider) => excluded.has(provider) || (only.length && !only.includes(provider)),
    )
  )
    return;
  let status;
  if (config.switchboardStatusUrl)
    try {
      const response = await fetchStatus(config.switchboardStatusUrl, {
        signal: AbortSignal.timeout(3000),
        redirect: "error",
      });
      if (!response.ok) {
        await response.body?.cancel();
        throw new Error();
      }
      status = await response.json();
    } catch {
      /* Publish unavailable records rather than retaining misleading limits. */
    }
  const directory = NodePath.join(p.state, "omarchy/agents/usage");
  await NodeFSP.mkdir(directory, { recursive: true, mode: 0o700 });
  for (const record of usageRecords(status)) {
    if (excluded.has(record.id) || (only.length && !only.includes(record.id))) continue;
    if (printRecord) {
      console.log(JSON.stringify(record));
      continue;
    }
    const file = NodePath.join(directory, `${record.id}.json`),
      temporary = `${file}.${process.pid}.tmp`;
    await NodeFSP.writeFile(temporary, JSON.stringify(record) + "\n", { mode: 0o600 });
    await NodeFSP.rename(temporary, file);
  }
}
export async function aiAction(
  action,
  args,
  config,
  env,
  p,
  run,
  { connections = collectPrivateConnections } = {},
) {
  const readyEnvironment = async () => {
    const routed = await routedEnvironment(config, env, p);
    const report = await connections(config, env, { includeServer: false });
    if (!report.aiReady) throw new Error(formatPrivateConnections(report));
    return routed;
  };
  if (action === "ai-usage-record") {
    if (!providers.includes(args[0])) throw new Error("Choose claude or codex for cached usage.");
    await updateUsage(config, p, [args[0], ...args.slice(1)], fetch, true);
    return true;
  }
  if (action === "ai-usage") {
    await updateUsage(config, p, args);
    return true;
  }
  if (action === "default-agent") {
    if (!args.length) {
      console.log(await defaultAgent(p));
      return true;
    }
    if (args.length !== 1 || !providers.includes(args[0]))
      throw new Error(
        "Loom AI supports Claude Code and Codex through Switchboard. Other agents need an approved routing adapter.",
      );
    const file = NodePath.join(p.config, "omarchy/defaults/agent");
    await NodeFSP.mkdir(NodePath.join(p.config, "omarchy/defaults"), { recursive: true });
    await NodeFSP.writeFile(file, args[0] + "\n", { mode: 0o600 });
    return true;
  }
  if (action !== "agent" && action !== "ai") return false;
  if (action === "agent") {
    const { inline, prompt } = agentArgs(args);
    if (!inline) {
      await run(
        "omarchy-launch-tui",
        [
          "--app-id=org.omarchy.agent",
          NodePath.join(aiBin(p), "loom-ai-terminal"),
          ...(prompt === undefined ? [] : ["--prompt", prompt]),
        ],
        { env: { ...env, PATH: aiPath(p, env.PATH) } },
      );
    } else {
      const routed = await readyEnvironment();
      await run(
        config.switchboardCli,
        ["run", await defaultAgent(p), ...(prompt === undefined ? [] : ["--", prompt])],
        { env: routed },
      );
    }
  } else {
    if (!providers.includes(args[0]))
      throw new Error("Usage: loom-os ai claude|codex [native CLI args]");
    await run(config.switchboardCli, ["run", ...args], {
      env: await readyEnvironment(),
    });
  }
  return true;
}
