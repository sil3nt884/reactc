"""Check a reactc.config.json project built into a server and a client executable.

Build, then run with a Windows Python on a desktop session:

    compiler/target/debug/reactc.exe build --config scripts/fixtures/reactc-config/reactc.config.json
    python scripts/check-reactc-config.py dist/reactc-config

The server answers over HTTP, and the client window shows its reply after
Tab, typing, Tab and Enter.
"""
import argparse
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
from tempfile import TemporaryDirectory
import time
from urllib.request import urlopen

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
spec = importlib.util.spec_from_file_location('keys', ROOT / 'scripts' / 'check-keyboard-shortcuts.py')
keys = importlib.util.module_from_spec(spec)
spec.loader.exec_module(keys)
URL = 'http://127.0.0.1:5055/greeting?name=Ada'


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('outdir', type=Path, help='the configured outDir')
    outdir = parser.parse_args().outdir.resolve()
    server_exe, client_exe = outdir / 'server' / 'GreetingServer.exe', outdir / 'client' / 'Greeting.exe'
    for executable in (server_exe, client_exe):
        with open(executable, 'rb') as file:
            assert file.read(2) == b'MZ', f'{executable} is not a Windows executable'
    win = keys.gui()
    with TemporaryDirectory(prefix='reactc-config-') as folder, \
            subprocess.Popen([str(server_exe)], cwd=folder, stdout=subprocess.DEVNULL) as server:
        try:
            deadline = time.monotonic() + 15
            while True:
                try:
                    with urlopen(URL, timeout=2) as response:
                        assert json.load(response) == {'text': 'Hello, Ada!'}
                    break
                except OSError:
                    if server.poll() is not None or time.monotonic() > deadline:
                        raise
                    time.sleep(.1)
            ui_folder, app, window = keys.launch(win, client_exe, 'Greeting')
            try:
                keys.post_key(win, window.hwnd, 0x09)  # Tab to the name field
                field = win.wait_for(lambda: win.user.GetDlgItem(window.hwnd, 200), 'Tab did not focus the field')
                text = win.c.create_unicode_buffer('Ada')
                win.send(field, 0x00c2, 1, win.c.addressof(text))  # EM_REPLACESEL
                keys.post_key(win, field, 0x09)  # Tab to the button
                win.wait_for(lambda: not win.user.GetDlgItem(window.hwnd, 200), 'Tab did not reach the button')
                time.sleep(.4)
                region = (0, 0, 500, 400)
                before = window.capture(*region)
                keys.post_key(win, window.hwnd, 0x0d)  # Enter asks the server
                win.wait_for(lambda: window.capture(*region) != before, 'The client did not show the server reply')
            finally:
                keys.close(win, ui_folder, app, window)
        finally:
            server.terminate()
            server.wait(timeout=10)
    print('PASS: one reactc.config.json built a Windows server and client; the client showed the server reply')


if __name__ == '__main__':
    main()
