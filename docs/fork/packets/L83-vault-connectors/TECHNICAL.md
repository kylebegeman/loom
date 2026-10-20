# L83 technical design

## Implemented boundaries

`VaultGitHub` owns connection validation, metadata, local lifecycle and mediated use. RPC/MCP
handlers remain thin. `GitHubTransport` owns github.com API/JWT adaptation; `GitHubCli` owns
bounded process execution. Shared contracts and client-runtime commands use existing fork
registries. The backend is Kyle's selected OpenBao, through `VaultCore` service-connection
records. No personal key manager, ambient gh config or SSH agent is a credential fallback.

## Identity and storage

Schema version 1 stores provider, verified account, normalized repository allowlist and a
redacted App key or token inside the encrypted item. Replacements validate the existing GitHub
record, not just its generic item kind. Core CAS, actor-bound operations and lifecycle rules
apply. Safe list/info return no credential material; an unrelated service-connection is skipped.
Core administrator reveal/export remains available under its own explicit rights.

App credentials use RSA PEM, including GitHub's PKCS#1 downloads. Keys normalize in memory to
PKCS#8 for existing jose RS256 signing. The App JWT lasts under ten minutes with clock skew.
Installation identity/app ID and repository ownership are checked before token creation.
Saving probes every allowlisted repository. A use or API test issues an installation token
limited to its one repository. Scope exit attempts DELETE /installation/token; fixed safe
warnings report failure without exposing provider responses. Dedicated user tokens are never
revoked by that cleanup. API bodies, redirects, response size and time are bounded/classified.
No token refresh daemon or credential value is persisted in upstream events.

## Use and management authority

Human management requires environment access:read/access:write. Authenticated agent metadata
inspection additionally requires item inspect rights. Connection listing, testing and lifecycle
MCP operations are human-administrator only. Credential saving is private client RPC; no MCP
save tool accepts raw credentials. Use is agent-thread only and requires an active full-access/
default run, current item version/state, allowlisted repository and exact use destination
`https://github.com/owner/repo`. Before process spawn, recheck run/provider/project identity and
all current authority after token acquisition. Connection use is not an ambient terminal login.

The subprocess has a private temporary HOME and GH_CONFIG_DIR, explicit GH_TOKEN/GH_HOST and
an allowlisted environment. It inherits PATH for installed gh discovery but no ambient token,
SSH_AUTH_SOCK, Git configuration or personal HOME. Ordinary same-user process inspection is
outside this boundary; this is not full-access agent isolation.

## Operation and failure contract

Typed actions are repo-view, pr-list, issue-list, pr-view, issue-view, pr-checks, pr-comment,
issue-comment and issue-create. No arbitrary argv or shell expansion. Reads use bounded JSON
fields and list limits; writes take bounded title/body text. Max CLI output is 16 KiB, timeout
30 seconds and server concurrency four. stderr is discarded; the delivered token is scrubbed
from stdout. Scoped child/config cleanup also runs on failure. Nonzero exit codes remain
explicit results; callers must inspect exitCode. Timeout/failure after a write can mean the
remote operation completed. Inspect before retrying; no exactly-once provider claim is made.

## Surfaces and remaining integration

The `vault-github` capability gates web/desktop/native management. Shared protected commands
check the destination environment's grants and refresh mounted metadata after changes. CLI/MCP
call the same service. Common provider instructions expose the capability only through existing
tool availability. No adapter-specific model changes are required; command-only scheduled jobs
do not acquire it. Agent runs on any exposed provider can call the tool under the same policy.

Existing GitHubHostSetup, GitHubCredentials, persistent shell login, personal login and SSH
remote behavior remain outside this path. Project profiles bind the explicit connection/repository,
with portable declarations, current configuration/grant checks, version-pinned launch and named GH
execution. Profile archive and originating run identity are rechecked through token acquisition
and before spawn using the service guard. Profile use still inherits exact item use permission.
Command-scoped routing below is opt-in; persistent migration must remain a separately reviewed action.
OAuth/device flows, Enterprise, reusable connector registration, additional providers, provider
revocation management and broader operations remain full selected scope.

## GitHub terminal routing and readiness

Explicit `loom vault github-exec` / `loom_vault_github_exec` requests now run supported gh or
Git HTTPS argv on the Loom server with the chosen connection/version/repository. They require
an authenticated active full-access/default thread and its exact repository use grant. The
server infers the thread checkout, rechecks authority after token acquisition and before spawn,
scopes credentials/configuration to the child and releases the provider session afterward.
The CLI forwards stdout/stderr and the child exit status. Arbitrary shells, account login,
extensions, alternate repositories and executable transport overrides are rejected.

The `vault-github-terminal` capability also enables explicit, cancellable GitHub readiness in
web/desktop/native connection management, RPC and authenticated MCP/CLI. Checks separate API,
GH CLI and Git HTTPS reads. Selecting a thread adds current run/grant checks and identifies its
provider; host-only checks leave run access unchecked. Denied runs skip external probes. Results
expire after 60 seconds and clients visibly mark them stale. These are server-context results,
not proof of an independently configured provider terminal, external runner or future write.

Git uses an exact host/path credential helper, disables personal config sources and prompts,
and rejects repository configuration that can redirect authentication or launch custom
transports/filters. `origin` is a command-local shorthand for the selected HTTPS repository;
fetching it without refspecs updates `refs/remotes/origin/*`. Stored remotes are not migrated.
Both streams are bounded to 64 KiB combined and scrub the delivered token; execution times out
after 120 seconds. Process-group/config cleanup runs on completion, failure and cancellation.
Issued tokens and same-user/full-access processes remain outside an OS isolation guarantee.
