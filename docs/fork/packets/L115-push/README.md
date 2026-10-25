# L115: Library push

Status: Built, off (C04 of [Loom-owned connections](../LOOM-CONNECTIONS.md)). Kyle's Apple setup,
a build with the flag on and the go/no-go on agent alerts (C04-10) are pending.

A Library can send notifications to the Loom iPhone app with its own Apple push key, without T3
Connect or T3's relay. This packet builds the device registry, the APNs sender, status and test
on web, desktop, iPhone and MCP, and the iPhone's opt-in. The Library sends only test
notifications so far.

## Why Loom builds this

Pushes cannot reach the Loom iPhone app today, for two independent reasons:

- Release builds never get an APNs token. `scripts/fork/ios-release.ts` forces
  `LOOM_MOBILE_PUSH_ENABLED=0`, the capabilities plugin then removes `aps-environment`, and
  upstream's registration returns before it asks iOS for a token. The signed entitlements and
  the embedded profile of the local `0.0.122-nightly.20261020` IPA carry no `aps-environment`.
- relay.t3.codes signs with T3's team key, and APNs refuses a provider token for a topic owned by
  another team. Loom's bundle IDs are `com.kylebegeman.loom*`.

## Scope

- In: the `loom-push-devices` registry on the Library authority; the APNs token-auth sender on
  `node:http2`; status, register, unregister and test RPCs; `loom_push_status` and
  `loom_push_test`; the iPhone opt-in, registration coordinator and test; a Push notifications
  section in Settings > Connections on web and desktop; the iOS build flag and its release
  checks.
- Out: agent alerts from computers (C04-10, see the notes below), Live Activities (K10), and
  any change to upstream's relay or widget push paths, which stay tokenless.

## Off at four layers

1. **Library switch.** Push runs only on a Library authority with Loom Identity configured,
   `LOOM_LIBRARY_PUSH_ENABLED` on, and `LOOM_LIBRARY_PUSH_APNS_TEAM_ID`, `_KEY_ID` and `_KEY_FILE`
   set. Restart to apply.
2. **Advertised slug.** The Library advertises `library-push` only when push runs, and phones
   ask nothing without it.
3. **Build flag.** `LOOM_MOBILE_LIBRARY_PUSH_ENABLED` defaults to `0`. Only a build with it on
   keeps `aps-environment` and shows the iPhone controls. Upstream's `iosPushEnabled` stays false.
4. **Device opt-in.** Each iPhone turns on "Notifications from <Library>" in Settings >
   Notifications. The iOS permission prompt comes only from that switch.

## Operating it

| Variable                          | Meaning                                                                                                |
| --------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `LOOM_LIBRARY_PUSH_ENABLED`       | `true`, `yes`, `on`, `1` or `y` turns push on.                                                         |
| `LOOM_LIBRARY_PUSH_APNS_TEAM_ID`  | The Apple team that owns the key.                                                                      |
| `LOOM_LIBRARY_PUSH_APNS_KEY_ID`   | The key's ID.                                                                                          |
| `LOOM_LIBRARY_PUSH_APNS_KEY_FILE` | Path to the `.p8` file: owner-only mode such as 0600, at most 16 KiB, a P-256 key. Read once at start. |
| `LOOM_LIBRARY_PUSH_TOPICS`        | Optional comma list of `bundleId:environment`, default `com.kylebegeman.loom:production`.              |

- Topics outside `LOOM_IOS_PUSH_BUNDLE_IDS` are ignored, and a list with no usable entry accepts
  nothing. Register refuses any other pair with `unsupported-app`, so no undeliverable row is
  stored.
- A key file that cannot be read or is not a valid key, or T3's own team ID, makes push
  `misconfigured`. The registry stays; status and removal still work, and register and test fail.
- With push off, the Library removes `loom-push-devices` at startup. It never touches the `.p8`.
  Phones register again on their own once push is back.
- There is no migration. The registry is one secret-store document, so device tokens never enter
  `statev2.sqlite` or its snapshots.

### Apple key (K4)

1. In the Apple developer account, create a key with Apple Push Notifications service, set to
   Production and restricted to the topic `com.kylebegeman.loom`, not team-scoped.
2. Download the `.p8` (Apple allows this once) and keep a copy in Vault.
3. Install it on the Library through the deploy procedure, outside the T3 home, so copies of its
   state never carry the key. Mode 0600.
4. Set the variables and restart the Library. Settings > Connections > Push notifications shows
   "On" and the key, and an iPhone's "Send test notification" proves delivery.

Revoking the key in the Apple developer account is the only kill switch for a leaked key. The
Library switch only stops this server from sending. A Library session with terminal access, or a
full-access agent on the Library, can read the file as the server user, so the file mode is not
containment. Status reports the team and key IDs, never the file path. To rotate, create a new
key, replace the file and its ID, restart, then revoke the old key.

The iOS side of the setup is in
[Loom iOS TestFlight](../../../operations/loom-ios-testflight.md#library-push).

## Who can do what

- Register, unregister and test need `settings:write`; status needs `orchestration:read`. Rows
  belong to an Identity account (issuer and subject), so a phone must be signed in to the Library
  with Loom Identity.
- An Identity caller sees and changes only its own devices. A session with `settings:write` that
  is not an Identity session acts as operator and can remove or test any row by id.
- `loom_push_status` returns the state, reason, key IDs and a device count only. `loom_push_test`
  needs an explicit row id and full access. Both act only on the Library, never forward from a
  computer and never return tokens. Agents cannot discover row ids, so a person supplies one from
  the device list on web or desktop.
- Limits: 10 devices per account, 50 per Library. Tests: 3 per device per 10 minutes and 1 per
  account per 10 seconds. Rate-limit state, last delivery and the failing flag live in memory
  and reset on restart.

## Device lifetime and removal (A14)

- A row lasts `LOOM_IDENTITY_MAX_SESSION_AGE`, else 30 days. K8 wanted the earlier of that and
  the sign-in's own cap, but the session the phone registers on does not expose its sign-in time,
  so `expiresAt` is now plus the TTL. A phone in use re-registers on a Library connect when its
  record is over 24 hours old, and the Library extends a row at most every 12 hours.
- On a connect with a fresher record, the phone reads the Library's status once, as its
  Notifications screen does when it opens. A list that lacks the phone's row (an operator's
  Remove, or Apple refusing the token) clears its registration, so it registers again at once.
  A read within a minute of registering does not count, so a Library whose status never lists
  the row cannot cause a register loop.
- A row can therefore outlive the phone's sign-out or a revoked sign-in by up to its lifetime.
  Removing the iPhone in Settings > Connections > Push notifications on web or desktop is the
  immediate stop, next to revoking a lost phone's sign-in.
- The phone's record is keyed by Library and Identity account. Signing in to the same Library as
  another account resets the switch to off.
- Turning the switch off unregisters while connected. Offline, or if the Library refuses, the
  phone keeps the record with the switch off and retries on the next connect.
- Removing the Library connection on the iPhone first asks the Library to forget the phone,
  while it is connected and for at most 3 seconds, since the removal revokes the session the
  request needs. A Library that does not answer keeps the row until it expires.

## APNs replies

| Reply                                                  | Result                                                                                  |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------- |
| 410, or 400 `BadDeviceToken`, `DeviceTokenNotForTopic` | `bad-token`: the row is removed.                                                        |
| Any other 403, such as `InvalidProviderToken`          | `key-rejected`: push shows failing until a later delivery succeeds.                     |
| `TopicDisallowed`, `BadTopic`                          | `topic-disallowed`, recorded on that row only.                                          |
| 429                                                    | `rate-limited`.                                                                         |
| GOAWAY, reset or refused stream, 5xx                   | One immediate retry on a fresh session, so a duplicate is possible; then `unavailable`. |
| No answer within 10 seconds                            | Not retried, because the push may have arrived.                                         |

`ExpiredProviderToken` gets its own single retry with a fresh provider token.

In a build with Connect config, fetching the APNs token also fires upstream's tokenless T3 relay
listener. Removing it is a C05 cleanup item.

## Decisions (defaults pending Kyle)

Everything ships off at four layers, so each default is reversible.

| ID  | Default                                                                                                                 |
| --- | ----------------------------------------------------------------------------------------------------------------------- |
| K1  | Env-only switch and key settings on the Library. Restart to apply.                                                      |
| K2  | One secret-store document, `loom-push-devices`. No migration, no SQL table.                                             |
| K3  | With push off, the document is removed at startup. The `.p8` is never touched.                                          |
| K4  | A Production, topic-specific key for `com.kylebegeman.loom`, with a copy in Vault, installed outside the T3 home.       |
| K5  | `LOOM_LIBRARY_PUSH_TOPICS`, default `com.kylebegeman.loom:production`, inside the `LOOM_IOS_PUSH_BUNDLE_IDS` allowlist. |
| K6  | `LOOM_MOBILE_LIBRARY_PUSH_ENABLED` defaults to `0`. Kyle turns it on for a TestFlight build after the Apple setup.      |
| K7  | Per-device opt-in, default off.                                                                                         |
| K8  | Row lifetime is the Identity session age cap, else 30 days, counted from registration (see above).                      |
| K9  | Agent alerts from computers (C04-10) are not built. Kyle decides go or no-go.                                           |
| K10 | Live Activities stay out until after C05.                                                                               |

## C04-10 notes (not built)

- Custom data goes under the APNs payload key `body`, which Expo on iOS exposes as
  `notification.content.data`.
- Default text is generic: title "Loom" and a body by kind, with no thread, project, computer or
  model names. Titles would be Kyle's option.
- A second Library switch, `LOOM_LIBRARY_PUSH_ACTIVITY`, would gate it. Recipients are every
  registered device when exactly one Identity subject is allowed, otherwise
  `LOOM_LIBRARY_PUSH_RECIPIENTS`.
- Proposed limits: 20 per computer per hour, 30 per device per hour, a 2 minute freshness window
  and one collapsed notification per thread.
- Computers would post with their publisher session, the environment taken from the subject and
  a directory row required. They need no upstream edit.

## Not verified live

No real APNs traffic was sent. TLS and HTTP/2 from the Library to `api.push.apple.com`, the
release `inspect` check against a signed flag-on IPA, and delivery to a real iPhone remain for
the first device pass.

## Packet seams

See [SEAMS.md](./SEAMS.md).
