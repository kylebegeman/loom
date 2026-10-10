# L45 references

## Rules and where they came from

| Rule                                    | Source                                                         | Introduced upstream   |
| --------------------------------------- | -------------------------------------------------------------- | --------------------- |
| `t3code/no-outset-state-indicators`     | `oxlint-plugin-t3code/rules/no-outset-state-indicators.ts`     | `5dcb59ed6c` (#16675) |
| `t3code/no-raw-resize-observer`         | `oxlint-plugin-t3code/rules/no-raw-resize-observer.ts`         | `d97060709c` (#17656) |
| `t3code/require-centered-scroll-gutter` | `oxlint-plugin-t3code/rules/require-centered-scroll-gutter.ts` | `07a8b9ece4` (#17077) |

Read each with `git show <sha> --stat`; the commit messages explain the defect each rule
prevents. Rule registration: `oxlint-plugin-t3code/index.ts:10-39`. Config: `vite.config.ts`
lint block (rules at 176, 253-262, 269-273; options at 403-407).

## Upstream fixes to copy

- Centred scroller with gutter: `apps/web/src/components/RightPanelTabs.tsx:521`.
- `observeResize` usage in fork code that already follows the rule:
  `apps/web/src/fork/model-preview-3d/viewer/createViewer.ts:377`,
  `apps/web/src/fork/model-preview-3d/controls.tsx:185`.

## Tools

- `vp lint` is Vite+'s built-in oxlint runner; the root `lint` script is
  `vp lint --report-unused-disable-directives` (`package.json:29`). Flags used here
  (`--deny-warnings`, `--report-unused-disable-directives`) are oxlint CLI flags. Verified with
  `vp lint --help` in this checkout; see also the
  [oxlint CLI docs](https://oxc.rs/docs/guide/usage/linter/cli.html) (link not rechecked).
- Upstream CI lint: `.github/workflows/ci.yml:20-22` runs on `blacksmith-8vcpu-ubuntu-2404`.
  Whether those runners serve the fork's repository is not verified.

## Licences

No third-party code. oxlint (MIT) is already a dev dependency through Vite+.
