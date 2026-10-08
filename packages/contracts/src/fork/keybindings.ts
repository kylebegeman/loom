/** Loom keybinding commands (`loom.<slug>.<action>`). Spread into STATIC_KEYBINDING_COMMANDS. */
export const FORK_KEYBINDING_COMMANDS = [
  "loom.pcb-preview.toggle",
  "loom.file-outline.toggle",
  "loom.thread-inspector.toggle",
  "loom.thread-inspector.card",
  "loom.model-preview-3d.open",
  "loom.model-preview-3d.capture",
] as const;
export type ForkKeybindingCommand = (typeof FORK_KEYBINDING_COMMANDS)[number];

export const isForkKeybindingCommand = (command: string): command is ForkKeybindingCommand =>
  (FORK_KEYBINDING_COMMANDS as ReadonlyArray<string>).includes(command);
