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

function getProductSource(): 'woo' | 'hubspot' {
  const raw = (process.env.INTEGRATION_PRODUCT_SOURCE ?? process.env.PRODUCT_SOURCE ?? '').trim().toLowerCase();
  if (raw === 'woo' || raw === 'woocommerce') return 'woo';
  if (raw === 'hubspot') return 'hubspot';
  return process.env.HUBSPOT_PRODUCTS_ACCESS_TOKEN || process.env.HUBSPOT_ACCESS_TOKEN ? 'hubspot' : 'woo';
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
    const source = getProductSource();
    const hasWooCreds = !!(process.env.WOO_BASE_URL && process.env.WOO_CONSUMER_KEY && process.env.WOO_CONSUMER_SECRET);
    const hasHubSpotProductCreds = !!(process.env.HUBSPOT_PRODUCTS_ACCESS_TOKEN || process.env.HUBSPOT_ACCESS_TOKEN);
    const canInitForSource = source === 'hubspot' ? hasHubSpotProductCreds : hasWooCreds;

    if (canInitForSource) {
      try {
        cached = createRestWooAdapter();
        logInfo(`Catalog adapter: REST (source=${source})`);
        return cached;
      } catch (e) {
        logInfo('WooCommerce REST init failed; falling back to mock', e);
      }
    } else {
      logInfo(`Catalog REST env missing for configured source (${source}); using mock`);
    }
  }

  cached = mockWooAdapter;
  logInfo('WooCommerce adapter: mock');
  return cached;
}

export type { WooCommerceAdapter, WooProduct, WooVariation, WooProductImage } from './types';
