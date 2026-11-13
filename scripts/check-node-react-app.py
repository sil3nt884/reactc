"""Check templates/node-react-app built into TasksServer.exe and Tasks.exe.

Build, then run with a Windows Python on a desktop session:

    cd templates/node-react-app && npm run build
    python scripts/check-node-react-app.py templates/node-react-app/dist

The client adds and completes a task with the keyboard; the server's own API
confirms each change, and a restarted server reloads it from tasks.json.
"""
import argparse
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
from tempfile import TemporaryDirectory
import time
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
spec = importlib.util.spec_from_file_location('keys', ROOT / 'scripts' / 'check-keyboard-shortcuts.py')
keys = importlib.util.module_from_spec(spec)
spec.loader.exec_module(keys)
ORIGIN = 'http://127.0.0.1:5180'


def call(path, body=None):
    data = None if body is None else json.dumps(body).encode()
    headers = {} if body is None else {'Content-Type': 'application/json'}
    with urlopen(Request(ORIGIN + path, data=data, headers=headers), timeout=3) as response:
        text = response.read().decode()
        return json.loads(text) if text else None


def start_server(executable, folder):
    server = subprocess.Popen([str(executable)], cwd=folder, stdout=subprocess.DEVNULL,
                              env={**os.environ, 'TASKS_FILE': 'tasks.json'})
    deadline = time.monotonic() + 15
    while True:
        try:
            assert call('/health') == {'ok': True}
            return server
        except OSError:
            if server.poll() is not None or time.monotonic() > deadline:
                raise RuntimeError('TasksServer.exe did not start')
            time.sleep(.1)


def stop(server):
    server.terminate()
    server.wait(timeout=10)


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('dist', type=Path, help='the template dist folder')
    dist = parser.parse_args().dist.resolve()
    server_exe, client_exe = dist / 'server' / 'TasksServer.exe', dist / 'client' / 'Tasks.exe'
    win = keys.gui()
    with TemporaryDirectory(prefix='node-react-app-') as folder:
        server = start_server(server_exe, folder)
        try:
            assert call('/tasks') == []
            assert call('/tasks', {'title': 'Seeded over HTTP'})['id'] == 1
            ui_folder, app, window = keys.launch(win, client_exe, 'Tasks')
            try:
                keys.post_key(win, window.hwnd, 0x09)  # Tab: the first stop is the new-task field
                field = win.wait_for(lambda: win.user.GetDlgItem(window.hwnd, 200), 'Tab did not focus the field')
                text = win.c.create_unicode_buffer('Typed in the native client')
                win.send(field, 0x00c2, 1, win.c.addressof(text))  # EM_REPLACESEL
                keys.post_key(win, field, 0x0d)  # Enter submits the form
                win.wait_for(lambda: len(call('/tasks')) == 2, 'The client did not add the task')
                assert call('/tasks')[1] == {'id': 2, 'title': 'Typed in the native client', 'done': False}
                # Add is disabled with an empty draft, so Tab goes: all, open, done, Refresh, Done (task 1).
                keys.post_key(win, field, 0x09)
                win.wait_for(lambda: not win.user.GetDlgItem(window.hwnd, 200), 'Tab did not leave the field')
                for _ in range(4):
                    keys.post_key(win, window.hwnd, 0x09)
                    time.sleep(.15)
                keys.post_key(win, window.hwnd, 0x0d)  # Enter presses Done on the first task
                win.wait_for(lambda: call('/tasks')[0]['done'] is True, 'The client did not complete the task')
            finally:
                keys.close(win, ui_folder, app, window)
        finally:
            stop(server)
        # A new server process reloads tasks.json written by the first one.
        server = start_server(server_exe, folder)
        try:
            assert [task['title'] for task in call('/tasks')] == ['Seeded over HTTP', 'Typed in the native client']
        finally:
            stop(server)
    print('PASS: Tasks.exe added and completed tasks through TasksServer.exe, which saved and reloaded them')


if __name__ == '__main__':
    main()
