"""Summarise a Claude Code stream-json transcript: one line per tool call, plus totals.

    python3 harness/progress.py logs/inkling-2-mini.jsonl
"""

import json
import sys

turns = 0
output_tokens = 0
for line in open(sys.argv[1]):
    try:
        event = json.loads(line)
    except json.JSONDecodeError:
        continue
    if event.get("type") == "assistant":
        message = event["message"]
        turns += 1
        output_tokens += message.get("usage", {}).get("output_tokens", 0)
        for block in message.get("content", []):
            if block["type"] == "text" and block["text"].strip():
                print("say  ", block["text"].strip().replace("\n", " ")[:160])
            if block["type"] == "tool_use":
                call = block["input"]
                detail = call.get("command") or call.get("file_path") or call.get("pattern") or ""
                size = len(call.get("content", "") or call.get("new_string", ""))
                print(f"{block['name']:<5}", str(detail)[:120], f"({size} chars)" if size else "")
    elif event.get("type") == "user":
        for block in event["message"].get("content", []):
            if isinstance(block, dict) and block.get("type") == "tool_result" and block.get("is_error"):
                text = block.get("content")
                if isinstance(text, list):
                    text = " ".join(part.get("text", "") for part in text if isinstance(part, dict))
                print("  error:", str(text).replace("\n", " ")[:200])
    elif event.get("type") == "result":
        print("result:", event.get("subtype"), f"{event.get('duration_ms', 0) / 60000:.0f} min")

print(f"-- {turns} assistant messages, {output_tokens} output tokens")
