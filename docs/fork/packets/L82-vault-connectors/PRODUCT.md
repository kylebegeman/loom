# L82 product

## Summary

Manage GitHub and other developer service identities as tested, renewable connections.

## How it works

Use service-supported OAuth, app installations, tokens or service accounts. Store identity metadata and refresh material through Vault; supply API and Git credentials through the selected broker adapter. Record supported operations and repository reach instead of interpreting sign-in as universal access.

## User experience

Connect GitHub, review the account and permissions, select it for a project and test API plus Git access. Reconnect, replace, disconnect or request provider revocation with an explicit result.

## Why it improves the product

Fixes the split where pull requests work but fetch/push or another runner fails.

Complexity: **Large**. Impact: **High**.

## Entry points and reverse actions

The flows above must be reachable through the Vault workspace, their relevant project or
environment context and discoverable palette actions. CLI and agent access follow the
technical service boundary. Each mutable flow includes cancellation or an explicit irreversible
step, plus a way to inspect its current state. Narrow/mobile layouts retain task context and
restore focus when a dialog closes.

## States

Show loading, empty, ready, permission denied, unsupported, locked and disconnected states
where applicable. In-progress work is cancellable where the external operation permits it;
otherwise report the committed operation and reconcile its eventual result. Never show success
because a request was merely accepted. Use accessible labels and textual status, not color alone.

## Surfaces and connection modes

Web and desktop: management and inspection are required through the shared client runtime.
Mobile: the equivalent management/status flow is required, including private input and pending
requests when relevant. CLI and MCP call the same services, with narrower rights where needed.
Local, direct remote, Tailscale, relay and tunnel connections must address the selected execution
environment. An upstream or older server without the capability shows unavailable without
breaking its normal workflows. The proposed platform web surface uses the same authority and
never reads a remote environment's credentials from the browser's local machine.

## Dependencies and future opportunities

Uses shared storage, grants and delivery interfaces. Starts with GitHub; other connectors register independently and do not become compulsory dependencies. Unlocks registries, deployments and infrastructure providers.

## Decisions and open questions

Confirmed: Kyle selected this complete idea for implementation. The personal/development Vault
separation and self-hosting option are product requirements. Proposed behavior above remains
subject to design review; the following choices are not resolved by selection:

- D8: Local implementation starts with GitHub App installations and dedicated fine-grained tokens.
  OAuth/device onboarding, Enterprise hosts and account ownership/onboarding policy remain open.
- Which additional services are initial commitments versus later connector implementations?

Resolve relevant [shared gates](../LOOM-VAULT.md#design-decisions-before-building) as the implementation advances. Do not silently reduce the selected scope.

## Delivered local scope

Connect an App installation with App ID, installation ID and RSA PEM private key, or enter a
dedicated fine-grained token privately. Declare 1 to 32 github.com repositories. Loom verifies
identity and API access to each before saving. Review safe account/repository/version metadata,
replace credentials, test API access, disconnect locally with confirmation or restore. Cancel
and authentication-type switching clear private form values. No personal login fallback occurs.

For authenticated full-access/default agent runs, mediated GH supports repository/PR/issue
reads, PR checks, PR/issue comments and issue creation. Each call names the connection version,
repository and a typed operation. An exact `https://github.com/owner/repo` use grant is required.
An API test does not prove GH CLI installation or Git transport access. Unknown write outcomes
require inspection before retrying; Loom does not silently replay writes.

This milestone runs on the server, including when controlled remotely from a phone. It does
not export credentials into an ordinary terminal or sign into a personal account. Project profiles can explicitly bind connections and repositories
with reviewed defaults for new resolutions. Local disconnection
blocks future use; remote revocation and already issued credentials have separate lifetimes.
Human administrators retain the Vault core's explicit reveal/export powers. Full-access agents
and other same-user processes are not isolated by an OS security boundary.

GitHub project profiles now provide named selection, portable requirements, explicit launch
preflight and execution. See [L75 product](../L75-vault-profiles/PRODUCT.md) for the complete
binding, reverse-action and configuration-preview behavior.
