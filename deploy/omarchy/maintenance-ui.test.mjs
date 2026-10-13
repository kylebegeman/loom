import * as NodeTest from "node:test";
import * as NodeAssert from "node:assert/strict";
import { paths } from "./loom-os.mjs";
import {
  formatMaintenanceReview,
  formatMaintenanceSources,
  formatMaintenanceSummary,
  nativeMaintenance,
} from "./maintenance-ui.mjs";

const config = {
  profile: "workstation",
  officeUrl: "https://office.test",
  atlasUrl: "https://atlas.test",
  switchboardDashboardUrl: "https://switchboard.test",
};
const env = { HOME: "/owned-user" };
const sha256 = "a".repeat(64);
const reviewHash = "b".repeat(64);
const rollbackSha256 = "c".repeat(64);
const candidate = {
  kind: "pack",
  directory: "/owned-user/.local/share/loom-os/pack-releases/20261013.1",
  sha256,
  version: "20261013.1",
};
function update(changes = {}) {
  return {
    kind: "pack",
    sha256,
    reviewHash,
    rollbackSha256,
    profile: "workstation",
    phase: "staged",
    pack: { version: "20261013.1", sha256 },
    changedComponents: [],
    attempts: 0,
    updatedAt: "2026-10-13T12:00:00Z",
    activationPending: false,
    plan: {
      kind: "pack",
      profile: "workstation",
      pack: { version: "20261013.1", sha256 },
      changedComponents: [],
      activationPending: false,
    },
    ...changes,
  };
}
function status(staged = null, changes = {}) {
  return {
    version: 1,
    readOnly: true,
    profile: "workstation",
    release: {
      active: {
        version: "20261012.42",
        sha256: rollbackSha256,
        verified: true,
        matchesInstalled: true,
      },
      previous: { version: "20261012.41", sha256: rollbackSha256, verified: true },
    },
    commissioned: {
      state: "complete",
      components: [{ name: "loom", version: "0.0.45-loomos.20261011.5", pinned: true }],
    },
    update: staged,
    ownerMetadata: {
      sources: [{ id: "loom", owner: "loom", state: "connected", truncated: false }],
      visibleRunning: 0,
      visibleWaiting: 0,
      detail: "Visible metadata does not prove all work idle.",
    },
    runningServer: { state: "active", pid: 42 },
    compatibility: {
      errors: 0,
      checks: [{ id: "ownership", state: "ok", detail: "Owned files verified." }],
    },
    apps: [
      { owner: "office", state: "current", version: "1234567890abcdef1234", channel: "unknown" },
    ],
    attention: [],
    boundaries: ["Release ownership stays with each app."],
    ...changes,
  };
}
function fixture(actions, initial = status(), overrides = {}) {
  let current = initial;
  let clock = 0;
  const calls = [];
  const shown = [];
  const menus = [];
  const deps = {
    now: () => clock,
    report: async (currentConfig) => {
      NodeAssert.equal(currentConfig, undefined);
      calls.push({ type: "report" });
      return structuredClone(current);
    },
    candidates: async () => {
      calls.push({ type: "candidates" });
      return [candidate];
    },
    stage: async (selected, currentConfig) => {
      NodeAssert.equal(currentConfig, undefined);
      calls.push({ type: "stage", selected });
      current = status(update());
      return current.update;
    },
    apply: async (expected, currentConfig) => {
      NodeAssert.equal(currentConfig, undefined);
      calls.push({ type: "apply", expected });
      current = status(update({ phase: "complete", attempts: 1 }));
      return current.update;
    },
    recover: async (action, expected, currentConfig) => {
      NodeAssert.equal(currentConfig, undefined);
      calls.push({ type: "recover", action, expected });
      const phase =
        action === "retry" && current.update.recoveryAction !== "rollback"
          ? "complete"
          : "discarded";
      current = status(update({ ...current.update, phase, attempts: 1 }));
      return current.update;
    },
    verify: async () => {
      calls.push({ type: "verify" });
      return { ...current.update, verified: true };
    },
    command: async (file, args) => {
      calls.push({ type: "command", file, args });
      return { exit: 0, stdout: "" };
    },
    show: (value) => shown.push(value),
    choose: async (args) => {
      menus.push(args);
      const next = actions.shift();
      NodeAssert.notEqual(next, undefined, "The test must explicitly close every native screen.");
      return typeof next === "function" ? next(args) : next;
    },
    ...overrides,
  };
  return {
    deps,
    calls,
    shown,
    menus,
    get current() {
      return current;
    },
    setCurrent: (value) => {
      current = value;
    },
    setClock: (value) => {
      clock = value;
    },
  };
}
const firstCandidate = (args) => args.find((arg) => arg.startsWith("001  pack"));
const defaultChoice = (args) => args[args.indexOf("--") + 1];
const mutations = (calls) =>
  calls.filter((call) => ["stage", "apply", "recover", "verify", "command"].includes(call.type));

NodeTest.test(
  "opening the utility reads once and escaping starts no update, credential issue or work",
  async () => {
    const f = fixture([null]);
    NodeAssert.deepEqual(await nativeMaintenance(config, env, f.deps), { state: "closed" });
    NodeAssert.deepEqual(f.calls, [{ type: "report" }]);
    NodeAssert.ok(
      f.shown.some((line) => line.includes("Switchboard: cached controller unknown (unknown)")),
    );
  },
);

NodeTest.test(
  "manual refresh is cached for five seconds without a timer or automatic polling",
  async () => {
    const f = fixture([
      () => {
        f.setClock(4999);
        return "Refresh status";
      },
      () => {
        f.setClock(5000);
        return "Refresh status";
      },
      () => {
        f.setClock(5001);
        return "Refresh status";
      },
      "Done",
    ]);
    await nativeMaintenance(config, env, f.deps);
    NodeAssert.equal(f.calls.filter((call) => call.type === "report").length, 2);
    NodeAssert.deepEqual(mutations(f.calls), []);
    NodeAssert.equal(f.shown.filter((line) => line.startsWith("Refresh is limited")).length, 2);
  },
);

NodeTest.test(
  "candidate preview and default stage cancellation keep the installed state untouched",
  async () => {
    const f = fixture(["Browse verified local releases", firstCandidate, defaultChoice, "Done"]);
    await nativeMaintenance(config, env, f.deps);
    NodeAssert.deepEqual(mutations(f.calls), []);
    NodeAssert.equal(f.current.update, null);
    NodeAssert.ok(f.shown.some((line) => line.includes(`Candidate SHA256: ${sha256}`)));
  },
);

NodeTest.test(
  "explicit staging exposes the exact plan but the default apply choice preserves the stage",
  async () => {
    const f = fixture([
      "Browse verified local releases",
      firstCandidate,
      "Stage selected release",
      "Apply reviewed update",
      defaultChoice,
      "Done",
    ]);
    await nativeMaintenance(config, env, f.deps);
    NodeAssert.deepEqual(mutations(f.calls), [
      {
        type: "stage",
        selected: {
          kind: "pack",
          directory: candidate.directory,
          expected: sha256,
          profile: "workstation",
        },
      },
    ]);
    NodeAssert.equal(f.current.update.phase, "staged");
    NodeAssert.ok(
      f.shown.some(
        (line) =>
          line.includes(`Review SHA256: ${reviewHash}`) && line.includes("Exact owner plan"),
      ),
    );
  },
);

NodeTest.test(
  "explicit application uses the review digest and waits for authoritative installed completion",
  async () => {
    const f = fixture(["Apply reviewed update", "Apply reviewed update", "Done"], status(update()));
    await nativeMaintenance(config, env, f.deps);
    NodeAssert.deepEqual(mutations(f.calls), [{ type: "apply", expected: reviewHash }]);
    NodeAssert.equal(f.current.update.phase, "complete");
    NodeAssert.ok(
      f.shown.some((line) => line.startsWith("The owning installer confirmed completion")),
    );
  },
);

NodeTest.test(
  "a stale reviewed plan is rejected by its owner and never reported as installed",
  async () => {
    const f = fixture(
      [
        "Apply reviewed update",
        () => {
          f.setCurrent(status(update({ reviewHash: "d".repeat(64) })));
          return "Apply reviewed update";
        },
        "Done",
      ],
      status(update()),
      {
        apply: async (expected) => {
          NodeAssert.equal(expected, reviewHash);
          throw Error("The staged candidate changed after review. Review maintenance again.");
        },
      },
    );
    await nativeMaintenance(config, env, f.deps);
    NodeAssert.equal(f.current.update.phase, "staged");
    NodeAssert.equal(f.current.update.reviewHash, "d".repeat(64));
    NodeAssert.ok(f.shown.some((line) => line.includes("changed after review")));
    NodeAssert.ok(
      !f.shown.some((line) => line.startsWith("The owning installer confirmed completion")),
    );
  },
);

NodeTest.test(
  "interrupted application offers exact retry and never discards partial installed changes",
  async () => {
    const f = fixture(
      ["Retry interrupted update", "Retry interrupted update", "Done"],
      status(update({ phase: "failed", attempts: 1 })),
    );
    await nativeMaintenance(config, env, f.deps);
    NodeAssert.deepEqual(mutations(f.calls), [
      { type: "recover", action: "retry", expected: reviewHash },
    ]);
    NodeAssert.ok(!f.menus[0].includes("Discard unapplied update"));
    NodeAssert.equal(f.current.update.phase, "complete");
  },
);

NodeTest.test(
  "interrupted rollback retries its retained rollback identity and reports restored completion",
  async () => {
    const f = fixture(
      ["Retry interrupted update", "Retry interrupted update", "Done"],
      status(update({ phase: "failed", attempts: 1, recoveryAction: "rollback" })),
    );
    await nativeMaintenance(config, env, f.deps);
    NodeAssert.deepEqual(mutations(f.calls), [
      { type: "recover", action: "retry", expected: reviewHash },
    ]);
    NodeAssert.equal(f.current.update.phase, "discarded");
    NodeAssert.ok(
      f.shown.some((line) =>
        line.startsWith("The release owner confirmed the exact retained integration"),
      ),
    );
    NodeAssert.ok(!f.shown.some((line) => line.includes("did not confirm")));
  },
);

NodeTest.test(
  "rollback defaults to keeping current and only confirms a verified exact retained release",
  async () => {
    const f = fixture(
      [
        "Roll back reviewed integration",
        defaultChoice,
        "Roll back reviewed integration",
        "Roll back reviewed integration",
        "Done",
      ],
      status(update({ phase: "complete", attempts: 1 })),
    );
    await nativeMaintenance(config, env, f.deps);
    NodeAssert.deepEqual(mutations(f.calls), [
      { type: "recover", action: "rollback", expected: reviewHash },
    ]);
    NodeAssert.ok(
      f.shown.some((line) => line.includes(`Retained rollback SHA256: ${rollbackSha256}`)),
    );
    NodeAssert.equal(f.current.update.phase, "discarded");
  },
);

NodeTest.test("unverified or changed rollback releases expose no rollback operation", async () => {
  for (const previous of [
    { verified: false, sha256: rollbackSha256 },
    { verified: true, sha256: "d".repeat(64) },
  ]) {
    const f = fixture(
      ["Done"],
      status(update({ phase: "complete", attempts: 1 }), { release: { previous } }),
    );
    await nativeMaintenance(config, env, f.deps);
    NodeAssert.ok(!f.menus[0].includes("Roll back reviewed integration"));
    NodeAssert.deepEqual(mutations(f.calls), []);
  }
});

NodeTest.test(
  "unapplied discard is a confirmed reverse action that keeps the current installation",
  async () => {
    const f = fixture(
      [
        "Discard unapplied update",
        null,
        "Discard unapplied update",
        "Discard unapplied update",
        "Done",
      ],
      status(update()),
    );
    await nativeMaintenance(config, env, f.deps);
    NodeAssert.deepEqual(mutations(f.calls), [
      { type: "recover", action: "discard", expected: reviewHash },
    ]);
    NodeAssert.equal(f.current.update.phase, "discarded");
  },
);

NodeTest.test(
  "read-only verification claims success only for an exact completed owner receipt",
  async () => {
    const before = status(update({ phase: "complete", attempts: 1 }));
    const f = fixture(["Verify installed update", "Done"], before);
    await nativeMaintenance(config, env, f.deps);
    NodeAssert.deepEqual(mutations(f.calls), [{ type: "verify" }]);
    NodeAssert.deepEqual(f.current, before);
    NodeAssert.ok(f.shown.some((line) => line.startsWith("The owning verifier confirmed")));
    const failed = fixture(["Verify installed update", "Done"], before, {
      verify: async () => ({ ...before.update, verified: false }),
    });
    await nativeMaintenance(config, env, failed.deps);
    NodeAssert.deepEqual(failed.current, before);
    NodeAssert.ok(!failed.shown.some((line) => line.startsWith("The owning verifier confirmed")));
  },
);

NodeTest.test(
  "offline owner handoffs open only the trusted app and stock menu without reload or deploy operations",
  async () => {
    const f = fixture(
      [
        "Open Office update owner",
        "Open Atlas update owner",
        "Open Switchboard update owner",
        "Open Loom update owner",
        "Open system maintenance menu",
        "Done",
      ],
      status(null, {
        ownerMetadata: {
          sources: [
            { id: "office", owner: "office", state: "disconnected" },
            { id: "atlas", owner: "atlas", state: "unavailable" },
          ],
          detail: "Owner metadata is unavailable.",
        },
        compatibility: { errors: null, checks: [] },
        apps: [{ owner: "office", state: "unavailable", channel: "unknown" }],
      }),
    );
    await nativeMaintenance(config, env, f.deps);
    NodeAssert.deepEqual(mutations(f.calls), [
      ...["office", "atlas", "switchboard", "loom"].map((app) => ({
        type: "command",
        file: paths(env).bin,
        args: ["open", app],
      })),
      { type: "command", file: "omarchy-menu", args: ["summon", "update"] },
    ]);
    NodeAssert.equal(f.calls.filter((call) => call.type === "report").length, 1);
    NodeAssert.ok(f.shown.some((line) => line.includes("partial or unavailable sources")));
    NodeAssert.ok(
      f.shown.some((line) =>
        line.includes("Native compatibility: unknown errors, unknown warnings"),
      ),
    );
  },
);

NodeTest.test(
  "no verified local candidate or profile mismatch starts no stage or installation",
  async () => {
    for (const candidates of [[], [{ ...candidate, kind: "kit", profile: "laptop" }]]) {
      const f = fixture(["Browse verified local releases", "Done"], status(), {
        candidates: async () => candidates,
      });
      await nativeMaintenance(config, env, f.deps);
      NodeAssert.deepEqual(mutations(f.calls), []);
      NodeAssert.ok(f.shown.some((line) => line.startsWith("No verified local release")));
    }
  },
);

NodeTest.test(
  "verified local browsing stays bounded and cancellation leaves all candidates retained",
  async () => {
    const candidates = Array.from({ length: 150 }, (_, index) => ({
      ...candidate,
      version: `20261013.${index}`,
    }));
    const f = fixture(["Browse verified local releases", "Back", "Done"], status(), {
      candidates: async () => candidates,
    });
    await nativeMaintenance(config, env, f.deps);
    NodeAssert.equal(f.menus[1].filter((arg) => /^\d{3}  pack/.test(arg)).length, 100);
    NodeAssert.deepEqual(mutations(f.calls), []);
  },
);

NodeTest.test(
  "malformed staging and application receipts preserve recovery visibility without success claims",
  async () => {
    const staged = fixture(
      ["Browse verified local releases", firstCandidate, "Stage selected release", "Done"],
      status(),
      {
        stage: async () => update({ sha256: "d".repeat(64) }),
      },
    );
    await nativeMaintenance(config, env, staged.deps);
    NodeAssert.ok(staged.shown.some((line) => line.includes("did not confirm this exact plan")));
    const applied = fixture(
      ["Apply reviewed update", "Apply reviewed update", "Done"],
      status(update()),
      {
        apply: async () => update({ phase: "applying" }),
      },
    );
    await nativeMaintenance(config, env, applied.deps);
    NodeAssert.ok(
      applied.shown.some((line) => line.includes("did not confirm this reviewed operation")),
    );
    NodeAssert.ok(
      !applied.shown.some((line) => line.startsWith("The owning installer confirmed completion")),
    );
  },
);

NodeTest.test(
  "unsupported owner choices and unreviewed journal states cannot invoke operations",
  async () => {
    const f = fixture(["Apply reviewed update"], status(update({ reviewHash: null })));
    await NodeAssert.rejects(nativeMaintenance(config, env, f.deps), /Choose a visible/);
    NodeAssert.deepEqual(mutations(f.calls), []);
    const noOffice = fixture(["Open Office update owner"]);
    await NodeAssert.rejects(
      nativeMaintenance({ profile: "laptop" }, env, noOffice.deps),
      /Choose a visible/,
    );
    NodeAssert.deepEqual(mutations(noOffice.calls), []);
  },
);

NodeTest.test(
  "review and source formatting preserve exact identities while sanitizing owner text",
  () => {
    NodeAssert.throws(
      () => formatMaintenanceReview(update({ reviewHash: null })),
      /no exact reviewed plan/,
    );
    const rendered = formatMaintenanceReview(update({ profile: "workstation\u001b[31m\nspoof" }));
    NodeAssert.equal(rendered.includes("\u001b"), false);
    NodeAssert.ok(rendered.includes(reviewHash) && rendered.includes(sha256));
    const sources = formatMaintenanceSources(
      status(null, { compatibility: { errors: 2, checks: [] } }),
    );
    NodeAssert.ok(sources.includes("Office hosted web: current (1234567890abcdef1234)"));
    NodeAssert.ok(sources.includes("Release channel: unknown"));
    NodeAssert.ok(sources.includes("Native compatibility: needs review"));
  },
);

NodeTest.test(
  "unavailable candidate sources remain explicit without an automatic probe loop",
  async () => {
    const f = fixture(
      ["Browse verified local releases", "Browse verified local releases", "Done"],
      status(),
      {
        candidates: async () => {
          throw Error("The local release source is unavailable. Preserve it for review.");
        },
      },
    );
    await nativeMaintenance(config, env, f.deps);
    NodeAssert.equal(f.calls.filter((call) => call.type === "report").length, 1);
    NodeAssert.deepEqual(mutations(f.calls), []);
    NodeAssert.equal(
      f.shown.filter((line) => line.includes("local release source is unavailable")).length,
      2,
    );
  },
);

NodeTest.test(
  "kit review exposes target version pins while keeping server activation with the running owner",
  () => {
    const pin = "d".repeat(64);
    const rendered = formatMaintenanceReview(
      update({
        kind: "kit",
        changedComponents: ["server"],
        activationPending: true,
        plan: {
          kind: "kit",
          profile: "workstation",
          pack: { version: "20261013.1", sha256 },
          changedComponents: ["server"],
          activationPending: true,
          components: [
            { name: "server", previousVersion: "custom-1", version: "custom-2", sha256: pin },
          ],
        },
      }),
    );
    NodeAssert.ok(rendered.includes(`server: custom-1 to custom-2; component pin SHA256 ${pin}`));
    NodeAssert.ok(
      rendered.includes("Activating it remains a separate action in its owning environment"),
    );
  },
);

NodeTest.test(
  "running, hosted and pinned identities remain distinct without an up-to-date claim",
  () => {
    const missing = formatMaintenanceSources(
      status(null, {
        commissioned: { state: "unavailable" },
        apps: [],
        identities: {},
      }),
    );
    NodeAssert.ok(missing.includes("Office CLI unknown"));
    NodeAssert.ok(
      missing.includes("Observed Loom server: unknown (unknown). Pinned server payload: unknown"),
    );
    NodeAssert.ok(missing.includes("Inference activity: unknown"));
    NodeAssert.ok(
      missing.includes("Installed Omarchy: unknown (unknown). Release channel: unknown"),
    );
    const different = formatMaintenanceSources(
      status(null, {
        commissioned: {
          state: "complete",
          components: [
            { name: "loom", version: "desktop-2" },
            { name: "office", version: "office-cli-1" },
            { name: "server", version: "server-2" },
            { name: "switchboard", version: "cli-3" },
          ],
        },
        identities: {
          loom: { state: "current", serverVersion: "server-1", channel: "unknown" },
          switchboard: {
            state: "stale",
            controllerVersion: "controller-4",
            channel: "unknown",
            inferenceActivity: "unknown",
          },
          omarchy: { state: "current", version: "4.0.4", channel: "stable" },
        },
      }),
    );
    NodeAssert.ok(different.includes("Loom desktop desktop-2; Office CLI office-cli-1"));
    NodeAssert.ok(
      different.includes(
        "Observed Loom server: current (server-1). Pinned server payload: server-2",
      ),
    );
    NodeAssert.ok(different.includes("Office hosted web: current (1234567890abcdef1234)"));
    NodeAssert.ok(
      different.includes("Switchboard controller: stale (controller-4), cached health only"),
    );
    NodeAssert.ok(different.includes("Gateway release: unknown. Inference activity: unknown"));
    NodeAssert.ok(
      different.includes("Installed Omarchy: current (4.0.4). Release channel: stable"),
    );
    for (const report of [missing, different]) {
      NodeAssert.doesNotMatch(report, /up.to.date|latest release|update available/i);
      NodeAssert.ok(report.includes("matching versions do not establish update availability"));
    }
  },
);

NodeTest.test(
  "detailed status uses the cached report and returns to the ordinary screen without reads or writes",
  async () => {
    const initial = status(update());
    const f = fixture(
      ["View detailed status", "Back", "View detailed status", null, "Done"],
      initial,
    );
    await nativeMaintenance(config, env, f.deps);
    NodeAssert.deepEqual(f.calls, [{ type: "report" }]);
    NodeAssert.deepEqual(f.current, initial);
    NodeAssert.equal(f.shown.filter((line) => line.startsWith("Updates and recovery")).length, 3);
    NodeAssert.equal(
      f.shown.filter((line) => line.includes(`Review receipt: ${reviewHash}`)).length,
      2,
    );
    NodeAssert.ok(f.shown.some((line) => line.includes("ownership: ok. Owned files verified.")));
  },
);

NodeTest.test(
  "ordinary summary keeps identities and partial scope without operation IDs, hashes or diagnostic dumps",
  () => {
    const report = status(update({ phase: "failed", attempts: 1 }), {
      commissioned: {
        state: "complete",
        components: [{ name: "server", version: "server-pinned" }],
      },
      ownerMetadata: {
        sources: [
          { owner: "office", id: "office.health.overview", state: "connected", truncated: true },
        ],
        visibleRunning: 2,
        visibleWaiting: 1,
        truncated: true,
      },
      compatibility: {
        errors: 1,
        warnings: 2,
        checks: [
          { id: "technical-parser-id", state: "error", detail: "Full technical diagnostic." },
        ],
      },
      identities: {
        loom: { state: "current", serverVersion: "server-running" },
        switchboard: {
          state: "stale",
          controllerVersion: "controller-observed",
          inferenceActivity: "unknown",
        },
        omarchy: { state: "current", version: "4.0.4", channel: "stable" },
      },
      apps: [
        { owner: "office", state: "current", version: "1234567890abcdef1234" },
        { owner: "atlas", state: "unavailable" },
      ],
    });
    const summary = formatMaintenanceSummary(report);
    NodeAssert.ok(summary.includes("Installed pack: 20261012.42 · workstation · verified"));
    NodeAssert.ok(summary.includes("Commissioned setup: complete"));
    NodeAssert.ok(
      summary.includes("Loom server: observed server-running (current); pinned server-pinned"),
    );
    NodeAssert.ok(
      summary.includes("cached controller controller-observed (stale); inference activity unknown"),
    );
    NodeAssert.ok(summary.includes("Office hosted web: 1234567890abcdef1234 (current)"));
    NodeAssert.ok(summary.includes("Atlas hosted web: unknown (unavailable)"));
    NodeAssert.ok(summary.includes("Omarchy 4.0.4 (current); channel stable"));
    NodeAssert.ok(summary.includes("2 running, 1 waiting; partial or unavailable sources"));
    NodeAssert.ok(summary.includes("Counts cannot prove all work idle"));
    NodeAssert.ok(summary.includes("1 errors, 2 warnings"));
    NodeAssert.ok(summary.includes("pack 20261013.1, failed"));
    NodeAssert.doesNotMatch(
      summary,
      /office.health.overview|technical-parser-id|Full technical diagnostic/,
    );
    NodeAssert.equal(summary.includes(sha256) || summary.includes(reviewHash), false);
    const unknown = formatMaintenanceSummary(
      status(null, {
        release: { active: { version: "20261012.42", matchesInstalled: true, verified: false } },
        commissioned: { state: "unavailable" },
        identities: {},
        apps: [],
        ownerMetadata: { sources: [], state: "unavailable" },
        compatibility: { errors: null, checks: [] },
      }),
    );
    NodeAssert.ok(unknown.includes("20261012.42 · workstation · needs review"));
    NodeAssert.ok(unknown.includes("unknown running, unknown waiting; unknown coverage"));
    NodeAssert.ok(unknown.includes("unknown errors, unknown warnings"));
    NodeAssert.doesNotMatch(unknown, /up.to.date|latest release|update available/i);
  },
);

NodeTest.test(
  "exact plan inspection waits for Back and keeps its review hash without new owner reads",
  async () => {
    const initial = status(update());
    const f = fixture(["Review exact staged plan", "Back", "Done"], initial);
    await nativeMaintenance(config, env, f.deps);
    NodeAssert.deepEqual(f.calls, [{ type: "report" }]);
    NodeAssert.deepEqual(f.current, initial);
    NodeAssert.ok(
      f.shown.some(
        (line) =>
          line.includes(`Review SHA256: ${reviewHash}`) &&
          line.includes(`Candidate SHA256: ${sha256}`),
      ),
    );
    NodeAssert.equal(f.shown.filter((line) => line.startsWith("Updates and recovery")).length, 2);
  },
);

NodeTest.test(
  "recovery coverage compares complete recipe and verified installed pack hashes without treating an interrupted target as installed",
  () => {
    const commissioned = {
      state: "complete",
      pack: { version: "20261012.43", sha256: rollbackSha256 },
      components: [],
    };
    const current = {
      active: { version: "20261012.45", sha256, verified: true, matchesInstalled: true },
    };
    const mismatch = formatMaintenanceSummary(status(null, { commissioned, release: current }));
    NodeAssert.ok(
      mismatch.includes("Recovery pin: 20261012.43; differs from installed integration"),
    );
    const matching = formatMaintenanceSummary(
      status(null, {
        commissioned,
        release: {
          active: {
            version: "20261012.43",
            sha256: rollbackSha256,
            verified: true,
            matchesInstalled: true,
          },
        },
      }),
    );
    NodeAssert.ok(matching.includes("Recovery pin: 20261012.43; matches installed integration"));
    for (const changes of [
      { commissioned, release: { active: { ...current.active, verified: false } } },
      { commissioned, release: { active: { ...current.active, matchesInstalled: false } } },
      { commissioned, release: { active: { ...current.active, sha256: undefined } } },
      { commissioned: { ...commissioned, pack: undefined }, release: current },
      {
        commissioned: {
          ...commissioned,
          state: "interrupted",
          pack: { version: "target-45", sha256 },
        },
        release: current,
      },
      { commissioned, release: { ...current, pending: { version: "target-46" } } },
    ]) {
      const unknown = formatMaintenanceSummary(status(null, changes));
      NodeAssert.ok(unknown.includes("coverage unknown"));
      NodeAssert.equal(
        unknown.includes("matches installed integration") ||
          unknown.includes("differs from installed integration"),
        false,
      );
      NodeAssert.equal(unknown.includes("Installed pack: target"), false);
    }
  },
);
