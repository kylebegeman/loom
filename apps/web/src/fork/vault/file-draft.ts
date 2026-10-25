import { VaultFileContent } from "@t3tools/contracts/fork";
import { VAULT_FILE_LIMIT_BYTES } from "@t3tools/client-runtime/fork";
import * as Schema from "effect/Schema";
const encode = Schema.encodeSync(Schema.fromJsonString(VaultFileContent));
export async function readVaultFile(file: File) {
  if (file.size > VAULT_FILE_LIMIT_BYTES) throw new Error("Choose a file no larger than 512 KB.");
  const data = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  for (const byte of data) binary += String.fromCharCode(byte);
  return {
    name: file.name,
    value: encode({ name: file.name, mediaType: file.type, base64: btoa(binary) }),
  };
}
