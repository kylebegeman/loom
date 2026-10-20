import { expect, it } from "@effect/vitest";
import {
  acceptSyntheticIntent,
  decodeSyntheticImage,
  prepareSyntheticRecovery,
  reconcileSyntheticRecovery,
  simulateSyntheticWrite,
} from "./MigrationRecovery.testkit.ts";

const url = (path = "team/repo.git") => ({
  kind: "ssh",
  syntax: "scp-relative",
  user: "git",
  host: "code.invalid",
  port: 22,
  path,
});
const fixtureInput = () => ({
  mode: "synthetic-only",
  snapshotId: "synthetic-snapshot",
  sourceBinding: "synthetic-source-and-item-versions",
  selectedIndex: 1,
  route: {
    routeId: "synthetic-route",
    itemId: "synthetic-replacement",
    itemVersion: 3,
    operation: "ssh-repository-read",
  },
  image: {
    mode: "synthetic-only",
    identity: {
      environment: "synthetic-environment",
      project: "synthetic-project",
      worktree: "synthetic-worktree",
      gitDirectory: "synthetic-git-directory",
      gitFile: "synthetic-git-file",
      manifestFile: "synthetic-manifest-file",
    },
    git: {
      revision: 5,
      remote: "origin",
      fetch: [url("team/first.git"), url(), url(), url("team/last.git")],
      unrelated: ["synthetic-unrelated-entry", "synthetic-another-entry"],
    },
    manifest: { revision: 8, value: null },
  },
});
const controls = { now: 100, ledgerAvailable: true, authorized: true };
const evidence = {
  sourceBinding: "synthetic-source-and-item-versions",
  original: { id: "synthetic-original-receipt", validUntil: 200 },
  replacement: { id: "synthetic-replacement-receipt", validUntil: 300 },
};
const fixture = (input: unknown = fixtureInput()) => {
  const record = prepareSyntheticRecovery(input);
  const image = decodeSyntheticImage(fixtureInput().image);
  const apply = {
    direction: "apply" as const,
    operationId: "synthetic-apply",
    actor: "synthetic-actor",
    expectedRevision: 0,
    evidence,
  };
  return { ...record, image, apply };
};
const applied = () => {
  const f = fixture();
  const intent = acceptSyntheticIntent(f.proof, f.journal, f.image, f.apply, controls);
  const manifestOnly = simulateSyntheticWrite(f.proof, intent, f.image, controls);
  const image = simulateSyntheticWrite(f.proof, intent, manifestOnly, controls);
  const journal = reconcileSyntheticRecovery(f.proof, intent, image, controls).journal;
  return { ...f, intent, manifestOnly, image, journal };
};
const rollingBack = () => {
  const f = applied();
  const rollback = {
    ...f.apply,
    direction: "rollback" as const,
    operationId: "synthetic-rollback",
    expectedRevision: f.journal.revision,
  };
  const journal = acceptSyntheticIntent(f.proof, f.journal, f.image, rollback, controls);
  return { ...f, journal, rollback };
};

it("captures only the bounded fetch vector and route references, preserving duplicate order and syntax", () => {
  const f = fixture();
  expect(f.proof.snapshot.before.fetch).toEqual(f.image.git.fetch);
  expect(f.proof.snapshot.after.fetch?.map((value) => value.kind)).toEqual([
    "ssh",
    "synthetic-route-token",
    "ssh",
    "ssh",
  ]);
  expect(f.proof.snapshot.before.manifest).toBeNull();
  expect(JSON.stringify(f.proof)).not.toContain("synthetic-unrelated-entry");
  expect(f.proof.snapshot.guards.git.before).not.toEqual(f.proof.snapshot.guards.git.after);
  expect(f.gates).toEqual({
    captureEngine: "unimplemented",
    canCutover: false,
    canRollback: false,
    configurationWrites: false,
  });
});

it("recovers each apply interruption without replaying a completed resource write", () => {
  const f = fixture();
  const intent = acceptSyntheticIntent(f.proof, f.journal, f.image, f.apply, controls);
  expect(reconcileSyntheticRecovery(f.proof, intent, f.image, controls).next).toBe("manifest");
  const manifestOnly = simulateSyntheticWrite(f.proof, intent, f.image, controls);
  const resumed = reconcileSyntheticRecovery(
    f.proof,
    structuredClone(intent),
    structuredClone(manifestOnly),
    controls,
  );
  expect(resumed.next).toBe("git");
  expect(resumed.journal).toEqual(intent);
  const both = simulateSyntheticWrite(f.proof, resumed.journal, manifestOnly, controls);
  const final = reconcileSyntheticRecovery(f.proof, intent, both, controls);
  expect(final.journal.phase).toBe("applied");
  expect(final.next).toBeNull();
  expect(both.manifest.revision).toBe(f.image.manifest.revision + 1);
  expect(both.git.revision).toBe(f.image.git.revision + 1);
  expect(reconcileSyntheticRecovery(f.proof, final.journal, both, controls).journal).toEqual(
    final.journal,
  );
  expect(() => simulateSyntheticWrite(f.proof, final.journal, both, controls)).toThrow();
});

it("rolls back in inverse order, restoring the exact fetch vector and manifest absence", () => {
  const f = rollingBack();
  expect(reconcileSyntheticRecovery(f.proof, f.journal, f.image, controls).next).toBe("git");
  const gitRestored = simulateSyntheticWrite(f.proof, f.journal, f.image, controls);
  expect(gitRestored.git.fetch).toEqual(f.proof.snapshot.before.fetch);
  expect(gitRestored.manifest.value).toEqual(f.image.manifest.value);
  const resumed = reconcileSyntheticRecovery(f.proof, f.journal, gitRestored, controls);
  expect(resumed.next).toBe("manifest");
  const restored = simulateSyntheticWrite(f.proof, resumed.journal, gitRestored, controls);
  const final = reconcileSyntheticRecovery(f.proof, resumed.journal, restored, controls);
  expect(final.journal.phase).toBe("rolled-back");
  expect(restored.git.fetch).toEqual(f.proof.snapshot.before.fetch);
  expect(restored.manifest.value).toBeNull();
  expect(restored.git.unrelated).toEqual(fixtureInput().image.git.unrelated);
  expect(() => simulateSyntheticWrite(f.proof, final.journal, restored, controls)).toThrow();
});

it("restores an absent fetch key rather than creating a present empty or default value", () => {
  const input = fixtureInput();
  const image = decodeSyntheticImage({ ...input.image, git: { ...input.image.git, fetch: null } });
  const f = fixture({ ...input, image, selectedIndex: 0 });
  let journal = acceptSyntheticIntent(f.proof, f.journal, image, f.apply, controls);
  const manifestOnly = simulateSyntheticWrite(f.proof, journal, image, controls);
  const both = simulateSyntheticWrite(f.proof, journal, manifestOnly, controls);
  journal = reconcileSyntheticRecovery(f.proof, journal, both, controls).journal;
  journal = acceptSyntheticIntent(
    f.proof,
    journal,
    both,
    {
      ...f.apply,
      direction: "rollback",
      operationId: "synthetic-rollback",
      expectedRevision: journal.revision,
    },
    controls,
  );
  const first = simulateSyntheticWrite(f.proof, journal, both, controls);
  const restored = simulateSyntheticWrite(f.proof, journal, first, controls);
  expect(restored.git.fetch).toBeNull();
  expect(reconcileSyntheticRecovery(f.proof, journal, restored, controls).journal.phase).toBe(
    "rolled-back",
  );
});

it.each(["scp-relative", "scp-absolute", "ssh-url"] as const)(
  "preserves %s URL semantics in the inverse",
  (syntax) => {
    const input = fixtureInput();
    const value = {
      ...url(),
      syntax,
      path: syntax === "scp-relative" ? "team/repo.git" : "/team/repo.git",
      port: syntax === "ssh-url" ? 2222 : 22,
    };
    const f = fixture({
      ...input,
      selectedIndex: 0,
      image: { ...input.image, git: { ...input.image.git, fetch: [value] } },
    });
    expect(f.proof.snapshot.before.fetch).toEqual([value]);
  },
);

it("does not create an intent for indistinguishable no-op images", () => {
  const input = fixtureInput();
  const image = decodeSyntheticImage({
    ...input.image,
    git: {
      ...input.image.git,
      fetch: [{ kind: "synthetic-route-token", routeId: input.route.routeId }],
    },
    manifest: { ...input.image.manifest, value: input.route },
  });
  const f = fixture({ ...input, image, selectedIndex: 0 });
  expect(() => acceptSyntheticIntent(f.proof, f.journal, image, f.apply, controls)).toThrow();
  expect(reconcileSyntheticRecovery(f.proof, f.journal, image, controls).next).toBeNull();
});

it("skips an unchanged manifest without manufacturing extra writes or revisions", () => {
  const input = fixtureInput();
  const image = decodeSyntheticImage({
    ...input.image,
    manifest: { ...input.image.manifest, value: input.route },
  });
  const f = fixture({ ...input, image });
  const journal = acceptSyntheticIntent(f.proof, f.journal, image, f.apply, controls);
  expect(reconcileSyntheticRecovery(f.proof, journal, image, controls).next).toBe("git");
  const changed = simulateSyntheticWrite(f.proof, journal, image, controls);
  const appliedJournal = reconcileSyntheticRecovery(f.proof, journal, changed, controls).journal;
  expect(appliedJournal.phase).toBe("applied");
  const rollback = acceptSyntheticIntent(
    f.proof,
    appliedJournal,
    changed,
    {
      ...f.apply,
      direction: "rollback",
      operationId: "synthetic-rollback",
      expectedRevision: appliedJournal.revision,
    },
    controls,
  );
  const restored = simulateSyntheticWrite(f.proof, rollback, changed, controls);
  expect(reconcileSyntheticRecovery(f.proof, rollback, restored, controls).journal.phase).toBe(
    "rolled-back",
  );
  expect(restored.manifest).toEqual(image.manifest);
});

it("skips an unchanged Git image when only its managed manifest changes", () => {
  const input = fixtureInput();
  const image = decodeSyntheticImage({
    ...input.image,
    git: {
      ...input.image.git,
      fetch: [{ kind: "synthetic-route-token", routeId: input.route.routeId }],
    },
  });
  const f = fixture({ ...input, image, selectedIndex: 0 });
  const journal = acceptSyntheticIntent(f.proof, f.journal, image, f.apply, controls);
  const changed = simulateSyntheticWrite(f.proof, journal, image, controls);
  const done = reconcileSyntheticRecovery(f.proof, journal, changed, controls).journal;
  expect(done.phase).toBe("applied");
  const rollback = acceptSyntheticIntent(
    f.proof,
    done,
    changed,
    {
      ...f.apply,
      direction: "rollback",
      operationId: "synthetic-rollback",
      expectedRevision: done.revision,
    },
    controls,
  );
  expect(reconcileSyntheticRecovery(f.proof, rollback, changed, controls).next).toBe("manifest");
  const restored = simulateSyntheticWrite(f.proof, rollback, changed, controls);
  expect(reconcileSyntheticRecovery(f.proof, rollback, restored, controls).journal.phase).toBe(
    "rolled-back",
  );
  expect(restored.git).toEqual(image.git);
});

it("requires durable intent, the current journal revision, actor and operation binding", () => {
  const f = fixture();
  expect(() => simulateSyntheticWrite(f.proof, f.journal, f.image, controls)).toThrow();
  expect(() =>
    acceptSyntheticIntent(
      f.proof,
      f.journal,
      f.image,
      { ...f.apply, expectedRevision: 1 },
      controls,
    ),
  ).toThrow();
  const accepted = acceptSyntheticIntent(f.proof, f.journal, f.image, f.apply, controls);
  expect(acceptSyntheticIntent(f.proof, accepted, f.image, f.apply, controls)).toEqual(accepted);
  for (const patch of [
    { actor: "synthetic-other-actor" },
    { direction: "rollback" as const },
    {
      evidence: {
        ...evidence,
        original: { ...evidence.original, id: "synthetic-different-receipt" },
      },
    },
  ])
    expect(() =>
      acceptSyntheticIntent(f.proof, accepted, f.image, { ...f.apply, ...patch }, controls),
    ).toThrow();
});

it.each([{ ledgerAvailable: false }, { authorized: false }, { now: 200 }, { now: Number.NaN }])(
  "blocks intent and every simulated step with unavailable prerequisites %j",
  (patch) => {
    const f = fixture(),
      restricted = { ...controls, ...patch };
    expect(() => acceptSyntheticIntent(f.proof, f.journal, f.image, f.apply, restricted)).toThrow();
    const journal = acceptSyntheticIntent(f.proof, f.journal, f.image, f.apply, controls);
    expect(() => simulateSyntheticWrite(f.proof, journal, f.image, restricted)).toThrow();
    const manifestOnly = simulateSyntheticWrite(f.proof, journal, f.image, controls);
    expect(() => simulateSyntheticWrite(f.proof, journal, manifestOnly, restricted)).toThrow();
  },
);

it("requires separately bound original and replacement evidence and the exact source", () => {
  const f = fixture();
  for (const proof of [
    { ...evidence, sourceBinding: "synthetic-changed-source" },
    { ...evidence, replacement: evidence.original },
    { ...evidence, original: { ...evidence.original, validUntil: 100 } },
    { ...evidence, replacement: { ...evidence.replacement, validUntil: 100 } },
  ])
    expect(() =>
      acceptSyntheticIntent(f.proof, f.journal, f.image, { ...f.apply, evidence: proof }, controls),
    ).toThrow();
});

it("can explain a completed interrupted write after expiry without authorizing another write", () => {
  const f = applied();
  const result = reconcileSyntheticRecovery(f.proof, f.intent, f.image, { ...controls, now: 200 });
  expect(result.observedPhase).toBe("applied");
  expect(result.blocked).toBe("evidence-expired");
  expect(result.next).toBeNull();
  expect(() =>
    acceptSyntheticIntent(
      f.proof,
      result.journal,
      f.image,
      {
        ...f.apply,
        direction: "rollback",
        operationId: "synthetic-rollback",
        expectedRevision: result.journal.revision,
      },
      { ...controls, now: 200 },
    ),
  ).toThrow();
});

it("does not record observed completion when the ledger is unavailable", () => {
  const f = applied();
  const result = reconcileSyntheticRecovery(f.proof, f.intent, f.image, {
    ...controls,
    ledgerAvailable: false,
  });
  expect(result.observedPhase).toBe("applied");
  expect(result.journal).toEqual(f.intent);
  expect(result.blocked).toBe("ledger-unavailable");
  expect(reconcileSyntheticRecovery(f.proof, result.journal, f.image, controls).journal.phase).toBe(
    "applied",
  );
});

it("records unavailable observation as unknown and never automatically resumes from it", () => {
  const f = fixture();
  const intent = acceptSyntheticIntent(f.proof, f.journal, f.image, f.apply, controls);
  const result = reconcileSyntheticRecovery(f.proof, intent, null, controls);
  expect(result.journal.phase).toBe("unknown");
  expect(result.next).toBeNull();
  expect(reconcileSyntheticRecovery(f.proof, result.journal, f.image, controls).journal.phase).toBe(
    "unknown",
  );
  expect(() => simulateSyntheticWrite(f.proof, result.journal, f.image, controls)).toThrow();
});

it.each(["environment", "project", "worktree", "gitDirectory", "gitFile", "manifestFile"] as const)(
  "blocks changed %s identity, even with matching content",
  (field) => {
    const f = applied();
    const changed = {
      ...f.image,
      identity: { ...f.image.identity, [field]: "synthetic-different-identity" },
    };
    const result = reconcileSyntheticRecovery(f.proof, f.journal, changed, controls);
    expect(result.journal.phase).toBe("conflict");
    expect(result.next).toBeNull();
  },
);

it.each(["git", "manifest"] as const)(
  "detects an ABA revision on %s and refuses to restore over it",
  (resource) => {
    const f = rollingBack();
    const changed = {
      ...f.image,
      [resource]: { ...f.image[resource], revision: f.image[resource].revision + 2 },
    };
    const result = reconcileSyntheticRecovery(f.proof, f.journal, changed, controls);
    expect(result.journal.phase).toBe("conflict");
    expect(result.next).toBeNull();
  },
);

it("preserves the preimage and intent through conflicts, even if original-looking data returns", () => {
  const f = applied();
  const changed = { ...f.image, git: { ...f.image.git, unrelated: ["synthetic-external-edit"] } };
  const result = reconcileSyntheticRecovery(f.proof, f.journal, changed, controls);
  expect(result.journal.phase).toBe("conflict");
  expect(result.journal.intent).toEqual(f.journal.intent);
  expect(f.proof.snapshot.before.fetch).toEqual(fixtureInput().image.git.fetch);
  expect(reconcileSyntheticRecovery(f.proof, result.journal, f.image, controls).journal.phase).toBe(
    "conflict",
  );
});

it("loses a competing synthetic CAS without overwriting either participant's evidence", () => {
  const first = fixture();
  const input = fixtureInput();
  const second = fixture({
    ...input,
    snapshotId: "synthetic-second-snapshot",
    route: { ...input.route, routeId: "synthetic-competing-route" },
  });
  const intent1 = acceptSyntheticIntent(
    first.proof,
    first.journal,
    first.image,
    first.apply,
    controls,
  );
  const intent2 = acceptSyntheticIntent(
    second.proof,
    second.journal,
    first.image,
    { ...second.apply, operationId: "synthetic-competing-operation" },
    controls,
  );
  const winner = simulateSyntheticWrite(first.proof, intent1, first.image, controls);
  expect(() => simulateSyntheticWrite(second.proof, intent2, winner, controls)).toThrow();
  expect(reconcileSyntheticRecovery(second.proof, intent2, winner, controls).journal.phase).toBe(
    "conflict",
  );
  expect(reconcileSyntheticRecovery(first.proof, intent1, winner, controls).next).toBe("git");
  expect(second.proof.snapshot.before).toEqual(first.proof.snapshot.before);
});

it("rejects snapshot or journal corruption and cross-snapshot journal substitution", () => {
  const f = fixture();
  expect(() =>
    reconcileSyntheticRecovery(f.proof, { ...f.journal, phase: "applying" }, f.image, controls),
  ).toThrow();
  expect(() =>
    reconcileSyntheticRecovery(f.proof, { ...f.journal, revision: 1 }, f.image, controls),
  ).toThrow();
  expect(() =>
    reconcileSyntheticRecovery(
      { ...f.proof, snapshot: { ...f.proof.snapshot, selectedIndex: 0 } },
      f.journal,
      f.image,
      controls,
    ),
  ).toThrow();
  expect(() =>
    reconcileSyntheticRecovery(
      f.proof,
      { ...f.journal, digest: "0".repeat(64) },
      f.image,
      controls,
    ),
  ).toThrow();
});

it("exhausts every two-resource interruption/conflict combination in all journal phases", () => {
  const f = rollingBack();
  const gitRestored = simulateSyntheticWrite(f.proof, f.journal, f.image, controls);
  const restored = simulateSyntheticWrite(f.proof, f.journal, gitRestored, controls);
  const original = decodeSyntheticImage(fixtureInput().image);
  const journals = {
    captured: fixture().journal,
    applying: f.intent,
    applied: applied().journal,
    "rolling-back": f.journal,
    "rolled-back": reconcileSyntheticRecovery(f.proof, f.journal, restored, controls).journal,
  };
  const phases = ["captured", "applying", "applied", "rolling-back", "rolled-back"] as const;
  const states = ["before", "after", "restored", "conflict"] as const;
  const allowed: Record<(typeof phases)[number], readonly string[]> = {
    captured: ["before/before"],
    applying: ["before/before", "after/before", "after/after"],
    applied: ["after/after"],
    "rolling-back": ["after/after", "after/restored", "restored/restored"],
    "rolled-back": ["restored/restored"],
  };
  for (const phase of phases)
    for (const manifest of states)
      for (const git of states) {
        const source = {
          before: original,
          after: f.image,
          restored,
          conflict: {
            ...f.image,
            git: { ...f.image.git, revision: 900 },
            manifest: { ...f.image.manifest, revision: 900 },
          },
        };
        const observation = {
          ...original,
          manifest: source[manifest].manifest,
          git: source[git].git,
        };
        const journal = journals[phase];
        const result = reconcileSyntheticRecovery(f.proof, journal, observation, controls);
        const valid = allowed[phase].includes(`${manifest}/${git}`);
        expect(result.journal.phase === "conflict", `${phase}: ${manifest}/${git}`).toBe(!valid);
        if (!valid) expect(result.next).toBeNull();
      }
});

it("rejects out-of-scope, ambiguous, credential-bearing and oversized capture data without truncating", () => {
  const input = fixtureInput();
  const invalid: unknown[] = [
    { ...input, mode: "host" },
    { ...input, privateKey: "synthetic-private-material" },
    { ...input, selectedIndex: 7 },
    { ...input, image: { ...input.image, globalSsh: "synthetic-private-material" } },
    { ...input, image: { ...input.image, git: { ...input.image.git, fetch: [] } } },
    {
      ...input,
      image: {
        ...input.image,
        git: { ...input.image.git, fetch: Array.from({ length: 9 }, () => url()) },
      },
    },
    {
      ...input,
      image: {
        ...input.image,
        manifest: {
          ...input.image.manifest,
          value: { ...input.route, token: "synthetic-private-material" },
        },
      },
    },
    { ...input, route: { ...input.route, operation: "github-repository-api" } },
    {
      ...input,
      image: {
        ...input.image,
        git: { ...input.image.git, unrelated: Array.from({ length: 17 }, () => "synthetic-token") },
      },
    },
  ];
  for (const value of [
    { ...url(), host: "github.com" },
    { ...url(), privateKey: "synthetic-private-material" },
    { ...url(), path: "../repo.git" },
    { ...url(), path: "team/repo.git?token=synthetic-secret" },
    { ...url(), path: "/team/repo.git" },
    { ...url(), user: "git:synthetic-password" },
    { ...url(), path: "a".repeat(257) + ".git" },
    { ...url(), syntax: "ssh-url" },
    { ...url(), syntax: "scp-absolute", path: "/team/repo.git", port: 2222 },
  ])
    invalid.push({
      ...input,
      image: { ...input.image, git: { ...input.image.git, fetch: [value] } },
      selectedIndex: 0,
    });
  for (const request of invalid) expect(() => prepareSyntheticRecovery(request)).toThrow();
});

it("accepts the declared field/vector limits without losing entries and rejects revision exhaustion", () => {
  const input = fixtureInput();
  const f = fixture({
    ...input,
    selectedIndex: 7,
    image: {
      ...input.image,
      git: {
        ...input.image.git,
        fetch: Array.from({ length: 8 }, () => url()),
        unrelated: Array.from({ length: 16 }, () => "synthetic-token"),
      },
    },
  });
  expect(f.proof.snapshot.before.fetch).toHaveLength(8);
  expect(f.proof.snapshot.after.fetch).toHaveLength(8);
  expect(() =>
    prepareSyntheticRecovery({
      ...input,
      image: { ...input.image, git: { ...input.image.git, revision: 999_999 } },
    }),
  ).toThrow();
});

it("restarts from JSON-only artifacts after an unacknowledged write", () => {
  const f = fixture();
  const intent = acceptSyntheticIntent(f.proof, f.journal, f.image, f.apply, controls);
  const manifestOnly = simulateSyntheticWrite(f.proof, intent, f.image, controls);
  const restart = <T>(value: T): T => JSON.parse(JSON.stringify(value));
  const saved = restart({ proof: f.proof, journal: intent, image: manifestOnly });
  expect(reconcileSyntheticRecovery(saved.proof, saved.journal, saved.image, controls).next).toBe(
    "git",
  );
  const done = simulateSyntheticWrite(saved.proof, saved.journal, saved.image, controls);
  expect(reconcileSyntheticRecovery(saved.proof, saved.journal, done, controls).journal.phase).toBe(
    "applied",
  );
});

it("requires a new explicit rollback intent and fresh receipts after the apply evidence expires", () => {
  const f = applied();
  const refreshed = {
    sourceBinding: evidence.sourceBinding,
    original: { id: "synthetic-refreshed-original", validUntil: 500 },
    replacement: { id: "synthetic-refreshed-replacement", validUntil: 500 },
  };
  const journal = acceptSyntheticIntent(
    f.proof,
    f.journal,
    f.image,
    {
      ...f.apply,
      direction: "rollback",
      operationId: "synthetic-fresh-rollback",
      evidence: refreshed,
      expectedRevision: f.journal.revision,
    },
    { ...controls, now: 201 },
  );
  expect(journal.intent?.evidence).toEqual(refreshed);
  expect(
    reconcileSyntheticRecovery(f.proof, journal, f.image, { ...controls, now: 201 }).next,
  ).toBe("git");
});

it("rejects ambiguous observations without returning a simulated mutation", () => {
  const f = fixture();
  const intent = acceptSyntheticIntent(f.proof, f.journal, f.image, f.apply, controls);
  const ambiguous = {
    ...f.image,
    manifest: { ...f.image.manifest, privateKey: "synthetic-private" },
  };
  expect(() => simulateSyntheticWrite(f.proof, intent, ambiguous, controls)).toThrow();
  expect(intent.phase).toBe("applying");
  expect(f.image.manifest.value).toBeNull();
});
