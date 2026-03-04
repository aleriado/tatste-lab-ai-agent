// Temp script: calls getHubSpotProduct equivalent
// Usage: node scripts/hs_get.mjs <hubspot_product_id>
// Example: node scripts/hs_get.mjs 397379907786

const TOKEN = 'pat-eu1-394b8e55-a42c-4f51-964c-fbcd4308308f';
const BASE = 'https://api.hubapi.com';

const id = process.argv[2];
if (!id) { console.error('Usage: node scripts/hs_get.mjs <product_id>'); process.exit(1); }

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

const p = await req(`/crm/v3/objects/products/${id}?properties=${encodeURIComponent(allProps.join(','))}`);

console.log(`\nHubSpot Product ID: ${p.id}\n`);
for (const [k, v] of Object.entries(p.properties ?? {})) {
  if (v !== null && v !== undefined && v !== '') console.log(`  ${k}: ${v}`);
}
