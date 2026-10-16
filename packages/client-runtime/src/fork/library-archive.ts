import type { LibraryThreadSummary } from "@t3tools/contracts/fork";

/** Cheap summary updates reload only the conversation currently being read. */
export function shouldRefreshLibraryArchive(
  archive: Pick<LibraryThreadSummary, "id" | "sequence"> | null,
  listed: Pick<LibraryThreadSummary, "id" | "sequence"> | undefined,
) {
  return archive !== null && listed?.id === archive.id && listed.sequence > archive.sequence;
}
