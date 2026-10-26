# Loom iOS TestFlight delivery

Loom uses its own iOS identity, `com.kylebegeman.loom`, and installs alongside upstream
T3 Code. Both apps connect to existing hosts; installing Loom does not migrate or delete
conversations. Desktop updater releases do not install mobile binaries. Install the
Loom beta through its own TestFlight invitation.

The upstream merge process continues to merge the whole repository. The fork-owned
publisher packages that exact merged source for iOS. Android delivery is outside this
release path. Local releases disable Expo OTA and upstream Expo ownership, so they
require neither an Expo account nor an EAS subscription. Direct host pairing remains
available. Connect uses the existing account and relay protocol, with explicit public
configuration shared by desktop, standalone hosts and iOS releases.

## Account-linked computers

Configure the local publisher with `~/Library/Application Support/Loom Updates/connect.json`:

```json
{
  "enabled": true,
  "mobileEnabled": true,
  "clerkPublishableKey": "pk_live_...",
  "clerkJwtTemplate": "t3-relay",
  "clerkCliOAuthClientId": "public-oauth-application-id",
  "relayUrl": "https://relay.example.com",
  "accountPortalUrl": "https://accounts.example.com"
}
```

Use the public values for the same deployment on every client and host. The upstream
production values are in the repository-root `.env.example`. Use `accountPortalUrl` for the deployment's hosted Clerk account pages; the upstream
production key defaults to `https://accounts.t3.codes`. No Clerk secret key or
relay deployment credentials belong in this file. `enabled:false` disables Connect;
`mobileEnabled` defaults to false. New prepared release records freeze these public
values so a retry keeps the original account deployment even if local settings change.
Existing records without this configuration retain their original disabled setup.

With the upstream account service, Loom iOS uses email-code sign-in and opens account
creation and profile settings in the browser. This does not require registering Loom's
bundle with upstream's native OAuth callbacks. Native social sign-in and passkeys require
registration of Loom's Apple team and bundle on the selected auth service, its callback
allowlist and Associated Domains configuration. Only after that qualification, set the
optional `nativeAuthDomain` to that service's authentication hostname. Do not point it at
upstream's authentication domain and assume Loom is registered. Connect account discovery
does not enable push notifications, Apple sign-in or Expo OTA. Notifications from a Library
are a separate opt-in, described in [Library push](#library-push).

For direct manual iOS builds, set `LOOM_MOBILE_CONNECT_ENABLED=1` and the four canonical
public `T3CODE_*` values from [Connect setup](connect-setup.md), plus
`LOOM_MOBILE_ACCOUNT_PORTAL_URL` for an independently hosted account service. The release publisher
sanitizes unrelated development and native-provider settings before archiving. Sign in
with the same Connect account on the phone and each work computer; account discovery
finds linked computers while direct pairings remain device-local.

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
installed App Store profiles. Set `signingCertificate` to the distribution
certificate's 40-character SHA-1 fingerprint, and ensure that certificate belongs
to all three profiles. Certificate names and automatic selectors are rejected
because another app can install a newer certificate with the same name. The
publisher applies the same profile mappings and fingerprint to generated app and
extension targets before archiving. Without a supplied plist, archiving uses the
generated project signing settings and `asc` generates manual export options from
the signed archive. API keys can instead resolve through `ASC_KEY_ID`,
`ASC_ISSUER_ID`, and `ASC_PRIVATE_KEY_PATH`; key contents stay in a private file.
Never place a private key in source or pass its contents as a command argument.

## Library push

Release builds leave push off by default: the signed app carries no `aps-environment`, so iOS
never issues a device token. A Library can send notifications with Loom's own Apple key once a
build opts in. The Library side, including the APNs key and its custody, is in the
[L115 packet](../fork/packets/L115-push/README.md#apple-key-k4).

One-time Apple setup, on the same eligible team (not a personal team):

1. Enable Push Notifications on the `com.kylebegeman.loom` App ID. The extensions stay without
   it.
2. Regenerate the App Store distribution profile for `com.kylebegeman.loom` so it carries
   `aps-environment`, and install it on the release Mac. If you supply an export-options plist,
   keep its mapping pointed at the new profile.
3. Create the APNs key for the Library: Production, restricted to the topic
   `com.kylebegeman.loom`. Keep a copy in Vault and install it on the Library.

Build a release with `LOOM_MOBILE_LIBRARY_PUSH_ENABLED=1` in the environment before `prepare`
or `release`. For nightly delivery, set `"libraryPush": true` in the publisher's `ios.json`,
because its launch agent carries no environment. The value is `0` or `1`, and unset means `0`. The prepared record freezes it, and a later phase run with a
contradicting value fails, so a retry cannot quietly change it.

Inspection checks the main app only. With the flag on, its signed entitlements and its profile
must carry `aps-environment` set to `production`. With the flag off, its signed entitlements
must not carry it; the profile is not checked, because once the App ID has Push every profile
carries it. Upstream's own relay push stays off either way, and the release config check
refuses a build that turns it on. The verification workflow checks the flag-on public
configuration in its "Check Library push public configuration" step.

## Prepare and publish

Use a clean isolated checkout with frozen dependencies, the exact Node in `package.json`
`engines.node`, CocoaPods, Xcode, and the installed `asc` CLI. A separate absolute
output directory keeps archives, IPAs and receipts outside source. Commands below use a
task-specific variable; choose an unused directory in the lane or the local publisher's private builds root.

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
publisher keeps bulky artifacts for two completed records and the records themselves for
the six newest, preserving all unpublished or ambiguous uploads. Retained confirmed records
keep their source, IPA digest and Apple build ID; retries verify that exact valid Apple
build and reuse it without rebuilding. The scheduled publisher skips a release whose record
already confirms its upload. Retention skips symlinked or unrelated records. If an
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
  "exportOptions": "/Users/kyle/Library/Application Support/Loom Updates/ios-export-options.plist",
  "signingKeychain": "/Users/kyle/Library/Keychains/loom-distribution.keychain-db",
  "signingKeychainPasswordFile": "/Users/kyle/Library/Application Support/Loom Updates/apple-personal/signing-keychain-password"
}
```

Replace the example team and app IDs with the verified personal Apple team and Loom
app, and use an existing TestFlight group. `groups` and `exportOptions` are optional;
omitting groups uploads without assigning testers. The export-options path must be
absolute. When using a dedicated signing keychain, provide both absolute
`signingKeychain` and `signingKeychainPasswordFile` paths so delivery can unlock it
after sleep or login. The password file must be owned by the publishing user,
restricted to that user (for example, mode `0600`), and contain the existing
keychain password. The publisher uses macOS Security through the Python supplied
with Xcode and never places the password in process arguments or logs. Omit both
fields when the signing identity already uses an unlocked keychain. The named `asc` profile must already be authenticated; the hook uses strict
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
release boundaries, focused project/handoff and Library push tests (including the iPhone's
registration sync) and mobile, contracts, client-runtime and scripts typechecks. It runs on relevant main changes and published
releases, and supports manual dispatch. Its recorded source artifact is verification
evidence, not a downloadable iOS binary. The workflow does not hold Apple credentials
or upload to TestFlight. Upstream EAS workflows are separate and must remain disabled
for this fork's app delivery.

Native iOS smoke verification uses the Device panel against isolated host state. The
first release should verify install and host pairing through Loom's own TestFlight
channel. It must not replace a user's active upstream app session without their
chosen install/restart step.
