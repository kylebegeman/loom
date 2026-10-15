import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeCrypto from "node:crypto";
import { paths, finderChoice, main, resolveExactItem, itemReference } from "./loom-os.mjs";
import { connectionCommand } from "./connections.mjs";
import { collectPrivateConnections } from "./health.mjs";

const identity = (value) =>
  typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,149}$/.test(value);
const printable = (value, limit = 512) =>
  typeof value === "string" &&
  value.length > 0 &&
  value.length <= limit &&
  !/[\p{Cc}\p{Cf}]/u.test(value);
const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const modes = new Set(["power-saver", "balanced", "performance"]);
const targetFile = (env) => NodePath.join(paths(env).config, "loom-os/continuity.json");

/** Remote links use private HTTPS, never credentials embedded in a URL. */
export function workstationOrigin(value) {
  if (typeof value !== "string" || value.length > 2048)
    throw Error("Choose a private Tailscale HTTPS origin.");
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    !/^[a-z0-9-]+(?:\.[a-z0-9-]+)*\.ts\.net$/.test(url.hostname) ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    url.username ||
    url.password
  )
    throw Error(
      "Choose the workstation's private Tailscale HTTPS origin without a pairing token or path.",
    );
  return url.origin;
}
export function validateTarget(value) {
  if (
    !object(value) ||
    value.version !== 1 ||
    !identity(value.environmentId) ||
    !printable(value.label, 120) ||
    Object.keys(value).some((key) => !["version", "origin", "environmentId", "label"].includes(key))
  )
    throw Error("The saved workstation identity is invalid. Review it in Device continuity.");
  return {
    version: 1,
    origin: workstationOrigin(value.origin),
    environmentId: value.environmentId,
    label: value.label,
  };
}
async function safePath(file) {
  for (let path = NodePath.resolve(file); ;) {
    try {
      if ((await NodeFSP.lstat(path)).isSymbolicLink())
        throw Error("Preserving a symbolic link in continuity settings.");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    const parent = NodePath.dirname(path);
    if (parent === path) return;
    path = parent;
  }
}
export async function readTarget(env = process.env) {
  const file = targetFile(env);
  await safePath(file);
  try {
    const stat = await NodeFSP.lstat(file);
    if (
      !stat.isFile() ||
      stat.size > 4096 ||
      stat.mode & 0o077 ||
      (process.getuid && stat.uid !== process.getuid())
    )
      throw Error("Continuity settings must be a private file owned by this user.");
    let value;
    try {
      value = JSON.parse(await NodeFSP.readFile(file, "utf8"));
    } catch {
      throw Error("Continuity settings are unreadable. Preserve them and review recovery.");
    }
    return validateTarget(value);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}
export async function inspectWorkstation(origin, { request = fetch, signal } = {}) {
  origin = workstationOrigin(origin);
  const response = await request(origin + "/.well-known/t3/environment", {
    method: "GET",
    redirect: "error",
    cache: "no-store",
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(3000)])
      : AbortSignal.timeout(3000),
  });
  if (!response.ok || !response.headers.get("content-type")?.startsWith("application/json")) {
    await response.body?.cancel();
    throw Error(
      "The workstation could not confirm its Loom identity. Check Tailscale and its existing server.",
    );
  }
  const reader = response.body?.getReader();
  if (!reader) throw Error("No workstation identity returned.");
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 64 * 1024) throw Error("Workstation metadata is too large.");
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  let value;
  try {
    value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw Error("The workstation returned invalid Loom metadata.");
  }
  if (
    signal?.aborted ||
    !object(value) ||
    !identity(value.environmentId) ||
    !printable(value.label, 120) ||
    !printable(value.serverVersion, 80) ||
    !object(value.capabilities)
  )
    throw Error("The workstation returned invalid Loom metadata.");
  return { version: 1, origin, environmentId: value.environmentId, label: value.label };
}
export async function saveTarget(origin, reviewedEnvironmentId, env = process.env, deps = {}) {
  if (!identity(reviewedEnvironmentId))
    throw Error("Review the workstation environment ID before saving.");
  const file = targetFile(env),
    previous = await readTarget(env);
  const target = await inspectWorkstation(origin, deps);
  if (
    target.environmentId !== reviewedEnvironmentId ||
    (previous?.origin === target.origin && previous.environmentId !== target.environmentId)
  )
    throw Error(
      "The workstation identity changed. Nothing was saved; forget the old target and review the replacement explicitly.",
    );
  await safePath(file);
  await NodeFSP.mkdir(NodePath.dirname(file), { recursive: true, mode: 0o700 });
  if (JSON.stringify(await readTarget(env)) !== JSON.stringify(previous))
    throw Error("Continuity settings changed during review. Review again.");
  const temporary = file + "." + NodeCrypto.randomUUID();
  try {
    await NodeFSP.writeFile(temporary, JSON.stringify(target, null, 2) + "\n", {
      mode: 0o600,
      flag: "wx",
    });
    await NodeFSP.rename(temporary, file);
  } finally {
    await NodeFSP.rm(temporary, { force: true });
  }
  return target;
}
export async function forgetTarget(env = process.env, reviewedEnvironmentId) {
  const target = await readTarget(env);
  if (!target || target.environmentId !== reviewedEnvironmentId)
    throw Error("The reviewed workstation changed. Review its identity again.");
  await NodeFSP.rm(targetFile(env));
  return {
    forgotten: true,
    grantsRevoked: false,
    detail:
      "The shortcut was forgotten. Revoke device access in Loom Settings > Connections on the owning workstation.",
  };
}
export async function verifyTarget(env, deps = {}) {
  const saved = await readTarget(env);
  if (!saved) throw Error("Save a reviewed workstation address in Device continuity first.");
  const live = await inspectWorkstation(saved.origin, deps);
  if (live.environmentId !== saved.environmentId)
    throw Error(
      "This address now belongs to a different Loom environment. No local server or substitute host was opened.",
    );
  return saved;
}
export function threadLink(target, destination) {
  target = validateTarget(target);
  if (
    destination?.type !== "loom-thread" ||
    !identity(destination.threadId) ||
    destination.environmentId !== target.environmentId
  )
    throw Error(
      "This thread belongs to a different workstation. Save its owning environment before handing it off.",
    );
  return new URL(
    `/${encodeURIComponent(target.environmentId)}/${encodeURIComponent(destination.threadId)}`,
    target.origin,
  ).href;
}
export async function handoffLink(owner, reference, config, env, deps = {}) {
  if (owner === "loom") return threadLink(await verifyTarget(env, deps), reference);
  if (!["office", "atlas"].includes(owner)) throw Error("Choose Loom, Office or Atlas.");
  return (await resolveExactItem(owner, itemReference(owner, reference), config, env, deps)).href;
}
/** Reveals a reviewed link only. The destination still checks its own login and permissions. */
export async function nativeHandoff(owner, reference, config, env, deps = {}) {
  const choose =
    deps.choose ??
    ((header, choices) => finderChoice(["choose", "--header", header, "--", ...choices], env));
  const show = deps.show ?? console.log,
    command = deps.command ?? connectionCommand;
  const link = await handoffLink(owner, reference, config, env, deps);
  show(
    `${link}\nOpen this link on your other device using its own account. It grants no access, starts no agent and moves no local data. Pair an unconnected Loom device through the workstation's existing pairing controls.`,
  );
  const action = await choose("Continue on another device", [
    "Keep on this device",
    "Copy reviewed link",
    "Show QR code",
  ]);
  if (action === "Copy reviewed link") {
    const result = await command("wl-copy", ["--type", "text/plain"], env, link);
    if (result.exit !== 0)
      throw Error("The link could not be copied. Your existing clipboard and work are preserved.");
    show("Link copied. The other device checks access when it opens it.");
  } else if (action === "Show QR code") {
    const result = await command("qrencode", ["-t", "ANSIUTF8", "--", link], env);
    if (result.exit !== 0)
      throw Error("QR rendering is unavailable. Copy the reviewed link instead.");
    show(result.stdout);
    await choose("Scan with your other device", ["Done"]);
  }
  return {
    state:
      action === "Copy reviewed link"
        ? "copied"
        : action === "Show QR code"
          ? "shown"
          : "cancelled",
    link,
  };
}
export async function powerStatus(env, deps = {}) {
  const command = deps.command ?? connectionCommand;
  const [current, available] = await Promise.all([
    command("powerprofilesctl", ["get"], env),
    command("powerprofilesctl", ["list"], env),
  ]);
  const advertised =
    available.exit === 0
      ? [
          ...new Set(
            [
              ...available.stdout.matchAll(/^\s*\*?\s*(power-saver|balanced|performance):\s*$/gm),
            ].map((match) => match[1]),
          ),
        ]
      : [];
  return {
    supported:
      current.exit === 0 &&
      available.exit === 0 &&
      modes.has(current.stdout.trim()) &&
      advertised.includes(current.stdout.trim()),
    current: modes.has(current.stdout.trim()) ? current.stdout.trim() : null,
    modes: advertised,
  };
}
export async function setPowerMode(mode, reviewedCurrent, env, deps = {}) {
  const current = await powerStatus(env, deps);
  if (!current.supported || current.current !== reviewedCurrent || !current.modes.includes(mode))
    throw Error("Power profiles changed or are unsupported. Review the current OS controls again.");
  const command = deps.command ?? connectionCommand;
  const locked = await command("omarchy-hyprland-session-locked", [], env);
  if (locked.exit !== 1)
    throw Error("Unlock the desktop normally before changing its power profile.");
  if ((await command("powerprofilesctl", ["set", mode], env)).exit !== 0)
    throw Error("The OS did not apply this power profile.");
  const verified = await powerStatus(env, deps);
  if (!verified.supported || verified.current !== mode)
    throw Error("The OS could not confirm the selected power profile. Review its controls.");
  return verified;
}
export async function continuityStatus(config, env, deps = {}) {
  const saved = await readTarget(env);
  const [privateConnections, power, remote] = await Promise.all([
    (deps.connections ?? collectPrivateConnections)(config, env),
    powerStatus(env, deps),
    saved
      ? inspectWorkstation(saved.origin, deps)
          .then((live) => ({
            state: live.environmentId === saved.environmentId ? "reachable" : "identity-changed",
            environmentId: live.environmentId,
          }))
          .catch(() => ({ state: "unreachable", environmentId: null }))
      : Promise.resolve({ state: "not-configured", environmentId: null }),
  ]);
  return {
    version: 1,
    profile: config.profile,
    target: saved,
    remote,
    power,
    privateConnections,
    hosting:
      config.profile === "workstation"
        ? "Existing workstation hosting stays explicit and owner-managed."
        : "The laptop profile starts no background Loom host. Remote work stays on its owning workstation.",
    caveat:
      "Host reachability does not prove this browser's login or device grant. Expired or revoked access must be repaired in Loom. Reconnect and suspend never replay tasks or start a replacement server.",
  };
}
export async function nativeContinuity(config, env, deps = {}) {
  const choose =
    deps.choose ??
    ((header, choices) => finderChoice(["choose", "--header", header, "--", ...choices], env));
  const show = deps.show ?? console.log,
    dispatch = deps.dispatch ?? ((args) => main(args, env));
  while (true) {
    const report = await (deps.status ?? continuityStatus)(config, env, deps);
    show(
      `Device continuity (${report.profile})\n${report.hosting}\nWorkstation: ${report.target ? report.target.label + " · " + report.remote.state : "not configured"}\n${report.caveat}\nPower: ${report.power.supported ? report.power.current : "Use the installed OS power controls; configurable profiles are unavailable."}`,
    );
    const choices = [
      "Refresh after reconnect",
      "Set workstation address",
      ...(report.target ? ["Open owning workstation", "Forget workstation shortcut"] : []),
      ...(config.profile === "workstation" && config.serverExecutable && config.serverBaseDir
        ? ["Pair another device with this workstation"]
        : []),
      "Review current work",
      "What works offline",
      ...(report.power.supported ? ["Change power profile"] : []),
      "Open OS power controls",
      "Close",
    ];
    const action = await choose("Device continuity", choices);
    if (!action || action === "Close") return;
    try {
      if (action === "Set workstation address") {
        const origin = await (
          deps.input ??
          (() =>
            finderChoice(
              [
                "input",
                "--header",
                "Private workstation HTTPS origin",
                "--placeholder",
                "https://workstation.example.ts.net",
                "--char-limit",
                "2048",
              ],
              env,
            ))
        )();
        if (!origin) continue;
        const candidate = await inspectWorkstation(origin, deps);
        show(`${candidate.label}\n${candidate.origin}\nEnvironment: ${candidate.environmentId}`);
        if (
          (await choose(
            "Save this workstation shortcut? Its own login and device grants still apply.",
            ["Keep current shortcut", "Save reviewed workstation"],
          )) === "Save reviewed workstation"
        )
          await saveTarget(candidate.origin, candidate.environmentId, env, deps);
      } else if (action === "Open owning workstation") {
        const target = await verifyTarget(env, deps);
        if (
          (await (deps.command ?? connectionCommand)("xdg-open", [target.origin], env)).exit !== 0
        )
          throw Error(
            "The owning workstation could not open. Retry after checking its browser connection.",
          );
      } else if (action === "Forget workstation shortcut") {
        if (
          (await choose(
            "Forget this shortcut? Device revocation stays in Loom Settings > Connections.",
            ["Keep shortcut", "Forget shortcut"],
          )) === "Forget shortcut"
        )
          show((await forgetTarget(env, report.target.environmentId)).detail);
      } else if (action === "Pair another device with this workstation")
        await dispatch(["pair", "--terminal"]);
      else if (action === "Review current work") await dispatch(["desk"]);
      else if (action === "What works offline") await dispatch(["availability"]);
      else if (action === "Open OS power controls")
        await (deps.command ?? connectionCommand)("omarchy-menu", ["summon", "system"], env);
      else if (action === "Change power profile") {
        const mode = await choose("Choose an advertised OS power profile", [
          "Keep current profile",
          ...report.power.modes,
        ]);
        if (
          report.power.modes.includes(mode) &&
          (await choose(`Change from ${report.power.current} to ${mode}?`, [
            "Keep current profile",
            "Apply reviewed profile",
          ])) === "Apply reviewed profile"
        )
          await setPowerMode(mode, report.power.current, env, deps);
      }
    } catch (error) {
      show(
        printable(error.message)
          ? error.message
          : "The owning operation could not finish. Existing work remains in place.",
      );
      await choose("Review connection or owner controls, then retry", ["Back"]);
    }
  }
}
