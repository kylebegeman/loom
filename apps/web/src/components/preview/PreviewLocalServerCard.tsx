import type { ScopedThreadRef } from "@t3tools/contracts";
import { DiscoveryListRow } from "../ui/discovery-list";
import { PreviewLinkCardActions } from "~/fork/preview-links/PortCardActions"; // fork: preview-links

import { PreviewFaviconIcon } from "./PreviewFaviconIcon";
import type { PreviewableServer } from "./useDiscoveredLocalServers";

interface Props {
  threadRef: ScopedThreadRef;
  server: PreviewableServer;
  onOpen: () => void;
}

export function PreviewLocalServerCard({ threadRef, server, onOpen }: Props) {
  const subtitle = describeServer(server);
  // fork: preview-links
  const row = (
    <DiscoveryListRow
      onClick={onOpen}
      icon={<PreviewFaviconIcon threadRef={threadRef} url={server.requestedUrl} />}
      title={subtitle}
      description={`${server.host}:${server.port}`}
    />
  );
  return <PreviewLinkCardActions threadRef={threadRef} port={server.port} row={row} />; // fork: preview-links
}

function describeServer(server: PreviewableServer): string {
  if (server.processName) return server.processName;
  return "Listening";
}
