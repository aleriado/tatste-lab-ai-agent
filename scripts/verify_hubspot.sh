#!/bin/bash
export HUBSPOT_ACCESS_TOKEN=$(grep HUBSPOT_ACCESS_TOKEN .env | cut -d '=' -f2 | tr -d '"')

echo "=== Testing HubSpot API ==="
echo "Token starts with: ${HUBSPOT_ACCESS_TOKEN:0:15}..."

echo -e "\n=== Listing contacts ==="
curl -s -H "Authorization: Bearer $HUBSPOT_ACCESS_TOKEN" \
  "https://api-eu1.hubapi.com/crm/v3/objects/contacts?limit=5&properties=email,firstname,lastname" | \
  jq -r '.results[] | "\(.id) | \(.properties.email // "no email") | \(.properties.firstname // "") \(.properties.lastname // "")"'

echo -e "\n=== Account info ==="
curl -s -H "Authorization: Bearer $HUBSPOT_ACCESS_TOKEN" \
  "https://api-eu1.hubapi.com/integrations/v1/me" | jq -r '.portalId, .timeZone'
