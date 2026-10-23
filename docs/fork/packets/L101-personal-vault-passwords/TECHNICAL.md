# L101 technical design

## Overview

`packages/client-runtime/src/fork/vault-password.ts` owns generation and policy validation.
The web Utilities password tool calls it; web/native local password controls consume the same
export. Random bytes are injected, so no runtime-specific import enters shared client code.

## Contracts and server

No RPC, environment capability, server service, SQL migration, OpenBao path or MCP tool is added.
A password generator does not need access to stored credentials or a destination environment.
The helper validates its input and returns the generated value plus a search-space estimate;
callers supply a cryptographic source and never persist the result automatically.

## Clients and entry points

`apps/web/src/fork/vault/PasswordGenerator.tsx` provides Settings access and a root-mounted
local dialog. `password-navigation.ts` and `password-palette.tsx` use existing fork registries.
`apps/mobile/src/fork/vault/PasswordGeneratorSection.tsx` provides a native sheet, composed in
`VaultSettingsSection.tsx` before the backend capability gate. This local-only exception is
deliberate; no unavailable server operation is exposed.

Web uses the existing `utilities/runtime.ts` getRandomValues adapter; mobile uses existing
`expo-crypto` getRandomValues. Avoid getRandomBytes because Expo can fall back to
Math.random during development/debugger use. Secure-source failure must fail closed. Web copy uses the established clipboard helper, native copy uses
expo-clipboard with Android sensitive-content marking. Clipboard failures retain a usable result for manual reveal/copy. Values begin
hidden and option changes clear them. Close unmounts the view. Visibility/focus loss on web and
AppState changes on mobile discard the generated result. Copying does not authorize persistence.

## Storage and exposure

No persistence. Strings live in component memory and, after explicit copy, in the OS clipboard.
This is reference cleanup, not guaranteed zeroization. A hidden input remains readable to a
process controlling that client; this feature establishes no new OS isolation claim.

## Performance

At most 128 output characters. Generation occurs only on user action. Sampling and random-source
failure handling must be bounded, including deterministic all-rejected sources; no polling,
background workers, subscriptions carrying values, telemetry or continuously repainting effects.

## Alternatives considered

A second native-only algorithm would drift from Utilities. A server generator adds an unnecessary
plaintext recipient and connection dependency. Personal encrypted storage belongs to the proposed
client boundary and is not imitated by this local tool.
