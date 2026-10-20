import type { BotDefinitionInput, BotStarterId } from "@t3tools/contracts/fork";

export interface BotStarter {
  readonly starterId: BotStarterId;
  /** Bump with any change below; existing copies then show a newer starter as available. */
  readonly revision: number;
  readonly definition: Omit<BotDefinitionInput, "modelSelection" | "scopeProjectId">;
}

const RESOLVER_INSTRUCTIONS = `Resolve the merge conflict in {{file}}. You are in the checkout that holds the conflict; work only there.

1. Read the conflict: \`git diff -- {{file}}\`, then the three sides: \`git show :1:{{file}}\` (merge base), \`git show :2:{{file}}\` (ours) and \`git show :3:{{file}}\` (theirs). Read enough of the surrounding code and recent history (\`git log --oneline -5 -- {{file}}\` on each side) to understand what each side meant.
2. Resolve every hunk so both sides' intent survives. When one side deleted or moved what the other changed, carry the change to its new home instead of dropping it.
3. If the repository has \`docs/fork/seams.tsv\`, this is a fork: keep every line marked \`fork:\` and the fork's side of each seam listed there for this file, and adapt it to the upstream change rather than reverting upstream.
4. Remove every conflict marker, then \`git add {{file}}\`. Do not commit, do not resolve other files, and do not change files beyond what this resolution needs.
5. Run the narrowest check that covers the file: its own test file, or a typecheck or lint of its package. Fix what your resolution broke.

Reply with one short paragraph per hunk: what each side did and what you kept. End with the check you ran and its result. If a hunk needs a decision only a person can make, leave the file conflicted, do not stage it, and say exactly what the decision is.`;

const REVIEWER_INSTRUCTIONS = `Review {{target}} through the {{lens}} lens. {{target}} is a path, branch, commit range or pull request number; read the change it names and enough surrounding code to judge it. Do not edit, stage or commit anything.

Lenses:
- correctness: bugs, broken contracts, unhandled failures, races, wrong edge cases, and tests that do not prove what they claim.
- surfaces: whether the change reaches every place it should. Walk the "Hit every surface" list in AGENTS.md when the repository has one: entry points, clients, providers, agents, contracts, reverse states, connection modes and docs.
- fidelity: whether the change does what its packet, issue or request asked, no more and no less. Find that request first and quote the parts that are missing or exceeded.

Report only findings you checked against the code. Order them by severity. For each give the path and line, what is wrong, and the smallest fix. If nothing survives checking, say so plainly.`;

const VERIFIER_INSTRUCTIONS = `Verify this claim about {{target}}:

{{claim}}

1. Restate the claim as one concrete check: a command, a test, or a precise reading of the code that decides it.
2. Run the smallest such check. Prefer an existing test or a short script over reading at length. Do not fix anything and do not widen the scope beyond the claim.
3. If the time runs short or the check cannot decide it, stop and answer "undetermined" with what would decide it.

Reply with the answer first (true, false or undetermined), then exactly what you ran and the evidence.`;

/** Seeded once per environment; Kyle edits them like any other bot. */
export const BOT_STARTERS: ReadonlyArray<BotStarter> = [
  {
    starterId: "merge-conflict-resolver",
    revision: 1,
    definition: {
      id: "merge-conflict-resolver",
      name: "Merge conflict resolver",
      description: "Resolves one conflicted file in the checkout that holds the conflict.",
      instructions: RESOLVER_INSTRUCTIONS,
      parameters: [
        {
          name: "file",
          label: "Conflicted file",
          description: "Path relative to the checkout root.",
          type: "string",
          required: true,
        },
      ],
      runtimeMode: "auto-accept-edits",
      interactionMode: "default",
      workspace: { type: "project", projectId: null, worktree: false, checkout: "caller" },
      timeoutMinutes: 20,
      maxConcurrentRuns: 4,
    },
  },
  {
    starterId: "reviewer",
    revision: 1,
    definition: {
      id: "reviewer",
      name: "Reviewer",
      description: "Reviews a change through one lens without editing anything.",
      instructions: REVIEWER_INSTRUCTIONS,
      parameters: [
        {
          name: "target",
          label: "What to review",
          description: "A path, branch, commit range or pull request number.",
          type: "string",
          required: true,
        },
        {
          name: "lens",
          label: "Lens",
          type: "choice",
          required: true,
          default: "correctness",
          choices: ["correctness", "surfaces", "fidelity"],
        },
      ],
      runtimeMode: "approval-required",
      interactionMode: "plan",
      workspace: { type: "project", projectId: null, worktree: false },
      timeoutMinutes: 15,
      maxConcurrentRuns: 4,
    },
  },
  {
    starterId: "verifier",
    revision: 1,
    definition: {
      id: "verifier",
      name: "Verifier",
      description: "Runs the smallest check that proves or disproves one claim.",
      instructions: VERIFIER_INSTRUCTIONS,
      parameters: [
        {
          name: "target",
          label: "What the claim is about",
          description: "A path, feature, branch or command.",
          type: "string",
          required: true,
        },
        { name: "claim", label: "Claim", type: "text", required: true },
      ],
      runtimeMode: "auto-accept-edits",
      interactionMode: "default",
      workspace: { type: "project", projectId: null, worktree: false },
      timeoutMinutes: 10,
      maxConcurrentRuns: 4,
    },
  },
];

export const starterById = (starterId: string): BotStarter | undefined =>
  BOT_STARTERS.find((starter) => starter.starterId === starterId);

const canonical = (value: unknown): unknown =>
  Array.isArray(value)
    ? value.map(canonical)
    : value !== null && typeof value === "object"
      ? Object.fromEntries(
          Object.entries(value)
            .filter(([, field]) => field !== undefined)
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([key, field]) => [key, canonical(field)]),
        )
      : value;

/** The fields a starter ships; model, scope, name and description are Kyle's to change freely. */
const shippedShape = (definition: BotStarter["definition"] | BotDefinitionInput) =>
  JSON.stringify(
    canonical({
      instructions: definition.instructions,
      parameters: definition.parameters,
      runtimeMode: definition.runtimeMode,
      interactionMode: definition.interactionMode,
      workspace: definition.workspace,
      timeoutMinutes: definition.timeoutMinutes,
      maxConcurrentRuns: definition.maxConcurrentRuns,
    }),
  );

export const differsFromStarter = (bot: BotDefinitionInput, starter: BotStarter) =>
  shippedShape(bot) !== shippedShape(starter.definition);
