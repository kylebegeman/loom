import { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";
import {
  preparationReceiptKey,
  recordPreparationReceipt,
  sanitizePreparationReceipts,
  type ProjectPreparationReceipt,
} from "./projectPreparationReceipt";

const receipt: ProjectPreparationReceipt = {
  sourceEnvironmentId: EnvironmentId.make("source"),
  sourceProjectId: ProjectId.make("source-project"),
  destinationEnvironmentId: EnvironmentId.make("destination"),
  projectId: ProjectId.make("stable-clone"),
  title: "Loom",
  createdAt: "2026-10-13T12:00:00Z",
  remoteUrl: "https://example.test/team/loom.git",
  repositoryKey: "example.test/team/loom",
  destinationPath: "/ssd/loom",
};
const key = preparationReceiptKey(
  receipt.sourceEnvironmentId,
  receipt.sourceProjectId,
  receipt.destinationEnvironmentId,
);
describe("native preparation receipts", () => {
  it("round-trips exact request details and allows only an identical retry", () => {
    const records = recordPreparationReceipt(undefined, receipt);
    const restored = sanitizePreparationReceipts(JSON.parse(JSON.stringify(records)));
    expect(restored?.[key]).toEqual(receipt);
    expect(recordPreparationReceipt(restored, { ...receipt })).toEqual(records);
    expect(() =>
      recordPreparationReceipt(restored, { ...receipt, projectId: ProjectId.make("another") }),
    ).toThrow("already owns");
    expect(() =>
      recordPreparationReceipt(restored, { ...receipt, destinationPath: "/different" }),
    ).toThrow("already owns");
    expect(() =>
      recordPreparationReceipt(restored, {
        ...receipt,
        remoteUrl: "https://example.test/another.git",
      }),
    ).toThrow("already owns");
  });
  it("keeps an unreadable saved claim as a blocker instead of pretending no attempt exists", () => {
    const records = sanitizePreparationReceipts({ [key]: { projectId: "partial" } });
    expect(records).toEqual({ [key]: null });
    expect(() => recordPreparationReceipt(records, receipt)).toThrow("already owns");
  });
  it("blocks a readable receipt filed under a different source or destination", () => {
    expect(
      sanitizePreparationReceipts({
        [key]: { ...receipt, destinationEnvironmentId: EnvironmentId.make("another-host") },
      }),
    ).toEqual({ [key]: null });
    expect(
      sanitizePreparationReceipts({
        [key]: { ...receipt, sourceProjectId: ProjectId.make("another-source") },
      }),
    ).toEqual({ [key]: null });
  });
  it("separates exact destination hosts and source project owners", () => {
    const first = recordPreparationReceipt(undefined, receipt);
    const other = { ...receipt, destinationEnvironmentId: EnvironmentId.make("other") };
    const records = recordPreparationReceipt(first, other);
    expect(Object.keys(records)).toHaveLength(2);
    expect(
      preparationReceiptKey(
        receipt.sourceEnvironmentId,
        ProjectId.make("another-source"),
        receipt.destinationEnvironmentId,
      ),
    ).not.toBe(key);
  });
});
