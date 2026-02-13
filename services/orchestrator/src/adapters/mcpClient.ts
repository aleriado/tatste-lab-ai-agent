/**
 * MCP client helper for WordPress/Woo and other MCP-backed adapters.
 * - baseUrl from env MCP_WP_BASE_URL
 * - auth header from MCP_WP_TOKEN if set
 * - timeout 10s, retry once on 5xx
 */

const DEFAULT_TIMEOUT_MS = 10_000;

function getBaseUrl(): string {
  const base = process.env.MCP_WP_BASE_URL;
  if (!base) {
    throw new Error('MCP_WP_BASE_URL is not set');
  }
  return base.replace(/\/$/, '');
}

function getHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json'
  };
  const token = process.env.MCP_WP_TOKEN;
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  return headers;
}

async function fetchWithTimeout(
  url: string,
  options: RequestInit & { timeout?: number }
): Promise<Response> {
  const { timeout = DEFAULT_TIMEOUT_MS, ...rest } = options;
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(url, {
      ...rest,
      signal: controller.signal
    });
    return res;
  } finally {
    clearTimeout(id);
  }
}

async function request<T>(
  method: 'GET' | 'POST',
  path: string,
  body?: unknown,
  params?: Record<string, string>
): Promise<T> {
  const base = getBaseUrl();
  const url = new URL(path.startsWith('http') ? path : `${base}${path.startsWith('/') ? path : `/${path}`}`);
  if (params) {
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  }
  const headers = getHeaders();

  const doRequest = async (): Promise<Response> => {
    return fetchWithTimeout(url.toString(), {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      timeout: DEFAULT_TIMEOUT_MS
    });
  };

  let res = await doRequest();

  if (res.status >= 500 && res.status < 600) {
    res = await doRequest();
  }

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`MCP request failed: ${res.status} ${text}`);
  }

  const contentType = res.headers.get('content-type');
  if (contentType?.includes('application/json')) {
    return res.json() as Promise<T>;
  }
  return res.text() as unknown as T;
}

export async function mcpGet<T = unknown>(
  path: string,
  params?: Record<string, string>
): Promise<T> {
  return request<T>('GET', path, undefined, params);
}

export async function mcpPost<T = unknown>(path: string, body?: unknown): Promise<T> {
  return request<T>('POST', path, body);
}
