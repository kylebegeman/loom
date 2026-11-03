type ObjectValue = Record<string, unknown>;
export const draftObject = (value: unknown): ObjectValue =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as ObjectValue)
    : {};
export const draftText = (value: unknown) => (typeof value === "string" ? value : "");
export const draftRows = (value: unknown) => (Array.isArray(value) ? value.map(draftObject) : []);
export function formatResponse(body: string, pretty: boolean) {
  if (!pretty || body.length > 262144) return body;
  try {
    return JSON.stringify(JSON.parse(body), null, 2);
  } catch {
    return body;
  }
}

export async function readMultipartFiles(files: Readonly<Record<number, readonly File[]>>) {
  const entries = Object.entries(files).flatMap(([index, items]) =>
    items.map((file) => ({ fieldIndex: Number(index), file })),
  );
  if (entries.length > 32 || entries.reduce((sum, entry) => sum + entry.file.size, 0) > 131072)
    throw new Error(
      "Choose at most 32 files totaling less than 128 KiB, leaving room for field headers.",
    );
  return Promise.all(
    entries.map(async ({ fieldIndex, file }) => {
      const bytes = new Uint8Array(await file.arrayBuffer());
      let binary = "";
      for (const byte of bytes) binary += String.fromCharCode(byte);
      return { fieldIndex, fileName: file.name, contentType: file.type, base64: btoa(binary) };
    }),
  );
}
