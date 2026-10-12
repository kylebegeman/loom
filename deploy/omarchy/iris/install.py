#!/usr/bin/env python3
"""Install the built skin on Omarchy, with private backups and a rollback command."""
from pathlib import Path
from datetime import datetime,timezone
import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import xml.etree.ElementTree as ET
from apply import atomic_write,session_env


def run(*args: str,env: dict[str,str]|None=None) -> str:
    return subprocess.check_output(args,text=True,env=env)


def finish_art(theme: Path) -> None:
    run('rsvg-convert','-o',str(theme/'unlock.png'),str(theme/'unlock.svg'))
    glyphs=ET.fromstring((theme/'unlock.svg').read_text())
    glyphs.set('viewBox','0 0 735 285')
    for child in list(glyphs):
        if child.tag.endswith('text'):
            caption_color=child.attrib['fill']
            glyphs.remove(child)
    (theme/'glyphs.svg').write_text(ET.tostring(glyphs,encoding='unicode'))
    run('rsvg-convert','-w','49','-h','19','-o',str(theme/'glyphs.png'),str(theme/'glyphs.svg'))
    pixels=run('magick',str(theme/'glyphs.png'),'-depth','8','txt:-')
    cells={}
    for line in pixels.splitlines():
        match=re.match(r'(\d+),(\d+):.*?#([0-9A-Fa-f]{8})(?:\s|$)',line)
        if match:
            x,y=int(match[1]),int(match[2]);color=match[3]
            if int(color[6:8],16)>=128:
                cells[x,y]=color[:6]
    if not cells:
        raise ValueError('Rasterized glyphs contain no opaque cells')
    plain=[];colored=[]
    for y in range(19):
        row=''.join('██' if (x,y) in cells else '  ' for x in range(49)).rstrip()
        plain.append(row)
        parts=[];last=None
        for x in range(len(row)//2):
            color=cells.get((x,y))
            if color:
                if color!=last:
                    r,g,b=(int(color[i:i+2],16) for i in (0,2,4))
                    parts.append(f'\x1b[38;2;{r};{g};{b}m');last=color
                parts.append('██')
            else:
                parts.append('  ')
        colored.append(''.join(parts)+'\x1b[0m')
    # Remove blank outer rows while preserving the caption's smaller scale and spacing.
    occupied=[y for y,row in enumerate(plain) if row]
    first,last=occupied[0],occupied[-1]
    caption='Loom OS'.center(98).rstrip()
    (theme/'about.txt').write_text('\n'.join(plain[first:last+1]+['',caption])+'\n')
    color=caption_color.lstrip('#');r,g,b=(int(color[i:i+2],16) for i in (0,2,4))
    (theme/'about-gradient.txt').write_text('\n'.join(colored[first:last+1]+['',f'\x1b[38;2;{r};{g};{b}m{caption}\x1b[0m'])+'\n')

    shutil.copyfile(theme/'about-gradient.txt',theme/'screensaver.txt')


def install(bundle: Path,mode: str|None) -> None:
    home=Path.home();env=session_env()
    lock=json.loads(run('omarchy-shell','lock','status',env=env))
    if any(lock.get(key) for key in ('locked','secure','requested','pending')):
        raise ValueError('Unlock the desktop normally before installing an appearance')
    if (bundle/'generate.py').is_file():
        subprocess.run([sys.executable,str(bundle/'generate.py'),'--check'],check=True)
    if not Path('/usr/share/omarchy').is_dir():
        raise ValueError('Run the installer on the Omarchy machine')
    current=home/'.local/state/omarchy/current'
    old_theme=(current/'theme.name').read_text().strip()
    if mode is None:
        mode=run('omarchy-theme-color','mode',env=env).strip()
    if mode not in ('light','dark'):
        raise ValueError(f'Unknown appearance: {mode}')
    stamp=datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S.%fZ')
    backup=home/'.local/state/loom-os/iris/backups'/stamp
    backup.mkdir(parents=True,mode=0o700)
    backup.chmod(0o700)
    shutil.copytree(current/'theme',backup/'active-theme')
    (backup/'original-theme.name').write_text(old_theme+'\n')
    library=home/'.local/lib/loom-os/iris'
    hook=home/'.config/omarchy/hooks/theme-set.d/90-loom-iris.sh'
    branding=home/'.config/omarchy/branding'
    library_files=('apply.py','install.py','manifest.json','terminal_colors.py','publish-terminal-colors.sh','tokens.json')
    files=[hook,branding/'screensaver.txt',branding/'about.txt',branding/'about-gradient.txt',home/'loom-branding.sh',
           *(library/name for name in library_files),
           *(library/'native-bin'/file.name for file in (bundle/'native-bin').iterdir() if file.is_file())]
    metadata={'previousTheme':old_theme,'selectedTheme':f'loom-iris-{mode}','files':{},'themes':{}}
    preserved=['.config/omarchy/shell.json','.config/omarchy/shell.toml','.config/hypr/looknfeel.lua','.config/hypr/bindings.lua']
    metadata['preservedSettings']={key:hashlib.sha256((home/key).read_bytes()).hexdigest() for key in preserved if (home/key).is_file()}
    managed=home/'.local/share/loom-os/t3'
    metadata['managedT3']=None
    if (managed/'userdata/settings.json').is_file():
        settings=json.loads((managed/'userdata/settings.json').read_text())
        unit=run('systemctl','--user','show','t3code.service','--property=ExecStart','--value',env=env)
        match=re.search(r'path=([^;]+)',unit)
        if match:
            cli=Path(match[1].strip()).resolve()
            if cli.is_relative_to(managed/'runtime') and cli.is_file():
                palette=managed/'userdata/themes/omarchy.json'
                metadata['managedT3']={'cli':str(cli),'previousDefaultTheme':settings.get('defaultTheme'),'paletteExisted':palette.is_file()}
                if palette.is_file():
                    shutil.copyfile(palette,backup/'t3-omarchy.json')

    for file in files:
        key=str(file.relative_to(home));exists=file.exists()
        metadata['files'][key]={'existed':exists}
        if exists:
            dest=backup/'files'/key;dest.parent.mkdir(parents=True,exist_ok=True)
            shutil.copy2(file,dest)
    for appearance in ('dark','light'):
        name=f'loom-iris-{appearance}';destination=home/'.config/omarchy/themes'/name
        metadata['themes'][name]=destination.exists()
        if destination.exists():
            shutil.copytree(destination,backup/'themes'/name)
        staging=destination.with_name(name+'.new-'+stamp)
        # A reviewed pack is immutable. Its staged skin must be writable for
        # local rasterization, without changing the retained bundle permissions.
        shutil.copytree(bundle/name,staging,copy_function=shutil.copyfile)
        # Carry the current wallpaper into the new theme; no image or composition is changed.
        backgrounds=staging/'backgrounds';backgrounds.mkdir()
        background=current/'background'
        if background.is_file():
            shutil.copyfile(background,backgrounds/background.resolve().name)
        finish_art(staging)
        if destination.exists():
            shutil.rmtree(destination)
        staging.rename(destination)
    library.mkdir(parents=True,exist_ok=True)
    for file in library_files:
        atomic_write(library/file,(bundle/file).read_bytes())
    (library/'publish-terminal-colors.sh').chmod(0o755)
    for file in (bundle/'native-bin').iterdir():
        if file.is_file():
            atomic_write(library/'native-bin'/file.name,file.read_bytes())
            (library/'native-bin'/file.name).chmod(0o755)
    hook_text='#!/bin/bash\nset -euo pipefail\nexec /usr/bin/python3 "$HOME/.local/lib/loom-os/iris/apply.py"\n'
    atomic_write(hook,hook_text.encode());hook.chmod(0o755)
    for file in files:
        metadata['files'][str(file.relative_to(home))]['installedSha256']=None
    (backup/'backup.json').write_text(json.dumps(metadata,indent=2)+'\n')
    # Root artwork is copied read-only now so local authentication is the final publishing step.
    boot=backup/'boot';boot.mkdir()
    for name,path in [('plymouth',Path('/usr/share/plymouth/themes/omarchy')),('sddm',Path('/usr/share/sddm/themes/omarchy'))]:
        if path.is_dir():
            shutil.copytree(path,boot/name)
    boot_script='''#!/bin/bash
set -euo pipefail
export OMARCHY_PATH=/usr/share/omarchy
export PATH="/usr/share/omarchy/bin:/usr/bin:/bin:${PATH:-}"
name=$(/usr/bin/cat "$HOME/.local/state/omarchy/current/theme.name")
case "$name" in loom-iris-dark|loom-iris-light) ;; *) echo 'Select Iris Dark or Iris Light before publishing.' >&2; exit 1 ;; esac
/usr/share/omarchy/bin/omarchy-plymouth-set-by-theme "$name"
"$HOME/.local/lib/loom-os/iris/publish-terminal-colors.sh"
printf 'Loom boot and login branding published.\n'
'''
    atomic_write(home/'loom-branding.sh',boot_script.encode());(home/'loom-branding.sh').chmod(0o755)
    metadata['brandingScript']='loom-branding.sh'
    try:
        subprocess.run(['omarchy-theme-set',f'loom-iris-{mode}'],env=env,check=True)
        # Upstream hooks log failures and return success; enforce our own result as well.
        subprocess.run([sys.executable,str(library/'apply.py')],env=env,check=True)
        if metadata['managedT3']:
            t3_env={**env,'T3CODE_HOME':str(managed)}
            subprocess.run([metadata['managedT3']['cli'],'theme','set','omarchy'],env=t3_env,check=True)

    finally:
        for file in files:
            if file.exists():
                metadata['files'][str(file.relative_to(home))]['installedSha256']=hashlib.sha256(file.read_bytes()).hexdigest()
        (backup/'backup.json').write_text(json.dumps(metadata,indent=2)+'\n')
    for key,expected in metadata['preservedSettings'].items():
        assert hashlib.sha256((home/key).read_bytes()).hexdigest()==expected, f'User setting changed: {key}'
    (library/'latest-backup').write_text(str(backup)+'\n')
    print(json.dumps({'theme':f'loom-iris-{mode}','backup':str(backup),'brandingScript':str(home/'loom-branding.sh')},indent=2))


def rollback(backup: Path) -> None:
    home=Path.home();metadata=json.loads((backup/'backup.json').read_text())
    # Refuse to overwrite subsequent edits to files owned by this installation.
    for key,info in metadata['files'].items():
        current=home/key
        if current.exists() and info['installedSha256'] and hashlib.sha256(current.read_bytes()).hexdigest()!=info['installedSha256']:
            raise ValueError(f'File changed after installation: {current}')
    for key,info in metadata['files'].items():
        dest=home/key
        if info['existed']:
            saved=backup/'files'/key
            atomic_write(dest,saved.read_bytes())
            shutil.copystat(saved,dest)
        else:
            dest.unlink(missing_ok=True)
    for name,existed in metadata['themes'].items():
        dest=home/'.config/omarchy/themes'/name
        if dest.exists():
            shutil.rmtree(dest)
        if existed:
            shutil.copytree(backup/'themes'/name,dest)
    # The publisher and theme-set hook must see restored themes and library bytes.
    subprocess.run(['omarchy-theme-set',metadata['previousTheme']],env=session_env(),check=True)
    t3=metadata.get('managedT3')
    if t3:
        managed=home/'.local/share/loom-os/t3'
        settings=json.loads((managed/'userdata/settings.json').read_text())
        if settings.get('defaultTheme')=='omarchy':
            command=['set',t3['previousDefaultTheme']] if t3['previousDefaultTheme'] else ['clear']
            subprocess.run([t3['cli'],'theme',*command],env={**session_env(),'T3CODE_HOME':str(managed)},check=True)
        palette=managed/'userdata/themes/omarchy.json'
        if t3.get('paletteExisted') is True:
            atomic_write(palette,(backup/'t3-omarchy.json').read_bytes())
        elif t3.get('paletteExisted') is False:
            palette.unlink(missing_ok=True)
        else:
            print('Prior managed T3 palette state is unknown; preserving the current palette.')
    print(f'Restored theme {metadata["previousTheme"]}. Boot/login rollback, if published, uses the saved boot logo separately.')


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--bundle',type=Path,default=Path(__file__).parent)
    parser.add_argument('--mode',choices=('light','dark'))
    parser.add_argument('--rollback',type=Path)
    args=parser.parse_args()
    if args.rollback:
        rollback(args.rollback)
    else:
        install(args.bundle.resolve(),args.mode)
