#!/bin/sh
# Build dependency only: native Windows Skia C ABI, no .NET/Python assembly.
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
curl --fail --location --retry 3 https://api.nuget.org/v3-flatcontainer/skiasharp.nativeassets.win32/3.119.2/skiasharp.nativeassets.win32.3.119.2.nupkg -o "$tmp/skia.zip"
printf '%s  %s\n' 088e9d83e325c57f2dfaf6e7931b5de50137c5a94c2a403c2d44ae77183b4cd5 "$tmp/skia.zip" | sha256sum --check
mkdir -p "$root/skia-win"
python3 - "$tmp/skia.zip" "$root/skia-win" <<'PY'
import pathlib,sys,zipfile
with zipfile.ZipFile(sys.argv[1]) as package:
    for source,name in [('runtimes/win-x64/native/libSkiaSharp.dll','libSkiaSharp.dll'),('LICENSE.txt','LICENSE.txt'),('THIRD-PARTY-NOTICES.txt','THIRD-PARTY-NOTICES.txt')]:
        pathlib.Path(sys.argv[2],name).write_bytes(package.read(source))
PY
curl --fail --location --retry 3 https://raw.githubusercontent.com/CanadaHonk/porffor/alpha-22/LICENSE -o "$root/skia-win/PORFFOR-LICENSE.txt"
printf '%s  %s\n' d384513c362a1eee6d48cb283bab96d5ef9631903d4efb42a9bb24f3951061a4 "$root/skia-win/PORFFOR-LICENSE.txt" | sha256sum --check
printf '%s  %s\n' 8b097d433db94fe61aba85213184938fb36118afd542d33252dd83794fdd9afc "$root/skia-win/libSkiaSharp.dll" | sha256sum --check
