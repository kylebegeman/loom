import { useEffect, useState } from "react";
import { HourglassIcon } from "lucide-react";
import styles from "./workspace.module.css";

export type OperationProgress = {
  label: string;
  detail?: string;
  completed?: number;
  total?: number;
};
/** Discrete progress updates keep long jobs visible without an animation or idle timer. */
export function OperationStatus({ label, detail, completed, total }: OperationProgress) {
  const [started] = useState(() => Date.now());
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setSeconds(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [started]);
  return (
    <div className={styles["model-operation"]} role="status" aria-live="polite">
      <div className={styles["model-operation-heading"]}>
        <HourglassIcon aria-hidden="true" />
        <strong>{label}</strong>
        <span aria-hidden="true">{seconds}s</span>
      </div>
      {detail && <p>{detail}</p>}
      {total !== undefined && completed !== undefined && (
        <progress aria-label={label} max={Math.max(1, total)} value={completed} />
      )}
    </div>
  );
}
