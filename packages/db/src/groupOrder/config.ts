/**
 * Group Order Configuration - Environment Variables
 */

import type { AllocationConfig } from './types';

export function getGroupOrderConfig(): AllocationConfig {
  const defaultMoqSurfaces = parseInt(process.env.GROUP_ORDER_DEFAULT_MOQ_SURFACES ?? '1', 10);
  const allowExtraSurfaces = process.env.GROUP_ORDER_ALLOW_EXTRA_SURFACES?.toLowerCase() === 'true';
  const maxSurfaces = parseInt(process.env.GROUP_ORDER_MAX_SURFACES ?? '10', 10);

  return {
    defaultMoqSurfaces: Number.isFinite(defaultMoqSurfaces) && defaultMoqSurfaces > 0 ? defaultMoqSurfaces : 1,
    allowExtraSurfaces,
    maxSurfaces: Number.isFinite(maxSurfaces) && maxSurfaces > 0 ? maxSurfaces : 10
  };
}

/** Import order MOQ (minimum surfaces/pallets). Uses IMPORT_ORDER_DEFAULT_MOQ_SURFACES, fallback GROUP_ORDER_DEFAULT_MOQ_SURFACES. */
export function getImportOrderMoqSurfaces(): number {
  const env = process.env.IMPORT_ORDER_DEFAULT_MOQ_SURFACES;
  if (env !== undefined && env !== '') {
    const n = parseInt(env, 10);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return getGroupOrderConfig().defaultMoqSurfaces;
}
