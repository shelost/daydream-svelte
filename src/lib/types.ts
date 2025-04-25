// src/lib/types.ts
// Tool types for different interaction modes
export type Tool = 'select' | 'draw' | 'eraser' | 'pan' | 'text' | 'rectangle' | 'node' | 'input' | 'output' | 'edge' | 'delete';

// Point in a stroke with pressure information
export interface StrokePoint {
  x: number;
  y: number;
  pressure?: number;
}

// A single stroke (line) in a drawing
export interface Stroke {
  id?: string;
  tool: 'pen' | 'highlighter' | 'eraser';
  points: StrokePoint[];
  color: string;
  size: number;
  opacity: number;
}

// Content of a drawing
export interface DrawingContent {
  strokes: Stroke[];
  bounds?: {
    width: number;
    height: number;
  };
}

// Canvas content can contain drawings and other objects
export interface CanvasContent {
  objects: any[];
  drawings: {
    id: string;
    position: { x: number; y: number };
    size: { width: number; height: number };
    drawingData: DrawingContent;
  }[];
}