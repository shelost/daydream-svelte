/**
 * Sketch Recognition Service
 *
 * A service that recognizes sketches based on stroke data.
 * Inspired by Google's Digital Ink Recognition but implemented in pure JavaScript
 * for web-based applications.
 */

import type { Stroke, StrokePoint } from '$lib/types';

// Common shape and object patterns for recognition
interface ShapePattern {
  name: string;
  match: (strokes: Stroke[]) => number; // Returns confidence score 0-1
}

// Basic geometric shapes for recognition
const basicShapes: ShapePattern[] = [
  {
    name: 'circle',
    match: (strokes: Stroke[]) => {
      // Circle is typically a single stroke with similar start and end points
      if (strokes.length !== 1) return 0;

      const points = strokes[0].points;
      if (points.length < 10) return 0; // Needs enough points to form a circle

      // Check if start and end points are close to each other
      const startPoint = points[0];
      const endPoint = points[points.length - 1];
      const distance = Math.sqrt(
        Math.pow(endPoint.x - startPoint.x, 2) +
        Math.pow(endPoint.y - startPoint.y, 2)
      );

      // Calculate the average radius
      const center = getCentroid(points);
      const radii = points.map(p =>
        Math.sqrt(Math.pow(p.x - center.x, 2) + Math.pow(p.y - center.y, 2))
      );
      const avgRadius = radii.reduce((sum, r) => sum + r, 0) / radii.length;

      // Calculate the variance in radius (circles should have consistent radius)
      const radiusVariance = radii.reduce((sum, r) => sum + Math.pow(r - avgRadius, 2), 0) / radii.length;
      const normalizedVariance = Math.min(1, radiusVariance / (avgRadius * avgRadius));

      // Circle score factors:
      // 1. Closeness of start/end points (as a fraction of average radius)
      const closenessScore = Math.max(0, 1 - (distance / avgRadius));

      // 2. Consistency of radius (lower variance means more circle-like)
      const consistencyScore = 1 - normalizedVariance;

      // Combined score
      return (closenessScore * 0.6 + consistencyScore * 0.4);
    }
  },
  {
    name: 'rectangle',
    match: (strokes: Stroke[]) => {
      // Rectangle is usually a single stroke with 4 corners
      if (strokes.length !== 1) return 0;

      const points = strokes[0].points;
      if (points.length < 8) return 0; // Need enough points to form a rectangle

      // Check if start and end points are close to each other
      const startPoint = points[0];
      const endPoint = points[points.length - 1];
      const closeness = Math.sqrt(
        Math.pow(endPoint.x - startPoint.x, 2) +
        Math.pow(endPoint.y - startPoint.y, 2)
      );

      // Find the corners by looking for changes in direction
      const corners = findCorners(points);

      // Ideal rectangle has 4 corners
      const cornerScore = corners.length === 4 ? 1 : corners.length === 5 ? 0.8 : 0;
      if (cornerScore === 0) return 0;

      // Check for right angles
      let angleScore = 0;
      if (corners.length >= 4) {
        const angles = [];
        for (let i = 0; i < 4; i++) {
          const p1 = corners[i];
          const p2 = corners[(i+1) % 4];
          const p3 = corners[(i+2) % 4];

          const angle = getAngle(p1, p2, p3);
          angles.push(angle);
        }

        // Sum up how close each angle is to 90 degrees (in radians, ~1.57)
        angleScore = angles.reduce((sum, angle) => {
          return sum + (1 - Math.abs(angle - Math.PI/2) / (Math.PI/2));
        }, 0) / angles.length;
      }

      // Calculate a closure score based on start/end point proximity
      const bounds = getBoundingBox(points);
      const diagonalLength = Math.sqrt(
        Math.pow(bounds.maxX - bounds.minX, 2) +
        Math.pow(bounds.maxY - bounds.minY, 2)
      );
      const closureScore = Math.max(0, 1 - (closeness / (diagonalLength * 0.25)));

      // Combine scores
      return (cornerScore * 0.5 + angleScore * 0.3 + closureScore * 0.2);
    }
  },
  {
    name: 'triangle',
    match: (strokes: Stroke[]) => {
      if (strokes.length !== 1) return 0;

      const points = strokes[0].points;
      if (points.length < 6) return 0; // Need enough points

      // Check if start and end points are close to each other
      const startPoint = points[0];
      const endPoint = points[points.length - 1];
      const closeness = Math.sqrt(
        Math.pow(endPoint.x - startPoint.x, 2) +
        Math.pow(endPoint.y - startPoint.y, 2)
      );

      // Find the corners
      const corners = findCorners(points);

      // Ideal triangle has 3 corners
      const cornerScore = corners.length === 3 ? 1 :
                         corners.length === 4 && closeness < 20 ? 0.8 : 0;
      if (cornerScore === 0) return 0;

      // Calculate a closure score
      const bounds = getBoundingBox(points);
      const diagonalLength = Math.sqrt(
        Math.pow(bounds.maxX - bounds.minX, 2) +
        Math.pow(bounds.maxY - bounds.minY, 2)
      );
      const closureScore = Math.max(0, 1 - (closeness / (diagonalLength * 0.25)));

      // Calculate angle sum (should be close to 180 degrees for a triangle)
      let angleSum = 0;
      if (corners.length >= 3) {
        for (let i = 0; i < 3; i++) {
          const p1 = corners[i];
          const p2 = corners[(i+1) % 3];
          const p3 = corners[(i+2) % 3];
          angleSum += getAngle(p1, p2, p3);
        }
      }

      // How close is the angle sum to 180 degrees (π radians)
      const angleSumScore = 1 - Math.abs(angleSum - Math.PI) / Math.PI;

      // Combine scores
      return (cornerScore * 0.5 + closureScore * 0.2 + angleSumScore * 0.3);
    }
  },
  {
    name: 'line',
    match: (strokes: Stroke[]) => {
      if (strokes.length !== 1) return 0;

      const points = strokes[0].points;
      if (points.length < 2) return 0;

      // A line is straight - check straightness
      const startPoint = points[0];
      const endPoint = points[points.length - 1];

      // Length of the line
      const lineLength = Math.sqrt(
        Math.pow(endPoint.x - startPoint.x, 2) +
        Math.pow(endPoint.y - startPoint.y, 2)
      );

      // Sum up distances of all points to the line
      let totalDeviation = 0;
      for (let i = 1; i < points.length - 1; i++) {
        totalDeviation += pointToLineDistance(startPoint, endPoint, points[i]);
      }

      // Average deviation from the line
      const avgDeviation = totalDeviation / (points.length - 2);

      // Lines should have minimal deviation
      return Math.max(0, 1 - (avgDeviation / (lineLength * 0.1)));
    }
  },
  {
    name: 'arrow',
    match: (strokes: Stroke[]) => {
      // An arrow is typically a line with an arrowhead
      if (strokes.length !== 1 && strokes.length !== 2) return 0;

      // If one stroke, it should have a special pattern
      if (strokes.length === 1) {
        const points = strokes[0].points;
        if (points.length < 10) return 0;

        // Find potential corners
        const corners = findCorners(points);
        if (corners.length < 3) return 0;

        // Check if the pattern resembles an arrow
        // This is a simple check for demonstration - could be improved
        const lineScore = basicShapes.find(s => s.name === 'line')?.match([{
          ...strokes[0],
          points: points.slice(0, Math.floor(points.length * 0.7))
        }]) || 0;

        if (lineScore < 0.7) return 0;

        // Check for the arrowhead pattern at the end
        // This is a basic check that could be enhanced
        const lastPoints = points.slice(Math.floor(points.length * 0.7));
        const changeDirections = countDirectionChanges(lastPoints);

        return lineScore * 0.7 + (changeDirections >= 2 ? 0.3 : 0);
      }

      // If two strokes, one should be a line and the other a v-shape
      if (strokes.length === 2) {
        // Check which is the line and which is the arrowhead
        const line1Score = basicShapes.find(s => s.name === 'line')?.match([strokes[0]]) || 0;
        const line2Score = basicShapes.find(s => s.name === 'line')?.match([strokes[1]]) || 0;

        if (line1Score < 0.7 && line2Score < 0.7) return 0;

        // Simple check for arrowhead
        // This could be enhanced with more specific arrowhead detection
        const lineStroke = line1Score > line2Score ? strokes[0] : strokes[1];
        const arrowheadStroke = line1Score > line2Score ? strokes[1] : strokes[0];

        // Check if arrowhead is near the end of the line
        const lineEndPoint = lineStroke.points[lineStroke.points.length - 1];
        const arrowheadPoints = arrowheadStroke.points;
        const avgArrowheadPoint = getCentroid(arrowheadPoints);

        const distance = Math.sqrt(
          Math.pow(lineEndPoint.x - avgArrowheadPoint.x, 2) +
          Math.pow(lineEndPoint.y - avgArrowheadPoint.y, 2)
        );

        // Arrow head should be close to the line end
        const proximityScore = Math.max(0, 1 - distance / 50);

        return Math.max(line1Score, line2Score) * 0.7 + proximityScore * 0.3;
      }

      return 0;
    }
  }
];

// Common objects that might be drawn
const commonObjects: ShapePattern[] = [
  {
    name: 'house',
    match: (strokes: Stroke[]) => {
      // Simple implementation: looking for a rectangle with a triangle on top
      // More sophisticated implementations would be needed for real-world use

      if (strokes.length < 1 || strokes.length > 3) return 0;

      // Try to identify a rectangle and triangle in the strokes
      let rectangleScore = 0;
      let triangleScore = 0;

      for (const stroke of strokes) {
        const currentRectScore = basicShapes.find(s => s.name === 'rectangle')?.match([stroke]) || 0;
        const currentTriScore = basicShapes.find(s => s.name === 'triangle')?.match([stroke]) || 0;

        rectangleScore = Math.max(rectangleScore, currentRectScore);
        triangleScore = Math.max(triangleScore, currentTriScore);
      }

      // If we have both shapes with decent confidence
      if (rectangleScore > 0.6 && triangleScore > 0.6) {
        return (rectangleScore + triangleScore) / 2;
      }

      // If we have a single stroke that might be a combined house shape
      if (strokes.length === 1) {
        const points = strokes[0].points;
        const corners = findCorners(points);

        // A house typically has 5 corners
        if (corners.length === 5) {
          return 0.7; // Simplified score for demo purposes
        }
      }

      return 0;
    }
  },
  {
    name: 'star',
    match: (strokes: Stroke[]) => {
      if (strokes.length !== 1) return 0;

      const points = strokes[0].points;
      if (points.length < 10) return 0;

      // Check if start and end points are close to each other
      const startPoint = points[0];
      const endPoint = points[points.length - 1];
      const closeness = Math.sqrt(
        Math.pow(endPoint.x - startPoint.x, 2) +
        Math.pow(endPoint.y - startPoint.y, 2)
      );

      // Find corners in the stroke
      const corners = findCorners(points);

      // A typical star has 5 or 10 corners (5-pointed star)
      const cornerScore =
        corners.length === 10 ? 1 :
        corners.length === 5 ? 0.8 :
        corners.length > 5 && corners.length < 12 ? 0.6 : 0;

      if (cornerScore === 0) return 0;

      // Calculate a closure score
      const bounds = getBoundingBox(points);
      const diagonalLength = Math.sqrt(
        Math.pow(bounds.maxX - bounds.minX, 2) +
        Math.pow(bounds.maxY - bounds.minY, 2)
      );
      const closureScore = Math.max(0, 1 - (closeness / (diagonalLength * 0.25)));

      // Count direction changes - stars have several
      const dirChanges = countDirectionChanges(points);
      const dirScore = Math.min(1, dirChanges / 8);

      return (cornerScore * 0.5 + closureScore * 0.3 + dirScore * 0.2);
    }
  }
];

// Helper functions
function getCentroid(points: StrokePoint[]): {x: number, y: number} {
  const sum = points.reduce((acc, point) => ({
    x: acc.x + point.x,
    y: acc.y + point.y
  }), {x: 0, y: 0});

  return {
    x: sum.x / points.length,
    y: sum.y / points.length
  };
}

function getBoundingBox(points: StrokePoint[]) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const point of points) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }

  return { minX, minY, maxX, maxY };
}

function findCorners(points: StrokePoint[]) {
  // A simple corner detection algorithm
  // This is a basic implementation that could be enhanced
  const corners: StrokePoint[] = [];
  const threshold = 30; // Angle threshold in degrees
  const minDistance = 10; // Minimum distance between corners

  if (points.length < 3) return corners;

  // Add the first point as a potential corner
  corners.push(points[0]);

  for (let i = 1; i < points.length - 1; i++) {
    const prev = points[i - 1];
    const curr = points[i];
    const next = points[i + 1];

    // Calculate the angle between the current point and its neighbors
    const angle = getAngle(prev, curr, next);

    // If the angle is sharp enough, it's a corner
    if (Math.abs(angle - Math.PI) > (threshold * Math.PI / 180)) {
      // Check if it's far enough from the last corner
      const lastCorner = corners[corners.length - 1];
      const distance = Math.sqrt(
        Math.pow(curr.x - lastCorner.x, 2) +
        Math.pow(curr.y - lastCorner.y, 2)
      );

      if (distance > minDistance) {
        corners.push(curr);
      }
    }
  }

  // Add the last point
  const lastPoint = points[points.length - 1];
  const lastCorner = corners[corners.length - 1];
  const distance = Math.sqrt(
    Math.pow(lastPoint.x - lastCorner.x, 2) +
    Math.pow(lastPoint.y - lastCorner.y, 2)
  );

  if (distance > minDistance) {
    corners.push(lastPoint);
  }

  return corners;
}

function getAngle(p1: StrokePoint, p2: StrokePoint, p3: StrokePoint) {
  // Calculate angle between three points
  const a = Math.sqrt(
    Math.pow(p2.x - p3.x, 2) +
    Math.pow(p2.y - p3.y, 2)
  );
  const b = Math.sqrt(
    Math.pow(p1.x - p3.x, 2) +
    Math.pow(p1.y - p3.y, 2)
  );
  const c = Math.sqrt(
    Math.pow(p1.x - p2.x, 2) +
    Math.pow(p1.y - p2.y, 2)
  );

  // Law of cosines
  return Math.acos((a*a + c*c - b*b) / (2 * a * c));
}

function pointToLineDistance(lineStart: StrokePoint, lineEnd: StrokePoint, point: StrokePoint) {
  // Calculate the perpendicular distance from a point to a line
  const numerator = Math.abs(
    (lineEnd.y - lineStart.y) * point.x -
    (lineEnd.x - lineStart.x) * point.y +
    lineEnd.x * lineStart.y -
    lineEnd.y * lineStart.x
  );

  const denominator = Math.sqrt(
    Math.pow(lineEnd.y - lineStart.y, 2) +
    Math.pow(lineEnd.x - lineStart.x, 2)
  );

  return numerator / denominator;
}

function countDirectionChanges(points: StrokePoint[]) {
  if (points.length < 3) return 0;

  let changes = 0;
  let prevDirection = Math.sign(points[1].x - points[0].x) + 2 * Math.sign(points[1].y - points[0].y);

  for (let i = 2; i < points.length; i++) {
    const direction = Math.sign(points[i].x - points[i-1].x) + 2 * Math.sign(points[i].y - points[i-1].y);
    if (direction !== prevDirection && (Math.abs(points[i].x - points[i-1].x) > 5 || Math.abs(points[i].y - points[i-1].y) > 5)) {
      changes++;
      prevDirection = direction;
    }
  }

  return changes;
}

/**
 * Recognizes shapes and objects from an array of strokes
 */
export function recognizeStrokes(strokes: Stroke[]) {
  if (!strokes || strokes.length === 0) {
    return {
      type: 'unknown',
      confidence: 0,
      allMatches: []
    };
  }

  // Combine all shape patterns for testing
  const allPatterns = [...basicShapes, ...commonObjects];

  // Calculate match scores for all patterns
  const scores = allPatterns.map(pattern => ({
    name: pattern.name,
    confidence: pattern.match(strokes)
  }));

  // Sort by confidence (highest first)
  scores.sort((a, b) => b.confidence - a.confidence);

  // Return the best match and all scores
  return {
    type: scores[0].confidence > 0.5 ? scores[0].name : 'unknown',
    confidence: scores[0].confidence,
    allMatches: scores
  };
}

/**
 * Simple classifier for text or drawing
 */
export function classifyStrokes(strokes: Stroke[]) {
  if (!strokes || strokes.length === 0) {
    return 'unknown';
  }

  // Text typically has:
  // 1. More separate strokes
  // 2. Smaller and more diverse stroke sizes
  // 3. Less closed shapes

  if (strokes.length > 5) {
    return 'text'; // Likely text if many separate strokes
  }

  // Check stroke length consistency
  const strokeLengths = strokes.map(stroke => stroke.points.length);
  const avgLength = strokeLengths.reduce((sum, len) => sum + len, 0) / strokeLengths.length;

  // Calculate stroke length variance
  const variance = strokeLengths.reduce((sum, len) => sum + Math.pow(len - avgLength, 2), 0) / strokeLengths.length;
  const normalizedVariance = variance / Math.pow(avgLength, 2);

  // Text typically has higher variance in stroke lengths
  if (normalizedVariance > 0.5 && strokes.length > 2) {
    return 'text';
  }

  // Check if any strokes are recognized as shapes with high confidence
  const recognition = recognizeStrokes(strokes);
  if (recognition.confidence > 0.7) {
    return 'drawing';
  }

  // Default case - if unsure, guess based on number of strokes
  return strokes.length <= 2 ? 'drawing' : 'text';
}

/**
 * Main function to analyze stroke data and return recognized content
 */
export function analyzeStrokeData(strokes: Stroke[]) {
  // First determine if this is text or drawing
  const contentType = classifyStrokes(strokes);

  if (contentType === 'drawing') {
    // Identify the specific shape or object
    const recognition = recognizeStrokes(strokes);

    return {
      type: 'drawing',
      content: recognition.type,
      confidence: recognition.confidence,
      details: recognition.allMatches.slice(0, 3) // Top 3 matches
    };
  } else if (contentType === 'text') {
    // For text, we'd ideally integrate with a handwriting recognition API
    // For this implementation, we'll just return a placeholder
    return {
      type: 'text',
      content: 'handwritten text',
      confidence: 0.7,
      details: 'Detailed text recognition would require additional API integration'
    };
  }

  return {
    type: 'unknown',
    content: 'unrecognized',
    confidence: 0
  };
}