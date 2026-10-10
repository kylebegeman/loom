# L50 references

"Verified" means checked on 2026-10-10 against PyPI's JSON API, the build123d source at tag
`v0.13.0`, or `--help` on Kyle's Mac. Nothing was installed or run beyond `--help` and
`--version`.

## Old Loom

None. Old Loom had no Python CAD; the 3D panel itself is new in L23.

## Loom today

- Formats: `apps/server/src/fork/model-preview-3d/ModelPreviewService.ts:71-80`,
  `apps/web/src/fork/model-preview-3d/ModelPanel.tsx:102-104`,
  `packages/contracts/src/fork/model-preview-3d.ts:40`.
- STEP placeholder: `ModelPanel.tsx:666-692`, `ModelPicker.tsx:113-138`,
  `docs/fork/user/model-preview-3d.md:27`; `fileUrl` refusal at `ModelPreviewService.ts:1011-1019`.
- Render pipeline to mirror: `ModelPreviewService.ts:403-622`; dependencies `:365-402`;
  sidecar `:203-216`; agent PNGs `:1104-1254`.
- Process runner with `stdin`, `timeout`, `timeoutBehavior` and output truncation:
  `apps/server/src/processRunner.ts:20-48`.
- Running workspace code needs terminal operate (PCB render):
  `apps/server/src/fork/rpcAuthorization.ts:42`.
- Pinned host tool precedent: `packages/contracts/src/fork/code-graph.ts:26-39`; "Loom never
  installs it" for Graphify: `apps/web/src/fork/code-graph/settings.tsx:130`.

## Upstream T3 Code

- Download pattern for the STEP button: `apps/web/src/components/media/mediaContent.ts:29-39`.
- MCP caller access: `apps/server/src/mcp/McpToolAccess.ts:148` (`actsAsCaller`).

## build123d (verified)

- PyPI `build123d` 0.13.0, uploaded 2026-09-21, licence Apache-2.0, `requires_python
  > =3.11,<3.15`. Requires `cadquery-ocp-novtk>=8.0,<8.1`, `ocpsvg>=0.7,<0.8`,
`ocp_gordon>=0.3.1,<0.4`, `trianglesolver`, and `lib3mf>=2.4.1`(or`py-lib3mf` on Linux
  > aarch64). <https://pypi.org/project/build123d/0.13.0/>
- `cadquery-ocp-novtk` 8.0.1.1.0, Apache-2.0, wheels for CPython 3.11 to 3.14 on macOS (arm64
  60 MB, x86_64 64 MB), manylinux x86_64 and aarch64 (58 to 63 MB) and Windows amd64 (45 MB).
  No source build is needed on those platforms. <https://pypi.org/project/cadquery-ocp-novtk/>
- Source at `v0.13.0` (<https://github.com/gumyr/build123d/tree/v0.13.0/src/build123d>):
  - `exporters3d.py`: `export_stl(to_export, file_path, tolerance=1e-3, angular_tolerance=0.1,
ascii_format=False) -> bool`; `export_step(to_export, file_path, unit=Unit.MM,
write_pcurves=True, precision_mode=PrecisionMode.AVERAGE, *, timestamp=None) -> bool`,
    raising `RuntimeError` on failure.
  - `mesher.py`: `Mesher(unit=Unit.MM)`, `add_shape(shape, linear_deflection=0.001,
angular_deflection=0.1, mesh_type=MeshType.MODEL, part_number=None, uuid_value=None)`,
    `write(file_name)` for `.3mf` and `.stl` only; properties `triangle_counts`,
    `vertex_counts`, `mesh_count`. A shape's `label` becomes the mesh name and its `color` a
    base material. Imports `lib3mf`.
  - `importers.py`: `import_step(filename) -> Compound`, reading colours and names (assembly
    structure becomes nested compounds).
  - `topology/shape_core.py`: `is_valid` and `is_manifold` are properties; `bounding_box(
tolerance=None, optimal=True)` is a method; `volume` is a property; `color` has a setter;
    `label` is an attribute.

## Python and uv (verified on Kyle's Mac)

- `uv` 0.12.17 at `/opt/homebrew/bin/uv`; Python 3.14.7 at `/opt/homebrew/bin/python3`.
- `uv venv --help` lists `-p, --python`, `--seed`, `--allow-existing`, `--no-project`;
  `uv pip install --help` lists `-p, --python` ("The Python interpreter into which packages
  should be installed"), `--only-binary`, `--require-hashes`, `--exclude-newer`,
  `--default-index`; global `--no-config`, `--offline`, `--cache-dir`, `--no-progress`.
- Python's `-I` (isolated mode), `ast.parse`, `ast.literal_eval`,
  `importlib.util.spec_from_file_location`, `importlib.metadata.version` and the `open` audit
  event (`sys.addaudithook`) are standard library features of Python 3.8 and later:
  <https://docs.python.org/3/using/cmdline.html#cmdoption-I>,
  <https://docs.python.org/3/library/ast.html>,
  <https://docs.python.org/3/library/audit_events.html>.

## Unverified

- That `uv venv --python 3.13` downloads a managed Python when none is installed. This is uv's
  documented default (`python-downloads = "automatic"`) but was not run here.
  <https://docs.astral.sh/uv/concepts/python-versions/>
- The installed size of the managed environment (estimated at a few hundred MB from the wheel
  sizes) and the cold import time of build123d. Measure in IMPLEMENTATION.md step 4.
- `ocpsvg`'s licence: PyPI shows none. The upstream repository
  (<https://github.com/snoyer/ocpsvg>) should be checked; Loom does not ship it either way.
- OpenCascade's licence as bundled in the OCP wheels: OCCT is LGPL-2.1 with the Open CASCADE
  exception (<https://dev.opencascade.org/resources/licensing>); not re-read here.

## Fabrication app (research, not a dependency)

- The Fabrication plans list build123d and STEP import as planned features:
  `~/Developer/docs/apps/fabrication/` (README.md and SPEC.md). Kyle chose to build them in
  Loom on 2026-10-10.

## Licences

Loom ships no Python code from these projects and no wheels. The runner is Loom's own code. The
managed install downloads Apache-2.0 (build123d, cadquery-ocp-novtk, ocp_gordon), BSD (lib3mf),
MIT (trianglesolver) and LGPL-2.1 with exception (OCCT inside the OCP wheel) packages onto the
user's machine at the user's request, from PyPI, the same way `pip install` would. Test fixtures
are Loom-written models; the STEP fixture is exported by build123d from one of them, not taken
from a third party.
