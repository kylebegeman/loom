export type Sexp = string | Sexp[];
/** Parse saved KiCad data, with explicit limits on nesting and token count. */
export function parseSexp(source: string): Sexp[] {
  const root: Sexp[] = [],
    stack = [root];
  const tokens = source.match(/"(?:\\.|[^"\\])*"|[()]|[^\s()]+/g) ?? [];
  if (tokens.length > 2000000)
    throw new Error("KiCad source exceeds the semantic inspection limit.");
  for (const token of tokens) {
    if (token === "(") {
      const next: Sexp[] = [];
      stack.at(-1)!.push(next);
      stack.push(next);
      if (stack.length > 256) throw new Error("KiCad source nesting exceeds the inspection limit.");
    } else if (token === ")") {
      if (stack.length === 1) throw new Error("Unbalanced KiCad source.");
      stack.pop();
    } else
      stack
        .at(-1)!
        .push(
          token.startsWith('"')
            ? token
                .slice(1, -1)
                .replace(/\\(["\\nrt])/g, (_, c: string) => ({ n: "\n", r: "\r", t: "\t" })[c] ?? c)
            : token,
        );
  }
  if (stack.length !== 1) throw new Error("Unbalanced KiCad source.");
  return root;
}
export const children = (node: Sexp[], name: string): Sexp[][] =>
  node.filter((v): v is Sexp[] => Array.isArray(v) && v[0] === name);
export const child = (node: Sexp[], name: string): Sexp[] => children(node, name)[0] ?? [];
export const atom = (node: Sexp[], index = 1): string =>
  typeof node[index] === "string" ? node[index] : "";
export const number = (node: Sexp[], index = 1, fallback = 0) => {
  const value = Number(atom(node, index));
  return Number.isFinite(value) && atom(node, index) !== "" ? value : fallback;
};
export const property = (node: Sexp[], name: string) =>
  atom(children(node, "property").find((p) => p[1] === name) ?? [], 2);
export const localPosition = (at: Sexp[], local: Sexp[]) => {
  const a = (number(at, 3) * Math.PI) / 180;
  return {
    x: number(at) + number(local) * Math.cos(a) + number(local, 2) * Math.sin(a),
    y: number(at, 2) - number(local) * Math.sin(a) + number(local, 2) * Math.cos(a),
  };
};
