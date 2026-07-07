#!/usr/bin/env sh
set -eu

cd "$(dirname "$0")"

if ! command -v bun >/dev/null 2>&1; then
  echo "Bun is required. Install Bun, reopen the terminal, then run setup again." >&2
  exit 1
fi

if [ ! -f ".env" ]; then
  cp ".env.example" ".env"
  echo "Created .env from .env.example. Fill the NetSuite OAuth values before live use."
fi

bun install

mode="--all-detected"
while [ "$#" -gt 0 ]; do
  case "$1" in
    --all-detected)
      mode="--all-detected"
      ;;
    --all-known)
      mode="--all-known"
      ;;
    --list)
      mode="--list"
      ;;
    --target)
      shift
      if [ "$#" -eq 0 ]; then
        echo "--target requires an id" >&2
        exit 1
      fi
      mode="--target=$1"
      ;;
    --target=*)
      mode="$1"
      ;;
    *)
      echo "Unknown setup option: $1" >&2
      exit 1
      ;;
  esac
  shift
done

bun run install:clients -- "$mode"

echo ""
echo "Setup finished. SuperMCP only registered MCP servers; client approval settings remain in each client."
echo "Next: edit .env with NetSuite OAuth values, deploy the RESTlet files, then run ns_checkAccountPermissions."
