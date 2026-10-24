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
  explains why and checks that the address reaches the listed computer.
- Out: public routes (C03), recording each computer's Pocket ID resource in the Library (C03),
  a Command Palette entry and Settings search, which need edits in files other packets own.

## Issuer pin

The Library's issuer comes from the account recorded on the saved Library connection, or from
the Library's own `/api/loom/identity`. A row whose computer names another issuer, or whose
Library issuer is unknown, falls back to pairing. The finished sign-in is checked again with
`directorySignInMismatch` before anything is saved.

## Packet seams

See [SEAMS.md](./SEAMS.md).
