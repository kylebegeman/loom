// fork: mobile-design
export const MOBILE_TYPOGRAPHY = {
  micro: { fontSize: 11, lineHeight: 14 },
  caption: { fontSize: 12, lineHeight: 16 },
  label: { fontSize: 13, lineHeight: 17 },
  footnote: { fontSize: 14, lineHeight: 19 },
  body: { fontSize: 17, lineHeight: 24 },
  headline: { fontSize: 18, lineHeight: 24 },
  title: { fontSize: 22, lineHeight: 29 },
  largeTitle: { fontSize: 28, lineHeight: 34 },
  display: { fontSize: 32, lineHeight: 38 },
} as const;

export const MOBILE_CODE_SURFACE = {
  rowHeight: 22,
  gutterWidth: 46,
  codePadding: 7,
  textVerticalInset: 2,
  fontSize: MOBILE_TYPOGRAPHY.caption.fontSize,
  lineNumberFontSize: MOBILE_TYPOGRAPHY.micro.fontSize,
} as const;

/** Class names share the same scaled CSS variables as native text roles. */
export const MOBILE_TEXT_CLASSES = {
  micro: "text-3xs",
  caption: "text-2xs",
  label: "text-xs",
  footnote: "text-sm",
  body: "text-base",
  headline: "text-lg",
  title: "text-xl",
  largeTitle: "text-2xl",
  display: "text-3xl",
} as const satisfies Record<keyof typeof MOBILE_TYPOGRAPHY, string>;
