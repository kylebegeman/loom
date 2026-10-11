import { capTriangles, CheckFailure, type TriangleSoup } from "./mesh.ts";
import type { CheckFile } from "./protocol.ts";

/** Expands face fans and resolves negative references against the vertices seen at that line. */
export const readObj = (
  files: readonly CheckFile[],
  limits: { readonly maxTriangles: number },
): TriangleSoup => {
  const bytes = files[0]?.bytes;
  if (!bytes) throw new CheckFailure("command-failed", "This OBJ file is damaged.");
  const points: number[] = [];
  const values: number[] = [];
  for (const [index, line] of new TextDecoder().decode(bytes).split(/\r?\n/).entries()) {
    const fields = line.split("#", 1)[0]!.trim().split(/\s+/);
    const fail = () => {
      throw new CheckFailure(
        "command-failed",
        `This OBJ has invalid geometry at line ${index + 1}.`,
      );
    };
    if (fields[0] === "v") {
      if (fields.length < 4) fail();
      const point = fields.slice(1, 4).map(Number);
      if (point.some((value) => !Number.isFinite(value))) fail();
      points.push(...point);
    } else if (fields[0] === "f") {
      if (fields.length < 4) fail();
      const face = fields.slice(1).map((field) => {
        const token = field.split("/", 1)[0]!;
        if (!/^-?\d+$/.test(token)) fail();
        const reference = Number(token);
        const vertex = reference > 0 ? reference - 1 : points.length / 3 + reference;
        if (
          !reference ||
          !Number.isSafeInteger(vertex) ||
          vertex < 0 ||
          vertex >= points.length / 3
        )
          fail();
        return vertex;
      });
      capTriangles(values.length / 9 + face.length - 2, limits.maxTriangles);
      for (let i = 1; i < face.length - 1; i++) {
        for (const vertex of [face[0]!, face[i]!, face[i + 1]!]) {
          values.push(points[vertex * 3]!, points[vertex * 3 + 1]!, points[vertex * 3 + 2]!);
        }
      }
    }
  }
  return Float32Array.from(values);
};
