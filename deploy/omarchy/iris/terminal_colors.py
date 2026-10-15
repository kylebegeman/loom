#!/usr/bin/env python3
"""Keep approved wordmark colors in native terminal utilities, with plain sizing data."""
from pathlib import Path
import os
import sys


def color_args(tool: str, args: list[str], home: Path) -> list[str]:
    branding = home / '.config/omarchy/branding'
    # Identity colors survive changing the OS palette. Removing this owned
    # artwork during rollback makes both adapters transparent again.
    if not (branding / 'about-gradient.txt').is_file():
        return args
    if tool == 'fastfetch':
        # The native About launcher measures about.txt and invokes --logo none
        # for module sizing. Only its display call receives the colored copy.
        logo = branding / 'about-gradient.txt'
        if not args and logo.is_file() and not (home / '.config/fastfetch/config.jsonc').exists():
            return ['--logo', str(logo)]
    elif tool == 'ttfx':
        if any(arg.split('=', 1)[0] == '--existing-color-handling' for arg in args):
            return args
        for index, arg in enumerate(args):
            source = None
            if arg in ('-i', '--input-file') and index + 1 < len(args):
                source = args[index + 1]
            elif arg.startswith('--input-file='):
                source = arg.partition('=')[2]
            if source == str(branding / 'screensaver.txt'):
                return ['--existing-color-handling', 'always', *args]
    return args


if __name__ == '__main__':
    tool = sys.argv[1]
    if tool not in ('fastfetch', 'ttfx'):
        raise SystemExit('Unsupported terminal utility')
    native = '/usr/bin/' + tool
    os.execv(native, [native, *color_args(tool, sys.argv[2:], Path.home())])
