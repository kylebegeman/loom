import { EnvironmentAuthorizationError, EnvironmentId } from "@t3tools/contracts";
import { LibraryError, VaultError, VaultGitHubError } from "@t3tools/contracts/fork";
import { describe, expect, it } from "vite-plus/test";
import {
  libraryAccessRepairFromFailure,
  libraryAccessRepairNotice,
} from "./library-access-repair.ts";

const library = EnvironmentId.make("library");
const computer = EnvironmentId.make("computer");
const original = { issuer: "https://id.example", subject: "original", email: "owner@example.test" };
const context = {
  authorityEnvironmentId: library,
  environmentId: computer,
  computerLabel: "Build Mac",
};
const repository = { id: "1".repeat(32), expectedVersion: 7, repository: "owner/repo" };

describe("contextual Library access repair", () => {
  it("pins human sign-in to the failing computer instead of the current Library", () => {
    const notice = libraryAccessRepairNotice(
      { kind: "sign-in", environmentId: computer },
      context,
    )!;
    expect(notice.destination).toEqual({ kind: "computer-sign-in", environmentId: computer });
    expect(notice.description).toContain("Build Mac");
    expect(notice.afterReturn).toMatch(/only refreshes.*never resumes/i);
    expect(
      libraryAccessRepairNotice({ kind: "sign-in", environmentId: library }, context)?.destination,
    ).toEqual({ kind: "library-sign-in", environmentId: library });
  });

  it("routes permission and connection failures to that computer without requesting another login", () => {
    for (const kind of ["permission", "connection"] as const) {
      const notice = libraryAccessRepairNotice({ kind, environmentId: computer }, context)!;
      expect(notice.destination).toEqual({ kind: "connection", environmentId: computer });
    }
  });

  it("repairs ownership with only the original authorized account", () => {
    const notice = libraryAccessRepairNotice(
      { kind: "ownership", environmentId: computer },
      {
        ...context,
        account: { ...original, subject: "different", email: "different@example.test" },
        originalAccount: original,
      },
    )!;
    expect(notice.expectedIdentity).toEqual(original);
    expect(notice.description).toContain("owner@example.test");
    expect(notice.description).toContain("original");
    expect(notice.description).not.toContain("different@example.test");
    expect(libraryAccessRepairNotice({ kind: "ownership" }, context)?.expectedIdentity).toBeNull();
    expect(
      libraryAccessRepairNotice({ kind: "ownership", repository }, context)?.destination.kind,
    ).toBe("computer-sign-in");
    expect(
      libraryAccessRepairNotice(
        { kind: "sign-in" },
        { ...context, account: { ...original, subject: "other" }, originalAccount: original },
      )?.expectedIdentity,
    ).toEqual(original);
  });

  it("keeps the selected Vault item, version and repository separate from host GitHub login", () => {
    const repair = libraryAccessRepairFromFailure(
      new VaultGitHubError({ reason: "unauthorized" }),
      computer,
      repository,
    )!;
    expect(repair).toMatchObject({ repository, vaultReason: "unauthorized" });
    const notice = libraryAccessRepairNotice(repair, context)!;
    expect(notice.destination).toEqual({
      kind: "vault-github",
      environmentId: computer,
      ...repository,
    });
    expect(notice.description).toContain("selected Vault");
    expect(notice.description).toContain("owner/repo");
    expect(notice.description).not.toContain("host login");
  });

  it("does not interpret a hidden selection as a missing credential", () => {
    const repair = libraryAccessRepairFromFailure(
      new VaultError({ reason: "not-found" }),
      computer,
      repository,
    )!;
    const notice = libraryAccessRepairNotice(repair, context)!;
    expect(notice.description).toMatch(/hidden|not visible/i);
    expect(notice.description).not.toMatch(/create|add a|no credential/i);
    expect(notice.destination).toMatchObject({ id: repository.id, expectedVersion: 7 });
  });

  it("keeps Vault backend failure, policy denial and GitHub authentication distinct", () => {
    const notices = ["locked", "denied", "unavailable"].map((reason) =>
      libraryAccessRepairNotice(
        libraryAccessRepairFromFailure(
          new VaultError({ reason: reason as "locked" | "denied" | "unavailable" }),
          computer,
          repository,
        ),
        context,
      )!,
    );
    expect(notices[0]?.description).toMatch(/unlock/i);
    expect(notices[1]?.description).toMatch(/inspect.*use.*permission/i);
    expect(notices[2]?.description).toMatch(/connection.*backend/i);
    const ownerDenial = libraryAccessRepairNotice(
      libraryAccessRepairFromFailure(
        new VaultError({ reason: "denied", detail: "caller-permission" }),
        computer,
        repository,
      ),
      context,
    )!;
    expect(ownerDenial.description).toContain("full access");
    expect(ownerDenial.description).not.toContain("grant it");
  });

  it("respects typed repair over legacy wording and maps only typed access failures", () => {
    const error = new LibraryError({
      reason: "blocked",
      accessRepair: { kind: "ownership", environmentId: library },
    });
    expect(libraryAccessRepairFromFailure(error, computer)).toEqual(error.accessRepair);
    expect(
      libraryAccessRepairFromFailure(
        new LibraryError({ reason: "blocked", accessRepair: { kind: "sign-in" } }),
        computer,
      ),
    ).toEqual({ kind: "sign-in", environmentId: computer });
    expect(
      libraryAccessRepairFromFailure(
        new EnvironmentAuthorizationError({
          message: "Denied",
          requiredScope: "orchestration:read",
        }),
        computer,
      ),
    ).toEqual({ kind: "permission", environmentId: computer });
    expect(libraryAccessRepairFromFailure(new Error("network down"), computer)).toBeUndefined();
    expect(libraryAccessRepairNotice(undefined, context, "Sign in again")?.destination).toEqual({
      kind: "computer-sign-in",
      environmentId: computer,
    });
    expect(
      libraryAccessRepairNotice({ kind: "connection" }, context, "Sign in again")?.destination.kind,
    ).toBe("connection");
  });
});
