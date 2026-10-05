import { MAX_OUTLINE_SYMBOLS, outlineSymbol } from "../types";
export const markdownOutline = {
  languageId: "markdown" as const,
  extract(source: string) {
    const lines = source.split("\n");
    const headings: { name: string; line: number; level: number }[] = [];
    let fence: { char: string; length: number } | null = null;
    let frontMatter = lines[0]?.trim() === "---" || lines[0]?.trim() === "+++";
    const frontDelimiter = lines[0]?.trim();
    let previousText: string | null = null;
    for (let i = 0; i < lines.length && headings.length <= MAX_OUTLINE_SYMBOLS; i++) {
      const line = lines[i]!.replace(/\r$/, "");
      if (frontMatter) {
        if (i > 0 && line.trim() === frontDelimiter) frontMatter = false;
        continue;
      }
      const boundary = /^ {0,3}([\x60~]{3,})(.*)$/.exec(line);
      if (fence) {
        if (
          boundary &&
          boundary[1]![0] === fence.char &&
          boundary[1]!.length >= fence.length &&
          !boundary[2]!.trim()
        )
          fence = null;
        continue;
      }
      if (boundary && /^(\x60+|~+)$/.test(boundary[1]!)) {
        fence = { char: boundary[1]![0]!, length: boundary[1]!.length };
        previousText = null;
        continue;
      }
      const atx = /^ {0,3}(#{1,6})(?:[ \t]+(.*?)|[ \t]*)$/.exec(line);
      const setext = /^ {0,3}(=+|-+)\s*$/.exec(line);
      if (atx)
        headings.push({
          name: (atx[2] ?? "").replace(/\s+#+\s*$/, "").trim(),
          line: i + 1,
          level: atx[1]!.length,
        });
      else if (setext && previousText)
        headings.push({ name: previousText, line: i, level: setext[1]![0] === "=" ? 1 : 2 });
      previousText =
        !atx && !setext && /^\S/.test(line) && !/^(?:>|[-+*]\s|\d+\.\s|<!--)/.test(line)
          ? line.trim()
          : null;
    }
    const minimum = Math.min(...headings.map((heading) => heading.level));
    return headings.map((heading) =>
      outlineSymbol(heading.name, "heading", heading.line, heading.level - minimum),
    );
  },
};
