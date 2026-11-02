export const API_SCRIPT_RUNNER = String.raw`
import * as vm from 'node:vm';
let input = '';
for await (const chunk of process.stdin) {
  input += chunk;
  if (input.length > 2 * 1024 * 1024) process.exit(1);
}
try {
  const context = vm.createContext(Object.assign(Object.create(null), { __seed: input }), {
    codeGeneration: { strings: false, wasm: false }, microtaskMode: 'afterEvaluate',
  });
  const setup = new vm.Script(
    'const __input = JSON.parse(__seed); delete globalThis.__seed;\n' +
    'const __values = new Map(Object.entries(__input.variables)); const __tests = []; const __changed = new Set();\n' +
    'const pw = Object.freeze({\n' +
    'env: Object.freeze({ get(key) { return __values.get(String(key)) ?? ""; }, set(key, value) { if(typeof key !== "string" || !key || typeof value !== "string" || value.length > 262144) throw Error("Invalid variable"); __values.set(key, value); __changed.add(key); }, unset(key) { __values.delete(String(key)); __changed.add(String(key)); } }),\n' +
    'response: __input.response,\n' +
    'test(name, fn) { try { const result = fn(); if(result && typeof result.then === "function") throw Error("Async assertion"); __tests.push({name:String(name).slice(0,200),passed:true}); } catch { __tests.push({name:String(name).slice(0,200),passed:false}); } },\n' +
    'expect(value) { return { toBe(expected) { if(!Object.is(value, expected)) throw Error("Assertion"); }, toEqual(expected) { if(JSON.stringify(value) !== JSON.stringify(expected)) throw Error("Assertion"); }, toBeTruthy() { if(!value) throw Error("Assertion"); }, toBeFalsy() { if(value) throw Error("Assertion"); }, toBeDefined() { if(value === undefined) throw Error("Assertion"); }, toBeNull() { if(value !== null) throw Error("Assertion"); }, toContain(expected) { if(!value.includes(expected)) throw Error("Assertion"); }, toHaveProperty(key) { if(!Object.hasOwn(value,key)) throw Error("Assertion"); } }; }\n' +
    '});\n' +
    'let __ok = true;\n'
  );
  setup.runInContext(context, { timeout: 200 });
  const scripts = JSON.parse(input).scripts;
  for (const script of scripts) {
    try { new vm.Script('{\n' + script + '\n}').runInContext(context, { timeout: 300 }); }
    catch { new vm.Script('__ok = false').runInContext(context, { timeout: 100 }); break; }
  }
  const output = new vm.Script('JSON.stringify({ ok: __ok, variables: Object.fromEntries(__values), checks: __tests, changed: [...__changed] })').runInContext(context, {timeout: 100});
  if (output.length > 1024 * 1024) process.exit(1);
  process.stdout.write(output);
} catch { process.exitCode = 1; }
`;
