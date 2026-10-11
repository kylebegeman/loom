import { capTriangles, CheckFailure, type TriangleSoup } from "./mesh.ts";
import type { CheckFile } from "./protocol.ts";

/** Ignores stored normals; geometry is authoritative for the print checks. */
export const readStl = (
  files: readonly CheckFile[],
  limits: { readonly maxTriangles: number },
): TriangleSoup => {
  const bytes = files[0]?.bytes;
  if (!bytes) throw new CheckFailure("command-failed", "This STL file is damaged.");
  const data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = bytes.length >= 84 ? data.getUint32(80, true) : 0;
  if (bytes.length >= 84 && bytes.length === 84 + 50 * count) {
    capTriangles(count, limits.maxTriangles);
    const triangles = new Float32Array(count * 9);
    for (let triangle = 0; triangle < count; triangle++) {
      for (let coordinate = 0; coordinate < 9; coordinate++) {
        const value = data.getFloat32(84 + triangle * 50 + 12 + coordinate * 4, true);
        if (!Number.isFinite(value))
          throw new CheckFailure("command-failed", "This STL file contains invalid coordinates.");
        triangles[triangle * 9 + coordinate] = value;
      }
    }
    return triangles;
  }
  const source = new TextDecoder().decode(bytes);
  if (!/^\s*solid\b/i.test(source))
    throw new CheckFailure("command-failed", "This STL file is damaged.");
  const values: number[] = [];
  let vertices = 0;
  let facet = false;
  for (const [index, line] of source.split(/\r?\n/).entries()) {
    const fail = () => {
      throw new CheckFailure(
        "command-failed",
        `This STL has a damaged facet at line ${index + 1}.`,
      );
    };
    if (/^\s*facet\b/i.test(line)) {
      if (facet) fail();
      facet = true;
      vertices = 0;
    } else if (/^\s*vertex\b/i.test(line)) {
      if (!facet || vertices >= 3) fail();
      const fields = line.trim().split(/\s+/).slice(1).map(Number);
      if (fields.length !== 3 || fields.some((value) => !Number.isFinite(value))) fail();
      capTriangles(Math.floor(values.length / 9) + 1, limits.maxTriangles);
      values.push(...fields);
      vertices++;
    } else if (/^\s*endfacet\b/i.test(line)) {
      if (!facet || vertices !== 3) fail();
      facet = false;
    }
  }
  if (facet)
    throw new CheckFailure(
      "command-failed",
      "This STL has an incomplete facet at the end of the file.",
    );
  return Float32Array.from(values);
};
