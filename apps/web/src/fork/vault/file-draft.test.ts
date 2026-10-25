import { expect, it } from "vite-plus/test";
import { readVaultFile } from "./file-draft";
it("keeps binary contents, filename and media type in a secure file draft", async () => {
  const draft = await readVaultFile(
    new File([new Uint8Array([0, 255, 10, 13])], "key.p8", { type: "application/octet-stream" }),
  );
  expect(draft.name).toBe("key.p8");
  expect(JSON.parse(draft.value)).toEqual({
    name: "key.p8",
    mediaType: "application/octet-stream",
    base64: "AP8KDQ==",
  });
});
it("rejects files over the Vault limit before reading them", async () => {
  await expect(
    readVaultFile(new File([new Uint8Array(512 * 1024 + 1)], "too-big.bin")),
  ).rejects.toThrow("512 KB");
});
