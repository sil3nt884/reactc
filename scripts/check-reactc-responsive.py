"""Exercise the Windows message pump during real HTTP and compiled CPU work."""
import argparse
import ctypes
from ctypes import wintypes
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import subprocess
from tempfile import TemporaryDirectory
import threading
import time

ROOT = Path(__file__).resolve().parents[1]
TITLE = 'Reactc Responsiveness Verification'
ENTRY = '''
import { useEffect, useState } from 'react';
import { WindowTitleBar } from '../../src/window-chrome.tsx';

export default function App() {
  const [status, setStatus] = useState('Starting');
  useEffect(() => { fetch('/start').then(() => setStatus('Ready')); }, []);
  async function refresh() {
    setStatus('Refreshing');
    const response = await fetch('/slow');
    setStatus(await response.text());
    await fetch('/finished');
  }
  async function calculate() {
    await fetch('/cpu');
    const deadline = Date.now() + 2200;
    let steps = 0;
    while (Date.now() < deadline) steps++;
    setStatus(String(steps));
    await fetch('/cpu-done');
  }
  return <main>
    <WindowTitleBar height={status === 'Refreshing' ? 76 : 48}><span>Responsiveness probe</span></WindowTitleBar>
    <button style={{height:42}} onClick={() => { void refresh(); }}>Refresh</button>
    <button style={{height:42}} onClick={calculate}>Calculate</button>
    <p>{status}</p>
  </main>;
}
'''


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        path = self.path[1:]
        event = self.server.events[path]
        event.set()
        if path in self.server.gates:
            self.server.gates[path].wait(10)
        body = b'Local test response'
        try:
            self.send_response(200)
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        except OSError:
            pass  # The final check closes the app with a request outstanding.

    def log_message(self, *_):
        pass


def wait_for(predicate, timeout=8):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if result := predicate():
            return result
        time.sleep(.02)
    raise AssertionError('Timed out waiting for native window state')


def check_window(executable, server):
    user32 = ctypes.WinDLL('user32')
    for name, argtypes, restype in [
        ('FindWindowW', [wintypes.LPCWSTR, wintypes.LPCWSTR], wintypes.HWND),
        ('GetWindowRect', [wintypes.HWND, ctypes.POINTER(wintypes.RECT)], wintypes.BOOL),
        ('ClientToScreen', [wintypes.HWND, ctypes.POINTER(wintypes.POINT)], wintypes.BOOL),
        ('SetWindowPos', [wintypes.HWND, wintypes.HWND, ctypes.c_int, ctypes.c_int,
                          ctypes.c_int, ctypes.c_int, wintypes.UINT], wintypes.BOOL),
        ('SendMessageTimeoutW', [wintypes.HWND, wintypes.UINT, wintypes.WPARAM,
                                  wintypes.LPARAM, wintypes.UINT, wintypes.UINT,
                                  ctypes.POINTER(ctypes.c_size_t)], wintypes.LPARAM),
    ]:
        function = getattr(user32, name)
        function.argtypes, function.restype = argtypes, restype

    def point(x, y):
        return (x & 0xffff) | ((y & 0xffff) << 16)

    with subprocess.Popen([str(executable)], cwd=executable.parent) as app:
        try:
            hwnd = wait_for(lambda: user32.FindWindowW('PTPorfforSkiaNative', TITLE))

            def send(message, wp=0, lp=0):
                result = ctypes.c_size_t()
                assert user32.SendMessageTimeoutW(hwnd, message, wp, lp, 2, 700, ctypes.byref(result)), hex(message)
                return result.value

            def rect():
                result = wintypes.RECT()
                assert user32.GetWindowRect(hwnd, ctypes.byref(result))
                return result

            def move():
                before = rect()
                assert user32.SetWindowPos(hwnd, None, before.left + 18, before.top + 6, 0, 0, 0x0015)
                after = rect()
                assert (after.left, after.top) == (before.left + 18, before.top + 6)
                send(0x000f)  # WM_PAINT must still run on the window thread.

            def has_custom_caption():
                bounds, origin = rect(), wintypes.POINT()
                assert user32.ClientToScreen(hwnd, ctypes.byref(origin))
                return (bounds.left, bounds.top) == (origin.x, origin.y)

            def click(y):
                send(0x0201, 1, point(100, y))
                send(0x0202, 0, point(100, y))

            assert server.events['start'].wait(8)
            send(0)  # WM_NULL
            wait_for(has_custom_caption)  # React renders before the initial HTTP response.
            move()
            server.gates['start'].set()
            send(0x000f)

            click(80)
            assert server.events['slow'].wait(3)
            bounds = rect()
            assert send(0x0084, 0, point(bounds.left + 100, bounds.top + 24)) == 2  # HTCAPTION
            def refreshing_is_painted():
                send(0x000f)
                return send(0x0084, 0, point(bounds.left + 100, bounds.top + 65)) == 2

            wait_for(refreshing_is_painted, timeout=2)  # Extra caption height comes from React state.
            move()
            click(158)
            assert not server.events['cpu'].is_set(), 'Core commands must stay ordered'
            server.gates['slow'].set()
            assert server.events['finished'].wait(4)
            assert server.events['cpu'].wait(4)
            assert not server.events['cpu-done'].is_set()
            move()
            assert not server.events['cpu-done'].is_set(), 'Move must complete during compiled CPU work'
            assert server.events['cpu-done'].wait(6)

            server.events['slow'].clear()
            server.gates['slow'].clear()
            click(80)
            assert server.events['slow'].wait(4)
            send(0x0010)  # WM_CLOSE
            assert app.wait(timeout=2) == 0
        finally:
            if app.poll() is None:
                app.kill()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('reactc', type=Path)
    args = parser.parse_args()
    dist = ROOT / 'dist'
    dist.mkdir(exist_ok=True)
    with TemporaryDirectory(prefix='reactc-responsive-', dir=dist) as temporary,             ThreadingHTTPServer(('127.0.0.1', 0), Handler) as server:
        folder = Path(temporary)
        entry = folder / 'probe.tsx'
        entry.write_text(ENTRY, encoding='utf-8')
        output = folder / 'build'
        subprocess.run([str(args.reactc.resolve()), 'build', str(entry.relative_to(ROOT)),
                        '--target', 'windows', '--name', 'ResponsiveProbe', '--title', TITLE,
                        '--http-origin', f'http://127.0.0.1:{server.server_port}',
                        '--outdir', str(output.relative_to(ROOT))], cwd=ROOT, check=True, timeout=300)
        manifest = json.loads((output / 'manifest.json').read_text(encoding='utf-8'))
        assert 'windows-host.c' in manifest['cSources']
        assert manifest['windowsThreading'] == {
            'window': 'win32-message-loop',
            'application': 'compiled-core-thread',
            'hostRequests': 'protocol-worker',
        }
        server.events = {name: threading.Event() for name in ('start', 'slow', 'finished', 'cpu', 'cpu-done')}
        server.gates = {name: threading.Event() for name in ('start', 'slow')}
        thread = threading.Thread(target=server.serve_forever)
        thread.start()
        try:
            check_window(output / 'ResponsiveProbe.exe', server)
        finally:
            for gate in server.gates.values():
                gate.set()
            server.shutdown()
            thread.join()
    print('PASS: startup and Refresh states paint before HTTP completes, and Windows moves and closes during pending work')


if __name__ == '__main__':
    main()
