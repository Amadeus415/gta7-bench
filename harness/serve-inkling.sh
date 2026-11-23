#!/bin/sh
# Serve Inkling 2 Mini locally at http://127.0.0.1:8080 (OpenAI- and Anthropic-compatible API).
# One slot with a 100k context: each 100k of context costs about 11 GB on top of the 18 GB of weights.
# The mmproj file is the vision encoder, so the model can look at screenshots of its own game.
exec "$HOME/models/llama.cpp-b12626/llama" serve \
  -m "$HOME/models/inkling-2-mini/Inkling-2-Mini-IQ4_NL.gguf" \
  --mmproj "$HOME/models/inkling-2-mini/mmproj-Inkling-2-Mini-Q8_0.gguf" \
  --alias inkling-2-mini \
  --ctx-size 100000 --parallel 1 \
  --port 8080 "$@"
