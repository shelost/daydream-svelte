import { writable } from 'svelte/store';
import type { TextStyles } from '$lib/types';

// Text style properties
export const textStyles = writable<TextStyles>({
  fontFamily: 'Inter',
  fontSize: 18,
  color: '#333333',
  fontWeight: 'normal', // normal, bold
  fontStyle: 'normal', // normal, italic
  textAlign: 'left', // left, center, right, justify
  lineHeight: 1.2,
  letterSpacing: 0,
  underline: false,
  opacity: 1.0,
  shadow: {
    enabled: false,
    color: 'rgba(0,0,0,0.5)',
    blur: 4,
    offsetX: 2,
    offsetY: 2
  }
});

// Shape style properties
export const shapeStyles = writable({
  fill: '#f0f0f0',
  stroke: '#333333',
  strokeWidth: 1,
  opacity: 1.0,
  cornerRadius: 0,
  shadow: {
    enabled: false,
    color: 'rgba(0,0,0,0.3)',
    blur: 10,
    offsetX: 5,
    offsetY: 5,
    inset: false
  }
});

// Line style properties
export const lineStyles = writable({
  stroke: '#333333',
  strokeWidth: 2,
  opacity: 1.0,
  lineDash: [0, 0], // [dashLength, gapLength]
  lineType: 'solid', // solid, dashed, dotted
  startArrow: false,
  endArrow: false,
  arrowSize: 10
});

// Image style properties
export const imageStyles = writable({
  opacity: 1.0,
  filters: {
    brightness: 100, // %
    contrast: 100,   // %
    saturation: 100, // %
    blur: 0,         // px
    grayscale: 0     // %
  },
  border: {
    enabled: false,
    width: 1,
    color: '#333333',
    style: 'solid' // solid, dashed, dotted
  },
  shadow: {
    enabled: false,
    color: 'rgba(0,0,0,0.3)',
    blur: 10,
    offsetX: 5,
    offsetY: 5
  }
});

// Active selection style (for multi-selection)
export const selectionStyles = writable({
  opacity: 1.0,
  locked: false,
  group: false
});

// Get style store based on object type
export function getStyleStoreForType(type: string) {
  switch (type) {
    case 'text':
    case 'i-text':
    case 'textbox':
      return textStyles;
    case 'rect':
    case 'circle':
    case 'polygon':
    case 'triangle':
      return shapeStyles;
    case 'line':
    case 'path':
      return lineStyles;
    case 'image':
      return imageStyles;
    case 'activeSelection':
    case 'group':
      return selectionStyles;
    default:
      return shapeStyles; // Default fallback
  }
}