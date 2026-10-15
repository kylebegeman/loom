#!/usr/bin/env python3
"""Merge Iris color roles into freshly generated Omarchy shell settings."""
from pathlib import Path
import base64
import json
import os
import re
import subprocess
import tempfile
import tomllib


def atomic_write(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True,exist_ok=True)
    with tempfile.NamedTemporaryFile(dir=path.parent,prefix='.'+path.name+'.',delete=False) as stream:
        stream.write(data)
        temporary=Path(stream.name)
    try:
        temporary.chmod(0o644)
        temporary.replace(path)
    finally:
        temporary.unlink(missing_ok=True)


def merge_colors(source: str, overrides: dict[str,dict[str,str|float]]) -> str:
    # Only this opacity belongs to the skin. Typography, geometry and all other
    # non-color settings stay with Omarchy and the user.
    for section, values in overrides.items():
        for key, value in values.items():
            if (section, key) == ('controls', 'focus-border-alpha'):
                if type(value) not in (float, int) or not 0 <= value <= 1:
                    raise ValueError('Invalid focus border opacity')
            elif not isinstance(value, str) or not re.fullmatch(r'#[0-9a-fA-F]{6}', value):
                raise ValueError(f'Non-color override: {section}.{key}')
    before=tomllib.loads(source)
    remaining={section:dict(values) for section,values in overrides.items()}
    lines=[]
    section=''
    for line in source.splitlines():
        header=re.fullmatch(r'\s*\[([\w-]+)\]\s*(?:#.*)?',line)
        if header:
            for key,value in remaining.get(section,{}).items():
                lines.append(f'{key} = {json.dumps(value)}')
            remaining.pop(section,None)
            section=header[1]
        assignment=re.match(r'\s*([\w-]+)\s*=',line)
        if assignment and assignment[1] in remaining.get(section,{}):
            key=assignment[1]
            value=remaining[section].pop(key)
            line=f'{key} = {json.dumps(value)}'
        lines.append(line)
    for key,value in remaining.get(section,{}).items():
        lines.append(f'{key} = {json.dumps(value)}')
    remaining.pop(section,None)
    for section,values in remaining.items():
        lines.extend(['',f'[{section}]'])
        lines.extend(f'{key} = {json.dumps(value)}' for key,value in values.items())
    result='\n'.join(lines)+'\n'
    after=tomllib.loads(result)
    for section,values in before.items():
        for key,value in values.items():
            if key not in overrides.get(section,{}):
                assert after[section][key]==value, f'Changed non-color setting: {section}.{key}'
    for section,values in overrides.items():
        for key,value in values.items():
            assert after[section][key]==value
    return result


def session_env() -> dict[str,str]:
    env=dict(os.environ)
    runtime=env.setdefault('XDG_RUNTIME_DIR',f'/run/user/{os.getuid()}')
    env.setdefault('DBUS_SESSION_BUS_ADDRESS',f'unix:path={runtime}/bus')
    env.setdefault('OMARCHY_PATH','/usr/share/omarchy')
    result=subprocess.run(['systemctl','--user','show-environment'],capture_output=True,text=True,check=True,env=env)
    for line in result.stdout.splitlines():
        key,sep,value=line.partition('=')
        if sep and key in ('WAYLAND_DISPLAY','HYPRLAND_INSTANCE_SIGNATURE','DISPLAY','OMARCHY_PATH'):
            env[key]=value
    return env


def apply() -> None:
    home=Path.home()
    current=home/'.local/state/omarchy/current'
    name=(current/'theme.name').read_text().strip()
    if name not in ('loom-iris-light','loom-iris-dark'):
        return
    theme=current/'theme'
    overrides=json.loads((theme/'iris-shell-colors.json').read_text())
    result=merge_colors((theme/'shell.toml').read_text(),overrides)
    atomic_write(theme/'shell.toml',result.encode())
    branding=home/'.config/omarchy/branding'
    # Screensavers use a black canvas, so their wordmark uses the approved dark asset in either mode.
    dark=home/'.config/omarchy/themes/loom-iris-dark'
    atomic_write(branding/'screensaver.txt',(dark/'screensaver.txt').read_bytes())
    atomic_write(branding/'about.txt',(theme/'about.txt').read_bytes())
    atomic_write(branding/'about-gradient.txt',(theme/'about-gradient.txt').read_bytes())
    payloads=[base64.b64encode((theme/file).read_bytes()).decode() for file in ('colors.toml','shell.toml')]
    subprocess.run(['omarchy-shell','shell','applyTheme',*payloads],env=session_env(),check=True)
    # Workstation's managed T3 server has its own home. Use the standard publisher
    # for that installed home as well as the default path handled by Omarchy.
    managed=home/'.local/share/loom-os/t3'
    if (managed/'userdata').is_dir():
        env=session_env()
        env['T3CODE_HOME']=str(managed)
        subprocess.run(['omarchy-theme-set-t3code'],env=env,check=True)
    print(f'Applied Iris color roles and Loom wordmark for {name}')


if __name__=='__main__':
    apply()
