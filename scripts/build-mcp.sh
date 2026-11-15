#!/bin/sh
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
mkdir -p "$ROOT/backend/bin"
cd "$ROOT/backend"
go build -o bin/stratos-mcp ./cmd/mcp
printf 'MCP executable: %s/backend/bin/stratos-mcp\n' "$ROOT"
