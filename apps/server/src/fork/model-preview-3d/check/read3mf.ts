import { capTriangles, CheckFailure, type TriangleSoup } from "./mesh.ts";
import type { CheckFile } from "./protocol.ts";

type Transform = readonly number[];
type Reference = { id: string; path: string | null; transform: Transform | null };
type ObjectMesh = {
  type: string;
  vertices: number[];
  triangles: number[];
  components: Reference[];
};
type Model = { unit: number; objects: Map<string, ObjectMesh>; build: Reference[] };
const UNIT_MM: Readonly<Record<string, number>> = {
  micron: 0.001,
  millimeter: 1,
  centimeter: 10,
  inch: 25.4,
  foot: 304.8,
  meter: 1000,
};
const fail = (message: string): never => {
  throw new CheckFailure("command-failed", message);
};
const unescape = (value: string): string =>
  value.replace(/&(?:amp|lt|gt|quot|apos);|&#(?:x[0-9a-f]+|\d+);/gi, (entity) => {
    const named: Readonly<Record<string, string>> = {
      "&amp;": "&",
      "&lt;": "<",
      "&gt;": ">",
      "&quot;": '"',
      "&apos;": "'",
    };
    if (entity.startsWith("&#")) {
      const code =
        entity[2] === "x"
          ? Number.parseInt(entity.slice(3, -1), 16)
          : Number.parseInt(entity.slice(2, -1), 10);
      return code <= 0x10ffff
        ? String.fromCodePoint(code)
        : fail("This 3MF has invalid XML entities.");
    }
    return named[entity] ?? entity;
  });
/** XML's small geometry subset needs no DOM, entities or external resource resolution. */
function* tags(bytes: Uint8Array) {
  const source = new TextDecoder()
    .decode(bytes)
    .replace(/<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[[\s\S]*?\]\]>/g, "");
  for (const match of source.matchAll(/<\s*(\/)?([\w:.-]+)((?:[^<>"']|"[^"]*"|'[^']*')*)>/g)) {
    const attributes: Record<string, string> = {};
    for (const attribute of match[3]!.matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g))
      attributes[attribute[1]!] = unescape(attribute[2] ?? attribute[3]!);
    yield { name: match[2]!.split(":").at(-1)!, closing: !!match[1], attributes };
  }
}
const partName = (name: string): string => {
  const normalized = name.startsWith("/") ? name.slice(1) : name;
  if (
    !normalized ||
    normalized.includes("\\") ||
    normalized.includes(":") ||
    normalized.split("/").some((segment) => segment === ".." || segment === "." || segment === "")
  )
    fail("This 3MF contains an invalid part path.");
  return normalized;
};
const number = (value: string | undefined): number => {
  if (value === undefined || value.trim() === "" || !Number.isFinite(Number(value)))
    fail("This 3MF contains invalid coordinates.");
  return Number(value);
};
const reference = (attributes: Readonly<Record<string, string>>): Reference => {
  const raw = attributes.transform;
  const transform = raw ? raw.trim().split(/\s+/).map(Number) : null;
  if (transform && (transform.length !== 12 || transform.some((value) => !Number.isFinite(value))))
    fail("This 3MF has an invalid transform.");
  const path = Object.entries(attributes).find(([key]) => key.endsWith(":path"))?.[1] ?? null;
  return {
    id: attributes.objectid ?? fail("This 3MF references a missing object."),
    path,
    transform,
  };
};
const parse = (bytes: Uint8Array, maxTriangles: number): Model => {
  const model: Model = { unit: 1, objects: new Map(), build: [] };
  let object: ObjectMesh | null = null;
  let inMesh = false;
  let inBuild = false;
  for (const tag of tags(bytes)) {
    const attrs = tag.attributes;
    if (tag.closing) {
      if (tag.name === "object") object = null;
      if (tag.name === "mesh") inMesh = false;
      if (tag.name === "build") inBuild = false;
      continue;
    }
    if (tag.name === "model")
      model.unit =
        UNIT_MM[attrs.unit ?? "millimeter"] ?? fail("This 3MF uses an unsupported unit.");
    else if (tag.name === "object") {
      const id = attrs.id ?? fail("This 3MF has an object without an id.");
      if (model.objects.has(id)) fail("This 3MF has duplicate object ids.");
      object = { type: attrs.type ?? "model", vertices: [], triangles: [], components: [] };
      model.objects.set(id, object);
    } else if (tag.name === "mesh") inMesh = true;
    else if (tag.name === "build") inBuild = true;
    else if (tag.name === "vertex" && object && inMesh)
      object.vertices.push(number(attrs.x), number(attrs.y), number(attrs.z));
    else if (tag.name === "triangle" && object && inMesh) {
      const indices = [number(attrs.v1), number(attrs.v2), number(attrs.v3)];
      if (indices.some((index) => !Number.isSafeInteger(index) || index < 0))
        fail("This 3MF has invalid triangle indices.");
      if (object.type !== "support" && object.type !== "other")
        capTriangles(object.triangles.length / 3 + 1, maxTriangles);
      object.triangles.push(...indices);
    } else if (tag.name === "component" && object) object.components.push(reference(attrs));
    else if (tag.name === "item" && inBuild) model.build.push(reference(attrs));
  }
  return model;
};
const transformed = (
  point: readonly [number, number, number],
  matrix: Transform | null,
  unit: number,
): readonly [number, number, number] => {
  if (!matrix) return point;
  const [x, y, z] = point;
  return [
    x * matrix[0]! + y * matrix[3]! + z * matrix[6]! + matrix[9]! * unit,
    x * matrix[1]! + y * matrix[4]! + z * matrix[7]! + matrix[10]! * unit,
    x * matrix[2]! + y * matrix[5]! + z * matrix[8]! + matrix[11]! * unit,
  ];
};

/** Parts arrive already expanded; this reader only resolves archive-local production references. */
export const read3mf = (
  files: readonly CheckFile[],
  limits: { readonly maxTriangles: number },
): TriangleSoup => {
  const parts = new Map(files.map((file) => [partName(file.name), file.bytes]));
  const relationships = parts.get("_rels/.rels");
  let rootName = "3D/3dmodel.model";
  if (relationships) {
    for (const tag of tags(relationships)) {
      if (
        tag.name === "Relationship" &&
        !tag.closing &&
        tag.attributes.Type?.endsWith("/3dmodel")
      ) {
        rootName = partName(tag.attributes.Target ?? fail("This 3MF has no start part."));
        break;
      }
    }
  }
  const models = new Map<string, Model>();
  const getModel = (name: string): Model => {
    const existing = models.get(name);
    if (existing) return existing;
    const bytes = parts.get(name) ?? fail("This 3MF references a missing model part.");
    const model = parse(bytes, limits.maxTriangles);
    models.set(name, model);
    return model;
  };
  const values: number[] = [];
  const expand = (
    name: string,
    ref: Reference,
    depth: number,
    transforms: readonly { matrix: Transform | null; unit: number }[],
  ): void => {
    if (depth > 8) fail("This 3MF nests components too deeply.");
    const source = getModel(name);
    if (ref.path && name !== rootName) fail("This 3MF uses p:path inside a non-root part.");
    const targetName = ref.path ? partName(ref.path) : name;
    const target = getModel(targetName);
    const object = target.objects.get(ref.id) ?? fail("This 3MF references a missing object.");
    if (object.type === "support" || object.type === "other") return;
    const nextTransforms = [{ matrix: ref.transform, unit: source.unit }, ...transforms];
    if (object.triangles.length) {
      capTriangles(values.length / 9 + object.triangles.length / 3, limits.maxTriangles);
      for (const index of object.triangles) {
        if (index * 3 + 2 >= object.vertices.length) fail("This 3MF has invalid triangle indices.");
        let point: readonly [number, number, number] = [
          object.vertices[index * 3]! * target.unit,
          object.vertices[index * 3 + 1]! * target.unit,
          object.vertices[index * 3 + 2]! * target.unit,
        ];
        for (const transform of nextTransforms)
          point = transformed(point, transform.matrix, transform.unit);
        if (point.some((value) => !Number.isFinite(value)))
          fail("This 3MF contains invalid coordinates.");
        values.push(...point);
      }
    }
    for (const child of object.components) expand(targetName, child, depth + 1, nextTransforms);
  };
  for (const item of getModel(rootName).build) expand(rootName, item, 0, []);
  return Float32Array.from(values);
};
