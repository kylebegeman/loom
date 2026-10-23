# L101 seams

## Extension points created

None. Existing fork registries already support client-only settings, palette and root mounting.

## Packet seams

The generator has no upstream-owned touchpoints. Registrations change fork-owned `ForkRoot.tsx`, settings and
command-palette registries, the client-runtime fork index and native Vault settings composition.
The existing fork-owned Utilities generator delegates to the shared helper. These generator
changes require no new rows.

Review found the same insecure Expo development RNG fallback in the existing mobile authentication
adapter. The corrective change uses `secure-native-random` in
`apps/mobile/src/features/cloud/dpop.ts` (one marked line) and `dpop.test.ts` (two marked lines),
registered in `FORK.md` and `docs/fork/seams.tsv`. It changes no transport or stored-data format.

## Merge check

Use focused checks on the touched packages. No complete packet-done or upstream integration
claim is made until required acceptance and the repository's merge checks are complete.
