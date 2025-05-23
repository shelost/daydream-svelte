// This file declares modules that don't have TypeScript definition files
// It allows importing them without TypeScript errors

declare module 'fabric' {
  const fabric: any;
  export default fabric;
}

declare module 'perfect-freehand' {
  export function getStroke(points: any[], options?: any): any[];
}

declare module 'gsap' {
  export const gsap: any;
}

// Add declarations for any other modules that don't have TypeScript definitions