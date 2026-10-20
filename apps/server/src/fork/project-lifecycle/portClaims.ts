// @effect-diagnostics nodeBuiltinImport:off - Claims need exclusive file creation Effect does not expose.
import * as NodeFSP from "node:fs/promises";

/**
 * Every Loom server on a computer (the installed app, dev servers, other homes) keeps its own
 * lanes but hands out ports from the same range, and a lane's release stops whatever listens
 * on its block. One file per claimed block, created exclusively, keeps two servers from giving
 * out the same ports. A claim lasts as long as its lane, across restarts, and is dropped once
 * the owning server's state folder is gone.
 */
export const portClaimsDir = (homeDir: string) => `${homeDir}/.loom/lane-ports`;

interface Claim {
  readonly owner: string;
  readonly laneId: string;
}

const present = (path: string) =>
  NodeFSP.access(path).then(
    () => true,
    () => false,
  );

/** `owner` is the server's state folder, which tells servers apart and outlives restarts. */
export const makePortClaims = (dir: string, owner: string) => {
  const pathOf = (base: number) => `${dir}/${base}`;
  const contents = (laneId: string) => `${JSON.stringify({ owner, laneId } satisfies Claim)}\n`;

  /** The claim on a block, `null` when there is none, `"unreadable"` for a file we cannot parse. */
  const read = async (base: number): Promise<Claim | null | "unreadable"> => {
    const text = await NodeFSP.readFile(pathOf(base), "utf8").catch(() => null);
    if (text === null) return null;
    try {
      const claim = JSON.parse(text) as Partial<Claim>;
      return typeof claim.owner === "string" && typeof claim.laneId === "string"
        ? { owner: claim.owner, laneId: claim.laneId }
        : "unreadable";
    } catch {
      return "unreadable";
    }
  };

  /** Removes another server's claim when that server's state folder no longer exists. */
  const dropIfStale = async (base: number, claim: Claim) => {
    if (claim.owner === owner || (await present(claim.owner))) return false;
    await NodeFSP.rm(pathOf(base), { force: true });
    return true;
  };

  const claimedBlocks = async () =>
    (await NodeFSP.readdir(dir).catch(() => [] as Array<string>))
      .map(Number)
      .filter((base) => Number.isSafeInteger(base) && base > 0);

  return {
    /** Blocks held by other servers. An unreadable claim counts as held. */
    heldByOthers: async () => {
      const held = new Set<number>();
      for (const base of await claimedBlocks()) {
        const claim = await read(base);
        if (claim === null) continue;
        if (claim === "unreadable") held.add(base);
        else if (claim.owner !== owner && !(await dropIfStale(base, claim))) held.add(base);
      }
      return held;
    },

    /** Takes a block for a lane. False when another server holds it. */
    claim: async (base: number, laneId: string): Promise<boolean> => {
      await NodeFSP.mkdir(dir, { recursive: true });
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          await NodeFSP.writeFile(pathOf(base), contents(laneId), { flag: "wx" });
          return true;
        } catch (cause) {
          if ((cause as NodeJS.ErrnoException).code !== "EEXIST") throw cause;
        }
        const current = await read(base);
        if (current === null) continue;
        if (current === "unreadable") return false;
        if (current.owner === owner) {
          // Left by one of this server's removed lanes.
          if (current.laneId !== laneId) await NodeFSP.writeFile(pathOf(base), contents(laneId));
          return true;
        }
        if (!(await dropIfStale(base, current))) return false;
      }
      return false;
    },

    /** Drops this server's claims on blocks none of its lanes use. */
    prune: async (kept: ReadonlyMap<number, string>) => {
      for (const base of await claimedBlocks()) {
        const claim = await read(base);
        if (claim === null || claim === "unreadable" || claim.owner !== owner) continue;
        if (kept.get(base) !== claim.laneId) await NodeFSP.rm(pathOf(base), { force: true });
      }
    },

    release: async (base: number, laneId: string) => {
      const claim = await read(base);
      if (
        claim !== null &&
        claim !== "unreadable" &&
        claim.owner === owner &&
        claim.laneId === laneId
      )
        await NodeFSP.rm(pathOf(base), { force: true });
    },
  };
};

export type PortClaims = ReturnType<typeof makePortClaims>;
