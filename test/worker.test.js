import test from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";

const SECRET = "unit-test-secret-only";

function makeEnv({ secret = SECRET, omitSecret = false, aiResponse } = {}) {
  return {
    ...(!omitSecret ? { RAPIDAPI_KEY: secret } : {}),
    AI: {
      async run(model, options) {
        assert.equal(model, "@cf/meta/llama-3.1-8b-instruct-fp8");
        assert.ok(Array.isArray(options.messages));
        return {
          response: aiResponse ?? JSON.stringify({
            company_name: "model-echo",
            ceo_name: "Example CEO",
            ceo_email: "public@example.com",
            linkedin_url: "https://www.linkedin.com/company/example/",
            industry: "Technology",
            confidence: "unexpected-value",
            verification_status: "verified",
            data_source: "model",
            is_verified: true
          })
        };
      }
    }
  };
}

async function send({
  method = "POST",
  body = JSON.stringify({ company_name: "Acme Inc." }),
  headers = { "content-type": "application/json" },
  env = makeEnv(),
  fetchImpl = async () => new Response(JSON.stringify({ search: [] }), { status: 200, headers: { "content-type": "application/json" } })
} = {}) {
  const request = new Request("https://worker.test/", { method, body: method === "GET" || method === "HEAD" ? undefined : body, headers });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = fetchImpl;
  try {
    return await worker.fetch(request, env);
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test("fails closed with 503 when the origin secret is not configured", async () => {
  const response = await send({ env: makeEnv({ omitSecret: true }) });
  assert.equal(response.status, 503);
  assert.match((await response.json()).error, /not configured/i);
});

test("rejects a missing proxy secret with 401 when configured", async () => {
  const response = await send();
  assert.equal(response.status, 401);
});

test("rejects a wrong proxy secret with 401", async () => {
  const response = await send({
    headers: { "content-type": "application/json", "x-rapidapi-proxy-secret": "wrong" }
  });
  assert.equal(response.status, 401);
});

test("rejects non-POST methods with 405", async () => {
  const response = await send({ method: "GET" });
  assert.equal(response.status, 405);
});

test("handles CORS preflight without calling the model", async () => {
  const response = await send({ method: "OPTIONS", body: undefined });
  assert.equal(response.status, 204);
  assert.equal(response.headers.get("access-control-allow-origin"), "*");
});

test("rejects non-JSON requests with 415 after authentication", async () => {
  const response = await send({
    headers: { "content-type": "text/plain", "x-rapidapi-proxy-secret": SECRET },
    body: "company=Acme"
  });
  assert.equal(response.status, 415);
});

test("rejects malformed JSON with 400 after authentication", async () => {
  const response = await send({
    headers: { "content-type": "application/json", "x-rapidapi-proxy-secret": SECRET },
    body: "{"
  });
  assert.equal(response.status, 400);
});

test("rejects blank company names with 400 after authentication", async () => {
  const response = await send({
    headers: { "content-type": "application/json", "x-rapidapi-proxy-secret": SECRET },
    body: JSON.stringify({ company_name: "   " })
  });
  assert.equal(response.status, 400);
});

test("returns the fixed unverified contract and validates model fields", async () => {
  const response = await send({
    headers: { "content-type": "application/json", "x-rapidapi-proxy-secret": SECRET },
    body: JSON.stringify({ company_name: "  Acme Inc.  " })
  });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.success, true);
  assert.equal(result.data.company_name, "Acme Inc.");
  assert.equal(result.data.ceo_name, "Example CEO");
  assert.equal(result.data.ceo_email, "public@example.com");
  assert.equal(result.data.linkedin_url, "https://www.linkedin.com/company/example/");
  assert.equal(result.data.confidence, "low");
  assert.equal(result.data.verification_status, "unverified_ai_generated");
  assert.equal(result.data.data_source, "cloudflare_workers_ai");
  assert.equal(result.data.is_verified, false);
});

test("returns 502 when the model output is not valid JSON", async () => {
  const response = await send({
    headers: { "content-type": "application/json", "x-rapidapi-proxy-secret": SECRET },
    env: makeEnv({ aiResponse: "not-json" })
  });
  assert.equal(response.status, 502);
});


function wikidataResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function entityClaim(entityId, referenceUrl) {
  return {
    rank: "normal",
    mainsnak: {
      snaktype: "value",
      datavalue: { type: "wikibase-entityid", value: { "entity-type": "item", id: entityId } }
    },
    references: [{
      snaks: {
        P854: [{ snaktype: "value", datavalue: { type: "string", value: referenceUrl } }]
      }
    }]
  };
}

function stringClaim(value, referenceUrl) {
  return {
    rank: "normal",
    mainsnak: { snaktype: "value", datavalue: { type: "string", value } },
    references: [{
      snaks: {
        P854: [{ snaktype: "value", datavalue: { type: "string", value: referenceUrl } }]
      }
    }]
  };
}

test("uses exact-label Wikidata results and attaches field-level source attribution", async () => {
  const calls = [];
  const fetchImpl = async (input) => {
    const url = new URL(String(input));
    calls.push(url);
    const action = url.searchParams.get("action");
    if (action === "wbsearchentities") {
      assert.equal(url.searchParams.get("search"), "Example Corp");
      assert.equal(url.searchParams.get("type"), "item");
      return wikidataResponse({ search: [{ id: "Q100", label: "Example Corp", description: "American software company" }] });
    }
    if (url.searchParams.get("ids") === "Q100") {
      return wikidataResponse({ entities: { Q100: {
        id: "Q100",
        labels: { en: { value: "Example Corp" } },
        descriptions: { en: { value: "American software company" } },
        claims: {
          P169: [entityClaim("Q200", "https://example.com/leadership")],
          P452: [entityClaim("Q300", "https://example.com/about")]
        }
      } } });
    }
    if (url.searchParams.get("ids") === "Q200|Q300") {
      return wikidataResponse({ entities: {
        Q200: {
          id: "Q200",
          labels: { en: { value: "Casey Example" } },
          claims: { P6634: [stringClaim("casey-example", "https://www.linkedin.com/in/casey-example/")] }
        },
        Q300: { id: "Q300", labels: { en: { value: "Software industry" } }, claims: {} }
      } });
    }
    throw new Error("Unexpected mocked Wikidata request: " + url);
  };

  const response = await send({
    headers: { "content-type": "application/json", "x-rapidapi-proxy-secret": SECRET },
    body: JSON.stringify({ company_name: "Example Corp" }),
    fetchImpl
  });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.success, true);
  assert.equal(result.data.ceo_name, "Casey Example");
  assert.equal(result.data.ceo_email, null);
  assert.equal(result.data.linkedin_url, "https://www.linkedin.com/in/casey-example/");
  assert.equal(result.data.industry, "Software industry");
  assert.equal(result.data.data_source, "wikidata");
  assert.equal(result.data.verification_status, "source_attributed_unverified");
  assert.equal(result.data.is_verified, false);
  assert.equal(result.data.source_lookup_status, "exact_match");
  assert.equal(result.data.matched_entity.id, "Q100");
  assert.equal(result.data.confidence_scope, "exact_entity_label_match_only");
  assert.ok(result.data.sources.some((source) => source.field === "ceo_name" && source.property_id === "P169" && source.reference_urls.includes("https://example.com/leadership")));
  assert.ok(result.data.sources.some((source) => source.field === "industry" && source.property_id === "P452" && source.reference_urls.includes("https://example.com/about")));
  assert.equal(calls.length, 3);
});

test("does not claim source attribution when Wikidata has no exact organization match", async () => {
  const response = await send({
    headers: { "content-type": "application/json", "x-rapidapi-proxy-secret": SECRET },
    body: JSON.stringify({ company_name: "Acme" }),
    fetchImpl: async () => wikidataResponse({ search: [{ id: "Q900", label: "Acme Holdings", description: "Holding company" }] })
  });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.data.company_name, "Acme");
  assert.equal(result.data.data_source, "cloudflare_workers_ai");
  assert.equal(result.data.verification_status, "unverified_ai_generated");
  assert.equal(result.data.is_verified, false);
  assert.equal(result.data.source_lookup_status, "no_exact_match");
  assert.deepEqual(result.data.sources, []);
  assert.equal(result.data.matched_entity, null);
});

test("falls back safely when the public source is unavailable", async () => {
  const response = await send({
    headers: { "content-type": "application/json", "x-rapidapi-proxy-secret": SECRET },
    body: JSON.stringify({ company_name: "Acme" }),
    fetchImpl: async () => wikidataResponse({ error: "rate limited" }, 429)
  });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.data.source_lookup_status, "unavailable");
  assert.equal(result.data.verification_status, "unverified_ai_generated");
  assert.equal(result.data.is_verified, false);
  assert.deepEqual(result.data.sources, []);
});
