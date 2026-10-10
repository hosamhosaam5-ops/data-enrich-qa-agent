# Data Enrich QA Agent

A Cloudflare Worker API that generates a cautious, AI-assisted company profile from a supplied company name. **This service does not perform live web research or independently verify facts.** Every response must remain explicitly marked as AI-generated and unverified.

## Endpoint

`POST https://data-enrich-qa-agent.hosamhosaam5.workers.dev/`

Request:

```json
{
  "company_name": "Microsoft"
}
```

Successful responses have this shape:

```json
{
  "success": true,
  "data": {
    "company_name": "Microsoft",
    "ceo_name": null,
    "ceo_email": null,
    "linkedin_url": null,
    "industry": null,
    "confidence": "low",
    "verification_status": "unverified_ai_generated",
    "data_source": "cloudflare_workers_ai",
    "is_verified": false
  }
}
```

Values may be `null` when the model cannot provide a cautious answer. The model's confidence label is not independent verification. Do not use this service as an authoritative source of corporate or personal data.

## Authentication and required configuration

The Worker must only be called through the RapidAPI proxy. The shared origin secret is **not** the public RapidAPI subscriber key.

1. In the RapidAPI provider dashboard for this API, configure a hidden secret header named `X-RapidAPI-Proxy-Secret` and generate a high-entropy value. RapidAPI must inject this header into proxied requests; do not expose it as a public parameter.
2. Configure a Cloudflare **Worker Secret** named `RAPIDAPI_KEY` with the exact same value. From a trusted local terminal, run `npx wrangler secret put RAPIDAPI_KEY` and paste the value only into the terminal prompt. Do not put it in source code, a wrangler.toml file, or a commit.
3. Configure a GitHub Actions repository secret named `RAPIDAPI_PROXY_SECRET` with that same value so the manually triggered production smoke test can make an authenticated request.
4. Deploy the reviewed Worker version only after step 1 and step 2 are complete. Then run the **Public Worker API smoke test** workflow; the authenticated case also needs step 3.

The application deliberately fails closed: it returns HTTP 503 when `RAPIDAPI_KEY` is absent, and HTTP 401 when the incoming proxy secret does not match. The old hard-coded test credential must never be used again.

## API contract

The OpenAPI 3.0 description is in [`openapi.yaml`](./openapi.yaml).

- `POST` with a JSON object and a non-empty `company_name` (maximum 200 characters) is required.
- `OPTIONS` supports CORS preflight.
- HTTP 400 indicates invalid JSON or input.
- HTTP 401 indicates a missing/incorrect origin secret when the server secret is configured.
- HTTP 405 indicates an unsupported method.
- HTTP 415 indicates a non-JSON request.
- HTTP 502 indicates invalid model output.
- HTTP 503 indicates missing origin authentication or Workers AI configuration.

## Local checks

The unit tests use Node's built-in test runner and a mocked AI binding, so they do not call Workers AI or incur AI usage:

```sh
npm test
```

The production smoke test is intentionally separate and manually triggered because it calls the live Worker and requires the production secrets to be configured.

## Pricing and payouts

Pricing, subscription tiers, and PayPal payout status are configured in RapidAPI's provider account, not by this Worker. Confirm platform fees, payout eligibility, and measured usage costs before enabling paid tiers. No pricing or payout setup is implied by a successful code test.
