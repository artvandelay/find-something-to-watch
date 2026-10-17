import assert from "node:assert/strict";
import { createBrowserMemory } from "../docs/js/memory.js";
import { DEFAULT_PROVIDER_ORDER, subscriptionOffer } from "../docs/js/providers.js";
import { DEFAULT_LLM, KEYS } from "../docs/js/store.js";
import { bootApp, createStorage } from "./harness/app.mjs";

const INDIA_ONLY = [
  "hotstar", "zee5", "sonyliv", "sunnxt", "aha", "hoichoi", "mxplayer", "shemaroo",
  "lionsgate", "manoramamax", "hungama", "epicon", "tataplay", "docubay", "bbcplayer",
  "chaupal", "erosnow"
];
const INDIA_PRIMARY = ["netflix", "prime", "hotstar", "zee5", "sonyliv", "appletv"];

function slugs(offer) {
  return new Set([...offer.visible, ...offer.more]);
}

{
  const india = subscriptionOffer({
    region: "IN",
    catalogOrder: DEFAULT_PROVIDER_ORDER,
    selected: ["netflix"]
  });
  assert.deepEqual(india.visible, INDIA_PRIMARY);
  assert.equal(india.visible.length <= 8, true);
  assert.equal(india.visible.length < DEFAULT_PROVIDER_ORDER.length, true);
  assert.equal(india.more.includes("netflix"), false);
  assert.equal(india.more.includes("hoichoi"), true);
  assert.equal(india.more.includes("erosnow"), true);
  assert.equal(india.visible.length + india.more.length, DEFAULT_PROVIDER_ORDER.length);
  assert.equal(india.moreLabel, "More in India");

  const us = subscriptionOffer({
    region: "US",
    catalogOrder: DEFAULT_PROVIDER_ORDER,
    selected: ["netflix"]
  });
  assert.deepEqual(us.visible, ["netflix", "prime", "appletv", "mubi", "crunchyroll", "discovery"]);
  assert.deepEqual(us.more, ["curiosity", "plex", "tubi"]);
  assert.equal(us.moreLabel, "More in this country");
  for (const slug of INDIA_ONLY) {
    assert.equal(slugs(us).has(slug), false, "US offer includes India-only " + slug);
  }

  const kept = subscriptionOffer({
    region: "US",
    catalogOrder: DEFAULT_PROVIDER_ORDER,
    selected: ["netflix", "hotstar"]
  });
  assert.equal(kept.visible.includes("hotstar"), true);
  assert.equal(kept.more.includes("hotstar"), false);

  const gb = subscriptionOffer({ region: "GB", catalogOrder: DEFAULT_PROVIDER_ORDER });
  const ca = subscriptionOffer({ region: "CA", catalogOrder: DEFAULT_PROVIDER_ORDER });
  const au = subscriptionOffer({ region: "AU", catalogOrder: DEFAULT_PROVIDER_ORDER });
  const sg = subscriptionOffer({ region: "SG", catalogOrder: DEFAULT_PROVIDER_ORDER });
  const ae = subscriptionOffer({ region: "AE", catalogOrder: DEFAULT_PROVIDER_ORDER });
  for (const offer of [gb, ca, au, sg, ae]) {
    for (const slug of INDIA_ONLY) {
      assert.equal(slugs(offer).has(slug), false, offer.region + " includes India-only " + slug);
    }
    assert.equal(offer.visible.length <= 8, true, offer.region);
  }
  assert.deepEqual(gb.more, ["curiosity"]);
  assert.deepEqual(ca.more, ["curiosity", "tubi"]);
  assert.deepEqual(au.more, ["curiosity"]);
  assert.deepEqual(sg.visible, ["netflix", "prime", "appletv", "mubi", "crunchyroll"]);
  assert.deepEqual(sg.more, []);
  assert.deepEqual(ae.visible, sg.visible);
  assert.deepEqual(ae.more, []);
}

function values(app, selector) {
  return app.$$(selector).map((input) => input.value);
}

const storage = createStorage();
storage.local.set(KEYS.llm, JSON.stringify({ ...DEFAULT_LLM, apiKey: "sk-test" }));
const memory = createBrowserMemory({ indexedDB: storage.indexedDB });
await memory.initialize();
await memory.setProfile({ providers: ["netflix"], region: "IN", onboardingComplete: true });

const app = await bootApp({
  storage,
  providerOrder: [...DEFAULT_PROVIDER_ORDER]
});

try {
  assert.equal(app.text("#subscriptions-summary"), "Netflix");
  await app.click("#settings-btn");

  const visible = values(app, "#settings-provider-list > .provider-picks input");
  const moreDetails = app.$("#settings-provider-list .provider-more");
  const more = values(app, "#settings-provider-list .provider-more input");
  assert.deepEqual(visible, INDIA_PRIMARY, "India settings show the short list");
  assert.equal(visible.length < DEFAULT_PROVIDER_ORDER.length, true);
  assert.equal(moreDetails.open, false, "More stays closed");
  assert.equal(moreDetails.querySelector("summary").textContent, "More in India");
  assert.equal(more.includes("hoichoi"), true);
  assert.equal(more.includes("netflix"), false);
  assert.equal(app.$("#settings-provider-list input[value=netflix]").checked, true);
  assert.equal(app.$("#settings-provider-list input[value=prime]").checked, false);

  app.$("#settings-provider-list input[value=hotstar]").click();
  const region = app.$("#region-select");
  region.value = "US";
  region.dispatchEvent(new app.window.Event("change", { bubbles: true }));
  await app.settle();

  const usValues = values(app, "#settings-provider-list input");
  assert.equal(usValues.includes("netflix"), true);
  assert.equal(usValues.includes("prime"), true);
  assert.equal(usValues.includes("hotstar"), true, "a saved India service stays visible");
  assert.equal(app.$("#settings-provider-list input[value=netflix]").checked, true);
  assert.equal(app.$("#settings-provider-list input[value=hotstar]").checked, true);
  for (const slug of ["zee5", "sonyliv", "sunnxt", "aha", "hoichoi", "erosnow"]) {
    assert.equal(usValues.includes(slug), false, "US settings hide " + slug);
  }
  assert.equal(app.$("#settings-provider-list .provider-more summary").textContent, "More in this country");
  assert.equal(app.text("#subscriptions-summary"), "Netflix");
} finally {
  app.restore();
}

console.log("check_subscriptions: ok");
