import { describe, expect, it } from "@effect/vitest";
import {
  boundedDocumentText,
  documentSources,
  matchesDocumentSource,
  parseDecisionDocument,
  safeDocumentPath,
  splitCatalogue,
} from "./library-decisions.ts";

describe("Library decision records", () => {
  it.each([
    ["- **Status:** Accepted. Removing the worktree is in progress.", "accepted"],
    ["Status: In progress", "in-progress"],
    ["**Status:** Superseded", "superseded"],
    ["- Status: Proposed", "idea"],
    ["This decision was accepted on 17 October 2026.", "accepted"],
    ["Status: undecided", "unknown"],
  ])("reads the status convention %s", (header, status) => {
    expect(
      parseDecisionDocument("docs/adr/0001-test.md", `# Test\n${header}\n- **Date:** 2026-10-17`)
        .status,
    ).toBe(status);
  });
  it("keeps date and superseding record", () => {
    expect(
      parseDecisionDocument(
        "docs/adr/0001.md",
        "# Original\nStatus: Superseded\nDate: 2026-10-17\nSuperseded by: [0002](0002.md)",
      ),
    ).toMatchObject({ title: "Original", date: "2026-10-17", supersededBy: "[0002](0002.md)" });
  });
  it("bounds Unicode records at 64 KiB", () => {
    const result = boundedDocumentText("😀".repeat(20_000));
    expect(new TextEncoder().encode(result).length).toBe(65536);
    expect(result.endsWith("�")).toBe(false);
  });
  it("splits catalogue headings, ignores fenced examples and keeps anchors unique", () => {
    const rows = splitCatalogue(
      "# Ideas\n### Recovery & keys\nFirst\n#### Detail\nKeep\n```md\n### Example\n```\n### Recovery & keys\nStatus: Accepted\nSecond\n## Next\nDo not include\n### Third\nLast",
    );
    expect(rows.map(({ anchor, status }) => ({ anchor, status }))).toEqual([
      { anchor: "recovery--keys", status: "idea" },
      { anchor: "recovery--keys-1", status: "accepted" },
      { anchor: "third", status: "idea" },
    ]);
    expect(rows[0]!.text).toContain("#### Detail");
    expect(rows[1]!.text).not.toContain("Do not include");
  });
});

describe("Library document sources", () => {
  it("selects numbered ADR files by default", () => {
    const sources = documentSources();
    expect(
      sources.some((source) => matchesDocumentSource("docs/decisions/0001-recovery.md", source)),
    ).toBe(true);
    expect(
      sources.some((source) => matchesDocumentSource("docs/decisions/README.md", source)),
    ).toBe(false);
    expect(
      sources.some((source) => matchesDocumentSource("docs/decisions/nested/0001.md", source)),
    ).toBe(false);
  });
  it("uses the manifest exclusively, including deliberate opt out", () => {
    expect(documentSources({ version: 1, sources: [] })).toEqual([]);
    const [source] = documentSources({
      version: 1,
      sources: [{ glob: "docs/decisions/[0-9][0-9][0-9][0-9]-*.md", kind: "decision" }],
    });
    expect(matchesDocumentSource("docs/decisions/0001-recovery.md", source!)).toBe(true);
  });
  it.each([
    "../outside.md",
    "/outside.md",
    "docs/../../outside.md",
    "docs//outside.md",
    "docs/secret\\outside.md",
    ".git/config.md",
    "docs/.hidden.md",
  ])("refuses unsafe path %s", (path) => {
    expect(safeDocumentPath(path)).toBe(false);
    expect(() => documentSources({ version: 1, sources: [{ path, kind: "decision" }] })).toThrow();
  });
  it("fails closed for malformed manifests and unsupported patterns", () => {
    expect(() => documentSources("bad JSON")).toThrow();
    expect(() => documentSources({ version: 2, sources: [] })).toThrow();
    expect(() =>
      documentSources({ version: 1, sources: [{ glob: "docs/[a-z]*.md", kind: "decision" }] }),
    ).toThrow();
  });
});
