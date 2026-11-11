import { expect, it, vi } from "vite-plus/test";
import { SitesError, type SitesSnapshot } from "@t3tools/contracts/fork";
import { createSitesWriteGuard } from "./sites.ts";

const site = {
  id: "site",
  name: "Site",
  url: "https://site.example",
  active: true,
  origins: ["https://site.example"],
  serviceIds: [],
  projectIds: ["project"],
};
const snapshot = (observedAt: string, name = "Before", etag = '"base"'): SitesSnapshot => ({
  schemaVersion: 1,
  primarySiteId: "site",
  observedAt,
  staleAfterSeconds: 900,
  sites: [{ ...site, active: 1, name, etag }],
  services: [],
  checks: [],
});
function fixture() {
  const data = new Map<string, string>();
  let sequence = 0;
  const options = {
    load: async (key: string) => data.get(key) ?? null,
    save: async (key: string, value: string) => {
      data.set(key, value);
    },
    remove: async (key: string) => {
      data.delete(key);
    },
    newId: () => `request-${++sequence}`,
    digest: async (value: string) => value,
  };
  return { data, options, guard: createSitesWriteGuard(options) };
}
it("persists identity before dispatch, blocks blind replay, then reuses it only after a fresh read", async () => {
  const f = fixture();
  f.guard.observe("library", snapshot("2026-11-11T12:00:00Z"));
  const send = vi.fn(async (input) => {
    expect(f.data.size).toBe(1);
    throw new SitesError({ stage: "unknown-outcome", requestId: input.requestId });
  });
  const input = { ...site, expectedEtag: '"base"' };
  await expect(f.guard.execute("library", "site", input, send)).rejects.toMatchObject({
    requestId: "request-1",
  });
  const reopened = createSitesWriteGuard(f.options);
  await expect(reopened.execute("library", "site", input, send)).rejects.toMatchObject({
    stage: "unknown-outcome",
    requestId: "request-1",
  });
  expect(send).toHaveBeenCalledTimes(1);
  reopened.observe("library", snapshot("2026-11-11T12:01:00Z"));
  await expect(reopened.execute("library", "site", input, send)).rejects.toMatchObject({
    requestId: "request-1",
  });
  expect(send).toHaveBeenCalledTimes(2);
  expect(send.mock.calls[1]?.[0].requestId).toBe("request-1");
});
it("reconciles matching state by reading and refuses stale overwrite or changed uncertain intent", async () => {
  const f = fixture();
  f.guard.observe("library", snapshot("2026-11-11T12:00:00Z"));
  const input = { ...site, expectedEtag: '"base"' };
  const send = vi.fn(async () => {
    throw new Error("reply lost");
  });
  await expect(f.guard.execute("library", "site", input, send)).rejects.toMatchObject({
    stage: "unknown-outcome",
  });
  f.guard.observe("library", snapshot("2026-11-11T12:01:00Z", "Another editor", '"new"'));
  await expect(f.guard.execute("library", "site", input, send)).rejects.toMatchObject({
    stage: "revision-conflict",
  });
  await expect(
    f.guard.execute("library", "site", { ...input, name: "Changed before review" }, send),
  ).rejects.toMatchObject({ stage: "revision-conflict" });
  f.guard.observe("library", snapshot("2026-11-11T12:02:00Z", site.name, '"saved"'));
  expect(await f.guard.execute("library", "site", input, send)).toEqual(
    snapshot("2026-11-11T12:02:00Z", site.name, '"saved"'),
  );
  expect(send).toHaveBeenCalledTimes(1);
  expect(f.data.size).toBe(0);
});
it("keeps legacy and check-run uncertainty blocked, and separates authority and resource identities", async () => {
  const f = fixture();
  const send = vi.fn(async () => {
    throw new Error("reply lost");
  });
  await expect(f.guard.execute("one", "site", site, send)).rejects.toMatchObject({
    requestId: "request-1",
  });
  f.guard.observe("one", snapshot("2026-11-11T12:01:00Z"));
  await expect(f.guard.execute("one", "site", site, send)).rejects.toMatchObject({
    requestId: "request-1",
  });
  await expect(f.guard.execute("two", "site", site, send)).rejects.toMatchObject({
    requestId: "request-2",
  });
  await expect(f.guard.execute("one", "runChecks", {}, send)).rejects.toMatchObject({
    requestId: "request-3",
  });
  f.guard.observe("one", snapshot("2026-11-11T12:03:00Z"));
  await expect(f.guard.execute("one", "runChecks", {}, send)).rejects.toMatchObject({
    requestId: "request-3",
  });
  expect(send).toHaveBeenCalledTimes(3);
});
it("refuses writes when recovery storage fails and never resumes after an access repair", async () => {
  const f = fixture();
  const send = vi.fn(async () => {
    throw new SitesError({ stage: "permission" });
  });
  await expect(f.guard.execute("library", "site", site, send)).rejects.toMatchObject({
    stage: "permission",
  });
  expect(send).toHaveBeenCalledTimes(1);
  expect(f.data.size).toBe(0);
  const broken = createSitesWriteGuard({
    ...f.options,
    save: async () => {
      throw new Error("disk full");
    },
  });
  await expect(broken.execute("library", "site", site, send)).rejects.toMatchObject({
    stage: "recovery",
  });
  expect(send).toHaveBeenCalledTimes(1);
});

it("requires a newer observation, then treats an explicitly reviewed revision as a new intent", async () => {
  const f = fixture();
  const input = { ...site, expectedEtag: '"base"' };
  f.guard.observe("library", snapshot("2026-11-11T12:01:00Z"));
  const lost = vi.fn(async () => {
    throw new Error("reply lost");
  });
  await expect(f.guard.execute("library", "site", input, lost)).rejects.toMatchObject({
    requestId: "request-1",
  });
  f.guard.observe("library", snapshot("2026-11-11T12:00:00Z"));
  await expect(f.guard.execute("library", "site", input, lost)).rejects.toMatchObject({
    stage: "unknown-outcome",
  });
  f.guard.observe("library", snapshot("2026-11-11T12:02:00Z", "Another edit", '"new"'));
  const send = vi.fn(async (_input: typeof input & { requestId: string }) =>
    snapshot("2026-11-11T12:03:00Z", site.name, '"saved"'),
  );
  await f.guard.execute(
    "library",
    "site",
    { ...input, expectedEtag: '"new"', requestId: "request-1" },
    send,
  );
  expect(send.mock.calls[0]?.[0]).toMatchObject({ requestId: "request-2", expectedEtag: '"new"' });
  expect(lost).toHaveBeenCalledTimes(1);
});
