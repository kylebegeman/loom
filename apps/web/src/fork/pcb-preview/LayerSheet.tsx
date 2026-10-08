import { useEffect, useState } from "react";
import { useAtomValue } from "@effect/atom-react";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { pcb } from "./state";
import { asyncValue, asyncError } from "./usePcbPreview";
import styles from "./workspace.module.css";
export function LayerSheet({
  threadRef,
  renderKey,
  sheetId,
  revision,
  opacity,
}: {
  threadRef: ScopedThreadRef;
  renderKey: string;
  sheetId: string;
  revision: string;
  opacity: number;
}) {
  const result = useAtomValue(
    pcb.readSheet.resultAtom({
      environmentId: threadRef.environmentId,
      input: { threadId: threadRef.threadId, renderKey, sheetId, revision },
    }),
  );
  const svg = asyncValue(result)?.svg;
  const [image, setImage] = useState<{ svg: string; url: string } | null>(null),
    [decoded, setDecoded] = useState<string | null>(null),
    [failed, setFailed] = useState<string | null>(null);
  const url = image && image.svg === svg ? image.url : undefined;
  const error =
    asyncError(result) ??
    (url && failed === url ? "This layer could not load. Refresh the preview." : null);
  const loading = result.waiting || result._tag === "Initial" || !url || decoded !== url;
  useEffect(() => {
    if (!svg) return;
    const value = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
    // Publish the newly allocated Blob URL; cleanup releases the external image resource.
    // eslint-disable-next-line react/set-state-in-effect
    setImage({ svg, url: value });
    return () => URL.revokeObjectURL(value);
  }, [svg]);
  return (
    <>
      <img
        src={error ? undefined : url}
        alt={sheetId}
        data-layer-image
        data-layer-loading={loading && !error ? "true" : undefined}
        data-layer-visible={opacity > 0 ? "true" : undefined}
        draggable={false}
        className={styles.drawing}
        style={{ opacity }}
        onLoad={() => setDecoded(url ?? null)}
        onError={() => setFailed(url ?? null)}
      />
      {error && (
        <span role="alert" className={styles.canvasError}>
          {error}
        </span>
      )}
    </>
  );
}
