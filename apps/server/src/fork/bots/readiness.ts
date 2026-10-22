import type { ServerProvider } from "@t3tools/contracts";
import { BOT_LIBRARY_STATUS_FRESH_MS, type LibraryToolCheck } from "@t3tools/contracts/fork";

export interface ReadinessProblem {
  readonly availability: "blocked" | "unknown";
  readonly message: string;
}

/** Cached or failed probes must never turn an enabled account into a ready target. */
export const providerProblems = (
  provider: ServerProvider | undefined,
  now: number,
): ReadonlyArray<ReadinessProblem> => {
  if (provider === undefined)
    return [
      { availability: "unknown", message: "Its provider readiness is not known on this computer." },
    ];
  if (
    !provider.enabled ||
    provider.availability === "unavailable" ||
    provider.status === "disabled"
  )
    return [
      { availability: "blocked", message: "Its provider is not available on this computer." },
    ];
  if (!provider.installed)
    return [
      { availability: "blocked", message: "Its provider is not installed on this computer." },
    ];
  const age = now - Date.parse(provider.checkedAt);
  if (
    !Number.isFinite(age) ||
    age < -BOT_LIBRARY_STATUS_FRESH_MS ||
    age > BOT_LIBRARY_STATUS_FRESH_MS
  )
    return [
      {
        availability: "unknown",
        message: "Its provider readiness could not be refreshed on this computer.",
      },
    ];
  if (provider.auth.status === "unauthenticated")
    return [
      { availability: "blocked", message: "Its provider is not signed in on this computer." },
    ];
  if (provider.status === "error")
    return [{ availability: "blocked", message: "Its provider is not ready on this computer." }];
  if (provider.auth.status === "unknown" && provider.setup?.canAuthenticate !== false)
    return [
      {
        availability: "unknown",
        message: "Its provider sign-in could not be verified on this computer.",
      },
    ];
  return [];
};

export const toolProblems = (
  checks: ReadonlyArray<LibraryToolCheck>,
): ReadonlyArray<ReadinessProblem> =>
  checks.flatMap((check): ReadonlyArray<ReadinessProblem> => {
    switch (check.status) {
      case "ok":
        return [];
      case "unknown":
        return [
          {
            availability: "unknown",
            message: `The required ${check.label} tool could not be checked.`,
          },
        ];
      case "missing":
        return [
          {
            availability: "blocked",
            message: `The required ${check.label} tool is missing on this computer.`,
          },
        ];
      case "outdated":
        return [
          {
            availability: "blocked",
            message: `The required ${check.label} tool needs version ${check.minimumVersion ?? "newer than this computer has"}.`,
          },
        ];
    }
  });

export const problemAvailability = (problems: ReadonlyArray<ReadinessProblem>) =>
  problems.some((problem) => problem.availability === "blocked")
    ? ("blocked" as const)
    : ("unknown" as const);
