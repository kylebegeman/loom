import { getClientSettings } from "~/hooks/useSettings";

/** The text a system notification may show on this device: `preview`, or `generic` with previews off. */
export function systemNotificationBody(preview: string, generic: string): string {
  return getClientSettings().notificationPreviewsEnabled ? preview : generic;
}
