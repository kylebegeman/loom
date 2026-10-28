import { BRAND_NAME } from "@t3tools/shared/brand";

import { cn } from "../lib/utils";

/**
 * The header wordmark; size, weight, tracking and color come from the surrounding text. The box is
 * trimmed to the capitals so the word centers optically, and padded so round-letter overshoot
 * stays inside the truncation clip.
 */
export function LoomWordmark({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "truncate [text-box:trim-both_cap_alphabetic] supports-[text-box:trim-both_cap_alphabetic]:py-1",
        className,
      )}
    >
      {BRAND_NAME}
    </span>
  );
}
