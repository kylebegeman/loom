import type { ModelSavedView } from "@t3tools/contracts/fork";
import type { ModelViewer } from "./createViewer";
export async function thumbnail(blob: Blob) {
  const bitmap = await createImageBitmap(blob);
  try {
    const canvas = document.createElement("canvas");
    const scale = Math.min(480 / bitmap.width, 360 / bitmap.height, 1);
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Image canvas unavailable.");
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    let quality = 0.65;
    let url = canvas.toDataURL("image/jpeg", quality);
    while (url.length > 50000 && quality > 0.15) {
      quality -= 0.1;
      url = canvas.toDataURL("image/jpeg", quality);
    }
    if (url.length > 50000) throw new Error("Thumbnail is too large. Try a simpler view.");
    return url;
  } finally {
    bitmap.close();
  }
}
export async function captureNamedViews(
  viewer: ModelViewer,
  views: readonly ModelSavedView[],
  footer: string,
  revision?: string,
) {
  const original = viewer.snapshot();
  const sheet = document.createElement("canvas");
  sheet.width = views.length === 1 ? 1200 : 1600;
  sheet.height = views.length <= 2 ? 640 : 1240;
  const context = sheet.getContext("2d");
  if (!context) throw new Error("Image canvas unavailable.");
  let captures: Promise<Blob>[];
  try {
    captures = views.map((view) => {
      viewer.restore(view.camera);
      if (revision && view.sourceRevision !== revision) viewer.refit();
      return viewer.capture(false);
    });
  } finally {
    viewer.restore(original);
  }
  // Observe every encoding promise immediately, including later frames if an earlier one fails.
  const frames = await Promise.all(captures);
  context.fillStyle = "#151920";
  context.fillRect(0, 0, sheet.width, sheet.height);
  for (const [index, view] of views.entries()) {
    const bitmap = await createImageBitmap(frames[index]!);
    const width = views.length === 1 ? 1200 : 800,
      height = 600,
      x = views.length === 1 ? 0 : (index % 2) * 800,
      y = Math.floor(index / 2) * 600;
    const scale = Math.min(width / bitmap.width, (height - 36) / bitmap.height);
    context.drawImage(
      bitmap,
      x + (width - bitmap.width * scale) / 2,
      y + 36 + (height - 36 - bitmap.height * scale) / 2,
      bitmap.width * scale,
      bitmap.height * scale,
    );
    bitmap.close();
    context.fillStyle = "white";
    context.font = "20px sans-serif";
    context.fillText(view.name, x + 16, y + 26);
  }
  context.font = "16px sans-serif";
  context.fillStyle = "white";
  context.fillText(footer, 16, sheet.height - 14, sheet.width - 32);
  return new Promise<Blob>((resolve, reject) =>
    sheet.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Capture failed."))),
      "image/png",
    ),
  );
}
