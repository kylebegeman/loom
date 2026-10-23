# L105 seams

## Status and absent integration

Documentation only. No code seams, extension/native host registration or new dependency.
`ext-personal-vault` is proposed; no browser API can be assumed from it. Existing T3 preview
is excluded, not extended into a personal credential client.

## Checked source boundaries

| Current path                                       | Consequence                                                                                        |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `apps/server/src/preview/ServerBrowser.ts:770`     | Preview contexts/profiles are agent browser infrastructure, not trusted personal browser sessions. |
| `apps/server/src/preview/ServerBrowserPage.ts:851` | JavaScript evaluation precludes confidentiality of filled DOM values.                              |
| `apps/desktop/src/preview/Passkeys.ts:140`         | Preview WebAuthn handler is not a personal provider implementation.                                |
| `apps/desktop/src/preload.ts:77`                   | Current desktop bridge; optional desktop fork bridge is absent.                                    |
| `apps/mobile/app.config.ts:157` and `:216`         | Sharing/keychain configuration does not install a credential-provider/Safari target.               |
| `apps/web/src/fork/settings/registry.ts:26`        | Safe setup/status launch entry only.                                                               |

## Proposed target inventory

Pure matching/schema work uses fork-owned `personal-vault-browser` paths. Chromium extension
manifest/content scripts/background/native-host manifest and Safari containing-app/extension
or Apple provider targets are new proposed artifacts; exact paths/build tooling are not yet
selected. Keep them under fork-owned target directories where tools allow. Native entitlement,
packaging and install manifests that require upstream paths become explicit reviewed seams.
No guessed target/API/path is presented as current source.

No upstream touch is currently necessary for a fixture matcher and packet review. An optional
`ext-desktop` bridge may launch safe setup, but is not the custodian and does not transfer
personal values into the ordinary renderer. Shared extension creation is independently
reviewable work, never an import of another numbered packet's implementation.

## Fork records and merge checks

Packet seams/FORK.md/seams.tsv rows added: **none**. Future upstream touches use
`fork: personal-vault-browser`; tool-required JSON/native metadata is recorded as no-marker
seams. Record actual packaging/entitlement/build changes and their necessity before coding.
No merge preview/rehearsal was run for these proposed documents.
