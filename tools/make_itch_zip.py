# itch.io upload: zips the playable game (index.html at the zip root) into dist/, without the dev
# tools, docs and git files. only committed files go in, so the zip matches the live build.
# usage: python tools/make_itch_zip.py   ->  dist/fogtide-build<N>.zip
import re
import subprocess
import zipfile
from pathlib import Path

root = Path(__file__).resolve().parent.parent
skip_dirs = ("tools/",)
skip_files = {".gitignore", "README.md"}

files = subprocess.run(["git", "ls-files"], cwd=root, capture_output=True, text=True, check=True).stdout.split()
files = [f for f in files if not f.startswith(skip_dirs) and f not in skip_files]
build = re.search(r"build (\d+)", (root / "index.html").read_text(encoding="utf-8")).group(1)

out = root / "dist" / f"fogtide-build{build}.zip"
out.parent.mkdir(exist_ok=True)
with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
    for f in files:
        z.write(root / f, f)
print(f"{out}  ({len(files)} files, {out.stat().st_size / 1e6:.1f} MB)")
