#!/usr/bin/env bash
# Prints the notifications currently in the shade for the watched bank apps.
# Usage: scripts/dump-notifications.sh [extra.package.id ...]
set -euo pipefail

PACKAGES=(com.jago.digitalBanking com.bca.mybca.omni.android com.bca "$@")
pattern=$(IFS='|'; echo "${PACKAGES[*]}")

adb shell dumpsys notification --noredact | awk -v pat="^($pattern)$" '
  /NotificationRecord\(/ {
    inrec = 0
    if (match($0, /pkg=[^ ]+/)) {
      pkg = substr($0, RSTART + 4, RLENGTH - 4)
      if (pkg ~ pat) { inrec = 1; print "\n=== " pkg " ===" }
    }
    next
  }
  inrec && /android\.(title|text|bigText|subText|infoText|textLines)=/ { sub(/^[ \t]+/, ""); print }
  inrec && /when=/ && !shown[NR] { if (match($0, /when=[0-9]+/)) print substr($0, RSTART, RLENGTH) }
'
