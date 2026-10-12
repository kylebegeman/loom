import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeURL from "node:url";
import * as NodeAssert from "node:assert/strict";
import * as NodeTest from "node:test";
const pythonOptions = { stdio: "pipe", env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" } };
const root = NodeURL.fileURLToPath(new URL("./iris/", import.meta.url));
function contrast(a, b) {
  const luminance = (hex) => {
    const channels = hex.match(/[a-f\d]{2}/gi).map((v) => parseInt(v, 16) / 255);
    return channels.reduce(
      (sum, v, i) =>
        sum +
        [0.2126, 0.7152, 0.0722][i] * (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4),
      0,
    );
  };
  const [low, high] = [luminance(a), luminance(b)].sort((x, y) => x - y);
  return (high + 0.05) / (low + 0.05);
}
NodeTest.test("ANSI text is readable on both Iris terminal backgrounds", () => {
  for (const mode of ["dark", "light"]) {
    const source = NodeFS.readFileSync(root + `loom-iris-${mode}/colors.toml`, "utf8");
    const colors = Object.fromEntries(
      [...source.matchAll(/^(\w+) = "(#[a-f\d]{6})"$/gm)].map((m) => [m[1], m[2]]),
    );
    for (const name of [
      "foreground",
      "muted",
      "red",
      "green",
      "yellow",
      "blue",
      "magenta",
      "cyan",
      "bright_red",
      "bright_green",
      "bright_yellow",
      "bright_blue",
      "bright_magenta",
      "bright_cyan",
    ]) {
      NodeAssert.ok(
        contrast(colors[name], colors.background) >= 4.5,
        `${mode} ${name}: ${contrast(colors[name], colors.background)}`,
      );
    }
  }
});
NodeTest.test("generated skin, source provenance and approved artwork agree", () => {
  NodeChildProcess.execFileSync("python3", [root + "generate.py", "--check"], pythonOptions);
});
NodeTest.test("skin merge preserves geometry and allows only the owned focus opacity", () => {
  NodeChildProcess.execFileSync(
    "python3",
    [
      "-c",
      `
import sys,tomllib
sys.path.insert(0,sys.argv[1])
from apply import merge_colors
source='[controls]\\nfocus-border = "#aaaaaa"\\nfocus-border-alpha = 0.25\\nnormal-border-width = 1\\n[font]\\nbase-size = 17\\n[spacing]\\nscale = 1.3\\n'
result=tomllib.loads(merge_colors(source,{'controls':{'focus-border':'#68616e','focus-border-alpha':1.0}}))
assert result['font']['base-size']==17 and result['spacing']['scale']==1.3
assert result['controls']['normal-border-width']==1 and result['controls']['focus-border-alpha']==1.0
for bad in [{'font':{'base-size':18}}, {'controls':{'focus-border-alpha':2}}, {'controls':{'normal-border-width':2}}]:
 try: merge_colors(source,bad)
 except ValueError: pass
 else: raise AssertionError('Non-color override accepted')
`,
      root,
    ],
    pythonOptions,
  );
});
NodeTest.test("generation rejects drift, unsafe source values and replaced artwork", () => {
  NodeChildProcess.execFileSync(
    "python3",
    [
      "-c",
      `
import sys,json,tempfile,shutil
from pathlib import Path
sys.path.insert(0,sys.argv[1])
from generate import generate
root=Path(sys.argv[1]);tokens=(root/'tokens.json').read_bytes()
with tempfile.TemporaryDirectory() as tmp:
 copy=Path(tmp)/'iris';shutil.copytree(root,copy,ignore=shutil.ignore_patterns('__pycache__'))
 outputs=generate(copy,tokens)
 assert all((copy/name).read_bytes()==data for name,data in outputs.items())
 bad=json.loads(tokens);bad['palettes']['plum']['dark']['ink']='#25202d'
 try: generate(copy,json.dumps(bad).encode())
 except ValueError as e: assert 'below' in str(e)
 else: raise AssertionError('Low-contrast canonical update accepted')
 bad=json.loads(tokens);bad['palettes']['plum']['dark']['ink']='var(--missing)'
 try: generate(copy,json.dumps(bad).encode())
 except ValueError as e: assert 'opaque RGB' in str(e)
 else: raise AssertionError('Unresolved source accepted')
 (copy/'loom-iris-dark/unlock.svg').write_text('<svg/>')
 try: generate(copy,tokens)
 except ValueError as e: assert 'wordmark changed' in str(e)
 else: raise AssertionError('Replacement artwork accepted')
`,
      root,
    ],
    pythonOptions,
  );
});
NodeTest.test(
  "appearance rollback restores previous themes and library before upstream applies them",
  () => {
    NodeChildProcess.execFileSync(
      "python3",
      [
        "-c",
        `
import sys,tempfile,json
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0,sys.argv[1])
import install
with tempfile.TemporaryDirectory() as tmp:
 home=Path(tmp);backup=home/'backup';backup.mkdir()
 theme='.config/omarchy/themes/loom-iris-dark';library='.local/lib/loom-os/iris/apply.py'
 for name,value in [(theme+'/colors.toml','new'),(library,'new')]:
  p=home/name;p.parent.mkdir(parents=True,exist_ok=True);p.write_text(value)
 saved=backup/'themes/loom-iris-dark';saved.mkdir(parents=True);(saved/'colors.toml').write_text('old')
 p=backup/'files'/library;p.parent.mkdir(parents=True,exist_ok=True);p.write_text('old')
 (backup/'backup.json').write_text(json.dumps({'previousTheme':'loom-iris-dark','themes':{'loom-iris-dark':True},'files':{library:{'existed':True,'installedSha256':None}},'managedT3':None}))
 def apply(*args,**kwargs):
  assert (home/theme/'colors.toml').read_text()=='old', 'Applied new colors during rollback'
  assert (home/library).read_text()=='old', 'Kept new library during rollback'
 with patch.object(Path,'home',return_value=home),patch.object(install,'session_env',return_value={}),patch.object(install.subprocess,'run',side_effect=apply):install.rollback(backup)
`,
        root,
      ],
      pythonOptions,
    );
  },
);
