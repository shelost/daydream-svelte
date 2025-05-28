#!/bin/bash

# Add @ts-nocheck to all TypeScript files
echo "Adding @ts-nocheck to TypeScript files..."
find src -type f -name "*.ts" -exec sed -i '' '1i\
// @ts-nocheck
' {} \;

# Add @ts-nocheck to Svelte files with TypeScript
echo "Adding @ts-nocheck to Svelte files with TypeScript..."
find src -type f -name "*.svelte" -exec grep -l "<script lang=\"ts\">" {} \; | xargs -I {} sed -i '' '/<script lang="ts">/a\
  // @ts-nocheck
' {}

echo "Done adding @ts-nocheck to files."
echo "Now you'll need to manually remove type annotations from files using the guide in TYPESCRIPT_REMOVAL_GUIDE.md"

# Reminder about type imports
echo ""
echo "Remember to update import statements that use 'type' or have type imports:"
echo "For example, change:"
echo "  import type { Something } from './module';"
echo "  import { func, type Another } from './module';"
echo "To:"
echo "  import { func } from './module';"
echo ""

# Run TypeScript in noEmit mode to find remaining issues
echo "Running TypeScript check to find any remaining issues..."
npx tsc --noEmit

echo "Script completed. Check the TypeScript errors above and fix them according to the guide in TYPESCRIPT_REMOVAL_GUIDE.md"