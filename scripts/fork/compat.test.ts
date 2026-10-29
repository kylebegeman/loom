import { expect, it } from "vite-plus/test";
import { compatibilityReport, formatCompatibilityReport } from "./compat.ts";

it("reports literal, imported and multiline floor guards without retiring other capabilities", () => {
  const report = compatibilityReport([
    {
      path: "packages/contracts/src/fork/flags.ts",
      text: 'export const FILES = "library-launch-files";\nexport const RELEASE = "checkout-release";',
    },
    {
      path: "apps/web/src/fork/example.ts",
      text: `import { FILES as LAUNCH } from "./flags";
const works = supportsLoomFeature(config(a, b), "project-workflows");
const files = supportsLoomFeature(
  host?.capabilities,
  LAUNCH,
);
const packet = supportsLoomFeature(capabilities, "project-library");
const release = supportsLoomFeature(capabilities, RELEASE);
const dynamic = supportsLoomFeature(capabilities, flag);
const message = "Update Loom on your Library";`,
    },
  ]);
  expect(
    report.checks.map(({ line, feature, impliedByFloor }) => ({ line, feature, impliedByFloor })),
  ).toEqual([
    { line: 2, feature: "project-workflows", impliedByFloor: true },
    { line: 3, feature: "library-launch-files", impliedByFloor: true },
    { line: 7, feature: "project-library", impliedByFloor: false },
    { line: 8, feature: "checkout-release", impliedByFloor: false },
    { line: 9, feature: null, impliedByFloor: false },
  ]);
  expect(report.wording[0]).toMatchObject({
    line: 10,
    nearbyFloorFeatures: ["project-workflows", "library-launch-files"],
  });
  expect(formatCompatibilityReport(report)).toContain("not proof of ownership");
});
