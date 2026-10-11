import {
  BoxGeometry,
  FrontSide,
  Group,
  Line,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Plane,
  Points,
  Texture,
  Vector3,
} from "three";
import { describe, expect, it, vi } from "vite-plus/test";
import { createGhost } from "./ghost";

function ghostMaterial(mesh: Mesh): MeshBasicMaterial {
  const material = mesh.material;
  if (!(material instanceof MeshBasicMaterial)) throw new Error("Expected a ghost material");
  return material;
}

describe("createGhost", () => {
  it("retains geometry and transforms while releasing shared original materials and images once", () => {
    const parent = new Group(),
      render = vi.fn(),
      ghost = createGhost(parent, render);
    const image = { close: vi.fn() },
      texture = new Texture(image);
    const firstMaterial = new MeshStandardMaterial({ map: texture }),
      secondMaterial = new MeshStandardMaterial({ map: texture });
    const firstDispose = vi.spyOn(firstMaterial, "dispose"),
      secondDispose = vi.spyOn(secondMaterial, "dispose"),
      textureDispose = vi.spyOn(texture, "dispose");
    const geometry = new BoxGeometry(),
      geometryDispose = vi.spyOn(geometry, "dispose");
    const root = new Group(),
      first = new Mesh(geometry, [firstMaterial, secondMaterial]),
      second = new Mesh(geometry, firstMaterial),
      line = new Line(geometry, firstMaterial),
      points = new Points(geometry, secondMaterial);
    root.position.set(1, 2, 3);
    first.rotation.x = 0.5;
    first.scale.set(2, 3, 4);
    root.add(first, second, line, points);
    ghost.set(root);
    expect(root.parent).toBe(parent);
    expect(root.position.toArray()).toEqual([1, 2, 3]);
    expect(first.rotation.x).toBe(0.5);
    expect(first.scale.toArray()).toEqual([2, 3, 4]);
    expect(first.geometry).toBe(geometry);
    expect(first.material).toBe(second.material);
    expect(first.material).toBeInstanceOf(MeshBasicMaterial);
    expect(first.material).toMatchObject({
      opacity: 0.22,
      depthWrite: false,
      depthTest: true,
      side: FrontSide,
    });
    expect(line.visible).toBe(false);
    expect(points.visible).toBe(false);
    expect(firstDispose).toHaveBeenCalledOnce();
    expect(secondDispose).toHaveBeenCalledOnce();
    expect(textureDispose).toHaveBeenCalledOnce();
    expect(image.close).toHaveBeenCalledOnce();
    expect(geometryDispose).not.toHaveBeenCalled();
    const ghostMaterialDispose = vi.spyOn(ghostMaterial(first), "dispose");
    ghost.setVisible(true);
    ghost.setVisible(false);
    expect(root.visible).toBe(false);
    expect(geometryDispose).not.toHaveBeenCalled();
    ghost.set(null);
    ghost.dispose();
    expect(parent.children).toHaveLength(0);
    expect(geometryDispose).toHaveBeenCalledOnce();
    expect(ghostMaterialDispose).toHaveBeenCalledOnce();
    expect(firstDispose).toHaveBeenCalledOnce();
    expect(image.close).toHaveBeenCalledOnce();
    vi.restoreAllMocks();
  });

  it("replaces one previous object, remembers theme/clipping/visibility and releases on close", () => {
    const parent = new Group(),
      ghost = createGhost(parent, vi.fn()),
      plane = new Plane(new Vector3(0, 0, 1), -5);
    ghost.setTheme(true);
    ghost.setClipping([plane]);
    ghost.setVisible(true);
    const first = new Mesh(new BoxGeometry(), new MeshStandardMaterial()),
      second = new Mesh(new BoxGeometry(), new MeshStandardMaterial());
    const firstDispose = vi.spyOn(first.geometry, "dispose"),
      secondDispose = vi.spyOn(second.geometry, "dispose");
    ghost.set(first);
    expect(first.visible).toBe(true);
    expect(ghostMaterial(first).color.getHex()).toBe(0xa3acb9);
    expect(ghostMaterial(first).clippingPlanes).toEqual([plane]);
    ghost.setTheme(false);
    ghost.setClipping([]);
    expect(ghostMaterial(first).color.getHex()).toBe(0x6b7480);
    expect(ghostMaterial(first).clippingPlanes).toEqual([]);
    ghost.set(second);
    expect(parent.children).toEqual([second]);
    expect(firstDispose).toHaveBeenCalledOnce();
    expect(second.visible).toBe(true);
    ghost.dispose();
    ghost.dispose();
    expect(secondDispose).toHaveBeenCalledOnce();
    expect(parent.children).toHaveLength(0);
    vi.restoreAllMocks();
  });
});
