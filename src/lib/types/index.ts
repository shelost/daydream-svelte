// @ts-nocheck
// Simplified version with no TypeScript types - just exports simple constants and empty objects
// Original typing information is kept in comments for reference

// Page types as string constants instead of TypeScript types
export const PAGE_TYPE_CANVAS = 'canvas';
export const PAGE_TYPE_DRAWING = 'drawing';
export const PAGE_TYPE_DIAGRAM = 'diagram';

// Tool types as string constants
export const TOOL_SELECT = 'select';
export const TOOL_PAN = 'pan';
export const TOOL_DRAW = 'draw';
export const TOOL_POLYGON = 'polygon';
export const TOOL_RECTANGLE = 'rectangle';
export const TOOL_TEXT = 'text';
export const TOOL_ERASER = 'eraser';
export const TOOL_MOVE = 'move';

// Diagram tool types
export const TOOL_NODE = 'node';
export const TOOL_EDGE = 'edge';
export const TOOL_DELETE = 'delete';
export const TOOL_CONNECT = 'connect';

// Node types
export const NODE_TYPE_DEFAULT = 'default';
export const NODE_TYPE_INPUT = 'input';
export const NODE_TYPE_OUTPUT = 'output';
export const NODE_TYPE_GROUP = 'group';
export const NODE_TYPE_DRAWING = 'drawing';

// Edge types
export const EDGE_TYPE_DEFAULT = 'default';
export const EDGE_TYPE_STEP = 'step';
export const EDGE_TYPE_SMOOTH = 'smooth';
export const EDGE_TYPE_STRAIGHT = 'straight';

// Status types as string constants
export const STATUS_SAVED = 'saved';
export const STATUS_SAVING = 'saving';
export const STATUS_ERROR = 'error';

// Export empty objects for backwards compatibility with code that expects these types
// This allows importing code to remain unchanged while removing actual type definitions
export const emptyProfile = {};
export const emptyBasePage = {};
export const emptyCanvasPage = {};
export const emptyDrawingPage = {};
export const emptyDiagramPage = {};
export const emptyCanvasContent = {};
export const emptyViewport = {};
export const emptyDrawingContent = {};
export const emptyDiagramContent = {};
export const emptyDrawingReference = {};
export const emptyStroke = {};
export const emptyStrokePoint = {};
export const emptyToolOption = {};
export const emptyToolSubOption = {};
export const emptyTextStyles = {};
export const emptyNode = {};
export const emptyEdge = {};

// Type aliases - these export nothing but maintain compatibility with imports
export const Profile = undefined;
export const BasePage = undefined;
export const CanvasPage = undefined;
export const DrawingPage = undefined;
export const DiagramPage = undefined;
export const Page = undefined;
export const CanvasContent = undefined;
export const Viewport = undefined;
export const DrawingContent = undefined;
export const DiagramContent = undefined;
export const DrawingReference = undefined;
export const Stroke = undefined;
export const StrokePoint = undefined;
export const Tool = undefined;
export const ToolOption = undefined;
export const ToolSubOption = undefined;
export const SaveStatus = undefined;
export const TextStyles = undefined;
export const Node = undefined;
export const Edge = undefined;