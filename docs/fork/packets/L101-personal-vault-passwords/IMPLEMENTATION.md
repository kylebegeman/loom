# L101 implementation

## Before starting

Read the repository instructions, packet conventions, existing Utilities generation and native
Crypto/clipboard adapters. Work in isolated state; no personal Vault input is needed.

## Steps

1. Extract the existing password policy into a shared dependency-free helper; validate input and
   bound failure/no-progress behavior. Preserve the Utilities entry point with focused regressions.
2. Add a local web dialog with policy controls, hidden output, explicit reveal/copy/clear and safe
   clipboard failure. Mount through existing root, Settings and palette registries.
3. Add the equivalent native sheet with Expo Crypto and clipboard adapters. Place the local tools
   before the server Vault gate so a missing backend cannot hide them.
4. Discard results on policy changes, close and app/window background. Explain clipboard lifetime.
5. Test the shared contract and existing consumer; lint/typecheck touched packages and check
   mobile conventions. Record real-client acceptance separately if not authorized.

## Done when

The complete product behavior works on claimed surfaces, focused checks pass, required integrated
acceptance and merge checks are recorded, and no secret reaches persistent app state or transport.
Passing helper tests alone does not complete the UI acceptance.
