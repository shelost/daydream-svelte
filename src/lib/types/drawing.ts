export interface Point {
  x: number;
  y: number;
  pressure?: number;
  timestamp?: number;
}

export interface Stroke {
  id: string;
  points: Point[];
  color: string;
  width: number;
  opacity?: number;
  tool?: string;
  timestamp?: number;
}

export interface DrawingMetadata {
  createdAt: string;
  updatedAt: string;
  id: string;
  title?: string;
  description?: string;
  tags?: string[];
}

export interface Drawing {
  metadata: DrawingMetadata;
  strokes: Stroke[];
}

export interface RecognizedShape {
  type: string;
  confidence: number;
  boundingBox?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  strokeIds?: string[];
}

export interface AnalysisResult {
  shapes?: RecognizedShape[];
  objects?: RecognizedObject[];
  text?: string;
  debug?: any;
}

export interface RecognizedObject {
  label: string;
  confidence: number;
  boundingBox: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

export type DrawingMode = 'pen' | 'eraser' | 'highlighter' | 'select' | 'move';

export type AnalysisType = 'basic' | 'detailed' | 'enhanced';

export interface AnalysisOptions {
  type: AnalysisType;
  includeObjects?: boolean;
  includeShapes?: boolean;
  includeText?: boolean;
  useAI?: boolean;
}