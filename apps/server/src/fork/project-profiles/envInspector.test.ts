import { describe, expect, it } from "@effect/vitest";
import { inspectEnv, currentEnvFor, parseEnvSource } from "./envInspector.ts";
const inspect = (
  schemaSource: string | null,
  envSources: Array<{ path: string; source: string }> = [],
  processEnv = {},
) => inspectEnv({ root: "/repo", schemaPath: ".env.schema", schemaSource, envSources, processEnv });
describe("env metadata preview", () => {
  it("applies precedence without returning any values, including public variables", () => {
    const report = inspect(
      "# @defaultSensitive=inferFromPrefix(PUBLIC_)\n# @currentEnv=$NODE_ENV\n\n# API address\n# @type=url\n# @example=https://docs.example\nPUBLIC_API=\n# @example=secret-example\nTOKEN=\nMISSING=\n",
      [
        {
          path: ".env",
          source:
            "PUBLIC_API=https://private-one.example\nTOKEN=private-token\nEXTRA=unlisted-secret\nNODE_ENV=preview\n",
        },
        { path: ".env.local", source: "PUBLIC_API=https://private-two.example\n" },
        { path: ".env.preview", source: "PUBLIC_API=https://private-three.example\n" },
      ],
      { PUBLIC_API: "https://server-private.example" },
    );
    const api = report.items.find((i) => i.key === "PUBLIC_API")!;
    expect(api).toMatchObject({
      sensitive: false,
      required: true,
      description: "API address",
      example: "https://docs.example",
      status: { _tag: "set", source: "server environment" },
    });
    expect(report.items.find((i) => i.key === "TOKEN")).toMatchObject({
      sensitive: true,
      example: null,
    });
    expect(report.unschematizedKeys).toEqual(["EXTRA", "NODE_ENV"]);
    expect(report.schema).toMatchObject({ _tag: "ok", currentEnv: "preview" });
    const wire = JSON.stringify(report);
    for (const value of [
      "private-one",
      "private-two",
      "private-three",
      "private-token",
      "unlisted-secret",
      "server-private",
      "secret-example",
    ])
      expect(wire).not.toContain(value);
  });
  it("keeps required/optional, defaults and deferred functions distinct", () => {
    const report = inspect(
      "# @defaultRequired=infer\n\n# @public\nDEFAULT=static-secret\n# @required=forEnv(production)\nONLY_PROD=\n# @optional\nOPTIONAL=\nDEFER=exec(doNotExecute)\n# @type=notSupported\nUNKNOWN=opaque\n",
      [],
    );
    expect(report.items.find((i) => i.key === "DEFAULT")).toMatchObject({
      required: false,
      sensitive: false,
      status: { _tag: "set" },
    });
    expect(report.items.find((i) => i.key === "ONLY_PROD")?.required).toBe(false);
    expect(report.items.find((i) => i.key === "OPTIONAL")?.required).toBe(false);
    expect(report.items.find((i) => i.key === "DEFER")?.status).toEqual({
      _tag: "resolvedByVarlock",
      functionName: "exec",
    });
    expect(report.items.find((i) => i.key === "UNKNOWN")?.status._tag).toBe("unchecked");
    expect(JSON.stringify(report)).not.toContain("static-secret");
    expect(JSON.stringify(report)).not.toContain("doNotExecute");
  });
  it.each([
    ["number(min=2,max=9)", "100"],
    ["boolean", "yes"],
    ["url", "bad"],
    ["email", "bad"],
    ["port", "65536"],
    ["enum(a,b)", "c"],
    ["semver", "bad"],
    ["isoDate", "bad"],
    ["uuid", "bad"],
  ])("validates %s with a value-free reason", (type, value) => {
    const report = inspect(`# @type=${type}\nKEY=\n`, [{ path: ".env", source: `KEY=${value}\n` }]);
    expect(report.items[0]?.status).toMatchObject({ _tag: "invalid" });
    expect(JSON.stringify(report.items[0]?.status)).not.toContain(`"${value}"`);
  });
  it("reports parser location without including the offending dotenv source", () => {
    const report = inspect("KEY=\n", [{ path: ".env", source: 'KEY="top-secret-unclosed\n' }]);
    expect(report.schema._tag).toBe("invalid");
    expect(JSON.stringify(report)).not.toContain("top-secret");
  });
  it("reports keys without a schema and imports metadata one level", () => {
    expect(inspect(null, [{ path: ".env", source: "FOUND=private\n" }])).toMatchObject({
      schema: { _tag: "absent" },
      unschematizedKeys: ["FOUND"],
    });
    const report = inspectEnv({
      root: "/repo",
      schemaPath: ".env.schema",
      schemaSource: "# @import(./base.schema)\n\nLOCAL=\n",
      imports: [{ path: "base.schema", source: "IMPORTED=secret\n" }],
      envSources: [],
      processEnv: {},
    });
    expect(report.schema).toMatchObject({ imports: ["./base.schema"] });
    expect(report.items.map((i) => i.key)).toEqual(["LOCAL", "IMPORTED"]);
  });
  it("resolves current env only from static safe names", () => {
    const schema = parseEnvSource("# @currentEnv=$NODE_ENV\n\nKEY=\n");
    expect(currentEnvFor(schema, [{ path: ".env", source: "NODE_ENV=exec(nope)\n" }], {})).toBe(
      null,
    );
    expect(currentEnvFor(schema, [], { NODE_ENV: "../../elsewhere" })).toBe(null);
  });
});
