import { describe, expect, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  EnvironmentHttpApi,
  EnvironmentId,
  ScheduledTaskWebhookDeliveryId,
} from "@t3tools/contracts";
import { botTriggerHookId } from "@t3tools/contracts/fork";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Etag from "effect/http/Etag";
import * as HttpPlatform from "effect/http/HttpPlatform";
import * as HttpRouter from "effect/http/HttpRouter";
import * as HttpApi from "effect/http-api/HttpApi";
import * as HttpApiBuilder from "effect/http-api/HttpApiBuilder";

import * as ServerSecretStore from "../../../auth/ServerSecretStore.ts";
import * as ServerEnvironment from "../../../environment/ServerEnvironment.ts";
import * as RelayDeliveryProof from "../../../scheduledTasks/RelayDeliveryProof.ts";
import {
  ScheduledTaskService,
  type WebhookTriggerRequest,
} from "../../../scheduledTasks/ScheduledTaskService.ts";
import * as WebhookRoute from "../../../scheduledTasks/webhookRoute.ts";
import { BotTriggers } from "./BotTriggers.ts";

class WebhookTestApi extends HttpApi.make("environment").add(EnvironmentHttpApi.groups.webhooks) {}

const accepted = (id: string) =>
  Effect.succeed({
    _tag: "accepted" as const,
    deliveryId: ScheduledTaskWebhookDeliveryId.make(id),
    outcome: "accepted" as const,
  });

describe("webhook route with bot triggers", () => {
  it("sends bot trigger hooks to the triggers and every other hook to scheduled tasks", async () => {
    const toTriggers: Array<WebhookTriggerRequest> = [];
    const toTasks: Array<WebhookTriggerRequest> = [];
    const { handler, dispose } = HttpRouter.toWebHandler(
      HttpApiBuilder.layer(WebhookTestApi).pipe(
        Layer.provide(WebhookRoute.layer),
        Layer.provide(RelayDeliveryProof.layer),
        Layer.provide(
          Layer.mock(ScheduledTaskService)({
            triggerWebhook: (request) => {
              toTasks.push(request);
              return accepted("task");
            },
          }),
        ),
        Layer.provide(
          Layer.mock(BotTriggers)({
            scheduled: () => [],
            store: {} as BotTriggers["Service"]["store"],
            webhook: (request) => {
              toTriggers.push(request);
              return accepted("bot");
            },
          }),
        ),
        Layer.provide(
          Layer.mock(ServerSecretStore.ServerSecretStore)({
            get: () => Effect.succeedNone,
          }),
        ),
        Layer.provide(
          Layer.mock(ServerEnvironment.ServerEnvironment)({
            getEnvironmentId: Effect.succeed(EnvironmentId.make("env-1")),
          }),
        ),
        Layer.provide(
          HttpPlatform.layer.pipe(
            Layer.provideMerge(NodeServices.layer),
            Layer.provideMerge(Etag.layerWeak),
          ),
        ),
        Layer.provide(NodeServices.layer),
      ),
      { disableLogger: true },
    );
    const post = (hookId: string) =>
      handler(
        new Request(`http://env.local/api/hooks/${encodeURIComponent(hookId)}/tok`, {
          method: "POST",
          body: '{"file":"a.ts"}',
        }),
      );
    try {
      const bot = await post(botTriggerHookId("trg_1"));
      expect(await bot.json()).toEqual({ deliveryId: "bot" });
      const task = await post("scheduled-task:hook");
      expect(await task.json()).toEqual({ deliveryId: "task" });
      expect(toTriggers.map((request) => [request.hookId, request.bodyText])).toEqual([
        ["bot-trigger-trg_1", '{"file":"a.ts"}'],
      ]);
      expect(toTasks.map((request) => request.hookId)).toEqual(["scheduled-task:hook"]);
    } finally {
      await dispose();
    }
  });
});
