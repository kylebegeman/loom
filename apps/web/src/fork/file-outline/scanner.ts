import type { OutlineLanguageId } from "./types";

interface LineComment {
  readonly start: number;
  readonly text: string;
}

/** Masks literals and comments while preserving UTF-16 offsets and every newline. */
export function scanSource(source: string, language: OutlineLanguageId) {
  const masked = source.split("");
  const comments: LineComment[] = [];
  const nestedComments = language === "rust" || language === "swift" || language === "kotlin";
  const javascript = language === "typescript" || language === "javascript";
  const mask = (start: number, end: number) => {
    for (let i = start; i < Math.min(end, source.length); i++)
      if (source[i] !== "\n" && source[i] !== "\r") masked[i] = " ";
  };
  const quotedEnd = (start: number, quote: string, raw = false) => {
    let i = start + quote.length;
    while (i < source.length) {
      if (!raw && source[i] === "\\") {
        i += 2;
        continue;
      }
      if (source.startsWith(quote, i)) return i + quote.length;
      i++;
    }
    return source.length;
  };
  const blockEnd = (start: number) => {
    let depth = 1;
    let i = start + 2;
    while (i < source.length) {
      if (nestedComments && source.startsWith("/*", i)) {
        depth++;
        i += 2;
      } else if (source.startsWith("*/", i)) {
        i += 2;
        if (--depth === 0) break;
      } else i++;
    }
    return i;
  };
  const kotlinStringEnd = (start: number, quote: string): number => {
    let i = start + quote.length;
    let interpolation = 0;
    while (i < source.length) {
      if (interpolation > 0) {
        if (source[i] === '"') {
          i = kotlinStringEnd(i, source.startsWith('"""', i) ? '"""' : '"');
          continue;
        }
        if (source[i] === "'") {
          i = quotedEnd(i, "'");
          continue;
        }
        if (source.startsWith("/*", i)) {
          i = blockEnd(i);
          continue;
        }
        if (source.startsWith("//", i)) {
          const end = source.indexOf("\n", i);
          i = end < 0 ? source.length : end;
          continue;
        }
        if (source[i] === "{") interpolation++;
        else if (source[i] === "}") interpolation--;
      } else {
        if (quote.length === 1 && source[i] === "\\") {
          i += 2;
          continue;
        }
        if (source.startsWith(quote, i)) return i + quote.length;
        if (source.startsWith("${", i)) {
          interpolation = 1;
          i += 2;
          continue;
        }
      }
      i++;
    }
    return source.length;
  };
  const templateEnd = (start: number): number => {
    let i = start + 1;
    let interpolation = 0;
    while (i < source.length) {
      const char = source[i];
      if (char === "\\") {
        i += 2;
        continue;
      }
      if (interpolation > 0) {
        if (char === '"' || char === "'") {
          i = quotedEnd(i, char);
          continue;
        }
        if (char === "\x60") {
          i = templateEnd(i);
          continue;
        }
        if (source.startsWith("/*", i)) {
          i = blockEnd(i);
          continue;
        }
        if (source.startsWith("//", i)) {
          const end = source.indexOf("\n", i);
          i = end < 0 ? source.length : end;
          continue;
        }
        if (char === "{") interpolation++;
        else if (char === "}") interpolation--;
      } else {
        if (char === "\x60") return i + 1;
        if (char === "$" && source[i + 1] === "{") {
          interpolation = 1;
          i += 2;
          continue;
        }
      }
      i++;
    }
    return source.length;
  };

  for (let i = 0; i < source.length;) {
    const start = i;
    const char = source[i];
    if (
      (language === "python" && char === "#") ||
      (language !== "python" && source.startsWith("//", i))
    ) {
      const newline = source.indexOf("\n", i);
      i = newline < 0 ? source.length : newline;
      comments.push({ start, text: source.slice(start, i) });
    } else if (language !== "python" && source.startsWith("/*", i)) {
      i = blockEnd(i);
    } else if (language === "rust" && (char === "r" || char === "b")) {
      const raw = /^(?:br|r)(#{0,255})"/.exec(source.slice(i, i + 260));
      if (!raw) {
        i++;
        continue;
      }
      const delimiter = '"' + raw[1];
      const end = source.indexOf(delimiter, i + raw[0].length);
      i = end < 0 ? source.length : end + delimiter.length;
    } else if (language === "swift" && char === "#") {
      const raw = /^(#+)("""|")/.exec(source.slice(i, i + 260));
      if (!raw) {
        i++;
        continue;
      }
      const delimiter = raw[2]! + raw[1]!;
      const end = source.indexOf(delimiter, i + raw[0].length);
      i = end < 0 ? source.length : end + delimiter.length;
    } else if (javascript && char === "\x60") {
      i = templateEnd(i);
    } else if (language === "go" && char === "\x60") {
      i = quotedEnd(i, char, true);
    } else if (char === '"' || char === "'") {
      if (
        language === "rust" &&
        char === "'" &&
        !/^'(?:\\(?:u\{[^}]+\}|x[0-9a-fA-F]{2}|.)|[^'\r\n\\])'/u.test(source.slice(i, i + 32))
      ) {
        i++;
        continue;
      }
      const triple = language === "python" || language === "swift" || language === "kotlin";
      const quote = triple && source.startsWith(char.repeat(3), i) ? char.repeat(3) : char;
      i = language === "kotlin" && char === '"' ? kotlinStringEnd(i, quote) : quotedEnd(i, quote);
    } else if (javascript && char === "/") {
      const prefix = source.slice(Math.max(0, i - 24), i).trimEnd();
      if (!/(?:^|[=(:,!&|?;{}]|\b(?:return|throw|yield))$/.test(prefix)) {
        i++;
        continue;
      }
      i++;
      let inClass = false;
      while (i < source.length && source[i] !== "\n") {
        if (source[i] === "\\") {
          i += 2;
          continue;
        }
        if (source[i] === "[") inClass = true;
        if (source[i] === "]") inClass = false;
        if (source[i++] === "/" && !inClass) break;
      }
      while (/[a-z]/i.test(source[i] ?? "")) i++;
    } else {
      i++;
      continue;
    }
    mask(start, i);
  }
  return { masked: masked.join(""), comments };
}

export function maskSource(source: string, language: OutlineLanguageId): string {
  return scanSource(source, language).masked;
}
