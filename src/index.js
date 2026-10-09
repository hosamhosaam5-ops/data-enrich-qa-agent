const RAPIDAPI_TEST_KEY = "test-key-123";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, x-rapidapi-key",
  "Content-Type": "application/json; charset=utf-8",
};

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders });
}

function parseModelJson(value) {
  if (typeof value !== "string") {
    if (value && typeof value === "object") return value;
    throw new Error("AI model returned no text");
  }
  const cleaned = value.trim().replace(/^\u0060\u0060\u0060(?:json)?\s*/i, "").replace(/\s*\u0060\u0060\u0060$/, "");
  return JSON.parse(cleaned);
}

export default {
  async fetch(request, env) {
    try {
      if (request.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: corsHeaders });
      }

      if (request.method !== "POST") {
        return jsonResponse({ success: false, error: "Method not allowed. Use POST." }, 405);
      }

      // Temporary test authentication only. Replace this with a Cloudflare secret
      // or a real RapidAPI subscription-key validation before public production use.
      const suppliedKey = request.headers.get("x-rapidapi-key");
      if (suppliedKey !== RAPIDAPI_TEST_KEY) {
        return jsonResponse({ success: false, error: "Unauthorized: valid x-rapidapi-key required." }, 401);
      }

      const contentType = request.headers.get("content-type") || "";
      if (!contentType.toLowerCase().includes("application/json")) {
        return jsonResponse({ success: false, error: "Content-Type must be application/json." }, 415);
      }

      let body;
      try {
        body = await request.json();
      } catch {
        return jsonResponse({ success: false, error: "Invalid JSON body." }, 400);
      }

      if (!body || typeof body !== "object" || Array.isArray(body)) {
        return jsonResponse({ success: false, error: "Request body must be a JSON object." }, 400);
      }
      if (typeof body.company_name !== "string" || !body.company_name.trim()) {
        return jsonResponse({ success: false, error: "company_name must be a non-empty string." }, 400);
      }

      const companyName = body.company_name.trim();
      if (companyName.length > 200) {
        return jsonResponse({ success: false, error: "company_name must be 200 characters or fewer." }, 400);
      }
      if (!env.AI || typeof env.AI.run !== "function") {
        return jsonResponse({ success: false, error: "Workers AI binding AI is not configured." }, 503);
      }

      const prompt = `You are a cautious company-data research assistant. The company name is: ${JSON.stringify(companyName)}.
Return ONLY one valid JSON object. No Markdown, no code fences, no commentary.
Required exact schema:
{
  "company_name": string,
  "ceo_name": string or null,
  "ceo_email": string or null,
  "linkedin_url": string or null,
  "industry": string or null,
  "confidence": "low" or "medium" or "high",
  "verification_status": "unverified_ai_generated",
  "data_source": "cloudflare_workers_ai",
  "is_verified": false
}
Rules:
- Never claim that information is verified or sourced from live web search; you have no browsing tool.
- Do not invent a person's real private email or assert an email belongs to the CEO. If you cannot reliably know a public company email, return null.
- For unknown CEO, LinkedIn URL, or industry, return null rather than fabricate facts.
- ceo_email, when non-null, must be a syntactically valid email address and should only be a clearly public corporate contact if confidently known; otherwise null.
- linkedin_url, when non-null, must be a valid https://www.linkedin.com/ URL.
- Keep company_name exactly as supplied.
- Do not add keys beyond the schema.`;

      const aiResult = await env.AI.run("@cf/meta/llama-3-8b-instruct", {
        messages: [
          { role: "system", content: "Return strict JSON only. Do not fabricate facts. Use null for uncertain values." },
          { role: "user", content: prompt }
        ],
        max_tokens: 500,
      });

      const modelText = typeof aiResult?.response === "string" ? aiResult.response : aiResult;
      let data;
      try {
        data = parseModelJson(modelText);
      } catch {
        return jsonResponse({ success: false, error: "AI returned invalid JSON. Please retry.", details: "model_output_parse_failed" }, 502);
      }

      const validObject = data && typeof data === "object" && !Array.isArray(data);
      if (!validObject) {
        return jsonResponse({ success: false, error: "AI returned an invalid data structure." }, 502);
      }

      // Normalize output to the exact public schema.
      const email = typeof data.ceo_email === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.ceo_email)
        ? data.ceo_email : null;
      const linkedin = typeof data.linkedin_url === "string" && /^https:\/\/www\.linkedin\.com\//i.test(data.linkedin_url)
        ? data.linkedin_url : null;
      const allowedConfidence = ["low", "medium", "high"].includes(data.confidence) ? data.confidence : "low";
      const nullableString = (v) => typeof v === "string" && v.trim() ? v.trim() : null;

      const normalized = {
        company_name: companyName,
        ceo_name: nullableString(data.ceo_name),
        ceo_email: email,
        linkedin_url: linkedin,
        industry: nullableString(data.industry),
        confidence: allowedConfidence,
        verification_status: "unverified_ai_generated",
        data_source: "cloudflare_workers_ai",
        is_verified: false,
      };
      return jsonResponse({ success: true, data: normalized });
    } catch {
      return jsonResponse({ success: false, error: "Internal server error." }, 500);
    }
  },
};
