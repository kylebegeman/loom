import {
  Material,
  MeshBasicMaterial,
  MeshLambertMaterial,
  MeshPhongMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  ShaderLib,
  ShaderMaterial,
  type WebGLRenderer,
} from "three";
import { expect, it, vi } from "vite-plus/test";
import { createOverhangShading } from "./overhangs";

function compile(
  material: Material,
  kind: "standard" | "physical" | "phong" | "lambert" = "standard",
) {
  const shader = {
    vertexShader: ShaderLib[kind].vertexShader,
    fragmentShader: ShaderLib[kind].fragmentShader,
    uniforms: { ...ShaderLib[kind].uniforms },
  } as Parameters<Material["onBeforeCompile"]>[0];
  material.onBeforeCompile(shader, {} as WebGLRenderer);
  return shader;
}

it.each([
  ["standard", MeshStandardMaterial],
  ["physical", MeshPhysicalMaterial],
  ["phong", MeshPhongMaterial],
  ["lambert", MeshLambertMaterial],
] as const)(
  "patches the installed %s shaders before lighting while preserving the compile hook",
  (kind, MaterialType) => {
    const shading = createOverhangShading();
    const material = new MaterialType();
    const previous = vi.fn((shader: Parameters<Material["onBeforeCompile"]>[0]) => {
      shader.fragmentShader = "// existing customization\n" + shader.fragmentShader;
    });
    material.onBeforeCompile = previous;
    expect(shading.patch(material)).toBe(true);
    const shader = compile(material, kind);
    expect(previous).toHaveBeenCalledOnce();
    expect(shader.fragmentShader).toContain("// existing customization");
    const worldPosition = shader.vertexShader.indexOf("vec4 loomOverhangPosition");
    expect(worldPosition).toBeGreaterThan(shader.vertexShader.indexOf("#include <project_vertex>"));
    expect(shader.vertexShader).toContain("batchingMatrix * loomOverhangPosition");
    expect(shader.vertexShader).toContain("instanceMatrix * loomOverhangPosition");
    expect(shader.vertexShader).toContain("modelMatrix * loomOverhangPosition");
    const shade = shader.fragmentShader.indexOf("if ( loomOverhangEnabled )");
    expect(shade).toBeGreaterThan(shader.fragmentShader.indexOf("#include <normal_fragment_maps>"));
    expect(shade).toBeLessThan(shader.fragmentShader.indexOf("#include <lights_fragment_begin>"));
    expect(shader.fragmentShader).toContain(
      "cross( dFdx( vLoomOverhangWorld ), dFdy( vLoomOverhangWorld ) )",
    );
    for (const [name, uniform] of Object.entries(shading.uniforms))
      expect(shader.uniforms[name]).toBe(uniform);
  },
);

it("updates the shared effect without recompiling either material", () => {
  const shading = createOverhangShading();
  const a = new MeshStandardMaterial(),
    b = new MeshPhongMaterial();
  shading.patch(a);
  shading.patch(b);
  const first = compile(a),
    second = compile(b, "phong");
  const versions = [a.version, b.version];
  const keys = [a.customProgramCacheKey(), b.customProgramCacheKey()];
  shading.setEnabled(true);
  shading.setAngle(50);
  shading.setBedZ(-6);
  shading.setTheme(true);
  shading.setPixelRatio(2);
  expect(first.uniforms.loomOverhangEnabled!.value).toBe(true);
  expect(second.uniforms.loomOverhangSin).toBe(first.uniforms.loomOverhangSin);
  expect(second.uniforms.loomOverhangSin!.value).toBeCloseTo(Math.sin((50 * Math.PI) / 180));
  expect(second.uniforms.loomOverhangBedZ!.value).toBe(-6);
  expect(shading.uniforms.loomOverhangColor.value.getHex()).toBe(0xff8a4c);
  expect(second.uniforms.loomOverhangHatch!.value).toBe(16);
  shading.setAngle(90);
  expect(first.uniforms.loomOverhangSin!.value).toBeCloseTo(Math.sin((70 * Math.PI) / 180));
  shading.setAngle(Number.NaN);
  expect(first.uniforms.loomOverhangSin!.value).toBeCloseTo(Math.sin((70 * Math.PI) / 180));
  expect([a.version, b.version]).toEqual(versions);
  expect([a.customProgramCacheKey(), b.customProgramCacheKey()]).toEqual(keys);
});

it("preserves previous shader cache distinctions and custom dynamic keys", () => {
  const shading = createOverhangShading();
  const a = new MeshStandardMaterial(),
    b = new MeshStandardMaterial(),
    custom = new MeshStandardMaterial();
  a.onBeforeCompile = (shader) => {
    shader.vertexShader += "\n// customization a";
  };
  b.onBeforeCompile = (shader) => {
    shader.vertexShader += "\n// customization b";
  };
  let customVariant = "a";
  custom.customProgramCacheKey = () => `custom-${customVariant}`;
  const original = [
    a.customProgramCacheKey(),
    b.customProgramCacheKey(),
    custom.customProgramCacheKey(),
  ];
  for (const material of [a, b, custom]) shading.patch(material);
  expect(a.customProgramCacheKey()).toBe(`${original[0]}|loom-overhangs-v1`);
  expect(b.customProgramCacheKey()).toBe(`${original[1]}|loom-overhangs-v1`);
  expect(a.customProgramCacheKey()).not.toBe(b.customProgramCacheKey());
  expect(custom.customProgramCacheKey()).toBe("custom-a|loom-overhangs-v1");
  customVariant = "b";
  expect(custom.customProgramCacheKey()).toBe("custom-b|loom-overhangs-v1");
});

it("patches once and leaves unsupported materials intact", () => {
  const shading = createOverhangShading();
  const supported = new MeshStandardMaterial();
  shading.patch(supported);
  const hook = supported.onBeforeCompile,
    version = supported.version;
  expect(shading.patch(supported)).toBe(true);
  expect(supported.onBeforeCompile).toBe(hook);
  expect(supported.version).toBe(version);
  for (const material of [new MeshBasicMaterial(), new ShaderMaterial()]) {
    const hook = material.onBeforeCompile,
      key = material.customProgramCacheKey();
    expect(shading.patch(material)).toBe(false);
    expect(material.onBeforeCompile).toBe(hook);
    expect(material.customProgramCacheKey()).toBe(key);
    expect(material.version).toBe(0);
  }
});
