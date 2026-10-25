# L112: Identity renewal

Status: Done (C01 of [Loom-owned connections](../LOOM-CONNECTIONS.md)).

The desktop app and iPhone stay signed in to each computer through Loom Identity without asking
again every hour. Each computer session still lasts at most an hour; before it ends the client
refreshes a per-computer Pocket ID grant, exchanges the new tokens at the computer, and the open
socket carries over. The computer caps how long one sign-in can be renewed, counted from the ID
token's `auth_time`, through `LOOM_IDENTITY_MAX_SESSION_AGE`.

## Scope

- In: refresh grants per account and computer in platform secret storage (desktop
  `safeStorage`, iOS Keychain); single-flight renewal before expiry and after a rejected
  credential; socket succession on the computer; the sign-in age cap; revocation that follows
  renewal links; removal that ends the grant.
- Out: browsers keep interactive sign-in. Issuer pinning for directory computers is C02, and
  refusing another computer's resource is C03, because this packet learns both from the
  computer it signs in to.

## Surfaces

Desktop and the mobile app renew. Web in a plain browser signs in each hour, with the expiry
notice. Renewal works on any address of a saved connection, so tailnet and public routes renew
too.

## Operating it

Renewal starts only on a computer that sets `LOOM_IDENTITY_MAX_SESSION_AGE` (for example `7d`).
Update the desktop and iPhone apps first: older apps cannot sign in once it is set. Pocket ID
ends a grant left unused for its refresh token lifetime, so Loom's `loom-library-native` client
moves from 60 minutes to 7 days through the identity reconciler.

## Packet seams

See [SEAMS.md](./SEAMS.md).
