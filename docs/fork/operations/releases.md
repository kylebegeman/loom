# Loom releases

Run `bash scripts/fork/loom.sh land --no-install` from clean, merged `main` to
publish without interrupting the installed app. The existing publisher also checks
for merged integration tags every 30 minutes while this Mac is logged in. Arm the
supported idle updater only after the exact release is published and verified.

The publisher builds the desktop app and Mac runtime on this Apple Silicon Mac in
its private source checkout. Mac and Linux runtime builds use the same builder,
which checks the source commit and pinned Node version, builds the native monitor
and executable, then extracts the archive and verifies its version and an isolated
server startup. Signing and installed-app compatibility checks remain on the Mac.

GitHub builds and tests the Linux runtimes. Its attach job verifies the Mac archive
against the publisher's SHA256 and the draft's source, requires all three runtimes,
and creates `SHA256SUMS`. Publication waits for that job to succeed. A manual
workflow run without a local Mac checksum retains the hosted-Mac build path.

An interrupted publisher can reuse its completed local build receipt after checking
the archive bytes and public build configuration. It resumes an active exact-source
workflow and recognizes an already uploaded matching Mac archive. A source or
checksum mismatch stops publication; it never repairs an already published release.
Older integration tags retain their original hosted-Mac workflow.

## Library distribution

A private repository's release URLs answer `404` without a GitHub credential, so
releases can also be served by the Library. Once
`~/Library/Application Support/Loom Updates/release-mirror.json` exists (mode
`0600`, holding a B2 key limited to `releases/`), every publication is copied to
the Library's B2 and new desktop builds embed the generic feed
`https://loom.begam.in/api/loom/releases`. Without the file the publisher keeps
the GitHub feed. The Library serves releases only with `LOOM_RELEASES_BACKEND=b2`;
otherwise it answers `404 not-hosted` and clients keep their GitHub source.

- `node scripts/fork/updates.ts mirror <version>` copies one published release.
  A marker in `mirrored/` makes it run once, a failed copy retries on the next
  scheduled run, and a channel feed never moves back to an older version.
- The desktop app sends this computer's enrolled Library credential only to the
  feed's own origin, and downloads full zips while it does.
- Servers and `t3 update` on an enrolled computer download through the Library. A
  managed mirror or `T3CODE_RELEASE_BASE_URL` wins, except a base naming Loom's own
  GitHub releases, which follows the Library.
- Web and mobile read release lists from their environment's Library through
  `loom.releases.index`, and read GitHub only when that server predates it or has
  no Library releases.
- A computer that was never enrolled has no Library credential. Copy its first
  runtime from an owner Mac (`gh release download`) and install it from a loopback
  mirror. SSH remote installs have the same limit.
- While the Library is down, `scripts/fork/loom.sh install` still installs this
  Mac's own build. Other Macs wait, or install a zip from `gh release download`.

The cutover and repository switch are in loom-platform's
`ops/runbooks/private-distribution-migration.md`.
