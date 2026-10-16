/** Enrollment lives beside machine configuration, never inside a source's native history database. */
export function libraryComputerDirectory(homeDirectory: string, environmentId: string) {
  return `${homeDirectory}/.config/loom/computers/computer-${encodeURIComponent(environmentId)}`;
}
