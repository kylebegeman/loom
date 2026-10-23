import type { ReactNode } from "react";
import { ChevronRightIcon } from "lucide-react";

export interface LibraryFlowNavigation {
  readonly steps: readonly string[];
  readonly current: number;
  readonly onBack?: (() => void) | undefined;
  readonly busy?: boolean | undefined;
}

export function LibraryFlowProgress({ steps, current }: LibraryFlowNavigation) {
  return (
    <nav aria-label="Setup progress">
      <ol className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        {steps.map((label, index) => (
          <li
            key={label}
            aria-current={index === current ? "step" : undefined}
            className="flex items-center gap-2"
          >
            {index > 0 ? <ChevronRightIcon aria-hidden className="size-3" /> : null}
            <span className={index === current ? "font-medium text-foreground" : undefined}>
              {label}
            </span>
          </li>
        ))}
      </ol>
    </nav>
  );
}

/** Keep edits in each step mounted while another step is visible. */
export function LibraryFlowSection({
  active,
  children,
}: {
  readonly active: boolean;
  readonly children: ReactNode;
}) {
  return (
    <div hidden={!active} className={active ? "space-y-4" : "hidden"}>
      {children}
    </div>
  );
}
