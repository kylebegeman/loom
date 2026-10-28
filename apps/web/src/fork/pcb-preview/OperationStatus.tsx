import { useEffect, useState } from "react";
import { HourglassIcon } from "lucide-react";
import styles from "./workspace.module.css";

/** A timer runs only for a pending operation; there is no continuously painted spinner. */
export function OperationStatus({
  label,
  detail,
  onCancel,
  silent = false,
}: {
  silent?: boolean;
  label: string;
  detail?: string;
  onCancel?: () => void;
}) {
  const [started] = useState(() => Date.now()),
    [seconds, setSeconds] = useState(0);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- ticks the elapsed seconds counter on an interval while mounted
  useEffect(() => {
    const timer = setInterval(() => setSeconds(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [started]);
  return (
    <div className={styles.operation} role={silent ? undefined : "status"}>
      <HourglassIcon aria-hidden="true" />
      <div>
        <strong>{label}</strong>
        {detail && <p>{detail}</p>}
      </div>
      <span aria-hidden="true">{seconds}s</span>
      {onCancel && (
        <button className={styles.textButton} onClick={onCancel}>
          Cancel
        </button>
      )}
    </div>
  );
}
