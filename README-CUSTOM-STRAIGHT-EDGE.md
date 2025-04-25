# Custom Straight Edge Implementation

## Overview

This README explains the changes made to fix the issue with the `getStraightPath` function from the @xyflow/svelte package. The problem was that the application was experiencing 500 internal server errors with StraightEdge components.

## Changes Made

We've created a custom implementation of the `getStraightPath` function to replace the one from @xyflow/svelte:

1. Created a new utility file at `src/lib/utils/edgePaths.ts` with our custom implementation
2. Updated `src/lib/components/diagram/edges/StraightEdge.svelte` to use our custom implementation
3. Added tests at `src/lib/utils/edgePaths.test.ts` to ensure the implementation works correctly

## Requirements

To run the project with these changes, you need:

1. **Node.js version 16 or higher** (the current Node.js v6.13.1 is too old)
2. npm version 7 or higher

## How to Upgrade Node.js

### Option 1: Using a Node Version Manager (Recommended)

#### Install nvm (Node Version Manager):

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.5/install.sh | bash
```

#### Install and use a newer Node.js version:

```bash
nvm install 18
nvm use 18
```

### Option 2: Direct installation

Download and install Node.js 18 LTS from: https://nodejs.org/

## Running the Application

After upgrading Node.js, run the application:

```bash
npm install
npm run dev
```

## How the Custom Implementation Works

The custom `getStraightPath` function in `src/lib/utils/edgePaths.ts` creates a simple SVG path string to draw a straight line between two points. It maintains the same API signature as the original function, returning a path string and null values for other path elements, ensuring compatibility with the rest of the @xyflow/svelte package.

```typescript
export function getStraightPath({
  sourceX,
  sourceY,
  targetX,
  targetY,
}: EdgePathParams): [string, null, null, null] {
  // Simple straight line from source to target
  const path = `M ${sourceX},${sourceY} L ${targetX},${targetY}`;

  // Return in the same format as the original function: [path, null, null, null]
  return [path, null, null, null];
}
```

The StraightEdge.svelte component now imports and uses this function instead of the one from @xyflow/svelte.