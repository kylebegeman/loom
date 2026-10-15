# 10. Reproducible LoomOS setup

Commission an existing Omarchy machine from a portable, versioned recipe.

Status: **completed**. Complexity: **Large**. Impact: **High**.

Owner: LoomOS with existing app/hub owners. Dependencies: [#4](04-guided-connections.md), [#6](06-shortcut-and-accessibility-presets.md), [#8](08-iris-consistency.md), [#9](09-omarchy-compatibility-checks.md).

## Scope

- Declare laptop/workstation profile, selected releases, app origins and supported appearance/settings.
- Keep secrets and device-specific identifiers out of recipes; resume interrupted commissioning.
- Guide necessary local administrator authentication and verify final health/recovery paths.

## Acceptance

- Commission clean laptop and workstation installations from the same reviewed recipe.
- Test interruption, rerun, existing personalized machines and incompatible components.
- Recover a replacement machine without relying on session artifact scripts.

## Delivery

Local preparation and focused checks first. Workstation rollout/native acceptance when reachable; secure lock and necessary local authentication remain normal user flows.

## Evidence

- Portable version 1 recipes and verified recovery kits are implemented in the repository-owned commissioner. The kit pins the integration, custom Loom desktop/server, Office/Atlas CLIs and Switchboard client, uses destination HOME/XDG paths and contains no account homes, credentials, browser profiles or application databases. One kit supports laptop/workstation; the laptop omits standalone hosting.
- 178 focused integration checks passed on macOS and native x64 Linux, with scoped lint and generated packet checks. Fifteen commissioning cases cover both clean profile homes, interruption/resumption, amended-recipe journal retirement, source/installed tampering, safe relative links, missing prerequisites, unsupported architecture/Omarchy, private-file exclusion, personal settings preservation, native lock/foreign-service refusal and runtime mirror cleanup. Physical laptop commissioning remains separate from these isolated fixtures.
- The same final kit also commissioned fresh isolated laptop and workstation homes on Workstation using its actual Omarchy installation and real release payloads. Fresh-login bindings and inactive hosting observations were modeled; live connection probes were omitted; no real service was created and local appearance/branding/widget/hosting steps were correctly reported unfinished. Laptop installation omitted the standalone server runtime.
- Workstation is commissioned and all 16 installed checks report ready. Pack 20261012.40 has manifest SHA256 3e2bfe15c0ce879920f400c6ecdb993f87264d030aa52726088aef4ca7572055. The Mac and Workstation independently built identical complete kits with recipe SHA256 98cd6f8dcaf96a13d10fec2e9c8f1f9a7c4a821b60f0923e9364fa0615994b68. The kit is retained on both machines outside the source repository.
- Actual native recovery exercised .40 -> .39 rollback and .39 -> .40 reapplication through the saved kit bootstrap. The source commissioner works independently of the installed CLI. Original T3 service PID 1152, off DND, app windows, current Iris appearance, protected branding and 27 preserved file hashes remain unchanged. Existing Office/Atlas CLI and Switchboard access were reused without new authorizations or provider inference.
- Native Omarchy exposes Machine setup and recovery in Maintenance and the existing searchable action catalog. Its installed terminal visibly renders all 16 ready checks and local continuation actions. Local protected publishing, initial hosting, appearance and widget actions retain existing owner workflows and secure-lock checks. No protected publication or real new service installation occurred in the live check.
- Live acceptance found opaque Lua callbacks falsely conflicting with unchanged presets. A failing regression proves the issue; unchanged owned binding blocks now introduce no new conflict. Commissioning preserves an existing machine's implicit keys even without a preset file. An early interrupted candidate journal was archived explicitly without discarding installed data or services.
- Recovery acceptance also caught an incomplete copied T3 executable. The final kit includes the full checked release with SDKs, client assets and resource monitor; setup and status require its isolated exact-version check. A real loopback mirror checksum/download, standard tar extraction and extracted t3 v0.0.45-loomos.20261011.5 version proof passed. The normal T3 installer remains authoritative; initial runtime mirror is temporary and the persisted custom fork origin is retained. No live service restart or replacement was used.
- Setup and recovery guidance: deploy/omarchy/recipes/README.md. Evidence, independent kit and private native screenshot: /Users/kyle/Developer/artifacts/loom-os/2026-10-12/reproducible-setup. Fresh full-disk Omarchy provisioning, physical laptop checks and first-time privileged/service-manager commissioning remain normal machine acceptance; fixtures and the live existing workstation are distinguished. Packet #14 remains excluded.
