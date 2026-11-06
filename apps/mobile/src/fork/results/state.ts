import type { EnvironmentId } from "@t3tools/contracts";
import { Atom } from "effect/reactivity";

export const resultsComputerAtom = Atom.make<EnvironmentId | null>(null).pipe(
  Atom.keepAlive,
  Atom.withLabel("mobile:results:computer"),
);
