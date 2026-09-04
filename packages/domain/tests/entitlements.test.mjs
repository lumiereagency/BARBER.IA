import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { parsePlanFeatures, subscriptionGrantsAccess } from "../dist/entitlements.js";

describe("parsePlanFeatures", () => {
  test("lê as quatro flags do plano", () => {
    const features = parsePlanFeatures({
      smartAgenda: true,
      waitlist: true,
      advancedReports: false,
      baileys: true,
    });
    assert.deepEqual(features, {
      smartAgenda: true,
      waitlist: true,
      advancedReports: false,
      baileys: true,
    });
  });

  test("plano sem json válido não dá acesso a nada, não quebra", () => {
    for (const raw of [null, undefined, "essencial", 42, []]) {
      assert.deepEqual(parsePlanFeatures(raw), {
        smartAgenda: false,
        waitlist: false,
        advancedReports: false,
        baileys: false,
      });
    }
  });

  test("valor que não é exatamente true vira false — nunca 'truthy'", () => {
    const features = parsePlanFeatures({ smartAgenda: "true", waitlist: 1 });
    assert.equal(features.smartAgenda, false);
    assert.equal(features.waitlist, false);
  });
});

describe("subscriptionGrantsAccess", () => {
  const agora = new Date("2026-09-04T12:00:00Z");

  test("ACTIVE sempre dá acesso", () => {
    assert.ok(subscriptionGrantsAccess("ACTIVE", null, agora));
    assert.ok(subscriptionGrantsAccess("ACTIVE", new Date("2020-01-01"), agora));
  });

  test("TRIALING sem prazo definido dá acesso", () => {
    assert.ok(subscriptionGrantsAccess("TRIALING", null, agora));
  });

  test("TRIALING dentro do prazo dá acesso, fora do prazo não", () => {
    assert.ok(subscriptionGrantsAccess("TRIALING", new Date("2026-09-05T00:00:00Z"), agora));
    assert.equal(subscriptionGrantsAccess("TRIALING", new Date("2026-09-01T00:00:00Z"), agora), false);
  });

  test("PAST_DUE e CANCELED nunca dão acesso", () => {
    assert.equal(subscriptionGrantsAccess("PAST_DUE", null, agora), false);
    assert.equal(subscriptionGrantsAccess("CANCELED", null, agora), false);
  });
});
