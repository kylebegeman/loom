import { expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";
import { ProjectId } from "../baseSchemas.ts";
import {
  ProjectCheckoutAdoptRequest,
  ProjectCheckoutRetentionRequest,
} from "./project-checkout.ts";

const reviewed = {
  projectId: ProjectId.make("reviewed-project"),
  reviewToken: "0123456789abcdef".repeat(4),
  retention: "keep",
};

it("requires the complete current review fingerprint for checkout mutations", () => {
  const acceptsAdoption = Schema.is(ProjectCheckoutAdoptRequest);
  const acceptsRetention = Schema.is(ProjectCheckoutRetentionRequest);
  expect(acceptsAdoption(reviewed)).toBe(true);
  expect(acceptsRetention(reviewed)).toBe(true);
  for (const reviewToken of [
    undefined,
    null,
    "",
    "a".repeat(63),
    "a".repeat(65),
    "g".repeat(64),
    reviewed.reviewToken.toUpperCase(),
    `${reviewed.reviewToken}\n`,
  ]) {
    expect(acceptsAdoption({ ...reviewed, reviewToken })).toBe(false);
    expect(acceptsRetention({ ...reviewed, reviewToken })).toBe(false);
  }
});

it("requires an explicit keep or release choice when adopting an external folder", () => {
  const accepts = Schema.is(ProjectCheckoutAdoptRequest);
  for (const retention of ["keep", "release-on-settle"])
    expect(accepts({ ...reviewed, retention })).toBe(true);
  for (const retention of [undefined, "inherit", "delete", "release", null])
    expect(accepts({ ...reviewed, retention })).toBe(false);
});

it("allows managed checkouts to return to the computer's default retention policy", () => {
  const accepts = Schema.is(ProjectCheckoutRetentionRequest);
  for (const retention of ["keep", "release-on-settle", "inherit"])
    expect(accepts({ ...reviewed, retention })).toBe(true);
  for (const retention of [undefined, "delete", "release", null])
    expect(accepts({ ...reviewed, retention })).toBe(false);
});
