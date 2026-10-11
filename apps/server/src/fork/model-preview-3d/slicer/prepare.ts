import * as Schema from "effect/Schema";
// @effect-diagnostics nodeBuiltinImport:off -- Content hashing is a host filesystem adapter.
import * as NodeCrypto from "node:crypto";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Stream from "effect/Stream";
import * as ProcessRunner from "../../../processRunner.ts";
import {
  ModelPreviewError,
  quaternionMatrix,
  type ModelQuaternion,
  type OpenScadInfo,
} from "@t3tools/contracts/fork";
import { readStl } from "../check/readStl.ts";
import { rotatePoint } from "../check/mesh.ts";
import { threeMfScale } from "../threeMfUnits.ts";
const encodeScadString = Schema.encodeEffect(Schema.fromJsonString(Schema.String));
export type SliceMesh = {
  readonly absolute: string;
  readonly format: "stl" | "3mf" | "obj";
  readonly geometryRevision?: string;
};
export const meshContentHash = Effect.fn("Slicer.contentHash")(function* (filename: string) {
  const fs = yield* FileSystem.FileSystem,
    hash = NodeCrypto.createHash("sha256");
  yield* fs.stream(filename).pipe(
    Stream.runForEach((chunk) =>
      Effect.sync(() => {
        hash.update(chunk);
      }),
    ),
  );
  return hash.digest("hex");
});
export const rotateStl = (bytes: Uint8Array, quaternion: ModelQuaternion): Uint8Array => {
  const soup = readStl([{ name: "part.stl", bytes }], { maxTriangles: 3000000 });
  let minZ = Infinity;
  for (let offset = 0; offset < soup.length; offset += 3) {
    const point = rotatePoint([soup[offset]!, soup[offset + 1]!, soup[offset + 2]!], quaternion);
    soup.set(point, offset);
    minZ = Math.min(minZ, point[2]);
  }
  if (!soup.length) minZ = 0;
  const output = new Uint8Array(84 + (soup.length / 9) * 50),
    view = new DataView(output.buffer);
  view.setUint32(80, soup.length / 9, true);
  for (let triangle = 0; triangle < soup.length / 9; triangle++) {
    const p = triangle * 9,
      ax = soup[p]!,
      ay = soup[p + 1]!,
      az = soup[p + 2]!,
      ux = soup[p + 3]! - ax,
      uy = soup[p + 4]! - ay,
      uz = soup[p + 5]! - az,
      vx = soup[p + 6]! - ax,
      vy = soup[p + 7]! - ay,
      vz = soup[p + 8]! - az;
    const nx = uy * vz - uz * vy,
      ny = uz * vx - ux * vz,
      nz = ux * vy - uy * vx,
      length = Math.hypot(nx, ny, nz) || 1;
    [nx / length, ny / length, nz / length].forEach((value, index) =>
      view.setFloat32(84 + triangle * 50 + index * 4, value, true),
    );
    for (let coordinate = 0; coordinate < 9; coordinate++)
      view.setFloat32(
        96 + triangle * 50 + coordinate * 4,
        soup[p + coordinate]! - (coordinate % 3 === 2 ? minZ : 0),
        true,
      );
  }
  return output;
};
export const prepareSliceMesh = Effect.fn("Slicer.prepareMesh")(function* (
  mesh: SliceMesh,
  orientation: ModelQuaternion | null,
  directory: string,
  openscad: OpenScadInfo,
  timeoutSeconds: number,
) {
  const fs = yield* FileSystem.FileSystem,
    path = yield* Path.Path,
    runner = yield* ProcessRunner.ProcessRunner;
  if (mesh.absolute.includes(";") || directory.includes(";"))
    return yield* new ModelPreviewError({
      reason: "invalid-path",
      message: "Slicer input paths cannot contain semicolons.",
    });
  if (!orientation)
    return { filename: mesh.absolute, orientationApplied: null, warnings: [] as string[] };
  const output = path.join(directory, "oriented.stl");
  if (mesh.format === "stl") {
    const bytes = yield* fs.readFile(mesh.absolute);
    const rotated = yield* Effect.try({
      try: () => rotateStl(bytes, orientation),
      catch: () =>
        new ModelPreviewError({
          reason: "command-failed",
          message: "Could not rotate this STL for slicing.",
        }),
    });
    yield* fs.writeFile(output, rotated);
    return { filename: output, orientationApplied: true, warnings: [] as string[] };
  }
  if (!openscad.path)
    return {
      filename: mesh.absolute,
      orientationApplied: false,
      warnings: ["Orientation not applied: install OpenSCAD to slice rotated 3MF and OBJ files."],
    };
  const scale = mesh.format === "3mf" ? yield* threeMfScale(mesh.absolute) : 1,
    rotation = quaternionMatrix(orientation),
    source = path.join(directory, "orientation.scad");
  const matrix = [...rotation.map((row) => [...row, 0]), [0, 0, 0, 1]];
  yield* fs.writeFileString(
    source,
    `multmatrix([${matrix.map((row) => `[${row.join(",")}]`).join(",")}]) scale(${scale}) import(${yield* encodeScadString(mesh.absolute)});\n`,
  );
  const result = yield* runner.run({
    command: openscad.path,
    args: ["--export-format", "binstl", "-o", output, source],
    cwd: directory,
    timeout: `${timeoutSeconds} seconds`,
    timeoutBehavior: "timedOutResult",
    outputMode: "truncate",
    maxOutputBytes: 512 * 1024,
  });
  if (result.timedOut || result.code !== 0 || !(yield* fs.exists(output)))
    return yield* new ModelPreviewError({
      reason: result.timedOut ? "timeout" : "command-failed",
      message: "OpenSCAD could not apply the saved orientation for slicing.",
    });
  const rotated = rotateStl(yield* fs.readFile(output), [0, 0, 0, 1]);
  yield* fs.writeFile(output, rotated);
  return { filename: output, orientationApplied: true, warnings: [] as string[] };
});
