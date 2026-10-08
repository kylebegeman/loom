import type { ComponentProps } from "react";
import { Tooltip, TooltipTrigger, TooltipPopup } from "~/components/ui/tooltip";
import styles from "./workspace.module.css";
/** PCB-only tool controls retain their feature styling and shared tooltip behavior. */
export function ToolButton({
  label,
  hint = label,
  side,
  className = styles.tool,
  children,
  ...props
}: ComponentProps<"button"> & {
  label: string;
  hint?: string;
  side?: "top" | "bottom" | "left" | "right";
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={<button type="button" aria-label={label} className={className} {...props} />}
      >
        {children}
      </TooltipTrigger>
      <TooltipPopup side={side}>{hint}</TooltipPopup>
    </Tooltip>
  );
}
