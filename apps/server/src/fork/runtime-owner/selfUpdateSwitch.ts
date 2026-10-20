import * as Config from "effect/Config";

// An operating system that ships the runtime in its own signed releases, such
// as LoomOS, sets this to false so the service launcher never replaces it.
export const SERVER_SELF_UPDATE_ENV = "LOOM_SERVER_SELF_UPDATE";

export const serverSelfUpdateEnabled = Config.Boolean(SERVER_SELF_UPDATE_ENV).pipe(
  Config.withDefault(true),
);

export const OS_MANAGED_RUNTIME_REASON =
  "This computer's operating system manages its Loom runtime. Update it through the operating system.";
