import { useAtomRefresh, useAtomValue } from "@effect/atom-react";
import {
  PREVIEW_PAGES_EMPTY_TEXT,
  PREVIEW_PAGES_UNAVAILABLE_TEXT,
  PREVIEW_PAGE_CONTROL_LABELS,
  previewPageControls,
  previewPageSummary,
  visiblePreviewPages,
  type PreviewPageControl,
} from "@t3tools/client-runtime/fork";
import type { EnvironmentId } from "@t3tools/contracts";
import type { PreviewPage, PreviewPageAction } from "@t3tools/contracts/fork";
import * as Option from "effect/Option";
import { AsyncResult } from "effect/reactivity";
import { SettingsRow } from "~/components/settings/settingsLayout";
import { Button } from "~/components/ui/button";
import { useNowMinute } from "~/hooks/useNowMinute";
import { ensureLocalApi } from "~/localApi";
import { Alert, Muted, failureOf, useAction } from "./parts";
import { previewLinks, runCommand } from "./state";

const NO_PAGE_ACCESS = "This connection cannot change published pages.";

const UPDATE_FAILURE_TITLES: Record<PreviewPageAction, string> = {
  keep: "Unable to keep page",
  release: "Unable to stop keeping page",
  end: "Unable to end page",
  restore: "Unable to restore page",
};

function PageRow({
  environmentId,
  page,
  now,
  canUpdate,
}: {
  environmentId: EnvironmentId;
  page: PreviewPage;
  now: number;
  canUpdate: boolean;
}) {
  const action = useAction();
  const run = (control: PreviewPageControl) => {
    if (control === "open") {
      // openExternal opens the tab before its first await, so the click still counts as a gesture.
      void action.act("Unable to open page", () => ensureLocalApi().shell.openExternal(page.url));
      return;
    }
    void action.act(UPDATE_FAILURE_TITLES[control], () =>
      runCommand(previewLinks.updatePage, {
        environmentId,
        input: { pageId: page.id, action: control },
      }),
    );
  };

  return (
    <li className="flex flex-col gap-2 rounded-lg border border-border/70 px-3 py-2.5">
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="break-words font-medium text-sm">{page.title}</span>
        <span className="text-muted-foreground text-xs">{previewPageSummary(page, now)}</span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {previewPageControls(page, canUpdate, now).map(({ control, enabled }) => (
          <Button
            key={control}
            size="xs"
            variant={control === "end" ? "destructive-outline" : "outline"}
            disabled={!enabled || action.busy}
            // Every row repeats the same buttons, so a screen reader needs the page in the name.
            aria-label={`${PREVIEW_PAGE_CONTROL_LABELS[control]} ${page.title}`}
            title={control === "open" || canUpdate ? undefined : NO_PAGE_ACCESS}
            onClick={() => run(control)}
          >
            {PREVIEW_PAGE_CONTROL_LABELS[control]}
          </Button>
        ))}
      </div>
    </li>
  );
}

/** Pages this computer published to its Library, listed through the computer. */
export function EnvironmentPreviewPages({ environmentId }: { environmentId: EnvironmentId }) {
  const atom = previewLinks.pages({ environmentId, input: {} });
  const result = useAtomValue(atom);
  const refresh = useAtomRefresh(atom);
  const canUpdate = useAtomValue(previewLinks.updatePage.permissionAtom(environmentId));
  // The shared clock is a UTC minute written without its zone.
  const now = Date.parse(`${useNowMinute()}Z`);
  const list = Option.getOrNull(AsyncResult.value(result));
  // A failed refetch keeps the last list, so the failure shows above it instead of hiding it.
  const failure = failureOf(result);
  const pages = list?.available ? visiblePreviewPages(list.pages, now) : [];

  return (
    <SettingsRow
      title="Pages"
      description="Pages that agents on this computer published to your Library, such as a rendered page or a Dossier. Each opens only in a browser signed in to your Library."
    >
      <div className="flex flex-col gap-2 pb-2">
        {failure && (
          <div className="flex flex-col items-start gap-1.5">
            <Alert>{failure}</Alert>
            <Button size="xs" variant="outline" disabled={result.waiting} onClick={refresh}>
              Try again
            </Button>
          </div>
        )}
        {list === null ? (
          !failure && <Muted>Loading pages...</Muted>
        ) : !list.available ? (
          <Muted>{PREVIEW_PAGES_UNAVAILABLE_TEXT}</Muted>
        ) : pages.length === 0 ? (
          <Muted>{PREVIEW_PAGES_EMPTY_TEXT}</Muted>
        ) : (
          <ul className="flex flex-col gap-2">
            {pages.map((page) => (
              <PageRow
                key={page.id}
                environmentId={environmentId}
                page={page}
                now={now}
                canUpdate={canUpdate}
              />
            ))}
          </ul>
        )}
      </div>
    </SettingsRow>
  );
}
