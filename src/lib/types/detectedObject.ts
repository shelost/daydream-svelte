/**
 * Types for object detection results
 */

export interface BoundingBox {
  // Support for shape recognition service
  x?: number;
  y?: number;

  // Standard normalized bounding box properties
  minX?: number;
  minY?: number;
  maxX?: number;
  maxY?: number;
  width: number;
  height: number;
  centerX?: number;
  centerY?: number;
}

export interface ShapeProperties {
  isRegular?: boolean;
  aspectRatio?: number;
  corners?: number;
  area?: number;
  perimeter?: number;
}

export interface DetectedObject {
  id?: string;
  name: string;
  confidence: number;
  boundingBox?: BoundingBox;
  properties?: ShapeProperties;
  strokeIds?: string[];
  enhancedByCNN?: boolean;
  enhancedByStrokes?: boolean;
  source?: 'shape-recognition' | 'tensorflow' | 'cnn' | 'openai' | 'strokes' | 'fallback' | 'hybrid';
  detectionSource?: 'tensorflow' | 'strokes' | 'cnn' | 'openai' | 'shape-recognition' | 'fallback';
  position?: { x: number; y: number };
  category?: string;
  color?: string;
  children?: string[];
  isChild?: boolean;
  parentId?: string;
  isContainer?: boolean;
}

export interface DetectionResult {
  analysis: {
    type: string;
    content: string;
    confidence: number;
  };
  detectedShapes: DetectedObject[];
  debug?: any;
}