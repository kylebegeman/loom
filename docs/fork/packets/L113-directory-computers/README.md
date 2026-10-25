# L113: Library computer list

Status: In progress (C02 of [Loom-owned connections](../LOOM-CONNECTIONS.md)).

Once a device is connected to the Library, desktop, web and iPhone list the Library directory's
computers that the device has not saved, and connect each one with Loom Identity instead of a
pairing code. The list is read when its section opens and on refresh, and the last good list is
kept offline for each Library.

## Scope

- In: the directory list on Settings > Connections (desktop and web) and Settings > Computers
  (iPhone); Connect from a row, which reads the computer's Identity metadata from its published
  routes and signs in only when the computer uses the Library's issuer; a pairing fallback that
  explains why and checks that the address reaches the listed computer, including rows with no
  usable route. The host shows its last published routes and Library sign-in expiry in its
  connection details. Publisher renewal replaces the session at two thirds of its lifetime,
  saves the successor atomically with mode 0600, and reloads credentials without a restart.
  An older Library keeps the current sign-in and reports that it needs an update.
- Out: public routes and per-computer Pocket ID resources (C03), a Command Palette entry and
  Settings search, which need edits in files other packets own.

## Issuer pin

The Library's issuer comes from the account recorded on the saved Library connection, or from
the Library's own `/api/loom/identity`. A row whose computer names another issuer, whose
Library issuer is unknown, or whose metadata names another computer's per-computer resource
(`identityResourceRefusal`, from C03) falls back to pairing. The finished sign-in is checked
again with `directorySignInMismatch` before anything is saved.

## Packet seams

See [SEAMS.md](./SEAMS.md).
