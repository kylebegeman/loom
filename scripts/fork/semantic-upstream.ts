// @effect-diagnostics nodeBuiltinImport:off
import * as NodeChildProcess from "node:child_process";
import * as NodeURL from "node:url";

const BOUNDARIES = [
  {
    id: "identity",
    match: /RepositoryIdentity|environment\/|PeerLinks|ProjectService|projectIdentity/i,
    owner: "Upstream environment/repository identity with Loom fork-origin validation",
    constraint:
      "Keep exact environment identity and validate the intended fork origin before matching a repository.",
    verify: "RepositoryIdentityResolver and RemoteDelegation wrong-fork tests",
  },
  {
    id: "placement",
    match:
      /ThreadLaunch|WorktreeMcp|NewConversation|ConversationPalette|ProjectLauncher|project-library|LibraryDelegation|RemoteDelegation/i,
    owner: "Library project/component/copy and upstream launch transport",
    constraint:
      "Preserve explicit host/branch/worktree choices and bind exact Library context before dispatch. Handoff must preserve metadata and cancellation semantics.",
    verify:
      "LibraryDelegation, WorktreeMcpService and library-launch-choice tests; conversation/fleet feature maps",
  },
  {
    id: "routes",
    match: /Tailscale|Reach|PeerForwarding|PeerRoutes|connection\/|relay\/|Tunnel|ServeMapping/i,
    owner: "Upstream peer routing alongside Loom Reach and owned-port protection",
    constraint:
      "Routes do not replace environment identity. Never overwrite another app's Serve mapping; preserve externally reachable OAuth/MCP routes.",
    verify:
      "PeerForwarding, Reach route middleware and Tailscale ownership tests; connection feature map",
  },
  {
    id: "permissions",
    match: /auth\/|oauth|McpInvocation|DispatchMode|PeerLinkRequests|Vault|rpcAuthorization/i,
    owner: "Destination-authoritative grants, link ceilings and Vault trust",
    constraint:
      "A peer must not widen runtime/interaction permissions or transfer credentials implicitly. Revalidate destination authorization and pinned identity.",
    verify: "RPC scope, link ceiling and destination Vault tests",
  },
  {
    id: "remote-tasks",
    match:
      /[+-].*(remoteChild|childThreadId|requestNamespace|clientRequestId)|RemoteDelegation|subagent|agent-receipts/i,
    owner: "Upstream task/restart protocol with Loom receipt consumers",
    constraint:
      "Task children can be local or remote. Preserve idempotent request IDs, cancellation, result following and environment-scoped links across restart.",
    verify:
      "RemoteDelegation, LibraryDelegation, agent-receipts and native ESM module-loading tests",
  },
  {
    id: "skills",
    match:
      /ProviderRegistry|ProviderInstance|Skills|SkillRegistry|skill-registry|[+-].*(skills\/list|skills\/config\/write|skillOverrides)/i,
    owner: "Provider-native discovery and enablement, Loom inventory/Sources/Lab",
    constraint:
      "Provider reports remain authoritative. Preserve real account homes, explicit invocation policy, complete directory installs and optimistic update/edit checks.",
    verify: "skill-registry service/native controls/source lifecycle tests; Skills feature map",
  },
] as const;
const git = (args: readonly string[]) =>
  NodeChildProcess.execFileSync("git", args, {
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  }).trim();
function commit(ref: string) {
  if (!ref || ref.startsWith("-") || /[\r\n\0]/.test(ref))
    throw new Error("Use a commit or tag ref, not a git option.");
  return git(["rev-parse", "--verify", `${ref}^{commit}`]);
}
export function semanticUpstream(fromRef: string, toRef: string) {
  const from = commit(fromRef),
    to = commit(toRef);
  const paths = git(["diff", "--name-only", from, to, "--"]).split("\n").filter(Boolean);
  const diff = git([
    "diff",
    "--unified=0",
    from,
    to,
    "--",
    ...paths.filter((path) => /\.(tsx?|json)$/.test(path)),
  ]);
  const topics = BOUNDARIES.flatMap((boundary) => {
    const touched = paths.filter((path) => boundary.match.test(path));
    let patchPath = "";
    for (const line of diff.split("\n")) {
      if (line.startsWith("+++ b/")) patchPath = line.slice(6);
      if (
        /^[+-][^+-]/.test(line) &&
        boundary.match.test(line) &&
        patchPath &&
        !touched.includes(patchPath)
      )
        touched.push(patchPath);
    }
    const symbols = [
      ...new Set(
        diff
          .split("\n")
          .filter((line) => /^[+-][^+-]/.test(line) && boundary.match.test(line))
          .map(
            (line) =>
              line.match(
                /remoteChild|childThreadId|requestNamespace|clientRequestId|skills\/list|skills\/config\/write|skillOverrides/,
              )?.[0],
          )
          .filter((value) => value !== undefined),
      ),
    ];
    if (touched.length === 0 && symbols.length === 0) return [];
    return [
      {
        id: boundary.id,
        owner: boundary.owner,
        status: "review-required",
        paths: touched,
        symbols,
        constraint: boundary.constraint,
        verify: boundary.verify,
      },
    ];
  });
  return {
    from,
    to,
    changedFiles: paths.length,
    commits: git(["log", "--format=%H%x09%s", `${from}..${to}`])
      .split("\n")
      .filter(Boolean),
    topics,
    decision:
      "Source review and behavior checks must resolve every touched boundary before integration. This report does not authorize or perform a merge.",
  };
}
if (process.argv[1] === NodeURL.fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2),
    from = args[args.indexOf("--from") + 1],
    to = args[args.indexOf("--to") + 1];
  if (!args.includes("--from") || !args.includes("--to") || !from || !to)
    throw new Error("Use --from <integrated ref> --to <candidate ref>.");
  process.stdout.write(JSON.stringify(semanticUpstream(from, to), null, 2) + "\n");
}
