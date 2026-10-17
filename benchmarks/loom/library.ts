import * as NodeAssert from "node:assert/strict";
import { createLibraryBenchmarkFixture } from "../../apps/server/scripts/benchmark-library.ts";
import { defineBenchmark, fingerprint } from "./harness.ts";

export async function makeLibraryBenchmarks() {
  const fixtures: Awaited<ReturnType<typeof createLibraryBenchmarkFixture>>[] = [];
  try {
    const cases = [];
    for (const historyItems of [100, 1000, 8000]) {
      const fixture = await createLibraryBenchmarkFixture(historyItems);
      fixtures.push(fixture);
      cases.push(
        defineBenchmark({
          id: `library.history.rewrite.${historyItems}`,
          description:
            "Rewrite browsing history and the full-text index through LibraryStore transactions; two alternating archives with deduplicated compressed blobs",
          workload: { historyItems, archiveWrites: 2, pageItems: 40, compressedBlobs: 2 },
          run: fixture.rewrite,
          check: async () => {
            const result = await fixture.inspect();
            NodeAssert.equal(result.retained, fixture.expected.retained);
            NodeAssert.deepEqual(
              { ...result.counts },
              {
                browsing: historyItems,
                searchable: historyItems,
                blobs: 2,
              },
            );
            NodeAssert.ok(result.newest);
            NodeAssert.ok(result.older);
            NodeAssert.equal(result.newest.totalItems, historyItems);
            NodeAssert.equal(result.older.totalItems, historyItems);
            NodeAssert.equal(result.newest.itemCount, 40);
            NodeAssert.equal(result.older.itemCount, 40);
            NodeAssert.deepEqual(
              JSON.parse(result.newest.payload).projection.messages,
              fixture.expected.newest,
            );
            NodeAssert.deepEqual(
              JSON.parse(result.older.payload).projection.messages,
              fixture.expected.older,
            );
            return fingerprint(result);
          },
        }),
      );
    }
    return {
      cases,
      close: async () => {
        for (const fixture of fixtures) await fixture.close();
      },
    };
  } catch (error) {
    for (const fixture of fixtures) await fixture.close();
    throw error;
  }
}
