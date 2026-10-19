import { useEffect, useState } from "react";
import { useAtomValue } from "@effect/atom-react";
import { useNavigate } from "@tanstack/react-router";
import { supportsLoomFeature } from "@t3tools/client-runtime/fork";
import type { EnvironmentId } from "@t3tools/contracts";
import {
  PREVIEW_LINK_LIFETIMES,
  type PreviewLink,
  type PreviewLinkLifetime,
} from "@t3tools/contracts/fork";
import * as Option from "effect/Option";
import { AsyncResult } from "effect/reactivity";
import { Link2Icon } from "lucide-react";
import { Button } from "~/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "~/components/ui/empty";
import {
  Menu,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuPopup,
  MenuTrigger,
} from "~/components/ui/menu";
import {
  Sheet,
  SheetDescription,
  SheetHeader,
  SheetPopup,
  SheetTitle,
} from "~/components/ui/sheet";
import { useNowMinute } from "~/hooks/useNowMinute";
import { useServerConfigs } from "~/state/entities";
import { usePreparedConnection } from "~/state/session";
import { LIFETIME_LABELS, canRestore, linkSummary, setupStatus, visibleLinks } from "./links";
import { Alert, Muted, copyPreviewLink, failureOf, useAction } from "./parts";
import {
  FEATURE,
  SETTINGS_HASH,
  onOpenPreviewLinksSettings,
  onOpenPreviewLinksSheet,
  previewLinks,
  runCommand,
} from "./state";
import { openInSystemBrowser } from "./systemBrowser";

const NO_ACCESS = "This connection cannot manage preview links.";

function LinkRow({
  environmentId,
  link,
  now,
  canOperate,
}: {
  environmentId: EnvironmentId;
  link: PreviewLink;
  now: number;
  canOperate: boolean;
}) {
  const action = useAction();
  const disabled = !canOperate || action.busy;
  const title = canOperate ? undefined : NO_ACCESS;

  const open = () =>
    void action.act("Unable to open preview link", () =>
      openInSystemBrowser(
        async () =>
          (await runCommand(previewLinks.open, { environmentId, input: { link: link.id } })).url,
      ),
    );
  const copy = () =>
    void action.act("Unable to copy preview link", () => copyPreviewLink(link.url));
  const extend = (lifetime: PreviewLinkLifetime) =>
    void action.act("Unable to extend preview link", () =>
      runCommand(previewLinks.extend, { environmentId, input: { linkId: link.id, lifetime } }),
    );
  const end = () =>
    void action.act("Unable to end preview link", () =>
      runCommand(previewLinks.revoke, { environmentId, input: { linkId: link.id } }),
    );
  const restore = () =>
    void action.act("Unable to restore preview link", () =>
      runCommand(previewLinks.restore, { environmentId, input: { linkId: link.id } }),
    );

  return (
    <li className="flex flex-col gap-2 rounded-lg border border-border/70 px-3 py-2.5">
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="break-all font-mono text-xs">{link.host}</span>
        <span className="text-muted-foreground text-xs">{linkSummary(link, now)}</span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {link.state === "open" ? (
          <>
            <Button size="xs" variant="outline" disabled={disabled} title={title} onClick={open}>
              Open
            </Button>
            <Button size="xs" variant="outline" disabled={action.busy} onClick={copy}>
              Copy link
            </Button>
            <Menu>
              <MenuTrigger
                render={<Button size="xs" variant="outline" disabled={disabled} title={title} />}
              >
                Extend
              </MenuTrigger>
              <MenuPopup align="start">
                <MenuGroup>
                  <MenuGroupLabel>Keep open for</MenuGroupLabel>
                  {PREVIEW_LINK_LIFETIMES.map((lifetime) => (
                    <MenuItem key={lifetime} onClick={() => extend(lifetime)}>
                      {LIFETIME_LABELS[lifetime]}
                    </MenuItem>
                  ))}
                </MenuGroup>
              </MenuPopup>
            </Menu>
            <Button
              size="xs"
              variant="destructive-outline"
              disabled={disabled}
              title={title}
              onClick={end}
            >
              End
            </Button>
          </>
        ) : canRestore(link, now) ? (
          <Button size="xs" variant="outline" disabled={disabled} title={title} onClick={restore}>
            Restore
          </Button>
        ) : null}
      </div>
    </li>
  );
}

function EnvironmentLinks({
  environmentId,
  openSettings,
}: {
  environmentId: EnvironmentId;
  openSettings: () => void;
}) {
  const result = useAtomValue(previewLinks.snapshot({ environmentId, input: {} }));
  const canOperate = useAtomValue(previewLinks.revoke.permissionAtom(environmentId));
  const now = Date.parse(useNowMinute());
  const snapshot = Option.getOrNull(AsyncResult.value(result));
  const failure = failureOf(result);
  if (!snapshot) return failure ? <Alert>{failure}</Alert> : <Muted>Loading links...</Muted>;
  const status = setupStatus(snapshot.setup);
  const links = visibleLinks(snapshot.links, now);
  return (
    <div className="flex flex-col gap-2">
      {!status.ready && (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-border/70 px-3 py-2.5">
          <div className="flex min-w-0 flex-col gap-0.5 text-xs">
            <span className="font-medium">{status.label}</span>
            <span className="text-muted-foreground">
              {status.detail ?? "New links cannot open until preview links are set up."}
            </span>
          </div>
          <Button size="xs" variant="outline" onClick={openSettings}>
            Set up
          </Button>
        </div>
      )}
      {links.length === 0 ? (
        <Muted>
          No open links. Share a port from the preview panel, or ask an agent to share one.
        </Muted>
      ) : (
        <ul className="flex flex-col gap-2">
          {links.map((link) => (
            <LinkRow
              key={link.id}
              environmentId={environmentId}
              link={link}
              now={now}
              canOperate={canOperate}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function EnvironmentSection({
  environmentId,
  label,
  openSettings,
}: {
  environmentId: EnvironmentId;
  label: string;
  openSettings: () => void;
}) {
  const connected = Option.isSome(usePreparedConnection(environmentId));
  return (
    <section aria-label={label} className="flex flex-col gap-2">
      <h3 className="font-medium text-sm">{label}</h3>
      {connected ? (
        <EnvironmentLinks environmentId={environmentId} openSettings={openSettings} />
      ) : (
        <Muted>Not connected. Its links show here once it reconnects.</Muted>
      )}
    </section>
  );
}

function PreviewLinkSections({ openSettings }: { openSettings: () => void }) {
  const configs = useServerConfigs();
  const environments = [...configs].filter(([, config]) =>
    supportsLoomFeature(config.environment.capabilities, FEATURE),
  );
  if (environments.length === 0) {
    return (
      <Empty size="compact">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Link2Icon />
          </EmptyMedia>
          <EmptyTitle>No computers share links</EmptyTitle>
          <EmptyDescription>
            Preview links need a Loom server that has them. Update the server on the computer you
            want to share from.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }
  return environments.map(([environmentId, config]) => (
    <EnvironmentSection
      key={environmentId}
      environmentId={environmentId}
      label={config.environment.label}
      openSettings={openSettings}
    />
  ));
}

/** Mounted once; palette items, settings and toasts open it through the listener bus. */
export function PreviewLinksHost() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const openSettings = () => {
    setOpen(false);
    void navigate({ to: "/settings/loom", hash: SETTINGS_HASH });
  };
  useEffect(() => onOpenPreviewLinksSheet(() => setOpen(true)), []);
  useEffect(() => onOpenPreviewLinksSettings(openSettings), [openSettings]);
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetPopup side="right">
        <SheetHeader>
          <SheetTitle>Preview links</SheetTitle>
          <SheetDescription>
            Ports shared from your computers. A link opens only in a browser that entered from Loom.
          </SheetDescription>
        </SheetHeader>
        {/* The popup unmounts while closed, so link lists subscribe only while it is open. */}
        <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-6 pb-6">
          <PreviewLinkSections openSettings={openSettings} />
        </div>
      </SheetPopup>
    </Sheet>
  );
}
