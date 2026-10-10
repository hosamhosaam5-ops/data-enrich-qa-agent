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
  env = makeEnv()
} = {}) {
  const request = new Request("https://worker.test/", { method, body: method === "GET" || method === "HEAD" ? undefined : body, headers });
  return worker.fetch(request, env);
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
