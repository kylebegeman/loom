import { expect, it } from "vite-plus/test";
import { LibraryError } from "@t3tools/contracts/fork";
import { visibleLibraryArchive, libraryRetentionDays } from "./libraryDeleted";

it("drops cached history after a not-found response while retaining it during an outage", () => {
  const cached = { title: "Saved history" };
  expect(visibleLibraryArchive(cached, new LibraryError({ reason: "not-found" }))).toBeNull();
  expect(visibleLibraryArchive(cached, new LibraryError({ reason: "publisher-unavailable" }))).toBe(
    cached,
  );
  expect(visibleLibraryArchive(cached, null)).toBe(cached);
});
it("only promises a retention period when the saved copy and Library preference are confirmed", () => {
  expect(libraryRetentionDays(true, true, { retentionDays: 14 })).toBe(14);
  expect(libraryRetentionDays(false, true, { retentionDays: 14 })).toBeNull();
  expect(libraryRetentionDays(null, true, { retentionDays: 14 })).toBeNull();
  expect(libraryRetentionDays(true, false, { retentionDays: 14 })).toBeNull();
  expect(libraryRetentionDays(true, true, null)).toBeNull();
});
