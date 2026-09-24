import { BRAND_NAME } from "@t3tools/shared/brand";

import { cn } from "../lib/utils";

/**
 * Loom fork: the header wordmark, in place of upstream's "T3" mark plus "Code".
 * Size, weight, tracking and color come from the surrounding text, so it follows
 * the sidebar header in both themes and on the stage backdrop. The text box is
 * trimmed to the capitals, like upstream's "Code", so the word centers optically.
 */
export function LoomWordmark({ className }: { className?: string }) {
  return (
    <span className={cn("truncate [text-box:trim-both_cap_alphabetic]", className)}>
      {BRAND_NAME}
    </span>
  );
}
