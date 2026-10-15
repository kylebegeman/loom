# 8. Iris consistency

Keep supported OS surfaces and every graphical LOOM wordmark consistent with Iris.

Status: **completed**. Complexity: **Medium**. Impact: **Medium**.

Owner: LoomOS with existing app/hub owners. Dependencies: [#9](09-omarchy-compatibility-checks.md).

## Scope

- Generate supported palette values from canonical Iris tokens while preserving Omarchy layout, pixel art and motion.
- Check contrast, terminal colors, theme switching and gradient wordmark placement.
- Publish an Iris version when shared token/component changes need to be retained across products.

## Acceptance

- Inspect both themes across supported native surfaces and theme changes.
- Verify palette provenance, gradient preservation and contrast.
- Shared Iris changes are released and consumer versions checked; OS-only assets do not require an artificial Iris release.

## Delivery

Local preparation and focused checks first. Workstation rollout/native acceptance when reachable; secure lock and necessary local authentication remain normal user flows.

## Evidence

- Completed 2026-10-12. Verified source bundles, dirty-edit copies and scoped archives were saved before changes. Workstation has a mirrored 72-file appearance snapshot plus 21 protected branding/adapter files. The pre-work appearance restore and corrected installer rollback were both exercised successfully; exact pre-work pack .28 remains retained and its restore dry-run passes.
- Pack 20261012.31, source d170f63649c4b96686e332416bb2479e4b426828, manifest SHA256 1e38b9c7c8a93bf54ee036a4c42ad91683b354217926b019f2b3a5ec4c202990 is installed and verified on Workstation. All 30 retained bundle members match committed source. No activation is pending. Generation pins canonical Iris 0.6.51 tokens, SHA256 2b88d3e455d0f5f7174a2952483292753c4f019bc49e2ef81dfa80fd7f42ffcd, with role maps and recorded contrast adaptations. No shared Iris source change or artificial package release was needed.
- Focused pack gate passes 157 tests, including palette readability, source/artwork drift, non-color setting preservation, immutable-bundle installation and read-only rollback regressions. Targeted formatter/lint pass. Native immutable installation exposed read-only staging and adapter-copy failures; writable staging and atomic adapter/restoration writes fix them without relaxing bundle integrity.
- Native Iris Dark and Light terminal palettes, Loom menu, Apps launcher, notifications, About and supported nonsecure lock previews were inspected. Both modes are selected through the regular Omarchy Theme menu/picker. Native About keeps the approved banded gradient when launched with the actual desktop PATH; a narrowed SSH test PATH had initially bypassed its installed adapter. Both approved wordmark SVG hashes are unchanged, and the screensaver retains the dark gradient in either mode.
- Workstation is restored to loom-iris-dark. Wallpaper bytes, shell geometry, shell/user settings, all 21 protected boot/login/adapter files, managed Loom palette delivery, original Office/Atlas windows and T3 service PID 1152 are verified. No protected publishing, service restart, provider inference or app release was needed. Palette contrast checks cover nominal opaque surfaces, not arbitrary wallpaper blends, ANSI black-on-black or app-owned content. Evidence and rollback handoff: /Users/kyle/Developer/artifacts/loom-os/2026-10-12/iris-consistency.
