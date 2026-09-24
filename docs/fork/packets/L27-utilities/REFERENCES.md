# L27 references

Treat external repositories as references, not code to copy.

## Old Loom

F4 in [selections.md](../../selections.md) (listed under "Not selected"; confirmed for this
packet on 2026-09-24). Old Loom (`bagelvault/loom` 0.13.10):

- https://github.com/bagelvault/loom/blob/a79ec506/packages/utilities/src/index.ts
  (913 lines, 30 tools, no runtime dependencies). Keep: the registry shape (id, label,
  category, description, example, run), the categories, most of the tool list. Adapt:
  hashing used `crypto.subtle` (breaks on plain-`http` remote origins) and a hand-written
  MD5; use `@noble/hashes` instead. Fix: `cron.describe` only echoed the five fields,
  `text.diff` compared line N to line N, `web.user-agent` was a few regexes,
  `randomString` used a biased `byte % length`, `bip39.mnemonic` was not real BIP39,
  `ulid.generate` was "ULID-like". Drop: BIP39, MIME table, the server copy.
- https://github.com/bagelvault/loom/blob/a79ec506/packages/utilities/src/index.test.ts
  (4 tests). This packet tests every tool.
- https://github.com/bagelvault/loom/blob/a79ec506/apps/web/src/components/code/UtilitiesSurface.tsx
  (160 lines: search, category dropdown, list, input and `key=value` options textarea,
  output, warnings). Adapt the list plus detail layout. Drop: the free-text options
  textarea (typed controls instead) and the server round trip.
- https://github.com/bagelvault/loom/blob/a79ec506/apps/web/src/components/code/UtilitiesSurface.logic.ts
  (69 lines) and `UtilitiesAskLayer.tsx` (75 lines, chat prompts). Drop.
- Old placement: a full-page area `utilities` at `/code/utilities`
  (https://github.com/bagelvault/loom/blob/a79ec506/packages/contracts/src/areas.ts, lines
  707-714), plus server RPC `utilities.list` / `utilities.run`
  (https://github.com/bagelvault/loom/blob/a79ec506/packages/contracts/src/utilities.ts), an
  MCP toolkit (`apps/server/src/mcp/toolkits/utilities/`) and a CLI
  (`apps/server/src/cli/util.ts`). All dropped; see TECHNICAL.md, Alternatives.

## Upstream T3 Code

- `apps/web/package.json` dependencies: `@noble/hashes` (catalog 1.8.0,
  `pnpm-workspace.yaml:42`), `jose`, `culori`, `@pierre/diffs`.
- `apps/web/src/openVsxThemes.ts:1`: `sha256` from `@noble/hashes/sha2`.
- `apps/web/src/themePalette.ts:4`: `converter`, `parse` from `culori/fn`.
- `apps/web/src/cloud/dpop.test.ts:4`: `decodeJwt` from `jose`.
- `apps/web/src/components/chat/MessagesTimeline.tsx`: `FileDiff` from `@pierre/diffs/react`;
  `MultiFileDiff` is exported from the same entry
  (`node_modules/@pierre/diffs/dist/react/MultiFileDiff.d.ts`).
- `apps/web/src/components/DiffWorkerPoolProvider.tsx`: the diff worker pool.
- `apps/web/src/components/CommandPalette.logic.ts:127-155,369-443`: item types, and root
  search not descending into submenus.
- `apps/web/src/components/ui/`: `dialog.tsx`, `textarea.tsx`, `select.tsx`, `switch.tsx`,
  `number-field.tsx`, `input.tsx`, `tooltip.tsx`.
- `apps/web/src/hooks/useCopyToClipboard.ts`.
- `apps/web/src/rightPanelStore.ts:160`: `closeSurface`.
- `apps/web/src/lib/storage.ts`: `resolveStorage`.

## External

- Secure contexts (why `crypto.subtle` and `crypto.randomUUID` are unavailable on
  plain-`http` origins): https://developer.mozilla.org/en-US/docs/Web/Security/Secure_Contexts
  and https://developer.mozilla.org/en-US/docs/Web/API/Crypto/getRandomValues (available
  in insecure contexts).
- `@noble/hashes` (MIT): https://github.com/paulmillr/noble-hashes (`legacy` module for MD5
  and SHA-1).
- `jose` (MIT): https://github.com/panva/jose (`decodeJwt`, `decodeProtectedHeader`).
- `culori` (MIT): https://culorijs.org/api/ (`culori/fn` tree-shakeable API).
- UUID v7: RFC 9562, section 5.7, https://www.rfc-editor.org/rfc/rfc9562#section-5.7.
- ULID spec: https://github.com/ulid/spec.
- HMAC test vectors: RFC 4231, https://www.rfc-editor.org/rfc/rfc4231.
- Cron field semantics (the day-of-month or day-of-week rule): `man 5 crontab`
  (https://man7.org/linux/man-pages/man5/crontab.5.html).
- Reference repositories in selections.md: none relevant.
