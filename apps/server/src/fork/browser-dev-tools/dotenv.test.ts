import { expect, it } from "@effect/vitest";
import * as NodeUtil from "node:util";
import { updateDotenv } from "./dotenv.ts";
it("updates the last definition and empty or multiline values while preserving comments and unrelated bytes", () => {
  const source =
    '# keep\nA=older\nexport A=old # note\nEMPTY=\nMULTI="first\nline"\nUNTOUCHED=yes\n';
  const values = [
    { key: "A", value: "new", secret: true },
    { key: "EMPTY", value: "filled", secret: true },
    { key: "MULTI", value: "next\nline", secret: true },
    { key: "ADDED", value: "value # quoted", secret: true },
  ];
  const updated = updateDotenv(source, values);
  expect(updated).toContain("# keep\nA=older\nexport A='new' # note\nEMPTY='filled'\n");
  expect(updated).toContain("UNTOUCHED=yes\n");
  expect(NodeUtil.parseEnv(updated)).toMatchObject(
    Object.fromEntries(values.map((v) => [v.key, v.value])),
  );
  expect(updateDotenv(updated, values)).toBe(updated);
});
