# Loom iOS TestFlight delivery

Loom uses its own iOS identity, `com.kylebegeman.loom`, and installs alongside upstream
T3 Code. Both apps connect to existing hosts; installing Loom does not migrate or delete
conversations. Desktop updater releases do not install mobile binaries. Install the
Loom beta through its own TestFlight invitation.

The upstream merge process continues to merge the whole repository. The fork-owned
publisher packages that exact merged source for iOS. Android delivery is outside this
release path. Local releases disable Expo OTA, upstream Expo ownership, and Connect by
default, so they require neither an Expo account nor an EAS subscription. Direct host
pairing remains available.

## One-time Apple setup

Use an Apple Developer membership that can distribute apps, then create a separate
Loom app in App Store Connect. Register these bundle IDs and the shared app group:

- `com.kylebegeman.loom`
- `com.kylebegeman.loom.sharing`
- `com.kylebegeman.loom.widgets`
- `group.com.kylebegeman.loom`

Enable the app group for the app and both extensions. Keep an Apple Distribution
certificate with its private key and App Store distribution profiles for all three
bundle IDs in the release Mac's keychain/profile store. Authenticate the installed
`asc` CLI with your own App Store Connect API key. The publisher verifies that the
configured App Store Connect app owns Loom's bundle ID before any upload.

Keep configuration and keys outside the repository, for example in the existing
local publisher's private state directory. Required variables are:

| Variable                     | Value                                               |
| ---------------------------- | --------------------------------------------------- |
| `LOOM_IOS_TEAM_ID`           | Your ten-character Apple Developer team ID          |
| `LOOM_IOS_ASC_APP_ID`        | Loom's numeric App Store Connect app ID             |
| `LOOM_IOS_TESTFLIGHT_GROUPS` | Optional comma-separated beta group IDs or names    |
| `LOOM_IOS_EXPORT_OPTIONS`    | Optional absolute path to your export-options plist |
| `ASC_PROFILE`                | Optional local `asc` credential profile name        |

An export-options plist, when supplied, must use `method=app-store-connect`,
`destination=export`, your `teamID`, and `signingStyle=manual`. Its
`provisioningProfiles` dictionary must explicitly map all three bundle IDs to your
installed App Store profiles. The same mappings are applied to generated app and extension targets before
archiving, so one Apple Distribution identity is sufficient. Without a supplied plist,
archiving uses the generated project signing settings and `asc` generates manual export
options from the signed archive. API keys can instead resolve through `ASC_KEY_ID`,
`ASC_ISSUER_ID`, and `ASC_PRIVATE_KEY_PATH`; key contents stay in a private file.
Never place a private key in source or pass its contents as a command argument.

## Prepare and publish

Use a clean isolated checkout with frozen dependencies, Node 24, CocoaPods, Xcode,
and the installed `asc` CLI. A separate absolute output directory keeps archives,
IPAs and receipts outside source. Commands below use a task-specific variable;
choose an unused directory in the lane or the local publisher's private builds root.

```sh
loom_ios_output=/absolute/path/to/ios-build-record
node scripts/fork/ios-release.ts prepare --output-dir "$loom_ios_output"
node scripts/fork/ios-release.ts build --output-dir "$loom_ios_output"
node scripts/fork/ios-release.ts inspect --output-dir "$loom_ios_output"
node scripts/fork/ios-release.ts publish --output-dir "$loom_ios_output"
```

`release` runs those phases together. Pass `--source-sha` with the full commit SHA
when invoking it from automation. Build numbers increase across all existing iOS
builds in App Store Connect and respect Apple's component limits. Set
`LOOM_IOS_BUILD_NUMBER` only for an explicit newer number. Marketing version comes
from the production app config. Apple closes a version's release train after a
public App Store release, so advance that marketing version before later uploads.

Preparation records the source SHA, team, app, version and build number. Inspection
checks the signed IPA, both extensions, embedded source SHA, matching app groups,
App Store provisioning profiles and SHA-256. Publishing rechecks those boundaries,
waits for Apple's processing, and optionally adds the build to configured groups.
With no groups configured it uploads only. It never requests a public App Store
release, beta review submission, tester notification, installation, or app restart.
Apple may send its own account or processing notifications independently.

Repeating completed phases reuses the prepared record and signed artifact. A confirmed
uploaded build is reconciled by its Apple build ID rather than uploaded again. Xcode
intermediates stay inside the release record and are removed after archiving. The
publisher keeps bulky artifacts for two completed records, preserving all unpublished
or ambiguous uploads. Older confirmed records keep their source, IPA digest and Apple
build ID; retries verify that exact valid Apple build and reuse it without rebuilding.
Retention skips symlinked or unrelated records. If an
upload times out after Apple accepts it but before a local receipt records that ID,
the publisher stops on the existing build number. Inspect Apple's build and recover
the local record before retrying. It deliberately does not assume an unrelated
upload contains the same binary.

## Nightly automation and verification

The authenticated local Mac publisher is the delivery path. Enable its optional iOS
hook with the private file `~/Library/Application Support/Loom Updates/ios.json`:

```json
{
  "enabled": true,
  "teamId": "ABCDE12345",
  "appId": "1234567890",
  "profile": "loom-personal",
  "groups": ["Loom Internal"],
  "exportOptions": "/Users/kyle/Library/Application Support/Loom Updates/ios-export-options.plist"
}
```

Replace the example team and app IDs with the verified personal Apple team and Loom
app, and use an existing TestFlight group. `groups` and `exportOptions` are optional;
omitting groups uploads without assigning testers. The export-options path must be
absolute. The named `asc` profile must already be authenticated; the hook uses strict
profile authentication so another account cannot supply credentials as a fallback.
Keep this file private and outside Git. Remove it or set `"enabled": false` to disable
automatic iOS delivery. No API key contents belong in this configuration.

After successful desktop publication, the hook checks the newest
`loom-ios-testflight.yml` run for that release's exact commit SHA. That run must be
completed with conclusion `success`; a green run on another commit or an older success
superseded by a pending, failed or cancelled rerun does not qualify. If there is no
qualifying run, desktop stays published and iOS waits until a later publisher attempt.
Trigger the verification workflow on the release's immutable integration tag when a
path-filtered main push did not run it, and confirm the recorded source matches the
published desktop commit. The hook then builds and uploads that same SHA with the
configured personal identity. Signing stays on the existing Mac; no new runner or Expo
publishing account is required.

The fork-owned `Loom iOS TestFlight verification` workflow checks production identity,
release boundaries, focused project/handoff tests and mobile, contracts,
client-runtime and scripts typechecks. It runs on relevant main changes and published
releases, and supports manual dispatch. Its recorded source artifact is verification
evidence, not a downloadable iOS binary. The workflow does not hold Apple credentials
or upload to TestFlight. Upstream EAS workflows are separate and must remain disabled
for this fork's app delivery.

Native iOS smoke verification uses the Device panel against isolated host state. The
first release should verify install and host pairing through Loom's own TestFlight
channel. It must not replace a user's active upstream app session without their
chosen install/restart step.
