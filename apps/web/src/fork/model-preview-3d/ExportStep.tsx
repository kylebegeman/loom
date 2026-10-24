import { useState } from "react";
import type { SignedFile } from "@t3tools/contracts/fork";
import { Button } from "~/components/ui/button";
import { saveImage } from "./captureExport";

async function downloadStep(
  onExport: () => Promise<SignedFile>,
  urlOf: (relativeUrl: string) => string,
  filename: string,
) {
  const result = await onExport();
  const response = await fetch(urlOf(result.relativeUrl));
  if (!response.ok) throw new Error("The STEP export could not be downloaded.");
  saveImage(
    await response.blob(),
    (filename.split(/[\\/]/).at(-1) ?? "model.b3d.py").replace(/\.b3d\.py$/i, ".step"),
  );
}

export function ExportStep({
  canExport,
  onExport,
  urlOf,
  filename,
}: {
  canExport: boolean;
  onExport: () => Promise<SignedFile>;
  urlOf: (relativeUrl: string) => string;
  filename: string;
}) {
  const [busy, setBusy] = useState(false),
    [failure, setFailure] = useState<string | null>(null);
  const download = async () => {
    setBusy(true);
    setFailure(null);
    await downloadStep(onExport, urlOf, filename)
      .catch((cause: unknown) => {
        setFailure(cause instanceof Error ? cause.message : String(cause));
      })
      .finally(() => {
        setBusy(false);
      });
  };
  return (
    <div className="flex flex-col gap-2">
      <Button
        variant="outline"
        size="sm"
        disabled={!canExport || busy}
        onClick={() => void download()}
      >
        {busy ? "Exporting STEP..." : "Export STEP"}
      </Button>
      {failure && (
        <p role="alert" className="text-xs">
          {failure}
        </p>
      )}
    </div>
  );
}
