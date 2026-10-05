# L05 implementation

The full selected v1 scope is implemented in `apps/web/src/fork/file-outline/`.
Existing web-root, palette and keybinding registries were reused; no extension point was
created. [SEAMS.md](./SEAMS.md) records the three upstream insertions, and
[TESTING.md](./TESTING.md) records the checks and remaining verification limits.

## Conditional tree-sitter follow-up

Not part of the v1 build. Start it only when the trigger is met.

Trigger: Kyle reports (or a tracking issue records) real files where the v1 outline misses
or misplaces symbols, and the fix is not a reasonable scanner rule (for example it needs
real parsing of a construct rather than one more pattern). Record the failing files as
fixtures first; they become the phase 2 acceptance tests.

Steps, only for the languages that failed:

1. Measure: WASM size and load time for each needed grammar from `@vscode/tree-sitter-wasm`
   or `tree-sitter-wasms` (check the license and that the grammar exists; Swift and Kotlin
   availability is unverified). Pick the smaller maintained source.
2. Add `web-tree-sitter` to `apps/web` (dependency approved by Kyle) and the grammar files;
   commit only the intended lockfile change.
3. `treeSitter/` provider per TECHNICAL.md, "Conditional tree-sitter follow-up"; switch those languages
   in the extractor map with the scanner as fallback.
4. Run the language fixture tests against the new provider (the expected symbol lists stay
   the same) plus the recorded failing files; add a test that a grammar load failure falls
   back to the scanner.
5. Check the web build and the desktop build both serve the WASM (manual pass with Kyle's
   permission).

Commit as `feat(fork-file-outline): parse <languages> outlines with tree-sitter`.

## Done when

The definition of done in [CONVENTIONS.md](../CONVENTIONS.md#definition-of-done), plus:

- Every language in scope has a fixture test with the full expected symbol list.
- Clicking any symbol in a 5,000-line TS file lands on the right line.
- The outline follows an edit in the editable surface within about 200 ms.
- The feature works unchanged against an upstream T3 server.
