const WIKIDATA_API = "https://www.wikidata.org/w/api.php";
const USER_AGENT = "DataEnrichQAAgent/0.2 (source attribution; https://github.com/hosamhosaam5-ops/data-enrich-qa-agent)";
const ORGANIZATION_DESCRIPTION = /company|corporation|business|enterprise|organization|organisation|manufacturer|multinational|firm|retailer|airline|bank|brand|conglomerate|publisher|telecommunications|software house|research lab/i;

function normalizeLabel(value) {
  return String(value || "").normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
}

function statementValue(statement) {
  const snak = statement?.mainsnak;
  if (snak?.snaktype !== "value") return null;
  return snak?.datavalue?.value ?? null;
}

function entityIdFromStatement(statement) {
  const value = statementValue(statement);
  return value && typeof value === "object" && /^Q\d+$/.test(String(value.id || "")) ? value.id : null;
}

function firstUsableStatement(statements) {
  if (!Array.isArray(statements)) return null;
  const candidates = statements
    .filter((statement) => entityIdFromStatement(statement) || typeof statementValue(statement) === "string")
    .filter((statement) => statement?.rank !== "deprecated");
  return candidates.find((statement) => statement?.rank === "preferred") || candidates[0] || null;
}

function referenceUrls(statement) {
  const urls = [];
  for (const reference of statement?.references || []) {
    for (const snak of reference?.snaks?.P854 || []) {
      const value = snak?.datavalue?.value;
      if (typeof value === "string" && /^https:\/\//i.test(value)) urls.push(value);
    }
  }
  return [...new Set(urls)].slice(0, 5);
}

function entityLabel(entity) {
  const label = entity?.labels?.en?.value;
  return typeof label === "string" && label.trim() ? label.trim() : null;
}

async function requestWikidata(params, fetchImpl) {
  const url = new URL(WIKIDATA_API);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  const response = await fetchImpl(url.toString(), {
    method: "GET",
    headers: {
      accept: "application/json",
      "user-agent": USER_AGENT
    },
    signal: AbortSignal.timeout(5000)
  });
  if (!response.ok) throw new Error(`Wikidata HTTP ${response.status}`);
  const contentType = response.headers?.get?.("content-type") || "";
  if (contentType && !contentType.toLowerCase().includes("json")) throw new Error("Wikidata returned a non-JSON response");
  const text = await response.text();
  if (text.length > 1_000_000) throw new Error("Wikidata response exceeded the size limit");
  const data = JSON.parse(text);
  if (data?.error) throw new Error("Wikidata reported an API error");
  return data;
}

function makeSource({ field, value, entityId, propertyId = null, statement = null, retrievedAt }) {
  return {
    field,
    value,
    source: "Wikidata",
    source_url: `https://www.wikidata.org/wiki/${entityId}`,
    entity_id: entityId,
    property_id: propertyId,
    reference_urls: referenceUrls(statement),
    retrieved_at: retrievedAt
  };
}

/**
 * Return a source-attributed profile only for one exact-label organization match.
 * This is an attribution layer, not an independent truth-verification service:
 * all returned facts remain marked unverified and the caller must preserve that
 * status. The function returns null when a unique organization match is absent.
 */
export async function fetchWikidataProfile(companyName, {
  fetchImpl = globalThis.fetch,
  now = () => new Date().toISOString()
} = {}) {
  if (typeof companyName !== "string" || !companyName.trim() || companyName.length > 200) {
    throw new TypeError("companyName must be a non-empty string of at most 200 characters");
  }
  if (typeof fetchImpl !== "function") throw new TypeError("fetch implementation is unavailable");

  const retrievedAt = now();
  const searched = await requestWikidata({
    action: "wbsearchentities",
    search: companyName.trim(),
    language: "en",
    format: "json",
    limit: "5",
    type: "item"
  }, fetchImpl);

  const exactOrganizations = (Array.isArray(searched?.search) ? searched.search : [])
    .filter((item) => normalizeLabel(item?.label) === normalizeLabel(companyName))
    .filter((item) => /^Q\d+$/.test(String(item?.id || "")))
    .filter((item) => ORGANIZATION_DESCRIPTION.test(String(item?.description || "")));

  if (exactOrganizations.length !== 1) return null;

  const match = exactOrganizations[0];
  const entityId = match.id;
  const entityData = await requestWikidata({
    action: "wbgetentities",
    ids: entityId,
    props: "labels|descriptions|claims",
    languages: "en",
    format: "json"
  }, fetchImpl);
  const companyEntity = entityData?.entities?.[entityId];
  if (!companyEntity || companyEntity?.missing !== undefined) return null;

  const ceoStatement = firstUsableStatement(companyEntity.claims?.P169);
  const industryStatement = firstUsableStatement(companyEntity.claims?.P452);
  const ceoId = entityIdFromStatement(ceoStatement);
  const industryId = entityIdFromStatement(industryStatement);
  const relatedIds = [...new Set([ceoId, industryId].filter(Boolean))];
  let relatedEntities = {};
  if (relatedIds.length) {
    const relatedData = await requestWikidata({
      action: "wbgetentities",
      ids: relatedIds.join("|"),
      props: "labels|descriptions|claims",
      languages: "en",
      format: "json"
    }, fetchImpl);
    relatedEntities = relatedData?.entities || {};
  }

  const ceoEntity = ceoId ? relatedEntities[ceoId] : null;
  const industryEntity = industryId ? relatedEntities[industryId] : null;
  const ceoName = entityLabel(ceoEntity);
  const industry = entityLabel(industryEntity);
  const linkedinStatement = firstUsableStatement(ceoEntity?.claims?.P6634);
  const linkedinId = statementValue(linkedinStatement);
  const linkedinUrl = typeof linkedinId === "string" && /^[A-Za-z0-9_-]{2,120}$/.test(linkedinId)
    ? `https://www.linkedin.com/in/${linkedinId}/`
    : null;

  const sources = [makeSource({
    field: "company_match",
    value: entityLabel(companyEntity) || match.label,
    entityId,
    retrievedAt
  })];
  if (ceoName && ceoId) sources.push(makeSource({
    field: "ceo_name",
    value: ceoName,
    entityId,
    propertyId: "P169",
    statement: ceoStatement,
    retrievedAt
  }));
  if (industry && industryId) sources.push(makeSource({
    field: "industry",
    value: industry,
    entityId,
    propertyId: "P452",
    statement: industryStatement,
    retrievedAt
  }));
  if (linkedinUrl && ceoId) sources.push(makeSource({
    field: "linkedin_url",
    value: linkedinUrl,
    entityId: ceoId,
    propertyId: "P6634",
    statement: linkedinStatement,
    retrievedAt
  }));

  return {
    company_name: companyName.trim(),
    ceo_name: ceoName,
    ceo_email: null,
    linkedin_url: linkedinUrl,
    industry,
    confidence: "high",
    confidence_scope: "exact_entity_label_match_only",
    verification_status: "source_attributed_unverified",
    data_source: "wikidata",
    is_verified: false,
    source_lookup_status: "exact_match",
    retrieved_at: retrievedAt,
    matched_entity: {
      id: entityId,
      label: entityLabel(companyEntity) || match.label,
      description: companyEntity?.descriptions?.en?.value || match.description || null,
      url: `https://www.wikidata.org/wiki/${entityId}`
    },
    sources
  };
}
