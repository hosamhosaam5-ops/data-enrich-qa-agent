# data-enrich-qa-agent

Standalone AI-powered data enrichment QA agent MVP built on Cloudflare Workers. This version uses clearly labeled mock data and does not contact external enrichment providers.

## API

**Endpoint:** `POST https://data-enrich-qa-agent.hosamhosaam5.workers.dev`

**Request**
```json
{
  "company_name": "Example Company"
}
```

**Successful response**
```json
{
  "success": true,
  "data": {
    "company_name": "Example Company",
    "ceo_name": "Alex Morgan (SAMPLE DATA)",
    "ceo_email": "alex.morgan@example.com",
    "linkedin_url": "https://www.linkedin.com/company/example/",
    "industry": "Technology (Sample)",
    "data_source": "mock",
    "is_mock_data": true
  }
}
```

## Validation and behavior

- `POST` with JSON is required.
- `OPTIONS` supports CORS preflight.
- Invalid JSON or missing/invalid `company_name` returns HTTP 400.
- Unsupported content types return HTTP 415.
- Other methods return HTTP 405.
- The response explicitly marks all returned company data as sample/mock data.

## Deploy

Install Wrangler and authenticate with Cloudflare, then run:

```sh
npx wrangler deploy
```

No API keys or paid services are required for this mock-data MVP.
