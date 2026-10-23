import { expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";
import { SaveSiteRequest, SaveSiteServiceRequest } from "./sites.ts";

const isSite = Schema.is(SaveSiteRequest);
const isService = Schema.is(SaveSiteServiceRequest);

const site = {
  id: "portfolio",
  name: "Portfolio",
  url: "https://portfolio.example",
  active: true,
  origins: ["https://portfolio.example"],
  serviceIds: [],
  projectIds: ["project-1"],
};

it.each([
  { ...site, url: "https://portfolio.example/page" },
  { ...site, origins: ["https://portfolio.example/page"] },
  { ...site, origins: ["https://other.example"] },
  { ...site, origins: [site.url, site.url] },
])("rejects invalid or ambiguous analytics origins before saving %j", (input) => {
  expect(isSite(input)).toBe(false);
});

it("accepts exact HTTPS origins and requires services to use an origin", () => {
  expect(isSite(site)).toBe(true);
  expect(
    isService({
      id: "api",
      name: "API",
      url: "https://api.example/healthz",
      active: true,
      kind: "api",
    }),
  ).toBe(false);
});
