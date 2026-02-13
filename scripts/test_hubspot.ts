/// <reference types="node" />

/**
 * Minimal HubSpot REST test script (Node 18+, TypeScript).
 *
 * Usage:
 * 1) Create a `.env` file in the repo root (or update it) and set:
 *      HUBSPOT_ACCESS_TOKEN=your_private_app_token_here
 * 2) Run the script:
 *      pnpm test:hubspot
 *      # Or directly:
 *      pnpm exec ts-node scripts/test_hubspot.ts
 *      # Or with node (after installing dotenv):
 *      pnpm exec node -r dotenv/config scripts/test_hubspot.ts
 *
 * This script:
 *  - Lists up to 1 existing contact and prints id/email.
 *  - Creates a test contact with email ai_test_<timestamp>@tastelabs.co.il
 *    and prints its id/email.
 *
 * NOTE: The HubSpot token is never logged.
 */

/* eslint-disable no-console */
// Load .env from repo root
// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
const dotenv = require('dotenv');
// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
const path = require('path');
// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
const fs = require('fs');

// Try multiple locations for .env file
const possibleEnvPaths = [
  path.resolve(process.cwd(), '.env'), // Current working directory
  path.resolve(__dirname, '..', '.env'), // Relative to script location
  path.resolve(__dirname, '../../.env') // Alternative relative path
];

let envPath: string | null = null;
for (const envFile of possibleEnvPaths) {
  if (fs.existsSync(envFile)) {
    envPath = envFile;
    break;
  }
}

let envLoaded = false;
let parsedEnv: Record<string, string> | undefined;

if (envPath) {
  // Use override: true to ensure variables are set
  const result = dotenv.config({ path: envPath, override: true });
  if (result.error) {
    console.warn('Warning: Failed to load .env file:', result.error.message);
  } else {
    envLoaded = true;
    parsedEnv = result.parsed;
    console.log(`✓ Loaded .env from: ${envPath}`);
    // Explicitly set variables in process.env from parsed result
    if (parsedEnv) {
      Object.keys(parsedEnv).forEach(key => {
        process.env[key] = parsedEnv![key];
      });
      const tokenInParsed = 'HUBSPOT_ACCESS_TOKEN' in parsedEnv;
      console.log(`  Token in parsed result: ${tokenInParsed ? 'Yes' : 'No'}`);
      if (tokenInParsed) {
        console.log(`  Token value starts with: ${parsedEnv.HUBSPOT_ACCESS_TOKEN?.substring(0, 10)}...`);
      }
    }
  }
} else {
  // Fallback to default behavior (current directory)
  const result = dotenv.config({ override: true });
  if (result.error) {
    console.warn('Warning: Failed to load .env file from current directory:', result.error.message);
  } else {
    envLoaded = true;
    parsedEnv = result.parsed;
    console.log('✓ Loaded .env from current directory');
    // Explicitly set variables in process.env from parsed result
    if (parsedEnv) {
      Object.keys(parsedEnv).forEach(key => {
        process.env[key] = parsedEnv![key];
      });
    }
  }
}

// Debug: Check if token is loaded (only show if missing)
if (!process.env.HUBSPOT_ACCESS_TOKEN) {
  console.error('✗ HUBSPOT_ACCESS_TOKEN not found in environment after loading .env');
  console.error('Checked paths:');
  possibleEnvPaths.forEach(p => {
    const exists = fs.existsSync(p);
    console.error(`  ${exists ? '✓' : '✗'} ${p}`);
  });
  console.error(`Current working directory: ${process.cwd()}`);
  console.error(`Script directory (__dirname): ${__dirname}`);
  if (envPath) {
    console.error(`Attempted to load from: ${envPath}`);
    // Try to read the file directly to see what's in it
    try {
      const envContent = fs.readFileSync(envPath, 'utf8');
      const hasToken = envContent.includes('HUBSPOT_ACCESS_TOKEN');
      console.error(`File contains HUBSPOT_ACCESS_TOKEN: ${hasToken ? 'Yes' : 'No'}`);
      if (hasToken) {
        const lines = envContent.split('\n');
        const tokenLine = lines.find((line: string) => line.startsWith('HUBSPOT_ACCESS_TOKEN'));
        if (tokenLine) {
          console.error(`Token line found: ${tokenLine.substring(0, 30)}...`);
        }
      }
    } catch (e) {
      console.error(`Could not read .env file: ${e}`);
    }
  }
}

// Auto-detect EU vs US based on token prefix (pat-eu1- or eu1- = EU)
function getHubSpotBaseUrl(token: string): string {
  if (token.startsWith('pat-eu1-') || token.startsWith('eu1-')) {
    return 'https://api-eu1.hubapi.com';
  }
  return 'https://api.hubapi.com';
}

const HUBSPOT_BASE_URL = getHubSpotBaseUrl(process.env.HUBSPOT_ACCESS_TOKEN || '');

function getAccessToken(): string {
  const token = process.env.HUBSPOT_ACCESS_TOKEN;
  if (!token) {
    throw new Error(
      'HUBSPOT_ACCESS_TOKEN is not set. Add it to your .env or export it in your shell.'
    );
  }
  return token;
}

async function hubspotRequest(
  path: string,
  options: RequestInit & { method: 'GET' | 'POST' }
): Promise<any> {
  const token = getAccessToken();
  const baseUrl = getHubSpotBaseUrl(token);
  const url = `${baseUrl}${path}`;

  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(options.headers ?? {})
    }
  });

  if (!res.ok) {
    const bodyText = await res.text().catch(() => '');

    if (res.status === 401 || res.status === 403) {
      console.error('Auth/scopes issue', bodyText);
    } else if (res.status === 429) {
      const retryAfter = res.headers.get('retry-after');
      console.error('Rate limited' + (retryAfter ? ` (retry-after: ${retryAfter})` : ''), bodyText);
    } else {
      console.error(`Status ${res.status}:`, bodyText);
    }

    throw new Error(`HubSpot request failed with status ${res.status}`);
  }

  return res.json();
}

/**
 * List HubSpot contacts (limited) and return the raw results array.
 */
export async function listContacts(limit = 1): Promise<any[]> {
  const searchParams = new URLSearchParams({
    limit: String(limit),
    properties: 'email'
  });

  const data = await hubspotRequest(
    `/crm/v3/objects/contacts?${searchParams.toString()}`,
    {
      method: 'GET'
    }
  );

  return (data?.results as any[]) ?? [];
}

/**
 * Create a test contact with a given email.
 * The lifecyclestage property is included as \"lead\"; if your HubSpot
 * account does not allow setting it this way, you may remove that line.
 */
export async function createTestContact(email: string): Promise<any> {
  const body = {
    properties: {
      email,
      firstname: 'AI',
      lastname: 'Test',
      lifecyclestage: 'lead'
    }
  };

  const data = await hubspotRequest('/crm/v3/objects/contacts', {
    method: 'POST',
    body: JSON.stringify(body)
  });

  return data;
}

async function main(): Promise<void> {
  try {
    console.log('Listing up to 1 existing HubSpot contact...');
    const contacts = await listContacts(1);

    if (contacts.length > 0) {
      const first = contacts[0];
      const email = first?.properties?.email ?? null;
      console.log('First contact:', { id: first.id, email });
    } else {
      console.log('No contacts found.');
    }

    const email = `ai_test_${Date.now()}@tastelabs.co.il`;
    console.log('Creating test contact with email:', email);
    const created = await createTestContact(email);

    const createdEmail = created?.properties?.email ?? email;
    console.log('Created contact:', { id: created.id, email: createdEmail });
  } catch (err) {
    console.error('HubSpot test script failed.', err);
    process.exitCode = 1;
  }
}

// Run when invoked directly (node / ts-node scripts/test_hubspot.ts)
if (require.main === module) {
  // eslint-disable-next-line @typescript-eslint/no-floating-promises
  main();
}

