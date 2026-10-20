import { expect, it } from "@effect/vitest";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import { VaultFileContent, VaultItemSave, VaultPrivateSave } from "./vault-core.ts";

const decodeSaveOption = Schema.decodeUnknownOption(VaultItemSave);
const request = {
  id: "a".repeat(32),
  operationId: "b".repeat(32),
  expectedVersion: 0,
  label: "Development token",
  kind: "secret" as const,
};
it("redacts incoming values while permitting metadata-only updates", () => {
  const decode = Schema.decodeUnknownSync(VaultItemSave);
  const secret = decode({ ...request, value: "synthetic-private-token" });
  expect(Redacted.value(secret.value!)).toBe("synthetic-private-token");
  expect(JSON.stringify(secret)).not.toContain("synthetic-private-token");
  expect(decode({ ...request, expectedVersion: 1 }).value).toBeUndefined();
  expect(Option.isNone(decodeSaveOption({ ...request, expectedVersion: -1 }))).toBe(true);
});
it("requires a private reference rather than an inline value for agent storage", () => {
  const decode = Schema.decodeUnknownOption(VaultPrivateSave);
  expect(Option.isNone(decode({ ...request, value: "inline-secret" }))).toBe(true);
  expect(Option.isSome(decode({ ...request, secretRef: "secret-ref:" + "c".repeat(32) }))).toBe(
    true,
  );
});
it("rejects traversal, control characters and malformed base64 in secure file content", () => {
  const decode = Schema.decodeUnknownOption(VaultFileContent);
  for (const name of [
    "../key",
    "folder/key",
    "folder\\key",
    ".",
    "..",
    "name\u0000.txt",
    "name\n.txt",
  ]) {
    expect(Option.isNone(decode({ name, mediaType: "text/plain", base64: "YQ==" }))).toBe(true);
  }
  expect(
    Option.isNone(decode({ name: "key.txt", mediaType: "text/plain", base64: "invalid%" })),
  ).toBe(true);
  expect(Option.isSome(decode({ name: "key.txt", mediaType: "text/plain", base64: "YQ==" }))).toBe(
    true,
  );
});
