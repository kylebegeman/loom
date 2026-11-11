import {
  LibraryError,
  type LibraryOperation,
  type LibraryWorkingCopy,
} from "@t3tools/contracts/fork";

/** Changing reviewed inputs is safe only after an unused preparation is cancelled. */
export async function cancelEmptyLibraryPreparation(
  requestId: string,
  ports: {
    readonly outcome: (requestId: string) => Promise<LibraryOperation | null>;
    readonly preparation: (requestId: string) => Promise<LibraryWorkingCopy | null>;
    readonly cancel: (operationId: string) => Promise<LibraryOperation>;
  },
) {
  const operation = await ports.outcome(requestId);
  if (operation && ["queued", "running", "succeeded"].includes(operation.state))
    throw new LibraryError({
      reason: "blocked",
      detail: "This preparation was accepted. Check its result before changing the setup.",
    });
  const copy = await ports.preparation(requestId);
  if (copy)
    throw new LibraryError({
      reason: "blocked",
      detail:
        "This preparation already has files. Review the existing copy before changing the setup.",
    });
  if (operation && operation.state !== "cancelled") {
    const cancelled = await ports.cancel(operation.id);
    if (cancelled.state !== "cancelled")
      throw new LibraryError({
        reason: "blocked",
        detail: "The preparation could not be cancelled. Keep its saved setup and check again.",
      });
  }
}
