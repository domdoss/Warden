#!/usr/bin/env bash
# Manually trigger the extension's element-picker popup — the same one the
# AI opens via chrome_request_element_selection. Works on the ACTIVE tab.
#
# Usage:
#   ./pick-element.sh "Title field" "Body field" ["More labels..."]
#
# A popup appears on the page; click the element(s) it asks for. The refs come
# back as JSON — paste them into the chat ("fill ref_N with ...") and the seat
# can drive the element directly.
set -euo pipefail

if [ $# -eq 0 ]; then
  echo 'usage: pick-element.sh "label" ["label2" ...]' >&2
  exit 1
fi

python3 - "$@" <<'EOF'
import json, sys, urllib.request

labels = sys.argv[1:]
payload = json.dumps({
    "jsonrpc": "2.0", "id": 1, "method": "tools/call",
    "params": {"name": "chrome_request_element_selection",
               "arguments": {"requests": [{"name": l} for l in labels]}}
}).encode()

req = urllib.request.Request("http://localhost:3200/mcp/browser", data=payload,
                             headers={"content-type": "application/json"})
# Blocks until you finish picking (or the 180s default timeout).
with urllib.request.urlopen(req, timeout=600) as resp:
    body = json.load(resp)

text = body["result"]["content"][0]["text"]
try:
    pretty = json.dumps(json.loads(text), indent=2)
    print(pretty)
except Exception:
    print(text)
EOF