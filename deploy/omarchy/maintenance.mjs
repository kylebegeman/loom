import * as NodeCrypto from "node:crypto";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeProcess from "node:process";
import * as NodeURL from "node:url";
import { collectCompatibility, paths, validateConfig } from "./loom-os.mjs";
import { activateRelease, releaseStatus, rollbackRelease, verifyRelease } from "./release.mjs";
import { applyCommission, planCommission, validateRecipe, verifyKit } from "./commission.mjs";
import { collectControlDesk } from "./control-desk.mjs";
import { environmentCall, environmentRequest } from "./loom-environment.mjs";
import { connectionCommand } from "./connections.mjs";

const hash = (bytes) => NodeCrypto.createHash("sha256").update(bytes).digest("hex");
const isHash = (value) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const isId = (value) =>
  typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(value);
const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const MAX_RECORD_BYTES = 64 * 1024;
const phases = new Set([
  "staged",
  "applying",
  "verifying",
  "complete",
  "failed",
  "recovering",
  "discarded",
]);
const commandKeys = new Set([
  "loomExecutable",
  "officeCli",
  "atlasCli",
  "switchboardCli",
  "switchboardKeyHelper",
  "serverExecutable",
]);
const originKeys = [
  "officeUrl",
  "atlasUrl",
  "switchboardUrl",
  "switchboardStatusUrl",
  "switchboardDashboardUrl",
  "serverBaseDir",
  "serverHost",
  "serverPort",
  "serverReleaseBaseUrl",
];
const boundaries = [
  "Integration updates preserve running services, app data, credentials, Iris appearance and personal shortcuts.",
  "A kit pins local clients and configuration. A changed server payload is staged; its running process and systemd unit retain their existing owner until a separately reviewed activation.",
  "Office and Atlas web releases, backups, system packages and provider runtimes remain with their existing update owners.",
];
function failure(code, message) {
  return Object.assign(Error(message), { code });
}
function updatePaths(env) {
  const root = NodePath.join(paths(env).state, "loom-os/updates");
  return {
    root,
    journal: NodePath.join(root, "journal.json"),
    lock: NodePath.join(root, "operation.json"),
    candidates: NodePath.join(root, "candidates"),
  };
}
async function safePath(file) {
  let current = NodePath.resolve(file);
  for (;;) {
    try {
      if ((await NodeFSP.lstat(current)).isSymbolicLink())
        throw failure("ownership", "Preserving a symbolic link in the maintenance path.");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    const parent = NodePath.dirname(current);
    if (parent === current) return;
    current = parent;
  }
}
async function privateRoot(env, create = false) {
  const u = updatePaths(env);
  await safePath(u.root);
  if (create) await NodeFSP.mkdir(u.root, { recursive: true, mode: 0o700 });
  try {
    const stat = await NodeFSP.lstat(u.root);
    if (
      !stat.isDirectory() ||
      stat.mode & 0o077 ||
      (process.getuid && stat.uid !== process.getuid())
    )
      throw failure(
        "ownership",
        "Maintenance state must be a private directory owned by this user.",
      );
  } catch (error) {
    if (error.code !== "ENOENT" || create) throw error;
  }
  return u;
}
async function bytes(file, limit = MAX_RECORD_BYTES) {
  await safePath(file);
  try {
    const stat = await NodeFSP.lstat(file);
    if (!stat.isFile() || stat.size > limit)
      throw failure("protocol", "Maintenance metadata is not a bounded ordinary file.");
    return await NodeFSP.readFile(file);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}
async function readJSON(file) {
  const value = await bytes(file);
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    throw failure("protocol", "Maintenance metadata is unreadable. Preserve it for review.");
  }
}
async function atomicJSON(file, value) {
  await safePath(file);
  const content = JSON.stringify(value, null, 2) + "\n";
  if (Buffer.byteLength(content) > MAX_RECORD_BYTES)
    throw failure("protocol", "Maintenance journal exceeded its bounded limit.");
  const temporary = file + "." + NodeCrypto.randomUUID();
  try {
    await NodeFSP.writeFile(temporary, content, { flag: "wx", mode: 0o600 });
    await NodeFSP.rename(temporary, file);
  } finally {
    await NodeFSP.rm(temporary, { force: true });
  }
}
function reviewHash(value) {
  return hash(
    JSON.stringify({
      id: value.id,
      kind: value.kind,
      sha256: value.sha256,
      profile: value.profile,
      pack: value.pack,
      changedComponents: value.changedComponents,
      baseline: value.baseline,
      expectedConfig: value.expectedConfig,
      components: value.components,
      name: value.name,
      rollbackSha256: value.rollbackSha256,
      activationPending: value.activationPending,
    }),
  );
}
function validateJournal(value) {
  if (!value) return null;
  if (
    !object(value) ||
    value.format !== "loom-os-maintenance" ||
    value.version !== 1 ||
    !phases.has(value.phase) ||
    !isId(value.id) ||
    !["pack", "kit"].includes(value.kind) ||
    !isHash(value.sha256) ||
    !["laptop", "workstation"].includes(value.profile) ||
    (value.name !== null && !isId(value.name)) ||
    !object(value.pack) ||
    !isId(value.pack.version) ||
    !isHash(value.pack.sha256) ||
    !Array.isArray(value.changedComponents) ||
    value.changedComponents.length > 5 ||
    value.changedComponents.some(
      (name) => !["loom", "office", "atlas", "switchboard", "server"].includes(name),
    ) ||
    !object(value.baseline) ||
    !isHash(value.baseline.config) ||
    !Number.isSafeInteger(value.attempts) ||
    value.attempts < 0 ||
    value.attempts > 100 ||
    !Number.isFinite(Date.parse(value.updatedAt))
  )
    throw failure("protocol", "Invalid maintenance journal. Preserve it for review.");
  for (const key of ["installation", "release", "commission", "recipe"])
    if (value.baseline[key] !== null && !isHash(value.baseline[key]))
      throw failure("protocol", "Invalid maintenance baseline.");
  if (value.expectedConfig !== null && !isHash(value.expectedConfig))
    throw failure("protocol", "Invalid maintenance configuration identity.");
  if (
    !Array.isArray(value.components) ||
    value.components.length > 5 ||
    value.components.some(
      (component) =>
        !["loom", "office", "atlas", "switchboard", "server"].includes(component.name) ||
        !isId(component.version) ||
        !isHash(component.sha256) ||
        (component.previousVersion !== null && !isId(component.previousVersion)),
    )
  )
    throw failure("protocol", "Invalid reviewed component plan.");
  // Paths are derived from this identity, never accepted from a journal.
  if (value.id !== value.kind + "-" + value.sha256)
    throw failure("ownership", "Maintenance candidate is outside its owned identity.");
  if (
    !isHash(value.reviewHash) ||
    value.reviewHash !== reviewHash(value) ||
    (value.rollbackSha256 !== null && !isHash(value.rollbackSha256)) ||
    (value.recoveryAction !== undefined && value.recoveryAction !== "rollback")
  )
    throw failure("protocol", "Maintenance review receipt changed. Preserve it for review.");
  const allowed = new Set([
    "format",
    "version",
    "id",
    "kind",
    "sha256",
    "profile",
    "phase",
    "pack",
    "name",
    "changedComponents",
    "components",
    "baseline",
    "expectedConfig",
    "attempts",
    "updatedAt",
    "failure",
    "activationPending",
    "verifiedAt",
    "reviewHash",
    "rollbackSha256",
    "recoveryAction",
  ]);
  if (Object.keys(value).some((key) => !allowed.has(key)))
    throw failure("protocol", "Unknown maintenance journal fields.");
  return value;
}
async function journal(env) {
  const u = await privateRoot(env);
  return validateJournal(await readJSON(u.journal));
}
function publicJournal(value) {
  if (!value) return null;
  return {
    kind: value.kind,
    sha256: value.sha256,
    reviewHash: value.reviewHash,
    rollbackSha256: value.rollbackSha256,
    profile: value.profile,
    phase: value.phase,
    pack: value.pack,
    changedComponents: value.changedComponents,
    plan: {
      kind: value.kind,
      profile: value.profile,
      pack: value.pack,
      changedComponents: value.changedComponents,
      components: value.components,
      activationPending: Boolean(value.activationPending),
    },
    attempts: value.attempts,
    updatedAt: value.updatedAt,
    activationPending: Boolean(value.activationPending),
    ...(value.recoveryAction ? { recoveryAction: value.recoveryAction } : {}),
    ...(value.failure ? { failure: value.failure } : {}),
  };
}
async function withOperation(env, callback) {
  const u = await privateRoot(env, true);
  const lock = {
    format: "loom-os-maintenance-lock",
    pid: process.pid,
    nonce: NodeCrypto.randomUUID(),
  };
  let acquired = false;
  for (let attempt = 0; attempt < 2 && !acquired; attempt++) {
    try {
      await NodeFSP.writeFile(u.lock, JSON.stringify(lock) + "\n", { mode: 0o600, flag: "wx" });
      acquired = true;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      const saved = await readJSON(u.lock);
      if (
        !saved ||
        saved.format !== lock.format ||
        !Number.isSafeInteger(saved.pid) ||
        saved.pid < 1 ||
        typeof saved.nonce !== "string"
      )
        throw failure(
          "ownership",
          "An unknown maintenance operation owns the lock. Preserve it for review.",
        );
      try {
        process.kill(saved.pid, 0);
        throw failure(
          "busy",
          "Another maintenance operation is still active. Let it finish before retrying.",
        );
      } catch (liveError) {
        if (liveError.code !== "ESRCH") throw liveError;
      }
      const again = await readJSON(u.lock);
      if (again?.nonce !== saved.nonce)
        throw failure("busy", "Maintenance operation changed during review.");
      await NodeFSP.rm(u.lock);
    }
  }
  if (!acquired) throw failure("busy", "Another maintenance operation owns the update state.");
  try {
    return await callback(u);
  } finally {
    const saved = await readJSON(u.lock);
    if (saved?.nonce === lock.nonce) await NodeFSP.rm(u.lock);
  }
}
async function checkedRecipeSnapshot(env, expected) {
  if (!isHash(expected)) throw failure("integrity", "The reviewed baseline recipe is unavailable.");
  const snapshot = await bytes(
    NodePath.join(paths(env).root, "commission/recipes", expected + ".json"),
    2 * 1024 * 1024,
  );
  if (!snapshot || hash(snapshot) !== expected)
    throw failure("integrity", "The installed recipe differs from its reviewed digest.");
  return validateRecipe(JSON.parse(snapshot));
}
async function installedRecipe(env) {
  const p = paths(env),
    state = await readJSON(NodePath.join(p.state, "loom-os/commission.json"));
  if (!state) return { state: null, recipe: null };
  if (
    state.format !== "loom-os-commission" ||
    state.version !== 1 ||
    !isHash(state.sha256) ||
    !isId(state.name) ||
    !["laptop", "workstation"].includes(state.profile) ||
    !["components", "integration", "preferences", "verification", "complete"].includes(state.phase)
  )
    throw failure("protocol", "The commissioning owner record is invalid.");
  const snapshot = await bytes(
    NodePath.join(p.root, "commission/recipes", state.sha256 + ".json"),
    2 * 1024 * 1024,
  );
  if (snapshot) {
    if (hash(snapshot) !== state.sha256)
      throw failure("integrity", "The installed recipe differs from its reviewed digest.");
    return { state, recipe: validateRecipe(JSON.parse(snapshot)) };
  }
  // The commissioner records its components intent before copying/probing payloads or publishing the recipe snapshot.
  // Only that exact in-progress owned intent may defer a missing snapshot; completed or altered snapshots remain errors.
  const saved = await journal(env);
  const candidate = saved ? NodePath.join(updatePaths(env).candidates, saved.id) : null;
  if (
    state.phase !== "components" ||
    !Array.isArray(state.completed) ||
    state.completed.length !== 0 ||
    !saved ||
    saved.kind !== "kit" ||
    !["applying", "recovering", "verifying", "failed"].includes(saved.phase) ||
    saved.attempts < 1 ||
    saved.sha256 !== state.sha256 ||
    saved.baseline.recipe === state.sha256 ||
    saved.profile !== state.profile ||
    saved.name !== state.name ||
    state.kit !== candidate
  )
    throw failure("integrity", "The installed recipe differs from its reviewed digest.");
  const staged = await bytes(NodePath.join(candidate, "recipe.json"), 2 * 1024 * 1024);
  if (!staged || hash(staged) !== saved.sha256)
    throw failure("integrity", "The staged recovery recipe differs from its reviewed digest.");
  const pendingRecipe = validateRecipe(JSON.parse(staged));
  if (
    pendingRecipe.profile !== saved.profile ||
    pendingRecipe.name !== saved.name ||
    !same(pendingRecipe.pack, saved.pack)
  )
    throw failure("integrity", "The staged recovery recipe changed after review.");
  await checkedRecipeSnapshot(env, saved.baseline.recipe);
  return { state, recipe: null, snapshotPending: true, pendingRecipe };
}
async function fingerprint(env) {
  const p = paths(env);
  const items = {
    config: p.configFile,
    installation: p.manifest,
    release: NodePath.join(p.state, "loom-os/pack-release.json"),
    commission: NodePath.join(p.state, "loom-os/commission.json"),
  };
  const result = {};
  for (const [key, file] of Object.entries(items)) {
    const content = await bytes(file, 2 * 1024 * 1024);
    result[key] = content ? hash(content) : null;
  }
  const installed = await installedRecipe(env);
  result.recipe = installed.state?.sha256 ?? null;
  if (!result.config)
    throw failure("setup", "Install and configure LoomOS before coordinating updates.");
  return result;
}
async function configFromDisk(env, config) {
  const saved = validateConfig(await readJSON(paths(env).configFile));
  if (config && JSON.stringify(saved) !== JSON.stringify(validateConfig(config)))
    throw failure("changed", "LoomOS configuration changed. Reload maintenance before continuing.");
  return saved;
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
function activeRecipeComponents(recipe, profile) {
  return Object.fromEntries(
    Object.entries(recipe.components).filter(
      ([name]) => name !== "server" || profile === "workstation",
    ),
  );
}
async function preserveFeatures(manifest, env, deps, resume) {
  const p = paths(env),
    current = await (deps.releaseStatus ?? releaseStatus)({ env });
  if (current.active?.verified !== true || (!resume && !current.active.matchesInstalled))
    throw failure(
      "integrity",
      "Repair or recover the installed integration before staging an update.",
    );
  const record = await readJSON(NodePath.join(p.state, "loom-os/pack-release.json"));
  const parent = NodePath.resolve(p.root, "pack-releases");
  if (
    !record?.active?.directory ||
    NodePath.dirname(NodePath.resolve(record.active.directory)) !== parent
  )
    throw failure("ownership", "The active pack is outside its owned release directory.");
  const previous = await (deps.verifyRelease ?? verifyRelease)(
    record.active.directory,
    record.active.sha256,
  );
  if (Object.keys(previous.files).some((name) => name.startsWith("pack/") && !manifest.files[name]))
    throw failure(
      "compatibility",
      "The candidate removes installed integration features. Review a complete compatible release.",
    );
}
async function inspectCandidate(
  kind,
  directory,
  expected,
  config,
  env,
  deps,
  { resume = false, receipt = null } = {},
) {
  if (!["pack", "kit"].includes(kind) || !isHash(expected))
    throw failure("review", "Stage needs pack or kit and its independently reviewed SHA256.");
  await safePath(directory);
  if ((deps.platform ?? NodeProcess.platform) !== "linux")
    throw failure("platform", "LoomOS maintenance applies only to the installed Linux machine.");
  const installed = await installedRecipe(env);
  if (kind === "pack") {
    const manifest = await (deps.verifyRelease ?? verifyRelease)(directory, expected);
    await preserveFeatures(manifest, env, deps, resume);
    if (!resume)
      await (deps.activateRelease ?? activateRelease)(directory, expected, { env, dryRun: true });
    return {
      pack: { version: manifest.version, sha256: expected },
      name: null,
      changedComponents: [],
      components: [],
      expectedConfig: null,
      activationPending: false,
    };
  }
  const kit = await (deps.verifyKit ?? verifyKit)(directory, expected),
    recipe = kit.recipe;
  const manifest = await (deps.verifyRelease ?? verifyRelease)(
    NodePath.join(directory, "integration"),
    recipe.pack.sha256,
  );
  await preserveFeatures(manifest, env, deps, resume);
  if (!installed.recipe || installed.state.phase !== "complete") {
    if (!resume || installed.state?.sha256 !== expected)
      throw failure(
        "setup",
        "Finish existing commissioning before coordinating a replacement kit.",
      );
  }
  if (recipe.profile !== config.profile)
    throw failure(
      "profile",
      "Updates preserve this machine's profile. Commission a profile change separately.",
    );
  const previous =
    resume && receipt?.kind === "kit"
      ? await checkedRecipeSnapshot(env, receipt.baseline.recipe)
      : installed.recipe;
  if (previous) {
    if (
      !same(
        Object.keys(activeRecipeComponents(previous, config.profile)).sort(),
        Object.keys(activeRecipeComponents(recipe, config.profile)).sort(),
      )
    )
      throw failure(
        "compatibility",
        "The candidate changes the installed component inventory. Commission that change separately.",
      );
    if (
      !same(previous.apps, recipe.apps) ||
      !same(previous.switchboard, recipe.switchboard) ||
      !same(previous.server, recipe.server)
    )
      throw failure(
        "origin",
        "The candidate changes app, AI or custom fork origins. Preserve existing authorities and review that migration separately.",
      );
    if (!same(previous.preferences, recipe.preferences))
      throw failure(
        "preferences",
        "Maintenance kits preserve existing personal setup preferences.",
      );
  }
  const plan = await (deps.planCommission ?? planCommission)(directory, {
    env,
    expected,
    profile: config.profile,
    ...deps,
  });
  for (const key of originKeys)
    if ((config[key] ?? null) !== (plan.config[key] ?? null))
      throw failure(
        "origin",
        "The candidate changes a configured app, AI, data or custom fork origin.",
      );
  for (const [key, value] of Object.entries(config))
    if (!commandKeys.has(key) && !originKeys.includes(key) && !same(value, plan.config[key]))
      throw failure(
        "configuration",
        "The commissioning owner would replace a personal configuration setting. Preserve it in the reviewed kit first.",
      );
  const components = activeRecipeComponents(recipe, config.profile);
  const changedComponents = previous
    ? Object.entries(components)
        .filter(([name, component]) => !same(component, previous.components[name]))
        .map(([name]) => name)
    : [];
  return {
    pack: recipe.pack,
    name: recipe.name,
    changedComponents,
    components: Object.entries(components).map(([name, component]) => ({
      name,
      previousVersion: previous?.components[name]?.version ?? null,
      version: component.version,
      sha256: hash(JSON.stringify(component)),
    })),
    expectedConfig: hash(JSON.stringify(plan.config, null, 2) + "\n"),
    activationPending: changedComponents.includes("server"),
  };
}
async function sealCandidate(directory) {
  const stat = await NodeFSP.lstat(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink())
    throw failure("ownership", "The staged candidate directory changed.");
  await NodeFSP.chmod(directory, 0o700);
  for (const name of await NodeFSP.readdir(directory)) {
    const file = NodePath.join(directory, name),
      info = await NodeFSP.lstat(file);
    if (info.isDirectory()) await sealCandidate(file);
    else if (info.isFile()) await NodeFSP.chmod(file, info.mode & 0o111 ? 0o500 : 0o400);
    // verifyKit has already validated all portable internal links.
    else if (!info.isSymbolicLink())
      throw failure("ownership", "The candidate contains an unsupported member.");
  }
}
async function owningWork(config, env, deps) {
  if (deps.localWork) return deps.localWork(config, env);
  if (config.profile !== "workstation" || !config.serverExecutable || !config.serverBaseDir)
    return { state: "unknown", active: null };
  try {
    const request = deps.loomRequest ?? environmentRequest,
      call = deps.loomCall ?? environmentCall;
    const session = await request(config, env, "/api/auth/session", deps);
    const scopes = session?.permissions ?? session?.scopes;
    if (
      session?.authenticated !== true ||
      !Array.isArray(scopes) ||
      !scopes.includes("orchestration:read")
    )
      return { state: "unknown", active: null };
    const [shell, schedules] = await Promise.all([
      request(config, env, "/api/orchestration/shell", deps),
      call(config, env, "list_scheduled_tasks", {}, deps),
    ]);
    if (
      !Array.isArray(shell?.threads) ||
      !Array.isArray(shell?.archivedThreads) ||
      !Array.isArray(schedules?.tasks) ||
      shell.threads.length + shell.archivedThreads.length > 100_000 ||
      schedules.tasks.length > 1000 ||
      shell.truncated === true ||
      schedules.truncated === true ||
      shell.nextCursor ||
      schedules.nextCursor
    )
      return { state: "unknown", active: null };
    const known = new Set([
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
    ]);
    let active = 0;
    for (const thread of [...shell.threads, ...shell.archivedThreads]) {
      const state = thread?.activityRunStatus ?? thread?.status;
      if (!known.has(thread?.status) || !known.has(state))
        return { state: "unknown", active: null };
      if (
        ["preparing", "queued", "starting", "running", "waiting"].includes(state) ||
        thread.activeRunId ||
        thread.pendingRuntimeRequest ||
        thread.pendingBackgroundTasks?.length
      )
        active++;
    }
    for (const task of schedules.tasks) {
      if (!["never", "running", "succeeded", "failed"].includes(task?.lastRunStatus))
        return { state: "unknown", active: null };
      if (task.lastRunStatus === "running") active++;
    }
    return { state: active ? "active" : "idle", active };
  } catch {
    return { state: "unknown", active: null };
  }
}
async function assertOwningWork(saved, config, env, deps) {
  if (!saved.changedComponents.length) return;
  const work = await owningWork(config, env, deps);
  if (work?.state !== "idle" || work.active !== 0)
    throw failure(
      work?.state === "active" ? "active" : "unknown",
      work?.state === "active"
        ? "Local Loom work is active. Finish or stop it in its owning environment before changing installed components."
        : "Local owning work could not be fully authorized and confirmed. Reconnect native access before changing installed components.",
    );
}
function clock(deps) {
  return new Date((deps.now ?? Date.now)()).toISOString();
}

/** Verify and retain exact local bytes. Staging never installs or restarts anything. */
export async function stageMaintenance(candidate, config, env = process.env, deps = {}) {
  return withOperation(env, async (u) => {
    const previous = await journal(env);
    if (previous && !["complete", "discarded"].includes(previous.phase))
      throw failure(
        "pending",
        "Complete, recover or discard the existing staged update before choosing another candidate.",
      );
    config = await configFromDisk(env, config);
    const directory = NodePath.resolve(candidate.directory),
      expected = candidate.expected;
    if (candidate.profile && candidate.profile !== config.profile)
      throw failure("profile", "The selected candidate must preserve the current machine profile.");
    await safePath(directory);
    const protectedRoots = [NodePath.resolve(paths(env).home), paths(env).root, u.root];
    if (
      protectedRoots.includes(directory) ||
      directory.startsWith(NodePath.join(paths(env).root, "components") + NodePath.sep) ||
      directory.startsWith(u.root + NodePath.sep)
    )
      throw failure(
        "ownership",
        "Choose a verified release bundle or portable kit, not an installed or maintenance directory.",
      );
    const baseline = await fingerprint(env),
      inspected = await inspectCandidate(candidate.kind, directory, expected, config, env, deps);
    const id = candidate.kind + "-" + expected,
      target = NodePath.join(u.candidates, id);
    await safePath(u.candidates);
    await NodeFSP.mkdir(u.candidates, { mode: 0o700, recursive: true });
    const temporary = NodePath.join(u.candidates, ".stage-" + NodeCrypto.randomUUID());
    try {
      await NodeFSP.cp(directory, temporary, { recursive: true, verbatimSymlinks: true });
      await inspectCandidate(candidate.kind, temporary, expected, config, env, deps);
      await inspectCandidate(candidate.kind, directory, expected, config, env, deps);
      if (!same(baseline, await fingerprint(env)))
        throw failure(
          "changed",
          "Installed configuration or ownership changed while staging. Reload and review again.",
        );
      await sealCandidate(temporary);
      try {
        await NodeFSP.access(target);
        await inspectCandidate(candidate.kind, target, expected, config, env, deps);
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
        await NodeFSP.rename(temporary, target);
      }
      const release = await (deps.releaseStatus ?? releaseStatus)({ env });
      const saved = {
        format: "loom-os-maintenance",
        version: 1,
        id,
        kind: candidate.kind,
        sha256: expected,
        profile: config.profile,
        phase: "staged",
        ...inspected,
        baseline,
        rollbackSha256: release.active?.sha256 ?? null,
        attempts: 0,
        updatedAt: clock(deps),
      };
      saved.reviewHash = reviewHash(saved);
      await atomicJSON(u.journal, saved);
      return publicJournal(saved);
    } finally {
      await NodeFSP.rm(temporary, { recursive: true, force: true });
    }
  });
}
async function reviewed(expected, env) {
  if (!isHash(expected))
    throw failure(
      "review",
      "Confirm the exact staged candidate SHA256 before applying or recovering it.",
    );
  const saved = await journal(env);
  if (!saved || saved.reviewHash !== expected)
    throw failure(
      "changed",
      "The staged candidate changed after review. Review maintenance again.",
    );
  return saved;
}
async function verifyInstalled(saved, config, env, deps) {
  const release = await (deps.releaseStatus ?? releaseStatus)({ env });
  if (
    !release.active?.verified ||
    !release.active.matchesInstalled ||
    release.active.sha256 !== saved.pack.sha256 ||
    release.pending
  )
    throw failure(
      "verification",
      "Installed integration does not match the staged candidate. Recover the exact update.",
    );
  const current = await fingerprint(env);
  const wanted = saved.kind === "kit" ? saved.expectedConfig : saved.baseline.config;
  if (current.config !== wanted)
    throw failure(
      "changed",
      "Configuration changed during installation. Preserve it and review recovery.",
    );
  if (saved.kind === "kit") {
    const owner = await installedRecipe(env);
    if (owner.state?.phase !== "complete" || owner.state.sha256 !== saved.sha256)
      throw failure(
        "verification",
        "Commissioning has not completed the staged recipe. Recover the exact kit.",
      );
  }
  const compatibility = await (deps.compatibility ?? collectCompatibility)(config, env);
  if (compatibility.errors)
    throw failure(
      "verification",
      "Native compatibility verification failed. Review recovery before continuing.",
    );
  return release;
}
async function assertRecoveryOwners(saved, current, env) {
  const p = paths(env),
    record = await readJSON(NodePath.join(p.state, "loom-os/pack-release.json"));
  if (current.release !== saved.baseline.release) {
    const exactCandidate =
      record?.version === 1 &&
      record.active?.sha256 === saved.pack.sha256 &&
      record.active.version === saved.pack.version &&
      record.previous?.sha256 === saved.rollbackSha256;
    if (!exactCandidate)
      throw failure(
        "changed",
        "The release owner changed outside this update. Preserve its current release and review recovery again.",
      );
  }
  const pending = await readJSON(NodePath.join(p.state, "loom-os/pack-pending.json"));
  if (
    pending &&
    (pending.version !== 1 ||
      pending.next?.sha256 !== saved.pack.sha256 ||
      pending.next.version !== saved.pack.version ||
      ![saved.rollbackSha256, saved.pack.sha256].includes(pending.previous?.sha256))
  )
    throw failure(
      "changed",
      "An unrelated pending release owner operation exists. Preserve it and recover through that owner.",
    );
  if (saved.kind === "pack") {
    if (
      current.commission !== saved.baseline.commission ||
      current.recipe !== saved.baseline.recipe
    )
      throw failure(
        "changed",
        "Commissioning changed outside this update. Preserve the current owner setup and review recovery again.",
      );
  } else if (current.commission !== saved.baseline.commission) {
    const owner = await installedRecipe(env),
      expectedKit = NodePath.join(updatePaths(env).candidates, saved.id);
    if (
      owner.state?.sha256 !== saved.sha256 ||
      owner.state.profile !== saved.profile ||
      owner.state.name !== saved.name ||
      owner.state.kit !== expectedKit
    )
      throw failure(
        "changed",
        "The commissioning owner changed outside this update. Preserve it and review recovery again.",
      );
  }
}

async function runApply(expected, config, env, deps, recovery) {
  return withOperation(env, async (u) => {
    const saved = await reviewed(expected, env);
    if (saved.phase === "discarded")
      throw failure("state", "This candidate was discarded. Stage it again before applying.");
    if (!recovery && !["staged", "complete"].includes(saved.phase))
      throw failure(
        "recovery",
        "This update was interrupted or failed. Recover the exact reviewed candidate.",
      );
    config = await configFromDisk(env, config);
    if (config.profile !== saved.profile)
      throw failure(
        "profile",
        "The machine profile changed after staging. Preserve the update and review commissioning.",
      );
    if (saved.phase === "complete") {
      await verifyInstalled(saved, config, env, deps);
      return publicJournal(saved);
    }
    const directory = NodePath.join(u.candidates, saved.id);
    const current = await fingerprint(env);
    if (saved.phase === "staged") {
      if (!same(current, saved.baseline))
        throw failure(
          "changed",
          "Installed configuration or release changed after staging. Discard and review a fresh candidate.",
        );
    } else if (
      ![saved.baseline.config, saved.expectedConfig].filter(Boolean).includes(current.config)
    )
      throw failure(
        "changed",
        "Configuration changed outside this update. Preserve it and review recovery.",
      );
    if (recovery && saved.phase !== "staged") await assertRecoveryOwners(saved, current, env);
    const inspected = await inspectCandidate(
      saved.kind,
      directory,
      saved.sha256,
      config,
      env,
      deps,
      { resume: saved.phase !== "staged", receipt: saved },
    );
    // A crash after the owner completed needs verification, not a second installation.
    if (recovery && saved.phase !== "staged") {
      try {
        await verifyInstalled(saved, config, env, deps);
        saved.phase = "complete";
        saved.updatedAt = clock(deps);
        saved.verifiedAt = saved.updatedAt;
        delete saved.failure;
        await atomicJSON(u.journal, saved);
        return publicJournal(saved);
      } catch (error) {
        if (!["verification"].includes(error.code)) throw error;
      }
    }
    if (
      [
        "pack",
        "name",
        "changedComponents",
        "components",
        "expectedConfig",
        "activationPending",
      ].some((key) => !same(inspected[key], saved[key]))
    )
      throw failure(
        "changed",
        "Candidate identities or displayed component plan changed after review.",
      );
    await assertOwningWork(saved, config, env, deps);
    if (!same(current, await fingerprint(env)))
      throw failure(
        "changed",
        "Installed ownership changed while checking active work. Reload and review again.",
      );
    if (saved.attempts >= 100)
      throw failure(
        "state",
        "This update reached its retry limit. Preserve its journal for review.",
      );
    try {
      saved.phase = recovery ? "recovering" : "applying";
      saved.attempts++;
      saved.updatedAt = clock(deps);
      delete saved.failure;
      await atomicJSON(u.journal, saved);
      await deps.afterPhase?.(saved.phase);
      if (saved.kind === "pack")
        await (deps.activateRelease ?? activateRelease)(directory, saved.sha256, { env });
      else
        await (deps.applyCommission ?? applyCommission)(directory, {
          env,
          expected: saved.sha256,
          profile: saved.profile,
          ...deps,
        });
      saved.phase = "verifying";
      saved.updatedAt = clock(deps);
      await atomicJSON(u.journal, saved);
      await deps.afterPhase?.(saved.phase);
      const updatedConfig = await configFromDisk(env);
      await verifyInstalled(saved, updatedConfig, env, deps);
      saved.phase = "complete";
      saved.updatedAt = clock(deps);
      saved.verifiedAt = saved.updatedAt;
      await atomicJSON(u.journal, saved);
      return publicJournal(saved);
    } catch (error) {
      saved.phase = "failed";
      saved.updatedAt = clock(deps);
      saved.failure =
        "Installation stopped. The exact candidate and owner recovery records are retained; recover this reviewed update before selecting another.";
      await atomicJSON(u.journal, saved);
      throw error;
    }
  });
}

/** Owner installers remain authoritative; applying never runs a generic T3 or system update. */
export async function applyMaintenance(expected, config, env = process.env, deps = {}) {
  return runApply(expected, config, env, deps, false);
}
export async function recoverMaintenance(action, expected, config, env = process.env, deps = {}) {
  if (action === "retry") {
    const saved = await reviewed(expected, env);
    return saved.recoveryAction === "rollback"
      ? recoverMaintenance("rollback", expected, config, env, deps)
      : runApply(expected, config, env, deps, true);
  }
  if (action === "discard")
    return withOperation(env, async (u) => {
      const saved = await reviewed(expected, env);
      if (saved.phase !== "staged" || saved.attempts !== 0)
        throw failure(
          "recovery",
          "Only an unapplied staged update can be discarded. Recover installed changes through their owners.",
        );
      saved.phase = "discarded";
      saved.updatedAt = clock(deps);
      await atomicJSON(u.journal, saved);
      await NodeFSP.rm(NodePath.join(u.candidates, saved.id), { recursive: true, force: true });
      return publicJournal(saved);
    });
  if (action === "rollback")
    return withOperation(env, async (u) => {
      const saved = await reviewed(expected, env);
      if (
        saved.kind !== "pack" ||
        (saved.phase !== "complete" && saved.recoveryAction !== "rollback")
      )
        throw failure(
          "recovery",
          "Pack rollback is available after completed activation. Partial updates resume the exact candidate; kits use commissioning recovery.",
        );
      config = await configFromDisk(env, config);
      if ((await fingerprint(env)).config !== saved.baseline.config)
        throw failure(
          "changed",
          "Configuration changed after review. Preserve it and review rollback through its owner.",
        );
      const release = await (deps.releaseStatus ?? releaseStatus)({ env });
      const alreadyRestored =
        release.active?.sha256 === saved.rollbackSha256 &&
        release.active.matchesInstalled &&
        !release.pending;
      if (
        !alreadyRestored &&
        (release.active?.sha256 !== saved.pack.sha256 ||
          !release.previous?.verified ||
          release.previous.sha256 !== saved.rollbackSha256)
      )
        throw failure(
          "changed",
          "Installed or retained rollback identities changed. Review their owner status.",
        );
      try {
        saved.phase = "recovering";
        saved.recoveryAction = "rollback";
        saved.updatedAt = clock(deps);
        delete saved.failure;
        await atomicJSON(u.journal, saved);
        await deps.afterPhase?.("recovering");
        if (!alreadyRestored)
          await (deps.rollbackRelease ?? rollbackRelease)({
            env,
            expectedSha256: saved.rollbackSha256,
          });
        const restored = await (deps.releaseStatus ?? releaseStatus)({ env });
        if (
          !restored.active?.matchesInstalled ||
          restored.active.sha256 !== saved.rollbackSha256 ||
          restored.pending
        )
          throw failure(
            "verification",
            "Pack rollback did not verify. Review the release owner's recovery status.",
          );
        saved.phase = "discarded";
        saved.updatedAt = clock(deps);
        await atomicJSON(u.journal, saved);
        return publicJournal(saved);
      } catch (error) {
        saved.phase = "failed";
        saved.failure =
          "Pack rollback stopped. Recover this exact review receipt to finish its existing owner operation.";
        saved.updatedAt = clock(deps);
        await atomicJSON(u.journal, saved);
        throw error;
      }
    });
  throw failure("review", "Choose retry, rollback or discard for an exact reviewed update.");
}
export async function verifyMaintenance(config, env = process.env, deps = {}) {
  config = await configFromDisk(env, config);
  const saved = await journal(env);
  if (!saved || saved.phase !== "complete")
    throw failure("state", "Complete or recover the staged update before verifying it.");
  await verifyInstalled(saved, config, env, deps);
  return { ...publicJournal(saved), verified: true };
}
function boundedWork(report) {
  if (
    !object(report) ||
    !Array.isArray(report.sources) ||
    !Array.isArray(report.rows) ||
    report.sources.length > 50 ||
    report.rows.length > 1000
  )
    throw failure("protocol", "Invalid bounded owner metadata.");
  const sources = report.sources.slice(0, 50).map((source) => ({
    id: isId(source.id) ? source.id : "unknown",
    owner: ["loom", "office", "atlas"].includes(source.owner) ? source.owner : "unknown",
    state: ["connected", "disconnected", "unavailable"].includes(source.state)
      ? source.state
      : "unavailable",
    ...(Number.isSafeInteger(source.count) && source.count >= 0 ? { count: source.count } : {}),
    ...(source.jobs &&
    ["queued", "running", "retry", "dead"].every(
      (name) => Number.isSafeInteger(source.jobs[name]) && source.jobs[name] >= 0,
    )
      ? {
          jobs: Object.fromEntries(
            ["queued", "running", "retry", "dead"].map((name) => [name, source.jobs[name]]),
          ),
        }
      : {}),
    truncated: Boolean(source.truncated),
  }));
  return {
    sources,
    visibleRunning: report.rows.filter((row) => row.state === "running").length,
    visibleWaiting: report.rows.filter((row) => row.state === "waiting").length,
    truncated: Boolean(report.truncated),
    detail:
      "Owner-filtered metadata is informational. It cannot prove all work idle or authorize an update.",
  };
}
async function runningServer(config, env, deps) {
  if (!config.serverExecutable) return { state: "not-configured", pid: null };
  try {
    const result = await (deps.command ?? connectionCommand)(
      "systemctl",
      ["--user", "show", "t3code.service", "-p", "ActiveState", "-p", "MainPID"],
      env,
    );
    const state = /^ActiveState=(active|inactive|failed|activating|deactivating)$/m.exec(
        result.stdout,
      )?.[1],
      pid = Number(/^MainPID=(\d+)$/m.exec(result.stdout)?.[1]);
    if (result.exit !== 0 || !state || !Number.isSafeInteger(pid) || pid < 0)
      return { state: "unknown", pid: null };
    return {
      state,
      pid: pid || null,
      detail:
        "Observed existing service. A pinned recipe version does not identify this running process's release.",
    };
  } catch {
    return { state: "unknown", pid: null };
  }
}

async function publicMetadata(address, deps) {
  const response = await (deps.request ?? fetch)(address, {
    method: "GET",
    headers: { Accept: "application/json", "Cache-Control": "no-cache" },
    credentials: "omit",
    redirect: "manual",
    signal: AbortSignal.timeout(4000),
  });
  if (
    !response.ok ||
    !/^application\/json(?:;|$)/i.test(response.headers.get("content-type") ?? "") ||
    Number(response.headers.get("content-length")) > 4096
  ) {
    await response.body?.cancel();
    throw failure(
      [404, 410].includes(response.status) ? "unsupported" : "unavailable",
      "Current owner release metadata is unavailable.",
    );
  }
  const reader = response.body?.getReader(),
    chunks = [];
  let size = 0;
  if (!reader) throw failure("protocol", "Missing owner metadata body.");
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > 4096) throw failure("protocol", "Owner release metadata exceeds its bound.");
      chunks.push(part.value);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
async function appReleaseMetadata(config, deps) {
  return Promise.all(
    ["office", "atlas"]
      .filter((owner) => config[owner + "Url"])
      .map(async (owner) => {
        try {
          const value = await publicMetadata(
            config[owner + "Url"] + "/app/install-version.json",
            deps,
          );
          if (
            !object(value) ||
            Object.keys(value).length !== 1 ||
            !/^[a-f0-9]{20}$/.test(value.version ?? "")
          )
            throw Error("Invalid app release identity.");
          return {
            owner,
            state: "current",
            version: value.version,
            channel: "unknown",
            detail:
              "Current app-owned release identity. Personal data, rollout policy and backups stay with the app.",
          };
        } catch (error) {
          return {
            owner,
            state: error.code === "unsupported" ? "unsupported" : "unavailable",
            channel: "unknown",
          };
        }
      }),
  );
}
async function releaseIdentities(config, env, deps) {
  const loom = async () => {
    if (!config.serverExecutable) return { state: "not-configured", channel: "unknown" };
    try {
      const value = await (deps.loomRequest ?? environmentRequest)(
        config,
        env,
        "/.well-known/t3/environment",
        deps,
      );
      if (!isId(value?.serverVersion)) throw Error("Unknown Loom server identity.");
      return {
        state: "current",
        serverVersion: value.serverVersion,
        channel: "unknown",
        detail:
          "Anonymous identity from the running local Loom environment, separate from pinned kit components.",
      };
    } catch {
      return { state: "unavailable", channel: "unknown" };
    }
  };
  const switchboard = async () => {
    const address = config.switchboardDashboardUrl ?? config.switchboardStatusUrl;
    if (!address)
      return { state: "not-configured", channel: "unknown", inferenceActivity: "unknown" };
    try {
      const value = await publicMetadata(new URL(address).origin + "/api/v1/health", deps);
      if (
        !object(value) ||
        value.version !== 1 ||
        value.service !== "switchboard" ||
        !isId(value.controllerVersion) ||
        typeof value.stale !== "boolean"
      )
        throw Error("Unknown Switchboard controller identity.");
      return {
        state: value.stale ? "stale" : "current",
        controllerVersion: value.controllerVersion,
        channel: "unknown",
        inferenceActivity: "unknown",
        detail:
          "Cached controller health only. Provider inference streams and gateway release identity remain with Switchboard's own installer.",
      };
    } catch {
      return { state: "unavailable", channel: "unknown", inferenceActivity: "unknown" };
    }
  };
  const omarchy = async () => {
    try {
      const root = env.OMARCHY_PATH || "/usr/share/omarchy";
      const content = await bytes(NodePath.join(root, "version"), 256);
      const version = content?.toString("utf8").trim();
      if (!isId(version)) throw Error("Unknown Omarchy version.");
      let channel = "unknown";
      const helper = NodePath.join(root, "bin/omarchy-channel-current");
      try {
        // Omarchy's stock helper only reads package/mirror state. It does not switch channels or fetch updates.
        if (await bytes(helper, 16 * 1024)) {
          await NodeFSP.access(helper, NodeFSP.constants.X_OK);
          const result = await (deps.command ?? connectionCommand)(helper, [], env);
          const observed = result.stdout.trim();
          if (result.exit === 0 && ["stable", "rc", "edge", "dev", "unknown"].includes(observed))
            channel = observed;
        }
      } catch {
        /* Missing/unsupported owner metadata remains unknown. */
      }
      return { state: "current", version, channel };
    } catch {
      return { state: "unavailable", channel: "unknown" };
    }
  };
  const values = await Promise.all([loom(), switchboard(), omarchy()]);
  return Object.fromEntries(
    ["loom", "switchboard", "omarchy"].map((name, index) => [name, values[index]]),
  );
}

/** Status omits prompts, titles, outputs, credential material and personal job history. */
export async function maintenanceReport(config, env = process.env, deps = {}) {
  config = await configFromDisk(env, config);
  const results = await Promise.allSettled([
    (deps.releaseStatus ?? releaseStatus)({ env }),
    installedRecipe(env),
    journal(env),
    (deps.work ?? collectControlDesk)(config, env, deps),
    runningServer(config, env, deps),
    (deps.compatibility ?? collectCompatibility)(config, env),
    appReleaseMetadata(config, deps),
    releaseIdentities(config, env, deps),
  ]);
  const value = (index, fallback) =>
    results[index].status === "fulfilled" ? results[index].value : fallback;
  const installed = value(1, null);
  return {
    version: 1,
    checkedAt: clock(deps),
    readOnly: true,
    profile: config.profile,
    release: value(0, { state: "unavailable" }),
    commissioned: installed?.recipe
      ? {
          state: installed.state.phase === "complete" ? "complete" : "interrupted",
          sha256: installed.state.sha256,
          name: installed.recipe.name,
          profile: installed.state.profile,
          pack: installed.recipe.pack,
          components: Object.entries(activeRecipeComponents(installed.recipe, config.profile)).map(
            ([name, component]) => ({ name, version: component.version, pinned: true }),
          ),
        }
      : installed?.snapshotPending
        ? {
            state: "interrupted",
            sha256: installed.state.sha256,
            name: installed.state.name,
            profile: installed.state.profile,
            phase: installed.state.phase,
            components: [],
            targetPack: installed.pendingRecipe.pack,
            detail:
              "Commissioning stopped during components before its recipe snapshot was published. Recover the exact reviewed staged kit; installed state remains with its owner.",
          }
        : { state: "unavailable" },
    update: publicJournal(value(2, null)),
    ownerMetadata:
      results[3].status === "fulfilled"
        ? boundedWork(results[3].value)
        : {
            sources: [],
            state: "unavailable",
            detail: "Current owner metadata is unavailable. No work was changed.",
          },
    runningServer: value(4, { state: "unknown", pid: null }),
    compatibility: value(5, { errors: null, checks: [] }),
    apps: value(6, []),
    identities: value(7, {}),
    attention: results
      .map((result, index) =>
        result.status === "rejected"
          ? [
              "release",
              "commission",
              "journal",
              "owner-metadata",
              "running-server",
              "compatibility",
              "app-releases",
              "release-identities",
            ][index]
          : null,
      )
      .filter(Boolean),
    boundaries,
  };
}

/** Incoming owner inboxes precede retained recovery candidates so bounded native pickers can always offer new releases. */
export async function maintenanceCandidates(env = process.env) {
  const p = paths(env),
    result = [];
  for (const [kind, root] of [
    ["pack", NodePath.join(p.root, "maintenance/inbox/packs")],
    ["kit", NodePath.join(p.root, "maintenance/inbox/kits")],
    ["pack", NodePath.join(p.root, "pack-releases")],
    ["kit", NodePath.join(p.root, "recovery-kits")],
  ]) {
    await safePath(root);
    const names = await NodeFSP.readdir(root).catch((error) => {
      if (error.code === "ENOENT") return [];
      throw error;
    });
    for (const name of names.toSorted().toReversed().slice(0, 50)) {
      if (!isId(name)) continue;
      const directory = NodePath.join(root, name);
      try {
        await safePath(directory);
        const file = NodePath.join(directory, kind === "pack" ? "release.json" : "recipe.json"),
          content = await bytes(file, 2 * 1024 * 1024);
        if (!content) continue;
        const sha256 = hash(content);
        const verified =
          kind === "pack"
            ? await verifyRelease(directory, sha256)
            : (await verifyKit(directory, sha256)).recipe;
        result.push({
          kind,
          directory,
          sha256,
          version: kind === "pack" ? verified.version : verified.pack.version,
          ...(kind === "kit" ? { profile: verified.profile, name: verified.name } : {}),
        });
      } catch {
        /* Damaged or foreign records are never offered as updates. */
      }
    }
  }
  return result;
}
export function formatMaintenanceReport(report) {
  return [
    `LoomOS updates (${report.profile})`,
    `Installed pack: ${report.release.active?.version ?? "unavailable"}${report.release.active?.matchesInstalled ? ", verified" : ", needs review"}`,
    `Commissioned setup: ${report.commissioned.state}`,
    ...(report.commissioned.detail ? [report.commissioned.detail] : []),
    ...(report.commissioned.components ?? []).map(
      (component) => `${component.name}: pinned ${component.version}`,
    ),
    `Running Loom service: ${report.runningServer.state}${report.runningServer.pid ? ` (PID ${report.runningServer.pid})` : ""}`,
    `Staged update: ${report.update ? `${report.update.pack.version}, ${report.update.phase}` : "none"}`,
    ...(report.update
      ? [
          `Payload SHA256: ${report.update.sha256}`,
          `Review receipt: ${report.update.reviewHash}`,
          ...(report.update.activationPending
            ? [
                "Server activation remains with its existing owner; the pinned server is not claimed running.",
              ]
            : []),
        ]
      : []),
    `Visible owner work: ${report.ownerMetadata.visibleRunning ?? "unknown"} running, ${report.ownerMetadata.visibleWaiting ?? "unknown"} waiting`,
    ...report.boundaries,
    ...(report.attention.length ? [`Needs review: ${report.attention.join(", ")}`] : []),
  ].join("\n");
}
export async function main(args = process.argv.slice(2), env = process.env, deps = {}) {
  const [action = "status", ...rest] = args,
    config = await configFromDisk(env);
  if (
    action === "status" &&
    (!rest.length || (rest.length === 1 && ["--human", "--json"].includes(rest[0])))
  ) {
    const report = await maintenanceReport(config, env, deps);
    return rest[0] === "--human" ? formatMaintenanceReport(report) : report;
  }
  if (action === "stage" && rest.length === 3)
    return stageMaintenance(
      { kind: rest[0], directory: rest[1], expected: rest[2] },
      config,
      env,
      deps,
    );
  if (action === "apply" && rest.length === 1) return applyMaintenance(rest[0], config, env, deps);
  if (action === "verify" && !rest.length) return verifyMaintenance(config, env, deps);
  if (action === "recover" && rest.length === 1)
    return recoverMaintenance("retry", rest[0], config, env, deps);
  if (action === "rollback" && rest.length === 1)
    return recoverMaintenance("rollback", rest[0], config, env, deps);
  if (action === "discard" && rest.length === 1)
    return recoverMaintenance("discard", rest[0], config, env, deps);
  throw Error(
    "Usage: loom-os updates status [--human|--json] | stage pack|kit DIRECTORY SHA256 | apply REVIEW_SHA256 | verify | recover REVIEW_SHA256 | rollback REVIEW_SHA256 | discard REVIEW_SHA256",
  );
}
if (process.argv[1] && NodePath.resolve(process.argv[1]) === NodeURL.fileURLToPath(import.meta.url))
  main()
    .then((value) => {
      if (value !== undefined)
        console.log(typeof value === "string" ? value : JSON.stringify(value, null, 2));
    })
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
