#!/usr/bin/env python3
"""Generate the Omarchy skin from a pinned copy of canonical Iris tokens."""
from pathlib import Path
import argparse
import hashlib
import json
import re

ROOT = Path(__file__).resolve().parent
TEXT_CONTRAST = 4.5
FOCUS_CONTRAST = 3.0
ANSI_ROLES = {
    'red', 'green', 'yellow', 'blue', 'magenta', 'orange', 'cyan', 'brown',
    'bright_red', 'bright_green', 'bright_yellow', 'bright_blue', 'bright_magenta', 'bright_cyan',
}
SHELL_ROLES = {
    'bar': {'background': 'band', 'text': 'ink', 'active': 'danger'},
    'controls': {'normal-border': 'line', 'hover-cursor-border': 'line', 'focus-border': 'muted'},
    'hyprland': {'active-border': 'line-strong', 'active-border-foreground': 'line-strong'},
    **{name: {'background': 'paper', 'text': 'ink', 'border': 'line'} for name in
       ('popups', 'tooltip', 'notifications', 'launcher', 'menu', 'polkit')},
    'lock': {'background': 'paper', 'text': 'ink', 'placeholder': 'muted', 'text-error': 'danger',
             'border': 'line-strong', 'border-active': 'line-strong'},
}
T3_ROLES = {
    'chrome': 'bg', 'toolbar': 'paper', 'toolbarForeground': 'ink', 'toolbarBorder': 'line',
    'text': 'ink', 'border': 'line', 'focus': 'accent', 'sidebar': 'band',
    'sidebarForeground': 'ink', 'sidebarBorder': 'line', 'sidebarRowHover': 'soft',
    'sidebarRowActive': 'paper', 'sidebarRowSelected': 'accent-soft', 'error': 'danger',
    'warning': 'warning', 'codeBackground': 'paper', 'codeForeground': 'ink',
    'terminalBackground': 'bg', 'terminalForeground': 'ink', 'terminalCursor': 'ink',
    'terminalSelection': 'accent-soft', 'terminalScrollbar': 'line', 'terminalScrollbarHover': 'line-strong',
}


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def dump(data: object) -> bytes:
    return (json.dumps(data, indent=2) + '\n').encode()


def luminance(color: str) -> float:
    channels = [int(color[i:i+2], 16) / 255 for i in (1, 3, 5)]
    return sum(weight * (value / 12.92 if value <= 0.04045 else ((value + 0.055) / 1.055) ** 2.4)
               for weight, value in zip((0.2126, 0.7152, 0.0722), channels))


def contrast(a: str, b: str) -> float:
    low, high = sorted((luminance(a), luminance(b)))
    return (high + 0.05) / (low + 0.05)


def readable(color: str, surfaces: list[str], mode: str) -> tuple[str, float]:
    # ANSI tags are used as small text, unlike app tag decoration. Preserve their
    # hue, mixing only toward black/white until the rounded RGB value passes.
    channels = [int(color[i:i+2], 16) for i in (1, 3, 5)]
    end = 0 if mode == 'light' else 255
    for step in range(101):
        amount = step / 100
        value = '#' + ''.join(f'{round(c * (1 - amount) + end * amount):02x}' for c in channels)
        if min(contrast(value, bg) for bg in surfaces) >= TEXT_CONTRAST:
            return value, amount
    raise ValueError(f'No readable ANSI shade for {color}')


def generate(root: Path, tokens_bytes: bytes) -> dict[str, bytes]:
    tokens = json.loads(tokens_bytes)
    manifest = json.loads((root / 'manifest.json').read_text())
    if tokens.get('schemaVersion') != 1 or tokens.get('name') != 'Iris':
        raise ValueError('Expected canonical Iris schema version 1')
    manifest.update(irisVersion=tokens['version'], irisSha256=sha(tokens_bytes), palette='plum',
                    tokenSource='tokens.json', shellRoles=SHELL_ROLES, t3Roles=T3_ROLES,
                    terminalContrastMinimum=TEXT_CONTRAST, adaptations={}, contrast={})
    outputs = {'tokens.json': tokens_bytes}
    for mode in ('dark', 'light'):
        palette = tokens['palettes']['plum'][mode]
        def color(role: str) -> str:
            value = palette[role]
            if not re.fullmatch(r'#[0-9a-fA-F]{6}', value):
                raise ValueError(f'Expected opaque RGB: {mode}.{role}')
            return value.lower()
        prefix = f'loom-iris-{mode}/'
        art = root / prefix / 'unlock.svg'
        if sha(art.read_bytes()) != manifest['themes'][mode]['wordmarkSha256']:
            raise ValueError(f'Approved {mode} wordmark changed; review artwork separately')
        colors = {key: color(role) for key, role in manifest['themeRoles'].items()}
        surfaces = [color(role) for role in ('bg', 'paper', 'band')]
        adaptations = {}
        for key in sorted(ANSI_ROLES):
            original = colors[key]
            colors[key], amount = readable(original, surfaces, mode)
            if colors[key] != original:
                adaptations[key] = {'role': manifest['themeRoles'][key], 'from': original,
                                    'to': colors[key], 'mixWith': '#000000' if mode == 'light' else '#ffffff',
                                    'amount': amount}
        shell = {section: {key: color(role) for key, role in roles.items()}
                 for section, roles in SHELL_ROLES.items()}
        # Keep Omarchy's widths and geometry; make its neutral keyboard outline visible.
        shell['controls']['focus-border-alpha'] = 1.0
        t3 = {'name': f'Iris {mode.title()}', 'appearance': mode, 'canvas': color('bg'),
              'accent': color('accent'), 'colors': {key: color(role) for key, role in T3_ROLES.items()}}
        checks = {}
        def require(name: str, fg: str, backgrounds: list[str], minimum: float) -> None:
            ratio = min(contrast(fg, bg) for bg in backgrounds)
            if ratio < minimum:
                raise ValueError(f'{mode} {name}: {ratio:.3f}:1 is below {minimum}:1')
            checks[name] = {'minimum': minimum, 'ratio': round(ratio, 3)}
        for role in ('ink', 'muted', 'accent', 'danger', 'success', 'warning', 'info'):
            require(role, color(role), surfaces, TEXT_CONTRAST)
        require('selection', color('ink'), [color('accent-soft')], TEXT_CONTRAST)
        for key in sorted(ANSI_ROLES):
            require('terminal.' + key, colors[key], surfaces, TEXT_CONTRAST)
        require('keyboard-focus', color('muted'), surfaces, FOCUS_CONTRAST)
        manifest['adaptations'][mode] = adaptations
        manifest['contrast'][mode] = checks
        outputs[prefix + 'colors.toml'] = (f'# Loom OS Iris {tokens["version"]}. Generated by iris/generate.py.\n'
            + f'mode = "{mode}"\n' + ''.join(f'{key} = "{value}"\n' for key, value in colors.items())).encode()
        outputs[prefix + 'iris-shell-colors.json'] = dump(shell)
        outputs[prefix + 't3code.json'] = dump(t3)
    outputs['manifest.json'] = dump(manifest)
    return outputs


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--tokens', type=Path, help='Import canonical Iris tokens.json')
    parser.add_argument('--check', action='store_true', help='Check generated files without writing')
    args = parser.parse_args()
    outputs = generate(ROOT, (args.tokens or ROOT / 'tokens.json').read_bytes())
    if args.check:
        stale = [name for name, value in outputs.items() if not (ROOT / name).is_file() or (ROOT / name).read_bytes() != value]
        if stale:
            raise ValueError('Stale Iris generation: ' + ', '.join(stale))
        print('Iris source, generated palettes, contrast and approved wordmarks verified.')
    else:
        for name, value in outputs.items():
            (ROOT / name).write_bytes(value)
        print('Generated both Iris skins; approved artwork preserved.')


if __name__ == '__main__':
    main()
