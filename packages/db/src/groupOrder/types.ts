/**
 * Group Order Types - Strict Client Rules Implementation
 * 
 * CLIENT RULES:
 * 1. One manufacturer per group order
 * 2. Each surface/pallet has multiple layers
 * 3. One product type per layer (no mixing)
 * 4. surface_max_layers = MIN(layers_per_surface) across all products
 * 5. Fill existing open layers first before opening new ones
 * 6. Layer capacity = boxes_per_layer * units_per_box
 * 7. MOQ = minimum surfaces (pallets) required
 */

export interface ProductLogistics {
  productId: string;
  variantId?: string | null;
  name: string;
  manufacturer: string;
  unitsPerBox: number;
  boxesPerLayer: number;
  layersPerSurface: number;
  boxesPerSurface?: number; // derived as boxes_per_layer * layers_per_surface if missing
}

export interface AllocationInput {
  groupOrderId: string;
  customerId: string;
  product: ProductLogistics;
  quantityUnits: number; // incoming quantity in UNITS
}

export interface AllocationResult {
  success: boolean;
  allocatedBoxes: number;
  allocatedUnits: number;
  surfacesOpened: number;
  layersOpened: number;
  surfacesUsed: number[];
  layersUsed: Array<{ surfaceIndex: number; layerIndex: number; boxes: number; units: number }>;
  error?: AllocationError;
}

export interface AllocationError {
  code: 'MANUFACTURER_MISMATCH' | 'INVALID_QUANTITY' | 'OVERFLOW' | 'LAYER_LIMIT_CONFLICT' | 'MISSING_LOGISTICS' | 'INVALID_STATE';
  message: string;
  details: Record<string, unknown>;
}

export interface GroupOrderState {
  id: string;
  code: string;
  manufacturerId: string | null;
  moqSurfaces: number;
  surfaceMaxLayers: number | null;
  surfaces: SurfaceState[];
  allowExtraSurfaces: boolean;
  maxSurfacesLimit: number;
  isImport: boolean;
  maxParticipants: number | null;
}

export interface SurfaceState {
  id: string;
  surfaceIndex: number;
  maxLayers: number;
  status: string;
  layers: LayerState[];
}

export interface LayerState {
  id: string;
  layerIndex: number;
  productId: string;
  variantId: string | null;
  capacityBoxes: number;
  capacityUnits: number;
  filledBoxes: number;
  filledUnits: number;
  status: string;
}

export interface LayerContribution {
  customerId: string;
  boxes: number;
  units: number;
  timestamp: string;
}

export interface AllocationConfig {
  defaultMoqSurfaces: number;
  allowExtraSurfaces: boolean;
  maxSurfaces: number;
}
