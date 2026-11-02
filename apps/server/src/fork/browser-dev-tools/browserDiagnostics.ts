import type {
  PreviewAutomationConsoleEntry,
  PreviewAutomationNetworkEntry,
} from "@t3tools/contracts";
import type { DevBrowserDiagnostics } from "@t3tools/contracts/fork";
const safeUrl = (text: string) => {
  try {
    const url = new URL(text);
    return `${url.origin}${url.pathname}`;
  } catch {
    return text.slice(0, 2048);
  }
};
export function readBrowserDiagnostics(tab: {
  page: { url(): string };
  consoleEntries: readonly PreviewAutomationConsoleEntry[];
  networkEntries: readonly PreviewAutomationNetworkEntry[];
}): DevBrowserDiagnostics {
  return {
    url: safeUrl(tab.page.url()),
    consoleEntries: tab.consoleEntries.slice(-100).map((entry) => ({
      ...entry,
      text: entry.text.slice(0, 2000),
      ...(entry.source ? { source: safeUrl(entry.source) } : {}),
    })),
    networkEntries: tab.networkEntries.slice(-100).map((entry) => ({
      ...entry,
      url: safeUrl(entry.url),
      ...(entry.errorText ? { errorText: entry.errorText.slice(0, 1000) } : {}),
    })),
  };
}
