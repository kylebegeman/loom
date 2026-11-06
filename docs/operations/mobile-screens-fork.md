# Building the mobile Screens dependency

The mobile v5 stack uses a committed tarball from the
[T3 Screens fork](https://github.com/PixPMusic/react-native-screens/tree/t3-v5.0.0-t3.48).
The fork owns the general integration changes. Loom applies a narrow native
navigation patch through `pnpm-workspace.yaml`'s `patchedDependencies`.
Each archive includes compiled JavaScript, declarations, native source and
`t3-fork.json` recording its version, source commit and upstream base.

The [local patch](../../patches/react-native-screens@5.0.0-t3.48.patch) exposes
UIKit's `hidesBottomBarWhenPushed` on `Stack.Screen`. A nested navigation
controller opts into forwarding that policy to its selected tab host when a
screen first requests it. Native appearance and navigation callbacks coordinate
push, pop, retained-tab return and cancelled interactive Back. Manually toggling
`Tabs.Host.tabBarHidden` from JavaScript on these transitions
tears down the native Search field and returns it to the top header on Back.
Split and hinge layouts retain their column visibility policy. The patch includes
source, distributed JavaScript and declarations. Archive metadata identifies the
original fork source, and pnpm records the local change in the patch and lockfile.
Run `vp i` after changing the patch, then rebuild the native client.

When upgrading Screens during an upstream merge, rebase this patch onto the
new package or remove it once the package carries the equivalent fix. Verify
Search result push/Back, interactive Back, Settings presentation/dismissal and
tab switching before removing it. Keep the exact-version patch entry
and generated lockfile aligned with the archive.

To reproduce an archive, use Node 24 and the repository's pinned Yarn from a
clean fork checkout at the source commit recorded in its `t3-fork.json`:

```sh
yarn --cwd /tmp/t3-screens-fork pack:t3 /absolute/path/to/t3code/apps/mobile/deps
```

For an update, sync the fork's `main` with upstream, merge it and the required
proposal branches into `t3/main`, increment the `5.0.0-t3.N` version, pin `t3Fork.upstreamCommit` to the
integrated upstream SHA and commit.
Run `pack:t3` from that clean checkout and tag the source as `t3-v<version>`.
Publish the source commit and tag to the fork before submitting the app change.
Replace the old archive, update `apps/mobile/package.json` and run `vp i` to
regenerate the lockfile. Verify mobile types and affected navigation tests.
Changes to native source also require rebuilding and testing the native client.

The same iOS binary supports iPhone, iPad, and Duo. UIKit hinge updates enable
phone workspace columns at runtime; regular phones retain portrait rotation.
Use the normal EAS build profiles and update channels. Duo support requires a
binary built with the iOS 27.1 SDK; an OTA cannot add the native APIs.
