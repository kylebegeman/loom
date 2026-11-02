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
