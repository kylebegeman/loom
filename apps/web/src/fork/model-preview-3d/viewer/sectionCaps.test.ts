import {
  AlwaysStencilFunc,
  BackSide,
  Box3,
  BoxGeometry,
  BufferGeometry,
  Color,
  DecrementWrapStencilOp,
  Float32BufferAttribute,
  FrontSide,
  Group,
  IncrementWrapStencilOp,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  NotEqualStencilFunc,
  Plane,
  ReplaceStencilOp,
  Scene,
  Vector3,
} from "three";
import { describe, expect, it, vi } from "vite-plus/test";
import {
  closedMesh,
  createSectionCaps,
  insideSection,
  sectionSegments,
  wallAt,
} from "./sectionCaps";

const material = () => new MeshBasicMaterial();
const cube = (size = 10): Mesh => new Mesh(new BoxGeometry(size, size, size), material());
const plane = () => new Plane(new Vector3(0, 0, 1), 0);
const withTriangles = (source: BufferGeometry, transform: (positions: number[]) => number[]) => {
  const geometry = source.index ? source.toNonIndexed() : source;
  return new BufferGeometry().setAttribute(
    "position",
    new Float32BufferAttribute(transform(Array.from(geometry.getAttribute("position").array)), 3),
  );
};
const hollow = () => {
  const outer = new BoxGeometry(10, 10, 10).toNonIndexed(),
    inner = new BoxGeometry(6, 6, 6).toNonIndexed(),
    positions = [...outer.getAttribute("position").array],
    inside = Array.from(inner.getAttribute("position").array);
  for (let i = 0; i < inside.length; i += 9)
    positions.push(
      ...inside.slice(i, i + 3),
      ...inside.slice(i + 6, i + 9),
      ...inside.slice(i + 3, i + 6),
    );
  return new Mesh(
    new BufferGeometry().setAttribute("position", new Float32BufferAttribute(positions, 3)),
    material(),
  );
};

describe("closedMesh", () => {
  it("accepts indexed and non-indexed solids and caches welded closure", () => {
    const indexed = new BoxGeometry(),
      plain = indexed.toNonIndexed();
    expect(closedMesh(indexed)).toBe(true);
    expect(closedMesh(plain)).toBe(true);
    const getAttribute = vi.spyOn(plain, "getAttribute");
    expect(closedMesh(plain)).toBe(true);
    expect(getAttribute).not.toHaveBeenCalled();
  });
  it("rejects missing triangles, reversed winding and nonmanifold fins", () => {
    expect(closedMesh(withTriangles(new BoxGeometry(), (values) => values.slice(9)))).toBe(false);
    expect(
      closedMesh(
        withTriangles(new BoxGeometry(), (values) => [
          ...values.slice(0, 3),
          ...values.slice(6, 9),
          ...values.slice(3, 6),
          ...values.slice(9),
        ]),
      ),
    ).toBe(false);
    expect(
      closedMesh(
        withTriangles(new BoxGeometry(), (values) => [...values, ...values.slice(0, 6), 0, 0, 2]),
      ),
    ).toBe(false);
  });
  it("rejects malformed, degenerate and cropped triangle geometry", () => {
    expect(closedMesh(new BufferGeometry())).toBe(false);
    expect(
      closedMesh(
        withTriangles(new BoxGeometry(), (values) => [...values, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
      ),
    ).toBe(false);
    const cropped = new BoxGeometry();
    cropped.setDrawRange(0, cropped.index!.count - 3);
    expect(closedMesh(cropped)).toBe(false);
  });
});

describe("CPU sections", () => {
  it("chains collinear cuts of a cube into four directed boundary segments", () => {
    const section = sectionSegments([cube()], plane());
    expect(section.segments.length).toBe(16);
    expect(insideSection(section, new Vector3())).toBe(true);
    expect(insideSection(section, new Vector3(8, 0, 0))).toBe(false);
    for (let i = 0; i < section.segments.length; i += 4) {
      const ax = section.segments[i]!,
        ay = section.segments[i + 1]!,
        bx = section.segments[i + 2]!,
        by = section.segments[i + 3]!;
      expect((bx - ax) * -ay - (by - ay) * -ax).toBeGreaterThan(0);
    }
  });
  it("classifies exact-plane vertices consistently and misses out-of-range cuts", () => {
    const throughVertices = sectionSegments(
      [cube()],
      new Plane(new Vector3(1, 1, 0).normalize(), 0),
    );
    expect(insideSection(throughVertices, new Vector3())).toBe(true);
    expect(wallAt(throughVertices, new Vector3())?.thicknessMm).toBeCloseTo(10, 3);
    expect(sectionSegments([cube()], new Plane(new Vector3(0, 0, 1), -6)).segments).toHaveLength(0);
  });
  it("refuses open meshes instead of closing dangling intersections", () => {
    const open = cube();
    open.geometry = withTriangles(open.geometry, (values) => values.slice(9));
    const section = sectionSegments([open], plane());
    expect(section.segments).toHaveLength(0);
    expect(wallAt(section, new Vector3())).toBeNull();
  });
  it("keeps a hollow void empty and measures two millimetres near either wall face", () => {
    const section = sectionSegments([hollow()], plane());
    expect(insideSection(section, new Vector3())).toBe(false);
    for (const x of [3.1, 4, 4.9]) {
      const wall = wallAt(section, new Vector3(x, 0, 0));
      expect(wall?.thicknessMm).toBeCloseTo(2, 3);
      expect(Math.min(wall!.start[0], wall!.end[0])).toBeCloseTo(3, 3);
      expect(Math.max(wall!.start[0], wall!.end[0])).toBeCloseTo(5, 3);
      expect(wall!.start[2]).toBe(0);
      expect(wall!.end[2]).toBe(0);
    }
  });
  it("measures a solid cube and rejects air", () => {
    const section = sectionSegments([cube()], plane());
    expect(wallAt(section, new Vector3())?.thicknessMm).toBeCloseTo(10, 4);
    expect(wallAt(section, new Vector3(8, 0, 0))).toBeNull();
  });
  it("uses nonzero winding for overlapping parts without measuring their interior seam", () => {
    const left = new Mesh(new BoxGeometry(10, 20, 10), material()),
      right = new Mesh(new BoxGeometry(10, 20, 10), material());
    left.position.x = -2;
    right.position.x = 2;
    const section = sectionSegments([left, right], plane());
    expect(insideSection(section, new Vector3())).toBe(true);
    expect(wallAt(section, new Vector3())?.thicknessMm).toBeCloseTo(14, 3);
  });
  it("honors parent transforms, mirrored winding, plane flips and hidden ancestors", () => {
    const parent = new Group(),
      mesh = cube();
    parent.position.set(20, 30, 4);
    parent.rotation.z = Math.PI / 4;
    mesh.scale.x = -1;
    parent.add(mesh);
    const cut = new Plane(new Vector3(0, 0, -1), 4),
      section = sectionSegments([mesh], cut);
    expect(insideSection(section, new Vector3(20, 30, 4))).toBe(true);
    expect(wallAt(section, new Vector3(20, 30, 4))?.thicknessMm).toBeCloseTo(10, 3);
    parent.visible = false;
    expect(sectionSegments([mesh], cut).segments).toHaveLength(0);
  });
  it("expands instance transforms and returns wall ends in world coordinates", () => {
    const mesh = new InstancedMesh(new BoxGeometry(10, 10, 10), material(), 2);
    mesh.position.y = 10;
    mesh.setMatrixAt(0, new Matrix4().makeTranslation(20, 0, 0));
    mesh.setMatrixAt(1, new Matrix4().makeTranslation(40, 0, 0));
    const section = sectionSegments([mesh], plane());
    expect(insideSection(section, new Vector3(20, 10, 0))).toBe(true);
    expect(insideSection(section, new Vector3(30, 10, 0))).toBe(false);
    const wall = wallAt(section, new Vector3(40, 10, 0));
    expect(wall?.thicknessMm).toBeCloseTo(10, 4);
    expect(new Vector3(...wall!.start).distanceTo(new Vector3(...wall!.end))).toBeCloseTo(10, 4);
  });
  it("reports the in-plane width when a two millimetre wall is cut at thirty degrees", () => {
    const wall = new Mesh(new BoxGeometry(2, 40, 40), material());
    wall.rotation.y = Math.PI / 6;
    const section = sectionSegments([wall], plane());
    expect(wallAt(section, new Vector3())?.thicknessMm).toBeCloseTo(2 / Math.cos(Math.PI / 6), 4);
  });
});

describe("stencil caps", () => {
  const options = (model: Mesh | Group) => ({
    enabled: true,
    caps: true,
    wireframe: false,
    box: new Box3().setFromObject(model),
    dark: false,
  });
  it("checks lazily and emits filled, partial, off and open states", () => {
    const scene = new Scene(),
      closed = cube(),
      open = cube(),
      model = new Group();
    open.geometry = withTriangles(open.geometry, (values) => values.slice(9));
    model.add(closed, open);
    const check = vi.fn((mesh: Mesh) => closedMesh(mesh.geometry)),
      changed = vi.fn(),
      caps = createSectionCaps(scene, plane());
    caps.onState(changed);
    caps.setModel(model, check);
    expect(check).not.toHaveBeenCalled();
    caps.update(options(model));
    expect(check).toHaveBeenCalledTimes(2);
    expect(caps.state()).toBe("partial");
    expect(changed.mock.calls.map((call) => call[0])).toEqual(["none", "checking", "partial"]);
    expect(caps.closedMeshes()).toEqual([closed]);
    caps.update({ ...options(model), wireframe: true });
    expect(caps.state()).toBe("off");
    expect(caps.visible()).toBe(false);
    caps.update({ ...options(model), caps: false });
    expect(caps.visible()).toBe(false);
    caps.update({ ...options(model), enabled: false });
    expect(caps.state()).toBe("none");
    caps.setModel(open);
    caps.update(options(open));
    expect(caps.state()).toBe("open-mesh");
    expect(caps.visible()).toBe(false);
    caps.dispose();
  });
  it("keeps helpers out of the model with correct stencil operations and geometry ownership", () => {
    const scene = new Scene(),
      model = cube(),
      caps = createSectionCaps(scene, plane()),
      disposed = vi.spyOn(model.geometry, "dispose");
    caps.setModel(model);
    caps.update(options(model));
    const group = scene.children[0]!,
      helpers = group.children.filter((object) => object instanceof Mesh) as Mesh[];
    expect(model.children).toHaveLength(0);
    expect(helpers).toHaveLength(3);
    const copies = helpers.filter((mesh) => mesh.geometry === model.geometry),
      cap = helpers.find((mesh) => mesh.geometry !== model.geometry)!;
    for (const mesh of copies) {
      const material = mesh.material as MeshBasicMaterial;
      expect(material.colorWrite).toBe(false);
      expect(material.depthWrite).toBe(false);
      expect(material.depthTest).toBe(false);
      expect(material.stencilWrite).toBe(true);
      expect(material.stencilFunc).toBe(AlwaysStencilFunc);
      expect(material.clippingPlanes).toHaveLength(1);
      expect(material.stencilZPass).toBe(
        material.side === BackSide ? IncrementWrapStencilOp : DecrementWrapStencilOp,
      );
      expect([BackSide, FrontSide]).toContain(material.side);
      expect(mesh.matrixWorldAutoUpdate).toBe(false);
    }
    const capMaterial = cap.material as MeshBasicMaterial;
    expect(capMaterial.stencilFunc).toBe(NotEqualStencilFunc);
    expect(capMaterial.stencilZPass).toBe(ReplaceStencilOp);
    expect(capMaterial.clippingPlanes).toBeNull();
    const materials = helpers.map((mesh) =>
      vi.spyOn(mesh.material as MeshBasicMaterial, "dispose"),
    );
    caps.dispose();
    expect(disposed).not.toHaveBeenCalled();
    expect(materials.every((dispose) => dispose.mock.calls.length === 1)).toBe(true);
    expect(scene.children).toHaveLength(0);
  });
  it("syncs parent transforms and effective visibility without moving the world-space cap", () => {
    const scene = new Scene(),
      parent = new Group(),
      model = cube(),
      cut = plane(),
      caps = createSectionCaps(scene, cut);
    parent.position.set(1000, 2000, 0);
    parent.add(model);
    caps.setModel(parent);
    caps.update(options(parent));
    const group = scene.children[0]!,
      copy = group.children.find(
        (node) => node instanceof Mesh && node.geometry === model.geometry,
      )!;
    expect(copy.matrixWorld.elements).toEqual(model.matrixWorld.elements);
    const cap = group.children.find((node) => node.name === "section-cap")!;
    expect(cap.position.toArray()).toEqual([1000, 2000, 0]);
    parent.rotation.y = Math.PI / 3;
    caps.syncTransforms();
    expect(copy.matrixWorld.elements).toEqual(model.matrixWorld.elements);
    parent.visible = false;
    caps.syncTransforms();
    expect(copy.visible).toBe(false);
    expect(caps.closedMeshes()).toHaveLength(0);
    caps.dispose();
  });
  it("preserves instancing and patches the opposite hatch diagonal with live theme uniforms", () => {
    const scene = new Scene(),
      model = new InstancedMesh(new BoxGeometry(), material(), 2),
      caps = createSectionCaps(scene, plane());
    model.setMatrixAt(1, new Matrix4().makeTranslation(4, 0, 0));
    caps.setModel(model);
    caps.update({ ...options(model), pixelRatio: 2 });
    const group = scene.children[0]!;
    const copy = group.children.find((node) => node instanceof InstancedMesh) as InstancedMesh;
    expect(copy.count).toBe(2);
    expect(copy.instanceMatrix).toBe(model.instanceMatrix);
    const cap = group.children.find((node) => node.name === "section-cap") as Mesh,
      capMaterial = cap.material as MeshBasicMaterial,
      shader = { uniforms: {}, vertexShader: "", fragmentShader: "#include <color_fragment>" };
    capMaterial.onBeforeCompile(
      shader as Parameters<typeof capMaterial.onBeforeCompile>[0],
      {} as Parameters<typeof capMaterial.onBeforeCompile>[1],
    );
    expect(shader.fragmentShader).toContain("gl_FragCoord.x - gl_FragCoord.y");
    expect(shader.uniforms).toMatchObject({ loomSectionHatch: { value: 12 } });
    caps.update({ ...options(model), dark: true });
    expect(capMaterial.color.getHex()).toBe(0x46566b);
    expect(shader.uniforms).toMatchObject({ loomSectionStripe: { value: new Color(0x5b6d85) } });
    caps.dispose();
  });
});
