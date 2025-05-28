import { describe, it, expect } from 'vitest';
import { getStraightPath, getStraightEdgeCenter } from './edgePaths';

describe('edgePaths utility', () => {
  describe('getStraightPath', () => {
    it('should create a straight path between two points', () => {
      const params = {
        sourceX: 100,
        sourceY: 100,
        targetX: 200,
        targetY: 200
      };

      const [path, labelX, labelY, labelOrient] = getStraightPath(params);

      // Check the path string is correctly formed
      expect(path).toBe('M 100,100 L 200,200');

      // Check other return values
      expect(labelX).toBe(null);
      expect(labelY).toBe(null);
      expect(labelOrient).toBe(null);
    });

    it('should work with negative coordinates', () => {
      const params = {
        sourceX: -50,
        sourceY: 100,
        targetX: 50,
        targetY: -100
      };

      const [path] = getStraightPath(params);
      expect(path).toBe('M -50,100 L 50,-100');
    });
  });

  describe('getStraightEdgeCenter', () => {
    it('should calculate the center point between two coordinates', () => {
      const params = {
        sourceX: 100,
        sourceY: 100,
        targetX: 200,
        targetY: 200
      };

      const center = getStraightEdgeCenter(params);

      expect(center.x).toBe(150);
      expect(center.y).toBe(150);
    });

    it('should handle horizontal lines', () => {
      const params = {
        sourceX: 100,
        sourceY: 100,
        targetX: 300,
        targetY: 100
      };

      const center = getStraightEdgeCenter(params);

      expect(center.x).toBe(200);
      expect(center.y).toBe(100);
    });

    it('should handle vertical lines', () => {
      const params = {
        sourceX: 100,
        sourceY: 100,
        targetX: 100,
        targetY: 300
      };

      const center = getStraightEdgeCenter(params);

      expect(center.x).toBe(100);
      expect(center.y).toBe(200);
    });
  });
});