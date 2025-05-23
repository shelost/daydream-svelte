import type { Point } from '$lib/types/drawing';
import type { Stroke as DrawingStroke } from '$lib/types/drawing';
import type { Stroke as AppStroke } from '$lib/types';

// Union type that can handle both types of strokes
type AnyStroke = DrawingStroke | AppStroke;

export interface ShapeMatch {
  type: string;
  confidence: number;
  strokeIds: string[];
  boundingBox?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  // Additional properties for enhanced shape detection
  properties?: {
    isRegular?: boolean;
    aspectRatio?: number;
    corners?: number;
    area?: number;
    perimeter?: number;
  };
}

export interface ShapeRecognitionResult {
  shapes: ShapeMatch[];
  multiStrokeShapes?: ShapeMatch[];
}

/**
 * Detects shapes from a collection of strokes
 * @param strokes Array of strokes to analyze
 * @returns Object containing the detected shapes
 */
export function detectShapes(strokes: AnyStroke[]): ShapeRecognitionResult {
  const shapes: ShapeMatch[] = [];
  const multiStrokeShapes: ShapeMatch[] = [];

  // Skip processing if no strokes provided
  if (!strokes || strokes.length === 0) {
    return { shapes, multiStrokeShapes };
  }

  // Process each stroke individually first
  for (const stroke of strokes) {
    // Skip strokes with too few points
    if (!stroke.points || stroke.points.length < 3) continue;

    // Check if the stroke is a closed shape
    const isClosed = detectClosedShape(stroke.points);

    // Calculate basic properties
    const boundingBox = calculateBoundingBox(stroke.points);
    const perimeter = calculatePerimeter(stroke.points);
    const area = calculateArea(stroke.points);
    const cornerCount = detectCorners(stroke.points);

    // Store common shape properties
    const properties = {
      isRegular: isRegularShape(stroke.points, boundingBox),
      aspectRatio: boundingBox.width > 0 ? boundingBox.height / boundingBox.width : 1,
      corners: cornerCount,
      area,
      perimeter
    };

    // Run all shape tests and collect confidences
    const shapeTests = [
      { type: 'circle', test: testForCircle(stroke.points, isClosed, boundingBox, perimeter, area) },
      { type: 'rectangle', test: testForRectangle(stroke.points, isClosed, boundingBox, perimeter, area) },
      { type: 'triangle', test: testForTriangle(stroke.points, isClosed, boundingBox, perimeter, area) },
      { type: 'line', test: testForLine(stroke.points) },
      { type: 'arrow', test: testForArrow(stroke.points) },
      { type: 'star', test: testForStar(stroke.points, isClosed) }
    ];

    // Find the best match
    shapeTests.sort((a, b) => b.test.confidence - a.test.confidence);
    const bestMatch = shapeTests[0];

    // Only add shapes with reasonable confidence
    if (bestMatch.test.confidence > 0.6) {
      shapes.push({
        type: bestMatch.type,
        confidence: bestMatch.test.confidence,
        strokeIds: [stroke.id],
        boundingBox,
        properties
      });
      continue;
    }

    // If no specific shape is detected with high confidence, but it's a closed shape, classify it
    if (isClosed && bestMatch.test.confidence < 0.6) {
      // Determine if it's an irregular polygon or a freeform shape
      if (cornerCount >= 3) {
        shapes.push({
          type: `polygon-${cornerCount}`,
          confidence: 0.6,
          strokeIds: [stroke.id],
          boundingBox,
          properties
        });
      } else {
        shapes.push({
          type: 'freeform',
          confidence: 0.5,
          strokeIds: [stroke.id],
          boundingBox,
          properties
        });
      }
    }
  }

  // Process potential multi-stroke shapes - if there are strokes close to each other
  if (strokes.length > 1) {
    analyzeMultiStrokeShapes(strokes, multiStrokeShapes);
  }

  return { shapes, multiStrokeShapes };
}

/**
 * Analyzes groups of strokes to detect multi-stroke shapes
 * @param strokes All strokes to analyze
 * @param results Array to store detected multi-stroke shapes
 */
function analyzeMultiStrokeShapes(strokes: AnyStroke[], results: ShapeMatch[]): void {
  // Group strokes by proximity and analyze them as potential composite shapes
  const processed = new Set<string>();

  for (let i = 0; i < strokes.length; i++) {
    if (processed.has(strokes[i].id)) continue;

    const closeStrokes = findCloseStrokes(strokes, strokes[i]);

    // If we found a meaningful group of strokes
    if (closeStrokes.length > 1) {
      // Mark all as processed
      closeStrokes.forEach(s => processed.add(s.id));

      // Analyze the group
      const allPoints = closeStrokes.flatMap(s => s.points);
      const boundingBox = calculateBoundingBox(allPoints);

      // Test for specific multi-stroke patterns
      // This is where you'd implement detection for shapes like rectangles with separate lines, etc.

      results.push({
        type: 'multi-stroke-shape',
        confidence: 0.6,
        strokeIds: closeStrokes.map(s => s.id),
        boundingBox
      });
    } else {
      // If no group was formed, mark this stroke as processed
      processed.add(strokes[i].id);
    }
  }
}

/**
 * Finds strokes that are close to the reference stroke
 * @param allStrokes All strokes to check
 * @param refStroke Reference stroke to check distance from
 * @returns Array of close strokes
 */
function findCloseStrokes(allStrokes: AnyStroke[], refStroke: AnyStroke): AnyStroke[] {
  const proximityThreshold = 20; // Pixel distance threshold
  const result: AnyStroke[] = [refStroke]; // Include the reference stroke

  const refBoundingBox = calculateBoundingBox(refStroke.points);

  for (const stroke of allStrokes) {
    if (stroke.id === refStroke.id) continue;

    const strokeBoundingBox = calculateBoundingBox(stroke.points);

    // Calculate distance between bounding boxes
    const distance = calculateBoundingBoxDistance(refBoundingBox, strokeBoundingBox);

    if (distance <= proximityThreshold) {
      result.push(stroke);
    }
  }

  return result;
}

/**
 * Calculates distance between two bounding boxes
 */
function calculateBoundingBoxDistance(box1: any, box2: any): number {
  // Calculate the centers of each box
  const center1 = {
    x: box1.x + box1.width / 2,
    y: box1.y + box1.height / 2
  };

  const center2 = {
    x: box2.x + box2.width / 2,
    y: box2.y + box2.height / 2
  };

  // Return the Euclidean distance between centers
  return Math.sqrt(
    Math.pow(center2.x - center1.x, 2) +
    Math.pow(center2.y - center1.y, 2)
  );
}

/**
 * Detects if a stroke forms a closed shape
 * @param points Array of points in the stroke
 * @returns Boolean indicating if the shape is closed
 */
function detectClosedShape(points: Point[]): boolean {
  if (points.length < 4) return false;

  const firstPoint = points[0];
  const lastPoint = points[points.length - 1];

  // Calculate distance between first and last point
  const distance = Math.sqrt(
    Math.pow(lastPoint.x - firstPoint.x, 2) +
    Math.pow(lastPoint.y - firstPoint.y, 2)
  );

  // Calculate average stroke width as a threshold
  let totalDistance = 0;
  for (let i = 1; i < points.length; i++) {
    totalDistance += Math.sqrt(
      Math.pow(points[i].x - points[i-1].x, 2) +
      Math.pow(points[i].y - points[i-1].y, 2)
    );
  }
  const averageSegment = totalDistance / (points.length - 1);
  const threshold = Math.max(20, averageSegment * 2); // Adjust as needed

  return distance < threshold;
}

/**
 * Calculates the bounding box of a stroke
 * @param points Array of points in the stroke
 * @returns The bounding box
 */
function calculateBoundingBox(points: Point[]) {
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

  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY
  };
}

/**
 * Calculates the perimeter of a shape
 * @param points Array of points in the shape
 * @returns The perimeter length
 */
function calculatePerimeter(points: Point[]): number {
  let perimeter = 0;

  for (let i = 1; i < points.length; i++) {
    perimeter += Math.sqrt(
      Math.pow(points[i].x - points[i-1].x, 2) +
      Math.pow(points[i].y - points[i-1].y, 2)
    );
  }

  // Add the distance from last point to first point to close the shape
  perimeter += Math.sqrt(
    Math.pow(points[0].x - points[points.length-1].x, 2) +
    Math.pow(points[0].y - points[points.length-1].y, 2)
  );

  return perimeter;
}

/**
 * Calculates the approximate area of a shape
 * @param points Array of points in the shape
 * @returns The area
 */
function calculateArea(points: Point[]): number {
  let area = 0;

  // Shoelace formula for polygon area
  for (let i = 0; i < points.length; i++) {
    const j = (i + 1) % points.length;
    area += points[i].x * points[j].y;
    area -= points[j].x * points[i].y;
  }

  return Math.abs(area / 2);
}

/**
 * Determines if a shape appears to be regular (consistent angles, etc.)
 */
function isRegularShape(points: Point[], boundingBox: any): boolean {
  // A shape is regular if it has consistent angles and sides
  // This is a simplified check based on aspect ratio and corner distribution

  const aspectRatio = boundingBox.height / boundingBox.width;

  // If nearly square, it could be a regular shape
  if (aspectRatio > 0.9 && aspectRatio < 1.1) {
    return true;
  }

  // More sophisticated check would analyze angle distributions
  // and side lengths, but this is a good starting point
  return false;
}

/**
 * Tests if the stroke forms a circle
 */
function testForCircle(
  points: Point[],
  isClosed: boolean,
  boundingBox: { width: number; height: number; },
  perimeter: number,
  area: number
): { confidence: number } {
  if (!isClosed) return { confidence: 0 };

  // A perfect circle has width = height and perimeter = 2 * PI * radius
  const aspectRatio = Math.min(boundingBox.width, boundingBox.height) /
                      Math.max(boundingBox.width, boundingBox.height);

  // Expected perimeter for a circle with this area
  const radius = Math.sqrt(area / Math.PI);
  const expectedPerimeter = 2 * Math.PI * radius;
  const perimeterRatio = Math.min(perimeter, expectedPerimeter) /
                        Math.max(perimeter, expectedPerimeter);

  // Combine the metrics for final confidence
  const confidence = (aspectRatio * 0.6) + (perimeterRatio * 0.4);

  return { confidence };
}

/**
 * Tests if the stroke forms a rectangle
 */
function testForRectangle(
  points: Point[],
  isClosed: boolean,
  boundingBox: { width: number; height: number; },
  perimeter: number,
  area: number
): { confidence: number } {
  if (!isClosed) return { confidence: 0 };

  // Check if the stroke forms a quadrilateral
  const cornerCount = detectCorners(points);

  // Rectangles should have 4 corners, but allow some flexibility
  // If cornerCount is not close to 4, it's unlikely to be a rectangle
  if (cornerCount < 3 || cornerCount > 6) return { confidence: 0.2 };

  // Strong signal for rectangle: 4 corners exactly
  const cornerScore = cornerCount === 4 ? 1.0 :
                      cornerCount === 3 ? 0.8 :
                      cornerCount === 5 ? 0.8 : 0.6;

  // For a perfect rectangle:
  // 1. Area should be close to width * height
  // 2. Perimeter should be close to 2 * (width + height)
  const expectedArea = boundingBox.width * boundingBox.height;
  const expectedPerimeter = 2 * (boundingBox.width + boundingBox.height);

  const areaRatio = Math.min(area, expectedArea) / Math.max(area, expectedArea);
  const perimeterRatio = Math.min(perimeter, expectedPerimeter) / Math.max(perimeter, expectedPerimeter);

  // Improved rectangle detection
  // High area fill ratio is a strong indicator of a rectangle
  if (areaRatio > 0.85) {
    // Weighted confidence with more emphasis on area ratio
    const confidence = (areaRatio * 0.6) + (perimeterRatio * 0.2) + (cornerScore * 0.2);
    return { confidence: confidence * 1.1 }; // Boost rectangular shapes
  }

  // Standard weighted confidence
  const confidence = (areaRatio * 0.4) + (perimeterRatio * 0.3) + (cornerScore * 0.3);
  return { confidence };
}

/**
 * Detects the number of corners in a shape
 */
function detectCorners(points: Point[]): number {
  if (points.length < 3) return 0;

  // Simple corner detection using angle changes
  const angleThreshold = 0.5; // Radians, ~30 degrees
  let corners = 0;

  // Skip some points for smoother corner detection
  const skip = Math.max(1, Math.floor(points.length / 50));

  for (let i = skip; i < points.length - skip; i += skip) {
    const prev = points[i - skip];
    const curr = points[i];
    const next = points[i + skip];

    // Calculate vectors
    const vec1 = { x: curr.x - prev.x, y: curr.y - prev.y };
    const vec2 = { x: next.x - curr.x, y: next.y - curr.y };

    // Normalize
    const len1 = Math.sqrt(vec1.x * vec1.x + vec1.y * vec1.y);
    const len2 = Math.sqrt(vec2.x * vec2.x + vec2.y * vec2.y);

    if (len1 > 0 && len2 > 0) {
      vec1.x /= len1;
      vec1.y /= len1;
      vec2.x /= len2;
      vec2.y /= len2;

      // Dot product
      const dot = vec1.x * vec2.x + vec1.y * vec2.y;
      // Clamp to avoid floating point errors
      const clampedDot = Math.max(-1, Math.min(1, dot));
      const angle = Math.acos(clampedDot);

      if (angle > angleThreshold) {
        corners++;
      }
    }
  }

  return corners;
}

/**
 * Tests if the stroke forms a triangle
 */
function testForTriangle(
  points: Point[],
  isClosed: boolean,
  boundingBox: { width: number; height: number; },
  perimeter: number,
  area: number
): { confidence: number } {
  if (!isClosed) return { confidence: 0 };

  // Check for three distinct corners - this is critical for triangles
  const cornerCount = detectCorners(points);

  // Strong signal for triangles: exactly 3 corners
  // If cornerCount is not close to 3, it's unlikely to be a triangle
  if (cornerCount < 2 || cornerCount > 4) return { confidence: 0.2 };

  // Triangles should have exactly 3 corners - this is a strong signal
  const cornerScore = cornerCount === 3 ? 1.0 : cornerCount === 2 ? 0.7 : cornerCount === 4 ? 0.6 : 0.3;

  // For triangles, area is approximately half the bounding box area
  const expectedAreaRatio = 0.5; // Triangles typically occupy half their bounding box
  const boxArea = boundingBox.width * boundingBox.height;
  const actualAreaRatio = area / boxArea;

  // How close is the actual area ratio to the expected 0.5
  const areaRatioScore = 1 - Math.min(1, Math.abs(actualAreaRatio - expectedAreaRatio) * 2);

  // Improved triangle detection
  // Combine corner count, area ratio, and closure
  const confidence = (cornerScore * 0.6) + (areaRatioScore * 0.4);

  // If it's a very close match to the ideal triangle shape, boost confidence
  if (cornerCount === 3 && areaRatioScore > 0.8) {
    return { confidence: confidence * 1.1 };
  }

  return { confidence };
}

/**
 * Tests if the stroke forms a line
 */
function testForLine(points: Point[] | { points: Point[] }): { confidence: number } {
  // Handle both raw points array and object with points property
  const pointsArray = Array.isArray(points) ? points : points.points;

  if (!pointsArray || pointsArray.length < 2) return { confidence: 0 };

  // For a line, we need at least two points
  // If there are just two points, it's definitely a line
  if (pointsArray.length === 2) return { confidence: 1.0 };

  // For a line, the points should all be close to the line connecting
  // the first and last points
  const start = pointsArray[0];
  const end = pointsArray[pointsArray.length - 1];

  // Calculate line length
  const lineLength = Math.sqrt(
    Math.pow(end.x - start.x, 2) +
    Math.pow(end.y - start.y, 2)
  );

  // If it's too short, it might not be an intentional line
  if (lineLength < 10) return { confidence: 0.3 };

  // Calculate the average deviation from the line
  let totalDeviation = 0;
  let maxDeviation = 0;

  for (const point of pointsArray) {
    // Calculate point's deviation from the line
    const deviation = pointToLineDistance(point, start, end);
    totalDeviation += deviation;
    maxDeviation = Math.max(maxDeviation, deviation);
  }

  const avgDeviation = totalDeviation / pointsArray.length;

  // Normalize deviations relative to line length
  const normalizedAvgDeviation = avgDeviation / lineLength;
  const normalizedMaxDeviation = maxDeviation / lineLength;

  // Line confidence is higher when:
  // 1. Average deviation is low
  // 2. Maximum deviation is low
  // 3. The line is reasonably long

  // Base confidence on average deviation
  let confidence = Math.max(0, 1 - normalizedAvgDeviation * 15);

  // Reduce confidence if maximum deviation is high
  if (normalizedMaxDeviation > 0.3) {
    confidence *= 0.7;
  }

  // Boost confidence for longer lines (they're more intentional)
  if (lineLength > 50) {
    confidence = Math.min(1, confidence * 1.2);
  }

  return { confidence };
}

/**
 * Calculate the distance from a point to a line segment
 */
function pointToLineDistance(point: Point, lineStart: Point, lineEnd: Point): number {
  const dx = lineEnd.x - lineStart.x;
  const dy = lineEnd.y - lineStart.y;

  // If it's a point, not a line
  if (dx === 0 && dy === 0) {
    return Math.sqrt(
      Math.pow(point.x - lineStart.x, 2) +
      Math.pow(point.y - lineStart.y, 2)
    );
  }

  // Calculate projection
  const t = ((point.x - lineStart.x) * dx + (point.y - lineStart.y) * dy) /
            (dx * dx + dy * dy);

  // Check if projection is on the line segment
  if (t < 0) {
    return Math.sqrt(
      Math.pow(point.x - lineStart.x, 2) +
      Math.pow(point.y - lineStart.y, 2)
    );
  }
  if (t > 1) {
    return Math.sqrt(
      Math.pow(point.x - lineEnd.x, 2) +
      Math.pow(point.y - lineEnd.y, 2)
    );
  }

  // If on the line, calculate perpendicular distance
  const projX = lineStart.x + t * dx;
  const projY = lineStart.y + t * dy;

  return Math.sqrt(
    Math.pow(point.x - projX, 2) +
    Math.pow(point.y - projY, 2)
  );
}

/**
 * Tests if the stroke forms an arrow
 */
function testForArrow(points: Point[] | { points: Point[] }): { confidence: number } {
  // Handle both raw points array and object with points property
  const pointsArray = Array.isArray(points) ? points : points.points;

  if (!pointsArray || pointsArray.length < 5) return { confidence: 0 };

  // Arrows have several key features:
  // 1. A mostly straight shaft
  // 2. An arrowhead with direction changes at one end

  // First check for a shaft - we should have a substantial part of the stroke that is line-like
  // Use a subset of points for the shaft test (first 75% of points)
  const shaftEndIndex = Math.floor(pointsArray.length * 0.75);
  const shaftPoints = pointsArray.slice(0, shaftEndIndex);

  // If the shaft is too short, it's unlikely to be an arrow
  if (shaftPoints.length < 3) return { confidence: 0.2 };

  const lineResult = testForLine(shaftPoints);

  // If the shaft isn't reasonably straight, it's probably not an arrow
  if (lineResult.confidence < 0.6) return { confidence: lineResult.confidence * 0.3 };

  // Now check for the arrowhead at the end
  // The last 25-40% of points should contain direction changes
  const headPoints = pointsArray.slice(Math.max(0, pointsArray.length - Math.floor(pointsArray.length * 0.4)));

  // For an arrowhead, we need direction changes
  const directionChanges = countDirectionChanges(headPoints);

  // Calculate shaft length - we want arrows to have a substantial shaft
  const shaftStart = pointsArray[0];
  const shaftEnd = pointsArray[shaftEndIndex - 1];
  const shaftLength = Math.sqrt(
    Math.pow(shaftEnd.x - shaftStart.x, 2) +
    Math.pow(shaftEnd.y - shaftStart.y, 2)
  );

  // Arrows with longer shafts are more likely to be intentional
  const shaftScore = Math.min(1, shaftLength / 50);

  // There should be at least one significant direction change in the arrowhead
  const headScore = directionChanges >= 2 ? 1.0 :
                    directionChanges === 1 ? 0.7 : 0.2;

  // Combine scores
  let confidence = (lineResult.confidence * 0.5) + (headScore * 0.3) + (shaftScore * 0.2);

  // Boost confidence if we have several classic arrow features
  if (directionChanges >= 2 && lineResult.confidence > 0.7 && shaftLength > 30) {
    confidence = Math.min(1, confidence * 1.2);
  }

  return { confidence };
}

/**
 * Count the number of significant direction changes in a set of points
 */
function countDirectionChanges(points: Point[]): number {
  if (points.length < 4) return 0;

  let changes = 0;
  const threshold = 0.7; // Cosine threshold for direction change (about 45 degrees)

  // Use a window to smooth out noise
  const window = Math.max(2, Math.floor(points.length / 8));

  for (let i = window; i < points.length - window; i += window) {
    // Calculate direction before this point
    const prevDirection = {
      x: points[i].x - points[i - window].x,
      y: points[i].y - points[i - window].y
    };

    // Calculate direction after this point
    const nextDirection = {
      x: points[i + window].x - points[i].x,
      y: points[i + window].y - points[i].y
    };

    // Normalize vectors
    const prevLength = Math.sqrt(prevDirection.x * prevDirection.x + prevDirection.y * prevDirection.y);
    const nextLength = Math.sqrt(nextDirection.x * nextDirection.x + nextDirection.y * nextDirection.y);

    if (prevLength > 0 && nextLength > 0) {
      prevDirection.x /= prevLength;
      prevDirection.y /= prevLength;
      nextDirection.x /= nextLength;
      nextDirection.y /= nextLength;

      // Calculate dot product
      const dot = prevDirection.x * nextDirection.x + prevDirection.y * nextDirection.y;

      // If dot product is below threshold, we have a direction change
      if (dot < threshold) {
        changes++;
      }
    }
  }

  return changes;
}

/**
 * Tests if the stroke forms a star
 */
function testForStar(points: Point[], isClosed: boolean): { confidence: number } {
  // For a star, we expect:
  // 1. A relatively high number of sharp corners (5+ for a typical star)
  // 2. A geometric pattern of these corners

  // First, get corner count
  const cornerCount = detectCorners(points);

  // Stars typically have 5 or more corners
  if (cornerCount < 4) return { confidence: 0 };

  // Check if the corners form a symmetric pattern
  // This would be a complex algorithm, so we'll use a simpler heuristic

  // For now, base confidence on corner count and shape closure
  let confidence = 0;

  // 5-pointed star is classic
  if (cornerCount >= 5 && cornerCount <= 12) {
    confidence = 0.6;
  } else if (cornerCount > 12) {
    confidence = 0.4; // Too many corners for a typical star
  } else {
    confidence = 0.3; // Few corners for a star
  }

  // Stars are usually closed shapes
  if (isClosed) {
    confidence += 0.2;
  }

  return { confidence };
}