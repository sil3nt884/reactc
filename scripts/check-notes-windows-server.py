"""Run the compiled upstream Notes server and UI as two Windows executables.

Run with a Windows Python on a desktop session:

    python scripts/check-notes-windows-server.py dist/notes-original/server-windows/OriginalNotesServer.exe \
        dist/notes-original/windows/OriginalNotesAcceptance.exe

The server executable is a standalone Windows console program. This check
starts it, seeds a note over HTTP, drives the Windows UI online against it,
stops it, and drives the UI's offline flow.
"""
import argparse
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
from tempfile import TemporaryDirectory
import time
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
from check_original_notes_settings import SEED_WINDOWS, URL

spec = importlib.util.spec_from_file_location('notes_win32', ROOT / 'scripts' / 'check-original-notes-win32.py')
gui = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gui)


def notes():
    with urlopen(URL, timeout=2) as response:
        return json.load(response)


def wait_for_server(server, output):
    deadline = time.monotonic() + 15
    while True:
        try:
            return notes()
        except OSError:
            if server.poll() is not None:
                raise RuntimeError('The Windows server exited: ' + output.read_text(errors='replace'))
            if time.monotonic() >= deadline:
                raise
            time.sleep(.1)


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('server', type=Path, help='OriginalNotesServer.exe')
    parser.add_argument('ui', type=Path, help='Windows Notes UI executable under the checkout')
    args = parser.parse_args()
    server_exe, ui = args.server.resolve(), args.ui.resolve()
    with open(server_exe, 'rb') as executable:
        assert executable.read(2) == b'MZ', 'The server is not a Windows executable'
    with TemporaryDirectory(prefix='notes-windows-server-') as folder:
        output = Path(folder) / 'server-output.txt'
        with open(output, 'wb') as log, subprocess.Popen([str(server_exe)], cwd=folder, stdout=log,
                                                         stderr=subprocess.STDOUT) as server:
            try:
                assert wait_for_server(server, output) == [], 'The server should start empty'
                seed = json.dumps({'markdown': SEED_WINDOWS, 'tag': 'compiler-test'}).encode()
                request = Request(URL, data=seed, headers={'Content-Type': 'application/json'})
                with urlopen(request, timeout=3) as response:
                    assert json.load(response)['markdown'] == SEED_WINDOWS
                with TemporaryDirectory(prefix='notes-windows-ui-') as ui_folder:
                    gui.online(ui, Path(ui_folder))
                assert server.poll() is None, 'The server stopped during the UI flow'
            finally:
                server.terminate()
                server.wait(timeout=10)
    with TemporaryDirectory(prefix='notes-windows-ui-') as ui_folder:
        gui.offline(ui, Path(ui_folder))
    print('PASS: Windows Notes UI used the compiled Windows Express server, then worked offline without it')


if __name__ == '__main__':
    main()
