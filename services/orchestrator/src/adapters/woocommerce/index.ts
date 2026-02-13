/**
 * WooCommerce adapter selector.
 * INTEGRATION_MODE_WOO = mcp | rest | mock
 * Defaults to mock if MCP env missing or mode not set.
 */

import type { WooCommerceAdapter } from './types';
import { mockWooAdapter } from './mock';
import { createMcpWooAdapter } from './mcp';
import { createRestWooAdapter } from './rest';
import { logInfo } from '../../logger';

let cached: WooCommerceAdapter | null = null;

function getMode(): 'mcp' | 'rest' | 'mock' {
  const raw = process.env.INTEGRATION_MODE_WOO?.toLowerCase();
  if (raw === 'mcp' || raw === 'rest' || raw === 'mock') return raw;
  return 'mock';
}

export function getWooAdapter(): WooCommerceAdapter {
  if (cached) return cached;

  const mode = getMode();

  if (mode === 'mcp') {
    if (process.env.MCP_WP_BASE_URL) {
      try {
        cached = createMcpWooAdapter();
        logInfo('WooCommerce adapter: MCP');
        return cached;
      } catch {
        logInfo('WooCommerce MCP not configured; falling back to mock');
      }
    } else {
      logInfo('WooCommerce MCP env missing; using mock');
    }
  }

  if (mode === 'rest') {
    if (process.env.WOO_BASE_URL && process.env.WOO_CONSUMER_KEY && process.env.WOO_CONSUMER_SECRET) {
      try {
        cached = createRestWooAdapter();
        logInfo('WooCommerce adapter: REST');
        return cached;
      } catch (e) {
        logInfo('WooCommerce REST init failed; falling back to mock', e);
      }
    } else {
      logInfo('WooCommerce REST env missing; using mock');
    }
  }

  cached = mockWooAdapter;
  logInfo('WooCommerce adapter: mock');
  return cached;
}

export type { WooCommerceAdapter, WooProduct } from './types';
