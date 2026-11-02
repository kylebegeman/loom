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
