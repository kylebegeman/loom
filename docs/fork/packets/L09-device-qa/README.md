# L09: Device QA and flows

Status: Not started. <!-- Not started | Designing | Ready | In progress | Done | Blocked: reason -->

Adds quality checks on top of upstream's Device panel. A "Device QA" right panel lists the
project's recorded UI flows (Software Mansion's argent flows in `.argent/flows/`), runs one or
all of them against a chosen simulator or emulator, and shows each step's result live, with
screenshot baseline diffs for failed snapshot steps. It also keeps an evidence list per thread:
device screenshots (optionally with a clean status bar), screen recordings and app installs,
each one click away from being attached to the next message. Agents get two small MCP tools to
run flows and capture evidence, gated by upstream's existing "Agent device access" setting.

## Scope

- In:
  - argent detection (`argent --version`), install guidance (Loom types the install command in
    a terminal for the user to confirm; it never installs silently), telemetry status and a
    one-click `argent telemetry disable`. Loom always runs argent with `DO_NOT_TRACK=1`.
  - Flow library: list `.argent/flows/**/*.yaml` with name, kind (end-to-end or fragment),
    prerequisite, step count and snapshot steps; view the YAML; run one flow or every flow in a
    folder (sequentially, one `argent flow run --json-stream` per flow); live step results;
    failed snapshot images (baseline, current, diff) from `--output`; update baselines with a
    confirmation; run history per project.
  - "Record with the agent": inserts a prompt into the composer asking the agent to record a
    named flow with argent's flow tools (needs argent's MCP server configured for that provider,
    which `argent init` does; Loom explains this).
  - Evidence per thread: screenshot (local simulators and emulators directly, SSH-hosted devices
    through upstream's `DeviceService.screenshot`), screen recording up to 180 seconds (local
    iOS simulators and Android emulators), app install of a built `.app` or `.apk`, and flow
    run reports. View, delete, attach to the composer.
  - Clean status bar for iOS simulator screenshots (`simctl status_bar override`) and clear it.
  - A small packet seam in upstream's Device panel toolbar: "Capture screenshot" and "Open
    Device QA" buttons for the device being watched.
  - Agent tools: `loom_device_qa_flow` and `loom_device_qa_capture`.
  - Loom settings section, palette entries, unbound keybinding commands.
- Out:
  - Building apps. L10 (apple-build-tooling) builds Xcode projects; Android Gradle builds are a
    later idea. This packet installs an already built artifact.
  - Loom's own flow recorder or step editor (old Loom had one; argent's recorder is better and
    agent-driven). Flow YAML is edited as a file.
  - Bundling argent or its proprietary binaries (`simulator-server`, `ax-service`, the
    `native-devtools-ios` dylibs). Loom calls the user-installed CLI only.
  - Running flows on SSH device hosts or physical iPhones (argent supports physical iPhones;
    Loom v1 lists only simulators and emulators for flows).
  - argent profiling, Argent Lens, and argent's remote tool-server (`argent link`).
  - Mobile UI.

## Surfaces

- Web and desktop: supported. Flows, evidence and installs run on the environment host; files
  are served to the client through upstream's signed `media-file` asset URLs, so everything
  works over the local network, Tailscale and T3 Connect.
- Mobile: not supported (no right panel system; the App Store app never shows fork UI).
- Upstream T3 server: launcher entry disabled with "Needs a Loom server with Device QA"; the
  Device panel toolbar buttons are not rendered.

## Extension points used

- [`ext-core`](../EXTENSION-POINTS.md#1-server-core-ext-core), [`ext-panels`](../EXTENSION-POINTS.md#6-right-panels-ext-panels), [`ext-settings`](../EXTENSION-POINTS.md#7-settings-ext-settings), [`ext-palette`](../EXTENSION-POINTS.md#8-command-palette-ext-palette), [`ext-web-root`](../EXTENSION-POINTS.md#5-web-root-ext-web-root) +
  [`ext-keybindings`](../EXTENSION-POINTS.md#9-keybindings-ext-keybindings), [`ext-mcp`](../EXTENSION-POINTS.md#10-agent-facing-mcp-tools-ext-mcp). Any of them may be created by this packet.
- Background work (EXTENSION-POINTS.md section 4): a fork reactor that deletes evidence of
  deleted threads.

## Packet seams

- `apps/web/src/components/device/DevicePanel.tsx`: one import and one JSX element in the
  device toolbar (4 added lines, 2 of them markers). See [SEAMS.md](./SEAMS.md).

## Optional integrations

- L10 (apple-build-tooling): if L10 is in the tree when this packet is built, the Install
  section lists L10's latest successful build products for the project as install candidates,
  and L10's "Build and run" gets a "Run flows after launch" option that calls this packet's
  flow runner. If L10 lands later, L10 adds the same hooks. Without L10 the user types or picks
  an artifact path.
- L11 (browser-dev-tools): none.

## Size estimate

Large: about 3,500 lines including tests (server about 1,700, web about 1,500).

## How an agent starts

Read AGENTS.md, FORK.md, the packets README, CONVENTIONS.md, EXTENSION-POINTS.md, then this
folder: PRODUCT.md, TECHNICAL.md, SEAMS.md, IMPLEMENTATION.md, TESTING.md, REFERENCES.md. The
argent report format is documented in TECHNICAL.md and REFERENCES.md; automated tests use
recorded NDJSON fixtures and never need argent installed.

## Documents

- [PRODUCT.md](./PRODUCT.md): what and why, for Kyle.
- [TECHNICAL.md](./TECHNICAL.md): the design.
- [SEAMS.md](./SEAMS.md): every upstream touch.
- [IMPLEMENTATION.md](./IMPLEMENTATION.md): ordered steps for the implementing agent.
- [TESTING.md](./TESTING.md): how it is proven.
- [REFERENCES.md](./REFERENCES.md): prior art, argent facts and Apple tooling sources.
