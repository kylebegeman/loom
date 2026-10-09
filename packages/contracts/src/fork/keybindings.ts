/** Loom keybinding commands (`loom.<slug>.<action>`). Spread into STATIC_KEYBINDING_COMMANDS. */
export const FORK_KEYBINDING_COMMANDS = [
  "loom.pcb-preview.toggle",
  "loom.file-outline.toggle",
  "loom.thread-inspector.toggle",
  "loom.thread-inspector.card",
  "loom.model-preview-3d.open",
  "loom.model-preview-3d.capture",
  "loom.apple-build-tooling.toggle",
  "loom.apple-build-tooling.build",
  "loom.apple-build-tooling.test",
  "loom.apple-build-tooling.run",
  "loom.device-qa.toggle",
  "loom.device-qa.capture",
  "loom.device-qa.run-last-flow",
] as const;
export type ForkKeybindingCommand = (typeof FORK_KEYBINDING_COMMANDS)[number];

export const isForkKeybindingCommand = (command: string): command is ForkKeybindingCommand =>
  (FORK_KEYBINDING_COMMANDS as ReadonlyArray<string>).includes(command);

/** Display names for slugs the Keybindings page cannot title-case from the id. */
export const FORK_KEYBINDING_FEATURE_NAMES: Readonly<Record<string, string>> = {
  "pcb-preview": "PCB Preview",
  "model-preview-3d": "3D Model",
  "device-qa": "Device QA",
};
