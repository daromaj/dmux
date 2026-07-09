#!/usr/bin/env node
/**
 * Generate AGENTS.md documentation from TypeScript types
 *
 * This script extracts hook types, environment variables, and generates
 * comprehensive documentation that gets embedded in the qmux binary.
 */

import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = join(__dirname, '..');

// Read the hooks.ts file to extract types
const hooksFile = join(projectRoot, 'src/utils/hooks.ts');
const hooksContent = readFileSync(hooksFile, 'utf-8');

// Extract hook types
const hookTypesMatch = hooksContent.match(/export type HookType =\s*\|([\s\S]*?);/);
const hookTypes = hookTypesMatch
  ? hookTypesMatch[1]
      .split('|')
      .map(t => t.trim().replace(/['"]/g, ''))
      .filter(Boolean)
  : [];

console.log(`📋 Found ${hookTypes.length} hook types`);

// Generate AGENTS.md content
const agentsMd = `# qmux Hooks System - Agent Reference

**Auto-generated documentation for AI agents**

This document contains everything an AI agent needs to create, modify, and understand qmux hooks. It is automatically generated from the qmux source code and embedded in the binary.

## What You're Working On

You are editing hooks for **qmux**, a tmux pane manager that creates AI-powered development workflows. Each pane runs in its own git worktree with an AI agent.

## Your Goal

Create executable bash scripts in \`.qmux-hooks/\` that run automatically at key lifecycle events.

## Quick Start

1. **Create a hook file**: \`touch .qmux-hooks/worktree_created\`
2. **Make it executable**: \`chmod +x .qmux-hooks/worktree_created\`
3. **Add shebang**: Start with \`#!/bin/bash\`
4. **Use environment variables**: Access \`$QMUX_ROOT\`, \`$QMUX_WORKTREE_PATH\`, etc.
5. **Test it**: Set env vars manually and run the script

## Hook Execution Model

- **Mostly non-blocking**: Most hooks run in background (detached processes)
- **Bootstrap-gated**: \`worktree_created\` blocks agent launch so setup can finish first, with no fixed timeout
- **Live bootstrap output**: During \`worktree_created\`, stdout/stderr is streamed into the new pane's setup UI
- **Failure behavior**: Background hook errors are logged; gated hooks can abort the operation
- **Environment-based**: All context passed via environment variables
- **Version controlled**: Hooks in \`.qmux-hooks/\` are shared with team
- **Priority resolution**: \`.qmux-hooks/\` → \`.qmux/hooks/\` → \`~/.qmux/hooks/\`

## Available Hooks

${generateHooksTable()}

## Environment Variables

### Always Available
\`\`\`bash
QMUX_ROOT="/path/to/project"           # Project root directory
QMUX_SERVER_PORT="3142"                # HTTP server port
\`\`\`

### Pane Context (most hooks)
\`\`\`bash
QMUX_PANE_ID="qmux-1234567890"         # qmux pane identifier
QMUX_SLUG="fix-auth-bug"               # Branch/worktree name
QMUX_PROMPT="Fix authentication bug"   # User's prompt
QMUX_AGENT="claude"                    # Agent type (registry id, e.g. claude, codex, opencode)
QMUX_TMUX_PANE_ID="%38"                # tmux pane ID
\`\`\`

### Worktree Context
\`\`\`bash
QMUX_WORKTREE_PATH="/path/.qmux/worktrees/fix-auth-bug"
QMUX_BRANCH="fix-auth-bug"             # Same as slug
\`\`\`

### Bootstrap Progress Context
\`\`\`bash
QMUX_PROGRESS="1"                      # Set when output is shown in the new pane setup UI
QMUX_STATUS_PREFIX="QMUX_STATUS:"      # Prefix for clean status messages
\`\`\`

\`worktree_created\` can emit progress while it runs. Any stdout/stderr line is shown in the setup UI; lines prefixed with \`$QMUX_STATUS_PREFIX\` are displayed without the prefix.

\`\`\`bash
status() {
  if [ "\${QMUX_PROGRESS:-0}" = "1" ]; then
    echo "\${QMUX_STATUS_PREFIX:-QMUX_STATUS:} $*"
  else
    echo "[Hook] $*"
  fi
}
\`\`\`

### Merge Context
\`\`\`bash
QMUX_TARGET_BRANCH="main"              # Branch being merged into
\`\`\`

## HTTP Callback API

Interactive hooks (\`run_test\` and \`run_dev\`) can update qmux UI via HTTP.

### Update Test Status
\`\`\`bash
curl -X PUT "http://localhost:$QMUX_SERVER_PORT/api/panes/$QMUX_PANE_ID/test" \\
  -H "Content-Type: application/json" \\
  -d '{"status": "running", "output": "optional test output"}'

# Status values: "running" | "passed" | "failed"
\`\`\`

### Update Dev Server
\`\`\`bash
curl -X PUT "http://localhost:$QMUX_SERVER_PORT/api/panes/$QMUX_PANE_ID/dev" \\
  -H "Content-Type: application/json" \\
  -d '{"status": "running", "url": "http://localhost:3000"}'

# Status values: "running" | "stopped"
# url: Can be localhost or tunnel URL (ngrok, cloudflared, etc.)
\`\`\`

## Common Patterns

### Pattern 1: Install Dependencies
\`\`\`bash
#!/bin/bash
# .qmux-hooks/worktree_created

cd "$QMUX_WORKTREE_PATH"

status() {
  if [ "\${QMUX_PROGRESS:-0}" = "1" ]; then
    echo "\${QMUX_STATUS_PREFIX:-QMUX_STATUS:} $*"
  else
    echo "[Hook] $*"
  fi
}

if [ -f "pnpm-lock.yaml" ]; then
  status "Installing dependencies with pnpm"
  pnpm install --prefer-offline
elif [ -f "package-lock.json" ]; then
  status "Installing dependencies with npm"
  npm install
elif [ -f "yarn.lock" ]; then
  status "Installing dependencies with yarn"
  yarn install
elif [ -f "Gemfile" ]; then
  status "Installing gems"
  bundle install
elif [ -f "requirements.txt" ]; then
  status "Installing Python dependencies"
  pip install -r requirements.txt
elif [ -f "Cargo.toml" ]; then
  status "Building Rust project"
  cargo build
fi
\`\`\`

### Pattern 2: Copy Configuration
\`\`\`bash
#!/bin/bash
# .qmux-hooks/worktree_created

# Copy environment file
if [ -f "$QMUX_ROOT/.env.local" ]; then
  cp "$QMUX_ROOT/.env.local" "$QMUX_WORKTREE_PATH/.env.local"
fi

# Copy other config files
for file in .env.development .npmrc .yarnrc; do
  if [ -f "$QMUX_ROOT/$file" ]; then
    cp "$QMUX_ROOT/$file" "$QMUX_WORKTREE_PATH/$file"
  fi
done
\`\`\`

### Pattern 3: Run Tests with Status Updates
\`\`\`bash
#!/bin/bash
# .qmux-hooks/run_test

set -e
cd "$QMUX_WORKTREE_PATH"
API="http://localhost:$QMUX_SERVER_PORT/api/panes/$QMUX_PANE_ID/test"

# Update: starting
curl -s -X PUT "$API" -H "Content-Type: application/json" \\
  -d '{"status": "running"}' > /dev/null

# Run tests and capture output
OUTPUT_FILE="/tmp/qmux-test-$QMUX_PANE_ID.txt"
if pnpm test > "$OUTPUT_FILE" 2>&1; then
  STATUS="passed"
else
  STATUS="failed"
fi

# Get output (truncate if too long)
OUTPUT=$(head -c 5000 "$OUTPUT_FILE")

# Update: complete
curl -s -X PUT "$API" -H "Content-Type: application/json" \\
  -d "$(jq -n --arg status "$STATUS" --arg output "$OUTPUT" \\
    '{status: $status, output: $output}')" > /dev/null

rm -f "$OUTPUT_FILE"
\`\`\`

### Pattern 4: Dev Server with Tunnel
\`\`\`bash
#!/bin/bash
# .qmux-hooks/run_dev

set -e
cd "$QMUX_WORKTREE_PATH"
API="http://localhost:$QMUX_SERVER_PORT/api/panes/$QMUX_PANE_ID/dev"

# Start dev server in background
LOG_FILE="/tmp/qmux-dev-$QMUX_PANE_ID.log"
pnpm dev > "$LOG_FILE" 2>&1 &
DEV_PID=$!

# Wait for server to start
sleep 5

# Detect port from logs
PORT=$(grep -oP 'localhost:\\K\\d+' "$LOG_FILE" | head -1)
[ -z "$PORT" ] && PORT=3000

# Optional: Create tunnel with cloudflared
if command -v cloudflared &> /dev/null; then
  TUNNEL=$(cloudflared tunnel --url "http://localhost:$PORT" 2>&1 | \\
    grep -oP 'https://[a-z0-9-]+\\.trycloudflare\\.com' | head -1)
  URL="\${TUNNEL:-http://localhost:$PORT}"
else
  URL="http://localhost:$PORT"
fi

# Report status
curl -s -X PUT "$API" -H "Content-Type: application/json" \\
  -d "{\\"status\\": \\"running\\", \\"url\\": \\"$URL\\"}" > /dev/null

echo "[Hook] Dev server running at $URL (PID: $DEV_PID)"
\`\`\`

### Pattern 5: Post-Merge Deployment
\`\`\`bash
#!/bin/bash
# .qmux-hooks/post_merge

set -e
cd "$QMUX_ROOT"

# Only deploy from main/master
if [ "$QMUX_TARGET_BRANCH" != "main" ] && [ "$QMUX_TARGET_BRANCH" != "master" ]; then
  exit 0
fi

# Push to remote
git push origin "$QMUX_TARGET_BRANCH"

# Trigger deployment (example: Vercel)
if [ -n "$VERCEL_TOKEN" ]; then
  curl -s -X POST "https://api.vercel.com/v1/deployments" \\
    -H "Authorization: Bearer $VERCEL_TOKEN" \\
    -H "Content-Type: application/json" \\
    -d '{"name": "my-project"}' > /dev/null
fi

# Close GitHub issue if prompt contains #123
ISSUE=$(echo "$QMUX_PROMPT" | grep -oP '#\\K\\d+' | head -1)
if [ -n "$ISSUE" ] && command -v gh &> /dev/null; then
  gh issue close "$ISSUE" \\
    -c "Resolved in $QMUX_SLUG, merged to $QMUX_TARGET_BRANCH" \\
    2>/dev/null || true
fi
\`\`\`

## Best Practices

1. **Always start with shebang**: \`#!/bin/bash\`
2. **Set error handling**: \`set -e\` (exit on error)
3. **Make executable**: \`chmod +x .qmux-hooks/hook_name\`
4. **Background long operations**: Append \`&\` to avoid blocking
5. **Check for required tools**: \`command -v tool &> /dev/null\`
6. **Log for debugging**: \`echo "[Hook] message" >> "$QMUX_ROOT/.qmux/hooks.log"\`
7. **Handle missing vars gracefully**: \`[ -z "$VAR" ] && exit 0\`
8. **Use silent curl**: \`curl -s\` to avoid noise in logs
9. **Clean up temp files**: Remove files in \`/tmp/\`
10. **Test before committing**: Run hooks manually with mock env vars

## Testing Hooks

### Manual Testing
\`\`\`bash
# 1. Set environment variables
export QMUX_ROOT="$(pwd)"
export QMUX_PANE_ID="test-pane"
export QMUX_SLUG="test-branch"
export QMUX_WORKTREE_PATH="$(pwd)"
export QMUX_SERVER_PORT="3142"
export QMUX_AGENT="claude"
export QMUX_PROMPT="Test prompt"

# 2. Run hook directly
./.qmux-hooks/worktree_created

# 3. Check exit code
echo $?  # Should be 0 for success
\`\`\`

### Syntax Check
\`\`\`bash
# Check for syntax errors without running
bash -n ./.qmux-hooks/worktree_created
\`\`\`

### Shellcheck (if available)
\`\`\`bash
shellcheck ./.qmux-hooks/worktree_created
\`\`\`

## Project Context Analysis

Before creating hooks, analyze these files in the project:

### Package Manager Detection
\`\`\`bash
# Check which package manager is used
if [ -f "pnpm-lock.yaml" ]; then
  # Use: pnpm install, pnpm test, pnpm dev
elif [ -f "package-lock.json" ]; then
  # Use: npm install, npm test, npm run dev
elif [ -f "yarn.lock" ]; then
  # Use: yarn install, yarn test, yarn dev
fi
\`\`\`

### Test Command Discovery
\`\`\`bash
# Read package.json to find test command
cat package.json | grep '"test"'
# Or with jq:
jq -r '.scripts.test' package.json
\`\`\`

### Dev Command Discovery
\`\`\`bash
# Read package.json to find dev command
cat package.json | grep '"dev"'
# Or with jq:
jq -r '.scripts.dev' package.json
\`\`\`

### Environment Variables
\`\`\`bash
# Check for .env files to copy
ls -la | grep '\\.env'
\`\`\`

### Build System
\`\`\`bash
# Detect build system
if [ -f "vite.config.ts" ]; then
  # Vite project
elif [ -f "next.config.js" ]; then
  # Next.js project
elif [ -f "nuxt.config.ts" ]; then
  # Nuxt project
fi
\`\`\`

## Common Mistakes to Avoid

❌ **Blocking operations**: \`sleep 60\` (blocks qmux)
✅ **Background long tasks**: \`slow_operation &\`

❌ **Hardcoded paths**: \`/Users/me/project\`
✅ **Use variables**: \`"$QMUX_ROOT"\`

❌ **Assuming tools exist**: \`pnpm install\`
✅ **Check first**: \`command -v pnpm && pnpm install\`

❌ **No error handling**: Script fails silently
✅ **Set error mode**: \`set -e\` or check exit codes

❌ **Forgetting executable bit**: Hook won't run
✅ **Make executable**: \`chmod +x\`

❌ **Noisy output**: Clutters qmux logs
✅ **Silent operations**: \`curl -s\`, \`> /dev/null 2>&1\`

❌ **Not testing**: Deploy and hope
✅ **Test manually**: Run with mock env vars first

## Debugging

If a hook isn't working:

1. **Check if file exists**: \`ls -la .qmux-hooks/\`
2. **Check permissions**: Should show \`x\` in \`rwxr-xr-x\`
3. **Check syntax**: \`bash -n .qmux-hooks/hook_name\`
4. **Test manually**: Set env vars and run
5. **Check logs**: qmux logs to stderr with \`[Hooks]\` prefix
6. **Simplify**: Remove complex parts, test basic version
7. **Check tool availability**: \`command -v required_tool\`

### Debug Mode
\`\`\`bash
#!/bin/bash
# Add to top of hook for debugging
set -x  # Print each command before executing
set -e  # Exit on error

# Your hook logic here
\`\`\`

## Summary Checklist

When creating a new hook:

- [ ] Create file in \`.qmux-hooks/\`
- [ ] Add shebang: \`#!/bin/bash\`
- [ ] Make executable: \`chmod +x\`
- [ ] Add \`set -e\` for error handling
- [ ] Use environment variables (never hardcode paths)
- [ ] Keep blocking hooks chatty with status output
- [ ] Background long operations with \`&\` only when the hook does not gate the operation
- [ ] Check for required tools before using
- [ ] Test manually with mock env vars
- [ ] Add comments explaining what it does
- [ ] Commit to version control

## Getting Help

- **Full documentation**: See \`HOOKS.md\` in project root
- **Claude-specific tips**: See \`CLAUDE.md\` in \`.qmux-hooks/\`
- **Examples**: Check \`.qmux-hooks/examples/\` directory
- **qmux API**: See \`API.md\` for REST endpoints

---

*This documentation was auto-generated from qmux source code.*
*Version: ${new Date().toISOString().split('T')[0]}*
`;

// Write the generated markdown
const outputPath = join(projectRoot, 'src/utils/generated-agents-doc.ts');
const tsContent = `/**
 * Auto-generated AGENTS.md content
 * DO NOT EDIT MANUALLY - run 'pnpm generate:hooks-docs' to regenerate
 */

export const AGENTS_MD = \`${agentsMd.replace(/`/g, '\\`').replace(/\$\{/g, '\\${')}\`;
`;

writeFileSync(outputPath, tsContent);

console.log('✅ Generated AGENTS.md content');
console.log(`📝 Written to: ${outputPath}`);
console.log(`📦 ${agentsMd.length} characters`);

function generateHooksTable() {
  const hookDescriptions = {
    before_pane_create: ['Before pane creation', 'Validation, notifications, pre-flight checks'],
    pane_created: ['After pane, before worktree', 'Configure tmux settings, prepare environment'],
    worktree_created: ['After worktree creation, before agent launch', 'Install deps, copy configs, setup git'],
    before_pane_close: ['Before closing', 'Save state, backup uncommitted work'],
    pane_closed: ['After closed', 'Cleanup resources, analytics, notifications'],
    before_worktree_remove: ['Before worktree removal', 'Archive worktree, save artifacts'],
    worktree_removed: ['After worktree removed', 'Cleanup external references'],
    pre_merge: ['Before merge operation', 'Run final tests, create backups'],
    post_merge: ['After successful merge', 'Deploy, close issues, notify team'],
    run_test: ['When tests triggered', 'Run test suite, report status via HTTP'],
    run_dev: ['When dev server triggered', 'Start dev server, create tunnel, report URL'],
  };

  let table = '### Pane Lifecycle Hooks\n\n';
  table += '| Hook | When | Common Use Cases |\n';
  table += '|------|------|------------------|\n';

  const paneHooks = ['before_pane_create', 'pane_created', 'worktree_created', 'before_pane_close', 'pane_closed'];
  paneHooks.forEach(hook => {
    const [when, use] = hookDescriptions[hook] || ['', ''];
    table += `| \`${hook}\` | ${when} | ${use} |\n`;
  });

  table += '\n### Worktree Lifecycle Hooks\n\n';
  table += '| Hook | When | Common Use Cases |\n';
  table += '|------|------|------------------|\n';

  const worktreeHooks = ['before_worktree_remove', 'worktree_removed'];
  worktreeHooks.forEach(hook => {
    const [when, use] = hookDescriptions[hook] || ['', ''];
    table += `| \`${hook}\` | ${when} | ${use} |\n`;
  });

  table += '\n### Merge Lifecycle Hooks\n\n';
  table += '| Hook | When | Common Use Cases |\n';
  table += '|------|------|------------------|\n';

  const mergeHooks = ['pre_merge', 'post_merge'];
  mergeHooks.forEach(hook => {
    const [when, use] = hookDescriptions[hook] || ['', ''];
    table += `| \`${hook}\` | ${when} | ${use} |\n`;
  });

  table += '\n### Interactive Hooks (with HTTP callbacks)\n\n';
  table += '| Hook | When | Common Use Cases |\n';
  table += '|------|------|------------------|\n';

  const interactiveHooks = ['run_test', 'run_dev'];
  interactiveHooks.forEach(hook => {
    const [when, use] = hookDescriptions[hook] || ['', ''];
    table += `| \`${hook}\` | ${when} | ${use} |\n`;
  });

  return table;
}
