const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json; charset=utf-8",
};

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: corsHeaders,
  });
}

function sampleCompanyData(companyName) {
  return {
    company_name: companyName,
    ceo_name: "Alex Morgan (SAMPLE DATA)",
    ceo_email: "alex.morgan@example.com",
    linkedin_url: "https://www.linkedin.com/company/example/",
    industry: "Technology (Sample)",
    data_source: "mock",
    is_mock_data: true,
  };
}

export default {
  async fetch(request) {
    try {
      if (request.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: corsHeaders });
      }

      if (request.method !== "POST") {
        return jsonResponse({ success: false, error: "Method not allowed. Use POST." }, 405);
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

      return jsonResponse({ success: true, data: sampleCompanyData(companyName) });
    } catch {
      return jsonResponse({ success: false, error: "Internal server error." }, 500);
    }
  },
};
