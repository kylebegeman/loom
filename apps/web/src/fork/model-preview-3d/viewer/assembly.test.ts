import { describe, it, expect, vi } from "vite-plus/test";
import { BoxGeometry, Mesh, MeshStandardMaterial, Vector3 } from "three";
import { createAssemblyScene } from "./assembly";
import type { AssemblyPart } from "@t3tools/contracts/fork";
const part = (
  id: string,
  position: readonly [number, number, number] = [0, 0, 0],
): AssemblyPart => ({
  id,
  name: id,
  path: `${id}.stl`,
  position,
  rotation: [0, 0, 0],
  color: null,
  visible: true,
  parameters: {},
  parameterSet: null,
  explode: null,
});
const model = () =>
  new Mesh(new BoxGeometry(2, 4, 6), new MeshStandardMaterial({ color: 0xeeeeee }));
describe("assembly scene ownership", () => {
  it("places authored geometry, restores colors, isolates and explodes without saving transforms", () => {
    const scene = createAssemblyScene(),
      a = model(),
      b = model(),
      parts = [part("a", [-4, 0, 0]), part("b", [4, 0, 0])];
    scene.set("a", a);
    scene.set("b", b);
    scene.update(parts, { selectedId: "a" });
    expect(a.getWorldPosition(new Vector3()).toArray()).toEqual([-4, 0, 0]);
    scene.update([{ ...parts[0]!, color: "#ff0000" }, parts[1]!]);
    expect(a.material.color.getHexString()).toBe("ff0000");
    scene.update(parts, { explode: 1, isolatedId: "a" });
    expect(a.getWorldPosition(new Vector3()).x).toBeLessThan(-4);
    expect(b.parent?.visible).toBe(false);
    expect(parts[0]?.position).toEqual([-4, 0, 0]);
    scene.update(parts);
    expect(a.material.color.getHexString()).toBe("eeeeee");
    expect(b.parent?.visible).toBe(true);
    expect(a.getWorldPosition(new Vector3()).x).toBe(-4);
    scene.dispose();
  });
  it("replaces and removes each part with bounded geometry ownership", () => {
    const scene = createAssemblyScene(),
      first = model(),
      next = model(),
      firstDispose = vi.spyOn(first.geometry, "dispose"),
      nextDispose = vi.spyOn(next.geometry, "dispose");
    scene.set("part", first);
    scene.set("part", next);
    expect(firstDispose).toHaveBeenCalledTimes(1);
    expect(scene.count()).toBe(12);
    scene.remove("part");
    expect(nextDispose).toHaveBeenCalledTimes(1);
    expect(scene.count()).toBe(0);
    scene.dispose();
    expect(nextDispose).toHaveBeenCalledTimes(1);
  });
});
