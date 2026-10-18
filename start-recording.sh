#!/usr/bin/env bash
# DarkScan: record a shopping session (macOS and Linux). Run: ./start-recording.sh
# "./start-recording.sh --check" only checks that everything is installed.
set -u
cd "$(dirname "$0")"
echo
echo " DarkScan: record a shopping session"
echo " -----------------------------------"
echo

if ! command -v node >/dev/null 2>&1; then
  echo ' Node.js is not installed. Install the "LTS" version from https://nodejs.org/ and run this again.'
  exit 1
fi
major=$(node -v | sed 's/^v//; s/\..*//')
if [ "$major" -lt 22 ]; then
  echo ' Your Node.js is too old. DarkScan needs version 22 or newer: install the "LTS" version from https://nodejs.org/.'
  exit 1
fi

if [ ! -d node_modules ]; then
  echo " First run: installing what DarkScan needs. This takes a minute or two."
  npm ci --no-audit --no-fund || { echo " The install failed. Check your internet connection and try again."; exit 1; }
fi
npx --no-install playwright install chromium || { echo " Could not set up the browser. Check your internet connection and try again."; exit 1; }

if [ "${1:-}" = "--check" ]; then
  echo " Everything is ready."
  exit 0
fi

cat <<'TEXT'

 What happens next:
   - A browser window opens. YOU shop in it as you normally would. DarkScan never clicks anything.
   - Stop before paying. Do not type card or bank details. Recording stops by itself at a payment page.
   - What you type is not saved, and emails, phone and card numbers are hidden in what is saved.
   - Names and addresses that the page shows are only hidden if you list them below.
   - When you are done, wait a second, then close the browser window.

TEXT

read -r -p "  Shop address to start from (for example https://www.example.com/): " shop
case "$shop" in
  http://*|https://*) ;;
  *) echo " The address must start with http:// or https://"; exit 1 ;;
esac
read -r -p "  Words to hide, such as your name, phone number or street (separate with commas, or press Enter to skip): " hide
read -r -p "  Also make a copy to send to the person running the study? (y/n): " share

args=(--url "$shop" --site session)
[ -n "$hide" ] && args+=(--redact "$hide")
case "$share" in y|Y) args+=(--share share) ;; esac
[ -n "${DARKSCAN_HEADLESS:-}" ] && args+=(--headless)

if [ -n "${DARKSCAN_DRYRUN:-}" ]; then
  echo " would run: record ${args[*]}"
  exit 0
fi
npm run record --silent -- "${args[@]}"

latest=$(ls -1t runs 2>/dev/null | head -n 1)
if [ -n "$latest" ]; then
  echo
  echo " Your report: runs/$latest/report.html"
fi
case "$share" in y|Y) echo ' The copy to send is in the "share" folder: zip the folder inside it and send that.' ;; esac
