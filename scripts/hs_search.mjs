// Temp script: calls searchHubSpotProducts equivalent
// Usage: node scripts/hs_search.mjs [query] [limit]
// Example: node scripts/hs_search.mjs פסטו 10

const TOKEN = 'pat-eu1-394b8e55-a42c-4f51-964c-fbcd4308308f';
const BASE = 'https://api.hubapi.com';

const query = process.argv[2] ?? '';
const limit = parseInt(process.argv[3] ?? '20');

async function req(path, init) {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json', ...(init?.headers ?? {}) }
  });
  if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
  return res.json();
}

const propsData = await req('/crm/v3/properties/products');
const allProps = propsData.results.map(p => p.name);

let results;
if (!query.trim()) {
  const data = await req(`/crm/v3/objects/products?limit=${limit}&properties=${encodeURIComponent(allProps.join(','))}`);
  results = data.results ?? [];
} else {
  const data = await req('/crm/v3/objects/products/search', {
    method: 'POST',
    body: JSON.stringify({ query: query.trim(), limit, properties: allProps })
  });
  results = data.results ?? [];
}

console.log(`\nFound ${results.length} products for query="${query}"\n`);
for (const p of results) {
  console.log('─'.repeat(60));
  console.log(`HubSpot ID: ${p.id}`);
  for (const [k, v] of Object.entries(p.properties ?? {})) {
    if (v !== null && v !== undefined && v !== '') console.log(`  ${k}: ${v}`);
  }
}
