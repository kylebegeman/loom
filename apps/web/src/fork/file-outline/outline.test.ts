import { describe, expect, it, vi } from "vite-plus/test";
import { extractOutline, MAX_OUTLINE_SYMBOLS, outlineLanguageForPath } from "./outline";

const symbols = (path: string, source: string) =>
  extractOutline(path, source)?.symbols.map(({ name, kind, line, depth }) => [
    name,
    kind,
    line,
    depth,
  ]);

describe("file outline", () => {
  it.each([
    ["ts", "typescript"],
    ["mts", "typescript"],
    ["cts", "typescript"],
    ["tsx", "typescript"],
    ["js", "javascript"],
    ["mjs", "javascript"],
    ["cjs", "javascript"],
    ["jsx", "javascript"],
    ["swift", "swift"],
    ["py", "python"],
    ["pyi", "python"],
    ["go", "go"],
    ["rs", "rust"],
    ["kt", "kotlin"],
    ["kts", "kotlin"],
    ["md", "markdown"],
    ["mdx", "markdown"],
    ["markdown", "markdown"],
  ])("supports .%s", (extension, language) => {
    expect(outlineLanguageForPath("/project/FILE." + extension.toUpperCase())).toBe(language);
  });
  it.each(["file.json", "file.csv", "file.tsv", "file.svg", "file.pdf", "file.png", "folder"])(
    "does not outline %s",
    (path) => expect(extractOutline(path, "class Fake {}")).toBeNull(),
  );
  it("extracts TypeScript declarations and members, excluding callbacks and locals", () => {
    expect(
      symbols(
        "fixture.ts",
        [
          "@sealed",
          "export abstract class Service<T> extends Base {",
          "  constructor() {}",
          "  static run<U>(input: U) { const hidden = () => {}; }",
          "  get value() { return 1; }",
          "  set value(next: number) {}",
          "  #secret() {}",
          "  handler = async (",
          "    value: string,",
          "  ) => { function hidden() {} };",
          "}",
          "export interface Shape {",
          "  render(value: string): void;",
          "}",
          "export type Alias = string;",
          "export const enum Mode { One, Two }",
          "export namespace Tools {",
          "  export function* iterate<T>() {}",
          "}",
          "export const transform = async (",
          "  value: string,",
          ") => value;",
          "export const settings = {",
          "  save() {},",
          "  load: () => {},",
          "};",
          "const noise = 1;",
          "export const VERSION = 2;",
          "items.map(function callback() {});",
          "/* export class Fake {} */",
          'const text = "function fake() {}";',
        ].join("\n"),
      ),
    ).toEqual([
      ["Service", "class", 2, 0],
      ["constructor", "method", 3, 1],
      ["run", "method", 4, 1],
      ["value", "method", 5, 1],
      ["value", "method", 6, 1],
      ["#secret", "method", 7, 1],
      ["handler", "method", 8, 1],
      ["Shape", "interface", 12, 0],
      ["render", "method", 13, 1],
      ["Alias", "type", 15, 0],
      ["Mode", "enum", 16, 0],
      ["Tools", "module", 17, 0],
      ["iterate", "function", 18, 1],
      ["transform", "function", 20, 0],
      ["settings", "constant", 23, 0],
      ["save", "method", 24, 1],
      ["load", "method", 25, 1],
      ["VERSION", "constant", 28, 0],
    ]);
  });
  it("handles TSX, generics, overloads and regex braces", () => {
    expect(
      symbols(
        "fixture.tsx",
        [
          "export function render(value: string): string;",
          "export function render(value: string) {",
          " const expression = /[{}]/g;",
          " return <div onClick={() => { const hidden = () => {}; }}>Hi</div>;",
          "}",
          "export const View = <T,>(props: T) => <div />;",
          "export default function App() { return <View />; }",
        ].join("\n"),
      ),
    ).toEqual([
      ["render", "function", 1, 0],
      ["render", "function", 2, 0],
      ["View", "function", 6, 0],
      ["App", "function", 7, 0],
    ]);
  });
  it("extracts Swift types, members, enum cases and real MARK comments", () => {
    expect(
      symbols(
        "fixture.swift",
        [
          "// MARK: - Models",
          "@MainActor public struct Store {",
          "  var title: String",
          "  let count = 1",
          "  init() {}",
          "  deinit {}",
          "  subscript(index: Int) -> Int { 0 }",
          "  public func save() { func hidden() {} }",
          "}",
          "extension Store { static func make() {} }",
          "protocol Named { func name() -> String }",
          "actor Worker { func run() {} }",
          "enum State {",
          "  case idle, ready(Int)",
          "}",
          "typealias Identifier = String",
          'let text = """',
          "// MARK: Fake",
          "class Fake {}",
          '"""',
        ].join("\n"),
      ),
    ).toEqual([
      ["Models", "heading", 1, 0],
      ["Store", "struct", 2, 0],
      ["title", "variable", 3, 1],
      ["count", "constant", 4, 1],
      ["init", "method", 5, 1],
      ["deinit", "method", 6, 1],
      ["subscript", "method", 7, 1],
      ["save", "method", 8, 1],
      ["Store", "extension", 10, 0],
      ["make", "method", 10, 1],
      ["Named", "protocol", 11, 0],
      ["name", "method", 11, 1],
      ["Worker", "class", 12, 0],
      ["run", "method", 12, 1],
      ["State", "enum", 13, 0],
      ["idle", "constant", 14, 1],
      ["ready", "constant", 14, 1],
      ["Identifier", "type", 16, 0],
    ]);
  });
  it("extracts Python definitions using indentation and ignores bracket continuations", () => {
    expect(
      symbols(
        "fixture.py",
        [
          '"""',
          "def fake(): pass",
          '"""',
          "LIMIT = 10",
          "class Service:",
          "    @decorator",
          "    async def run(self):",
          "        def hidden(): pass",
          "        class Hidden: pass",
          "def main(",
          "    arg,",
          "):",
          "    return arg",
          "config = {",
          '    "class Fake:": 1,',
          "}",
          "async def finish(): pass",
        ].join("\n"),
      ),
    ).toEqual([
      ["LIMIT", "constant", 4, 0],
      ["Service", "class", 5, 0],
      ["run", "method", 7, 1],
      ["main", "function", 10, 0],
      ["finish", "function", 17, 0],
    ]);
  });
  it("groups Go receiver methods and supports declaration blocks", () => {
    expect(
      symbols(
        "fixture.go",
        [
          "package example",
          "type (",
          "  Client struct {",
          "  }",
          "  Handler interface {",
          "    Handle() error",
          "  }",
          "  Key string",
          ")",
          "const (",
          "  First = iota",
          "  Second",
          ")",
          "var counter int",
          "func main() { hidden := func() {} }",
          "func (c *Client) Run() {}",
          "func (c External) Close() {}",
        ].join("\n"),
      ),
    ).toEqual([
      ["Client", "struct", 3, 0],
      ["Run", "method", 16, 1],
      ["Handler", "interface", 5, 0],
      ["Handle", "method", 6, 1],
      ["Key", "type", 8, 0],
      ["First", "constant", 11, 0],
      ["Second", "constant", 12, 0],
      ["counter", "variable", 14, 0],
      ["main", "function", 15, 0],
      ["(External).Close", "method", 17, 0],
    ]);
  });
  it("extracts Rust modules, impls and attributes without confusing lifetimes", () => {
    expect(
      symbols(
        "fixture.rs",
        [
          "#[derive(Clone)]",
          "pub struct Item<'a> { value: &'a str }",
          "pub enum Mode { One, Two }",
          "pub trait Named { fn name(&self); }",
          "impl<'a> Named for Item<'a> {",
          "  fn name(&self) { fn hidden() {} }",
          "}",
          "pub(crate) mod helpers {",
          "  pub async unsafe fn run() {}",
          "}",
          "pub type Key = String;",
          "const LIMIT: usize = 1;",
          "static VALUE: usize = 2;",
          "macro_rules! create { () => {} }",
          'extern "C" fn exported() {}',
        ].join("\n"),
      ),
    ).toEqual([
      ["Item", "struct", 2, 0],
      ["Mode", "enum", 3, 0],
      ["Named", "trait", 4, 0],
      ["name", "method", 4, 1],
      ["Named for Item", "impl", 5, 0],
      ["name", "method", 6, 1],
      ["helpers", "module", 8, 0],
      ["run", "function", 9, 1],
      ["Key", "type", 11, 0],
      ["LIMIT", "constant", 12, 0],
      ["VALUE", "variable", 13, 0],
      ["create", "function", 14, 0],
      ["exported", "function", 15, 0],
    ]);
  });
  it("extracts methods from inherent Rust implementations", () => {
    expect(
      symbols(
        "model.rs",
        "pub struct Model {}\nimpl Model {\n  pub fn save(&self) {}\n}\npub fn finish() {}",
      ),
    ).toEqual([
      ["Model", "struct", 1, 0],
      ["Model", "impl", 2, 0],
      ["save", "method", 3, 1],
      ["finish", "function", 5, 0],
    ]);
  });
  it("extracts Kotlin objects, generic/extension functions and escaped identifiers", () => {
    const tick = String.fromCharCode(96);
    expect(
      symbols(
        "fixture.kt",
        [
          "@Composable",
          "data class Model(val id: Int) {",
          "  companion object {",
          "    const val MAX = 10",
          "  }",
          "  suspend fun load() { val hidden = 1; fun fake() {} }",
          "  val title: String",
          "}",
          "sealed interface Result",
          "fun interface Listener { fun call() }",
          "object Singleton { fun run() {} }",
          "fun <T> List<T>.first(): T = this[0]",
          "fun " + tick + "with spaces" + tick + "() {}",
          "typealias Key = String",
          "const val VERSION = 1",
          "private val secret = 1",
          "val visible = 2",
          "enum class State { IDLE, READY; fun done() {} }",
        ].join("\n"),
      ),
    ).toEqual([
      ["Model", "class", 2, 0],
      ["companion", "class", 3, 1],
      ["MAX", "constant", 4, 2],
      ["load", "method", 6, 1],
      ["title", "variable", 7, 1],
      ["Result", "interface", 9, 0],
      ["Listener", "interface", 10, 0],
      ["call", "method", 10, 1],
      ["Singleton", "class", 11, 0],
      ["run", "method", 11, 1],
      ["List.first", "function", 12, 0],
      ["with spaces", "function", 13, 0],
      ["Key", "type", 14, 0],
      ["VERSION", "constant", 15, 0],
      ["visible", "variable", 17, 0],
      ["State", "enum", 18, 0],
      ["IDLE", "constant", 18, 1],
      ["READY", "constant", 18, 1],
      ["done", "method", 18, 1],
    ]);
  });
  it("outlines Markdown headings, excluding front matter, fences and indented code", () => {
    expect(
      symbols(
        "fixture.md",
        [
          "---",
          "title: Front matter",
          "---",
          "## First",
          "### Child",
          "~~~typescript",
          "# Fake",
          "~~~",
          "Second",
          "------",
          "    # Indented code",
          "## Last ##",
        ].join("\n"),
      ),
    ).toEqual([
      ["First", "heading", 4, 0],
      ["Child", "heading", 5, 1],
      ["Second", "heading", 9, 0],
      ["Last", "heading", 12, 0],
    ]);
  });
  it("keeps same-line overload and accessor IDs unique", () => {
    const result = extractOutline(
      "overload.ts",
      "export function run(): void; export function run() {}",
    );
    expect(result?.symbols).toHaveLength(2);
    expect(new Set(result?.symbols.map((symbol) => symbol.id)).size).toBe(2);
  });
  it("does not assign the next declaration's body to an empty type", () => {
    expect(
      symbols(
        "types.swift",
        "public class First {}\nprotocol Empty {}\nclass Second { func run() {} }",
      ),
    ).toEqual([
      ["First", "class", 1, 0],
      ["Empty", "protocol", 2, 0],
      ["Second", "class", 3, 0],
      ["run", "method", 3, 1],
    ]);
    expect(
      symbols(
        "types.ts",
        "export function value(): { key: string } { function hidden() {} }\nexport function next() {}",
      ),
    ).toEqual([
      ["value", "function", 1, 0],
      ["next", "function", 2, 0],
    ]);
  });
  it("preserves CRLF line numbers and bounds large output", () => {
    expect(symbols("x.ts", "// ignored\r\n\r\nexport function run() {}")?.[0]?.[2]).toBe(3);
    const result = extractOutline(
      "x.ts",
      Array.from({ length: 2100 }, (_, i) => "export function f" + i + "() {}").join("\n"),
    );
    expect(result?.symbols).toHaveLength(MAX_OUTLINE_SYMBOLS);
    expect(result?.capped).toBe(true);
  });
  it("handles a 1 MB file without quadratic scanning", () => {
    const source = "// filler line with no symbols\n".repeat(34000) + "export function last() {}";
    const started = performance.now();
    expect(extractOutline("large.ts", source)?.symbols[0]?.line).toBe(34001);
    expect(performance.now() - started).toBeLessThan(1000);
  });
  it("logs extraction errors once and keeps the file viewer usable", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const failing = {
      languageId: "typescript" as const,
      extract: () => {
        throw new Error("bad");
      },
    };
    expect(extractOutline("bad.ts", "", failing)?.symbols).toEqual([]);
    expect(extractOutline("bad.ts", "", failing)?.symbols).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});
