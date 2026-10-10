# Marketplace Launch Checklist

This document separates code readiness from account configuration and commercial launch. Pricing and payout values here are proposals only; this file does not change RapidAPI account settings.

## Release gates

### 1. Secure the RapidAPI-to-Worker path

- [ ] In RapidAPI Provider Dashboard, open **Definition → API Specs → Settings → Secret Headers & Parameters**.
- [ ] Add hidden header `X-RapidAPI-Proxy-Secret` with a high-entropy random value. Confirm its type is **Header**, not query parameter. RapidAPI must inject it into every proxied request.
- [ ] Set the exact same value as Cloudflare Worker Secret `RAPIDAPI_KEY` using `npx wrangler secret put RAPIDAPI_KEY` from a trusted terminal.
- [ ] Set that exact value as GitHub Actions repository secret `RAPIDAPI_PROXY_SECRET`.
- [ ] Never reuse `test-key-123`; it was in public source and must be considered compromised.
- [ ] Confirm the Worker has the AI binding `AI` and the secret binding `RAPIDAPI_KEY` without reading or printing the secret itself.

**Do not merge or deploy the security PR until the RapidAPI hidden header and Cloudflare Worker Secret are configured to match.** The hardened code intentionally fails closed if the Worker secret is absent.

### 2. Test and release

- [ ] Confirm the `Worker unit tests` GitHub Actions workflow passes. Those tests mock Workers AI and do not invoke the live model.
- [ ] Merge the reviewed security PR only after the secret configuration is complete.
- [ ] Deploy the exact merged commit to the `data-enrich-qa-agent` Worker.
- [ ] Run the manual `Public Worker API smoke test` workflow with `RAPIDAPI_PROXY_SECRET` configured. Expect an unauthorized request to fail closed and an authenticated request to return HTTP 200 with the required JSON schema.
- [ ] Test through RapidAPI's own API playground/subscriber route, not only by calling the Worker origin directly.
- [ ] Record the deployed Worker version/commit and the live response status. CI success alone is not production verification.

## Data-quality limits

This service calls a Workers AI model without live web research. Its answers can be wrong or incomplete. Keep all responses marked:

- `verification_status: "unverified_ai_generated"`
- `is_verified: false`

Describe it as an **AI-assisted company-data draft**, not a verified enrichment or authoritative source. Do not advertise independent fact-checking until a real source retrieval and verification pipeline exists.

## PayPal payout setup

RapidAPI's current provider guidance says payouts are sent through PayPal. In the provider account, select the avatar menu → **Personal Payouts** → **Link PayPal account**, complete the PayPal sign-in, and verify that the linked account is correct. Do not put PayPal passwords or credentials in source control or in this repository.

RapidAPI's provider payout documentation says the marketplace fee is **25% for payments processed through the API Hub from November 15, 2025**, with PayPal processing fees additional. Payouts follow the marketplace's collection and reconciliation schedule; receiving a sale does not mean funds arrive immediately. Read the current documentation before making a cash-flow commitment:
- [RapidAPI Payouts and Finance](https://docs.rapidapi.com/docs/payouts-and-finance)
- [RapidAPI Secret Headers & Parameters](https://docs.rapidapi.com/v2.0.0/docs/secret-headers-parameters)

Payout account status cannot be proven from CI or Cloudflare. Verify it in the authenticated RapidAPI provider account.

## Pricing proposal — not configured

Do not enable paid plans until real per-request costs and response quality have been measured. Start with a small free tier that has a **hard monthly quota**, and disable overages initially. Example test hypotheses only:

| Plan | Monthly quota | Candidate price | Notes |
|---|---:|---:|---|
| Basic | 50 requests | Free | Small hard limit for trial and integration testing |
| Pro | 1,000 requests | $9/month | Only after measured unit economics support it |
| Ultra | 5,000 requests | $29/month | Only after load, quality and cost checks |

At the currently documented 25% RapidAPI marketplace fee, a $9 plan leaves $6.75 before PayPal processing fees and any operating costs; a $29 plan leaves $21.75 before those additional costs. These are arithmetic estimates, not revenue forecasts. Do not activate these prices based on the table alone.

Before setting final prices:
1. Measure model usage and platform costs across a representative sample of requests.
2. Track HTTP errors, latency, JSON validity, and the fraction of fields returned as null.
3. Use strict hard quotas; avoid overage billing until cost and abuse controls are proven.
4. Ensure the listing accurately says that all model-generated fields are unverified.

## Current observed state (2026-10-11)

- The security PR is open and its latest unit-test CI job has passed.
- Cloudflare's secret-list endpoint returned no Worker secrets for `data-enrich-qa-agent` at the time of inspection.
- The currently deployed Worker source still contains the old hard-coded credential; the hardened PR has not been deployed.
- Therefore, release and paid launch remain blocked by the RapidAPI hidden-header and Cloudflare/GitHub secret configuration plus production smoke testing.
