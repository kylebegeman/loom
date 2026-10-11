import { thumbnail } from "../model-preview-3d/viewer/captureSheet";
const frame = (svg: string) => {
  const root = /<svg\b[^>]*>/.exec(svg)?.[0];
  const box = root
    ?.match(/\bviewBox=["']([^"']+)["']/)?.[1]
    ?.trim()
    .split(/[\s,]+/)
    .map(Number);
  if (!box || box.length !== 4 || !box.every(Number.isFinite) || box[2]! <= 0 || box[3]! <= 0)
    throw new Error("The candidate drawing has no physical view box.");
  return box as [number, number, number, number];
};
export function alignSvgPair(a: string, b: string): [string, string] {
  const fa = frame(a),
    fb = frame(b),
    x = Math.min(fa[0], fb[0]),
    y = Math.min(fa[1], fb[1]);
  const w = Math.max(fa[0] + fa[2], fb[0] + fb[2]) - x,
    h = Math.max(fa[1] + fa[3], fb[1] + fb[3]) - y;
  return [a, b].map((svg) =>
    svg.replace(/<svg\b[^>]*>/, (tag) =>
      tag
        .replace(/\s(?:width|height|viewBox)=["'][^"']*["']/g, "")
        .replace(
          /\/?>$/,
          (closing) => ` width="${w}mm" height="${h}mm" viewBox="${x} ${y} ${w} ${h}"${closing}`,
        ),
    ),
  ) as [string, string];
}
export async function svgThumbnail(svg: string) {
  const f = frame(svg),
    scale = Math.min(480 / f[2], 360 / f[3]);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(f[2] * scale));
  canvas.height = Math.max(1, Math.round(f[3] * scale));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Image canvas unavailable.");
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (value) => (value ? resolve(value) : reject(new Error("Could not create thumbnail."))),
        "image/png",
      ),
    );
    return await thumbnail(blob, 24000);
  } finally {
    URL.revokeObjectURL(url);
    canvas.width = 0;
    canvas.height = 0;
  }
}
