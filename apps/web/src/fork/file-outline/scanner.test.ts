import { describe, expect, it } from "vite-plus/test";
import { maskSource } from "./scanner";

describe("outline scanner", () => {
  it.each([
    [
      "typescript",
      '/* fake\nclass Fake {} */\nconst text = "class Fake {}"; // fake\nfunction real() {}',
    ],
    ["python", 'r"""fake\ndef fake(): pass\n"""\ndef real(): pass'],
    [
      "rust",
      '/* outer /* nested */ class Fake {} */\nlet text = r##"struct Fake {}"##;\nfn real() {}',
    ],
    [
      "swift",
      '/* outer /* nested */ class Fake {} */\nlet text = #"class Fake {}"#;\nfunc real() {}',
    ],
    [
      "kotlin",
      '/* outer /* nested */ class Fake {} */\nval text = """class Fake {}"""\nfun real() {}',
    ],
    [
      "go",
      "var text = " +
        String.fromCharCode(96) +
        "type Fake struct {}" +
        String.fromCharCode(96) +
        "\nfunc real() {}",
    ],
  ] as const)("masks %s comments and literals without changing offsets", (language, source) => {
    const masked = maskSource(source, language);
    expect(masked).toHaveLength(source.length);
    expect([...masked.matchAll(/\n/g)].map((match) => match.index)).toEqual(
      [...source.matchAll(/\n/g)].map((match) => match.index),
    );
    expect(masked).not.toContain("Fake");
    expect(masked).not.toContain("fake");
    expect(masked).toContain("real");
  });
  it("masks templates and nested interpolations, regexes and escaped quotes", () => {
    const tick = String.fromCharCode(96);
    const source =
      "const x = " +
      tick +
      "hello $" +
      "{() => " +
      tick +
      "class Fake {}" +
      tick +
      "}" +
      tick +
      ';\nconst r = /[{}\\/]/g;\nconst s = "escaped \\" class Fake {}";\nfunction real() {}';
    expect(maskSource(source, "typescript")).not.toContain("Fake");
    expect(maskSource(source, "typescript")).not.toContain("[{}");
    expect(maskSource(source, "typescript")).toContain("function real");
  });
  it("masks Kotlin strings inside interpolations", () => {
    const source =
      'val label = "${format("class Fake {}", "${other("fun fake() {}")}")}"\nfun real() {}';
    const masked = maskSource(source, "kotlin");
    expect(masked).toHaveLength(source.length);
    expect(masked).not.toContain("Fake");
    expect(masked).not.toContain("fake");
    expect(masked).toContain("fun real");
  });
  it("keeps Rust lifetimes and masks character literals", () => {
    expect(maskSource("fn run<'a>(value: &'a str) { let c = 'x'; }", "rust")).toContain(
      "run<'a>(value: &'a str)",
    );
    expect(maskSource("let c = '\\n';", "rust")).not.toContain("\\n");
  });
});
