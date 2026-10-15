#!/usr/bin/bash
set -euo pipefail
export PATH=/usr/local/bin:/usr/bin:/bin
library="$HOME/.local/lib/loom-os/iris"
action=${1:-install}
case "$action" in install|remove) ;; *) echo 'Usage: publish-terminal-colors.sh [install|remove]' >&2; exit 1 ;; esac
for tool in fastfetch ttfx; do
  source="$library/native-bin/$tool"
  destination="/usr/local/bin/$tool"
  if [[ -e "$destination" ]] && ! /usr/bin/cmp -s "$source" "$destination"; then
    echo "Preserving an existing command at $destination; it differs from the Loom adapter." >&2
    exit 1
  fi
done
for tool in fastfetch ttfx; do
  source="$library/native-bin/$tool"
  destination="/usr/local/bin/$tool"
  if [[ "$action" == install ]]; then
    sudo /usr/bin/install -m 0755 "$source" "$destination"
  elif [[ -e "$destination" ]]; then
    sudo /usr/bin/rm -- "$destination"
  fi
done
printf 'Loom wordmark gradient adapters %s complete.\n' "$action"
