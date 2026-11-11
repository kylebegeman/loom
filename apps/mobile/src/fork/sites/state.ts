import { createSitesAtoms, createSitesWriteGuard } from "@t3tools/client-runtime/fork";
import {
  type AtomCommandResult,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { AsyncResult } from "effect/reactivity";
import type { EnvironmentId } from "@t3tools/contracts";
import type {
  SaveSiteRequest,
  SaveSiteServiceRequest,
  SaveSiteCheckRequest,
  RunSiteChecksRequest,
  SitesSnapshot,
} from "@t3tools/contracts/fork";
import { connectionAtomRuntime } from "../../connection/runtime";
import { useAtomCommand } from "../../state/use-atom-command";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Crypto from "expo-crypto";

const writes = createSitesWriteGuard({
  load: (key) => AsyncStorage.getItem(key),
  save: (key, value) => AsyncStorage.setItem(key, value),
  remove: (key) => AsyncStorage.removeItem(key),
  newId: () => Crypto.randomUUID(),
  digest: (value) => Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, value),
});
export const sites = createSitesAtoms(connectionAtomRuntime, { onSnapshot: writes.observe });

export function useSitesWrites() {
  const site = useAtomCommand(sites.saveSite, { reportFailure: false });
  const service = useAtomCommand(sites.saveService, { reportFailure: false });
  const check = useAtomCommand(sites.saveCheck, { reportFailure: false });
  const run = useAtomCommand(sites.runChecks, { reportFailure: false });
  const send = async <
    T extends
      | SaveSiteRequest
      | SaveSiteServiceRequest
      | SaveSiteCheckRequest
      | RunSiteChecksRequest,
  >(
    kind: "site" | "service" | "check" | "runChecks",
    args: { readonly environmentId: EnvironmentId; readonly input: T },
    execute: (args: {
      readonly environmentId: EnvironmentId;
      readonly input: T;
    }) => Promise<AtomCommandResult<SitesSnapshot, unknown>>,
  ): Promise<AtomCommandResult<SitesSnapshot, unknown>> =>
    AsyncResult.success(
      await writes.execute(args.environmentId, kind, args.input, async (input) => {
        const result = await execute({ ...args, input });
        if (result._tag === "Failure") throw squashAtomCommandFailure(result);
        return result.value;
      }),
    );
  return {
    saveSite: (args: Parameters<typeof site>[0]) => send("site", args, site),
    saveService: (args: Parameters<typeof service>[0]) => send("service", args, service),
    saveCheck: (args: Parameters<typeof check>[0]) => send("check", args, check),
    runChecks: (args: Parameters<typeof run>[0]) => send("runChecks", args, run),
  };
}
