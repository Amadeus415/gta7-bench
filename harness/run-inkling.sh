#!/bin/sh
# Give the task to Inkling 2 Mini, with Claude Code as its harness (the same agent loop and
# tools Fable and Opus get), pointed at the local server. Start the model first with
# ./harness/serve-inkling.sh
#
# A 26B local model runs unattended here, so shell access is limited to the test tool and
# read-only commands, and file writes are confined to the run directory.
set -eu
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/runs/inkling-2-mini"

ANTHROPIC_BASE_URL=http://127.0.0.1:8080 \
ANTHROPIC_API_KEY=local \
ANTHROPIC_MODEL=inkling-2-mini \
ANTHROPIC_SMALL_FAST_MODEL=inkling-2-mini \
API_TIMEOUT_MS=3600000 \
CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1 \
CLAUDE_CODE_MAX_CONTEXT_TOKENS=100000 \
CLAUDE_CODE_AUTO_COMPACT_WINDOW=80000 \
CLAUDE_CODE_MAX_OUTPUT_TOKENS=32000 \
CLAUDE_CONFIG_DIR="$ROOT/logs/inkling-claude-config" \
claude --bare \
  -p "Read TASK.md in the current directory and complete the task it describes." \
  --model inkling-2-mini \
  --tools "Bash,Read,Write,Edit,Glob,Grep" \
  --permission-mode acceptEdits \
  --allowedTools "Bash(node tools/check.mjs:*)" "Bash(node --check:*)" "Bash(ls:*)" \
    "Bash(cat:*)" "Bash(wc:*)" "Bash(grep:*)" "Bash(head:*)" "Bash(tail:*)" \
  --output-format stream-json --verbose \
  > "$ROOT/logs/inkling-2-mini.jsonl"
