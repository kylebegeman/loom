/**
 * Where a computer's Library enrollment lives: beside machine configuration, never inside a
 * source's native history database. The server and the desktop updater both read it.
 */
export function libraryComputerDirectory(homeDirectory: string, environmentId: string) {
  return `${homeDirectory}/.config/loom/computers/computer-${encodeURIComponent(environmentId)}`;
}
