import type { User } from '@supabase/supabase-js';

// User profile
export interface Profile {
  id: string;
  full_name?: string;
  avatar_url?: string;
  updated_at?: string;
  created_at?: string;
}

// Page types
export type PageType = 'canvas' | 'drawing';

export interface BasePage {
  id: string;
  title: string;
  type: PageType;
  user_id: string;
  parent_id?: string;
  icon?: string;
  thumbnail_url?: string;
  thumbnail_updated_at?: string;
  order_index: number;
  created_at: string;
  updated_at: string;
}

export interface CanvasPage extends BasePage {
  type: 'canvas';
  content: CanvasContent;
}

export interface DrawingPage extends BasePage {
  type: 'drawing';
  content: DrawingContent;
}

export type Page = CanvasPage | DrawingPage;

// Canvas content type
export interface CanvasContent {
  objects: any[]; // fabric.js objects
  drawings: DrawingReference[];
  background?: string;
  viewport?: Viewport;
}

// Viewport type for canvas
export interface Viewport {
  zoom: number;
  panX: number;
  panY: number;
  originalSize?: {
    width: number;
    height: number;
  };
}

// Drawing content type
export interface DrawingContent {
  strokes: Stroke[];
  background?: string;
  bounds?: {
    width: number;
    height: number;
  };
}

// Drawing reference (within a canvas)
export interface DrawingReference {
  id: string;
  drawing_id: string;
  position: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  isEditing?: boolean;
}

// Stroke for perfect-freehand
export interface Stroke {
  points: StrokePoint[];
  color: string;
  size: number;
  opacity: number;
  tool: 'pen' | 'highlighter' | 'eraser';
}

export interface StrokePoint {
  x: number;
  y: number;
  pressure?: number;
}

// Tool types
export type Tool =
  | 'select'
  | 'pan'
  | 'draw'
  | 'polygon'
  | 'rectangle'
  | 'text'
  | 'eraser'
  | 'move';

export interface ToolOption {
  id: Tool;
  label: string;
  icon: string;
  shortcut?: string;
  options?: ToolSubOption[];
}

export interface ToolSubOption {
  id: string;
  label: string;
  icon?: string;
  value: any;
}

// Autosave status
export type SaveStatus = 'saved' | 'saving' | 'error';