# L101: Local Vault password tools

Status: **In progress.** First local personal-Vault build authorized by Kyle's 2026-10-21 request.

Generate a password on the current device without a Vault backend, automatic storage or a
credential handoff. This is the first useful slice of the [personal Vault](../LOOM-PERSONAL-VAULT.md),
whose full password-manager scope remains in the other packets.

## Scope

Shared generation policy, cryptographic platform sources, character classes, length and look-alike
controls; explicit generate/regenerate, hidden output, reveal/hide, copy and clear. Existing web
Utilities keeps using the same shared generator. Closing or backgrounding clears the generated
value from the view; the clipboard has its separate lifetime.

No encrypted personal storage, autofill, import, RPC or MCP secret output is introduced.

## Surfaces

Web and desktop: Loom Settings and the command palette; existing Utilities entry points remain.
Mobile: password tools in computer settings, available even without Vault support or a connection.
Local/direct/relay/tunnel modes do not affect generation. Upstream servers require no capability
because this tool never calls them. An unloaded app or inaccessible settings is not an independent
offline password-manager shell.

## Extension points used

Existing `ext-settings`, `ext-palette`, `ext-web-root` and fork-owned mobile settings composition.
The shared helper uses the existing client-runtime fork export. No new wire contract or generator
seam is needed. The related mobile authentication correction is recorded in [SEAMS](./SEAMS.md).

## Documents

[PRODUCT](./PRODUCT.md) · [TECHNICAL](./TECHNICAL.md) · [SEAMS](./SEAMS.md) ·
[IMPLEMENTATION](./IMPLEMENTATION.md) · [TESTING](./TESTING.md) · [REFERENCES](./REFERENCES.md)
