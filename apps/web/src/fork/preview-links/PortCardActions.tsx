import type { ReactNode } from "react";
import { useAtomValue } from "@effect/atom-react";
import { supportsLoomFeature } from "@t3tools/client-runtime/fork";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { ExternalLinkIcon, Link2Icon } from "lucide-react";
import { Button } from "~/components/ui/button";
import { useServerConfigs } from "~/state/entities";
import { copyPreviewLink, useAction } from "./parts";
import { FEATURE, previewLinks, runCommand } from "./state";
import { openInSystemBrowser } from "./systemBrowser";

/**
 * Adds link actions beside a local server row. They sit over the row as siblings, since the
 * row is itself a button. Without the feature or preview access the row renders alone.
 */
export function PreviewLinkCardActions({
  threadRef,
  port,
  row,
}: {
  threadRef: ScopedThreadRef;
  port: number;
  row: ReactNode;
}) {
  const { environmentId } = threadRef;
  const configs = useServerConfigs();
  const canShare = useAtomValue(previewLinks.share.permissionAtom(environmentId));
  const action = useAction();
  const capabilities = configs.get(environmentId)?.environment.capabilities;
  if (!canShare || !supportsLoomFeature(capabilities, FEATURE)) return row;

  const share = () => runCommand(previewLinks.share, { environmentId, input: { port } });
  const copy = () =>
    void action.act("Unable to copy preview link", () =>
      copyPreviewLink(share().then((link) => link.url)),
    );
  const openInBrowser = () =>
    void action.act("Unable to open preview", () =>
      openInSystemBrowser(async () => {
        const link = await share();
        return (await runCommand(previewLinks.open, { environmentId, input: { link: link.id } }))
          .url;
      }),
    );

  return (
    <div className="group/preview-link relative flex w-full items-center">
      <div className="min-w-0 flex-1">{row}</div>
      <div className="absolute right-3 flex items-center gap-0.5 opacity-0 focus-within:opacity-100 group-hover/preview-link:opacity-100 pointer-coarse:opacity-100">
        <Button
          size="icon-xs"
          variant="ghost-muted"
          aria-label="Copy preview link"
          title="Copy preview link"
          disabled={action.busy}
          onClick={copy}
        >
          <Link2Icon />
        </Button>
        <Button
          size="icon-xs"
          variant="ghost-muted"
          aria-label="Open in browser"
          title="Open in browser"
          disabled={action.busy}
          onClick={openInBrowser}
        >
          <ExternalLinkIcon />
        </Button>
      </div>
    </div>
  );
}
