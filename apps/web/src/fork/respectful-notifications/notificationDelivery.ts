const RECEIPTS_KEY = "loom:respectful-notifications:delivered:v1";
const RECEIPT_LIMIT = 255;

function readReceipts(): string[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(RECEIPTS_KEY) ?? "[]");
    return Array.isArray(parsed)
      ? parsed.filter((value): value is string => typeof value === "string").slice(-RECEIPT_LIMIT)
      : [];
  } catch {
    return [];
  }
}

function writeReceipts(receipts: readonly string[]) {
  try {
    localStorage.setItem(RECEIPTS_KEY, JSON.stringify(receipts));
  } catch {
    // Without storage, stable OS tags still coalesce copies across windows.
  }
}

/** Coordinate windows on one origin without persisting notification content. */
export function deliverDesktopNotification(identity: string, present: () => boolean) {
  if (typeof navigator === "undefined" || !navigator.locks) {
    present(); // Stable OS tags still coalesce copies on platforms without Web Locks.
    return;
  }
  void navigator.locks
    .request("loom:respectful-notifications:delivery", () => {
      const receipts = readReceipts();
      if (receipts.includes(identity)) return;
      writeReceipts(receipts);
      if (present()) writeReceipts([...receipts, identity]);
    })
    .catch(() => undefined);
}
