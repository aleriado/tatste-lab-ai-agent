/**
 * Group Order Validation - Product Logistics
 */

import type { ProductLogistics, AllocationError } from './types';

export function validateProductLogistics(product: Partial<ProductLogistics>): AllocationError | null {
  if (!product.manufacturer || product.manufacturer.trim() === '') {
    return {
      code: 'MISSING_LOGISTICS',
      message: 'Product is missing manufacturer metadata',
      details: { productId: product.productId, field: 'manufacturer' }
    };
  }

  if (!product.unitsPerBox || product.unitsPerBox <= 0) {
    return {
      code: 'MISSING_LOGISTICS',
      message: 'Product is missing valid units_per_box metadata',
      details: { productId: product.productId, field: 'unitsPerBox', value: product.unitsPerBox }
    };
  }

  if (!product.boxesPerLayer || product.boxesPerLayer <= 0) {
    return {
      code: 'MISSING_LOGISTICS',
      message: 'Product is missing valid boxes_per_layer metadata',
      details: { productId: product.productId, field: 'boxesPerLayer', value: product.boxesPerLayer }
    };
  }

  if (!product.layersPerSurface || product.layersPerSurface <= 0) {
    return {
      code: 'MISSING_LOGISTICS',
      message: 'Product is missing valid layers_per_surface metadata',
      details: { productId: product.productId, field: 'layersPerSurface', value: product.layersPerSurface }
    };
  }

  return null;
}

export function deriveBoxesPerSurface(product: ProductLogistics): number {
  return product.boxesPerSurface ?? (product.boxesPerLayer * product.layersPerSurface);
}
