# L28 references

Treat external repositories as references, not code to copy.

## Old Loom

F7 in [selections.md](../../selections.md), first listed as not selected; confirmed for this
packet on 2026-09-24. Old Loom (`bagelvault/loom` 0.13.10):

- https://github.com/bagelvault/loom/blob/a79ec506/apps/server/src/orchestration/Layers/ProviderLimitResumeWorker.ts
  (250 lines). Adapt: the claim-then-act structure (a row moves to an in-progress state in
  the same transaction that reads it) so a restart cannot resume twice. Drop: the 5 second
  polling loop with 60 second leases renewed every 20 seconds; one server process owns the
  table, so a sleeping fiber woken on change is enough.
- https://github.com/bagelvault/loom/blob/a79ec506/apps/server/src/orchestration/Layers/ProviderLimitResume.ts
  (433 lines). Keep: idempotent upsert that ignores a delayed older event, and the backoff
  idea (old: 5 s doubling to 15 minutes). Drop: `lifecycle_generation` hashing and lease
  columns.
- https://github.com/bagelvault/loom/blob/a79ec506/apps/server/src/orchestration/providerLimitClassification.ts
  (83 lines). Adapt: reading reset hints from nested detail keys (`resetsAt`,
  `retry_after`, epoch seconds below 1e10). Drop: the broad regex
  (`/(?:usage|rate|account|token|request)\s*(?:limit|quota)|...|\b429\b|limit reached/i`),
  which matches unrelated errors and misses "rate-limited".
- https://github.com/bagelvault/loom/blob/a79ec506/apps/server/src/persistence/Migrations/224_OrchestrationEstate.ts
  (lines 173-199, table `orchestration_provider_limit_resumes`). Adapt: one row per thread,
  index on `(state, resume_at)`. Drop: the table's place in upstream's migration sequence.
- https://github.com/bagelvault/loom/blob/a79ec506/apps/server/src/provider/Layers/ProviderRuntimeRecovery.ts
  (lines 318-358: resumed through `providerService.resumeThread` with the stored cursor,
  and failed when no active turn was restored) and
  https://github.com/bagelvault/loom/blob/a79ec506/apps/server/src/orchestration/Layers/ProviderRuntimeIngestion.ts
  (lines 2845-2880 detection hook, 3453-3478 holding back the failed state). Drop: both need
  seams in upstream's ingestion; this packet starts a new turn instead.
- Old Loom had no user-facing toggle, countdown or cancel for pending resumes, and no account
  switching in the resume path. Both are new here.

## Upstream T3 Code

- `docs/user/providers-codex.md:68-73`, `docs/user/providers-claude.md:56-62`,
  `docs/user/usage.md` ("Track subscription limits"): current user-facing behavior.
- `apps/server/src/provider/Layers/CodexAdapter.ts:2357-2397`: usage-limit stop mapping.
- `apps/server/src/provider/Layers/codexUsageLimits.ts:199-234`: message and next steps
  (exported `codexUsageLimitMessage`).
- `apps/server/src/provider/Layers/ClaudeAdapter.ts:486-487,525-570,3306-3318,3911-3953,2336-2356`:
  Claude stop messages, window labels and wait formatting, parked-turn warning with detail.
- `apps/server/src/provider/acp/XAiAcpExtension.ts:591-597`: Grok stop.
- `packages/contracts/src/providerUsageLimits.ts:20-60`: usage windows and limits.
- `packages/contracts/src/server.ts:61-66,146-148,189-238,254-255`: `ServerProviderAuth`
  (`type`), `ServerProvider`, `continuation.groupKey`, `isProviderAvailable`.
- `apps/server/src/provider/Layers/CodexProvider.ts:97-103,532-545`: Codex `auth.type`
  (`chatgpt`, `apiKey`, `amazonBedrock`), used to tell subscription accounts from metered
  ones.
- `apps/server/src/provider/Layers/ClaudeProvider.ts:139-158`: Claude `auth.type` (`apiKey`
  or the subscription type).
- `apps/server/src/provider/Drivers/instanceIdentity.ts:27`: where `continuation.groupKey`
  is published.
- `apps/server/src/provider/Drivers/CodexHomeLayout.ts:45-66`,
  `apps/server/src/provider/Drivers/ClaudeHome.ts:40-45`: continuation keys.
- `apps/server/src/orchestration/Layers/ProviderCommandReactor.ts:337-351,663-686`:
  server-side `thread.turn.start` example and instance switch rules.
- `apps/server/src/provider/Layers/ProviderService.ts:1438-1457`: the same rule at session start.
- `apps/server/src/orchestration/Layers/ProviderRuntimeIngestion.ts:494-508,1697-1727,2038-2060`:
  where stops become `thread.session-set` and activities.
- `packages/contracts/src/orchestration.ts:509-520,554-563,596-624,1238-1258,1492-1498,1586-1619,1813-1888,1919-1929`:
  messages, session, activities, latest turn, `thread.turn.start`,
  `thread.activity.append`, event types, payloads, event base fields.
- `apps/server/src/orchestration/Services/OrchestrationEngine.ts:47-100`: `readEvents`,
  `dispatch`, `streamDomainEvents`, `subscribeDomainEvents`, `latestSequence`.
- `apps/server/src/orchestration/Services/ProjectionSnapshotQuery.ts:217-252,279`: thread reads.
- `apps/server/src/provider/Services/ProviderRegistry.ts:28,47-49,83`: providers, refresh,
  change stream.
- `apps/server/src/serverActivation.ts:12-26`: `forkParked`.
- `apps/server/src/ws.ts:734-735`: server command id pattern.
- `apps/web/src/session-logic.ts:451-512`: the work log renders unknown activity kinds.

## External

- Codex app-server protocol (generated schema in this repo):
  `packages/effect-codex-app-server/src/_generated/schema.gen.ts:2500-2511,3292-3303`
  (`RateLimitReachedType` values). Codex's own docs on plan limits:
  https://developers.openai.com/codex/pricing (not needed for implementation).
- Claude Agent SDK `rate_limit_event` (`SDKRateLimitInfo`: `status`, `rateLimitType`,
  `resetsAt` epoch seconds, overage fields) as consumed by upstream's adapter; the adapter
  code above is the authority for this packet.
- No reference repository from selections.md applies.
