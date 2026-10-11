export type ExportAction = "copy" | "save";

const safePart = (value: string, fallback: string) =>
  value
    .replace(/[^A-Za-z0-9._]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || fallback;

/** A local download name that keeps the model, view and local capture time recognizable. */
export function captureFileName(
  path: string,
  label: string,
  date: Date,
  extension: "png" | "svg" = "png",
): string {
  const model =
    path
      .split(/[\\/]/)
      .at(-1)
      ?.replace(/\.[^.]*$/, "") ?? "";
  const pad = (value: number) => String(value).padStart(2, "0");
  const time = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}`;
  return `${safePart(model, "model")}-${safePart(label, "view")}-${time}.${extension}`;
}

export function canCopyImages(): boolean {
  return (
    typeof window !== "undefined" &&
    window.isSecureContext &&
    typeof navigator !== "undefined" &&
    typeof navigator.clipboard?.write === "function" &&
    typeof ClipboardItem !== "undefined" &&
    ClipboardItem.supports?.("image/png") !== false
  );
}

/** Start the write during the user gesture, while rendering may still be pending. */
export function copyImage(image: Promise<Blob>): Promise<void> {
  // A clipboard denial can precede a render failure; observe both promises immediately.
  void image.catch(() => undefined);
  if (!canCopyImages())
    throw new Error(
      "Image copying is unavailable. Use a secure browser connection or save the image.",
    );
  return navigator.clipboard.write([new ClipboardItem({ "image/png": image })]);
}

/** Downloads a rendered image without changing the composer draft. */
export function saveImage(image: Blob, name: string): void {
  const url = URL.createObjectURL(image);
  try {
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = name;
    anchor.click();
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  }
}
