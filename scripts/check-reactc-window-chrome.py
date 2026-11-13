"""Build and exercise the React-authored frame on a real Windows desktop."""
import argparse
import ctypes
from ctypes import wintypes
import json
from pathlib import Path
import struct
import subprocess
from tempfile import TemporaryDirectory
import time

ROOT = Path(__file__).resolve().parents[1]
TITLE = 'React Window Chrome Verification'
ENTRY = '''
import { useState } from 'react';
import { WindowTitleBar, WindowButton } from '../../src/window-chrome.tsx';

export default function App() {
  const [value, setValue] = useState('select native text');
  return <main>
    <WindowTitleBar height={52} style={{backgroundColor: '#21344f', borderBottomWidth: 3, borderColor: '#ffae42', paddingLeft: 18}}>
      <span style={{flexGrow: 1, fontSize: 16}}>Custom window title</span>
      <WindowButton command="minimize" style={{position: 'relative', top: 10}} />
      <div style={{position: 'relative', width: 128, height: 42}}>
        <WindowButton command="maximize" style={{position: 'absolute',
          left: 10, bottom: 5, width: 38, height: 22}} />
        <WindowButton command="close" style={{position: 'absolute',
          right: 12, top: 5, backgroundColor: '#842a3a', height: 32,
          borderRadius: 5, borderTopRightRadius: 0,
          padding: 4, paddingLeft: 16, paddingTop: 12, paddingBottom: 0}} />
      </div>
    </WindowTitleBar>
    <h1 onContextMenu={event => setValue('menu ' + event.clientX + ',' + event.clientY)}>Native Skia</h1>
    <input value={value} onChange={event => setValue(event.target.value)}
      onContextMenu={event => { event.preventDefault(); setValue('edit menu'); }} />
    <textarea readOnly value="read only text" />
  </main>;
}
'''


def wait_for(condition):
    deadline = time.monotonic() + 10
    while time.monotonic() < deadline:
        if result := condition():
            return result
        time.sleep(.02)
    raise AssertionError('Timed out waiting for Win32 window state')


def pack_point(x, y):
    return (x & 0xffff) | ((y & 0xffff) << 16)


def check_window(executable):
    user32 = ctypes.WinDLL('user32')
    user32.FindWindowW.argtypes = [wintypes.LPCWSTR, wintypes.LPCWSTR]
    user32.FindWindowW.restype = wintypes.HWND
    for name, arguments in {
        'GetClientRect': [ctypes.POINTER(wintypes.RECT)],
        'GetWindowRect': [ctypes.POINTER(wintypes.RECT)],
        'ClientToScreen': [ctypes.POINTER(wintypes.POINT)],
        'GetMenu': [], 'IsZoomed': [], 'IsIconic': [], 'UpdateWindow': [],
    }.items():
        getattr(user32, name).argtypes = [wintypes.HWND, *arguments]
    user32.GetMenu.restype = wintypes.HMENU
    user32.GetDlgItem.argtypes = [wintypes.HWND, ctypes.c_int]
    user32.GetDlgItem.restype = wintypes.HWND
    user32.PostMessageW.argtypes = [wintypes.HWND, wintypes.UINT, wintypes.WPARAM, wintypes.LPARAM]
    user32.GetWindowThreadProcessId.argtypes = [wintypes.HWND, ctypes.c_void_p]
    user32.GetWindowThreadProcessId.restype = wintypes.DWORD

    class GuiThreadInfo(ctypes.Structure):
        _fields_ = [('cbSize', wintypes.DWORD), ('flags', wintypes.DWORD)] + [
            (name, wintypes.HWND) for name in ('active', 'focus', 'capture', 'menuOwner', 'moveSize', 'caret')
        ] + [('caretRect', wintypes.RECT)]

    user32.GetGUIThreadInfo.argtypes = [wintypes.DWORD, ctypes.POINTER(GuiThreadInfo)]
    user32.SendMessageTimeoutW.argtypes = [
        wintypes.HWND, wintypes.UINT, wintypes.WPARAM, wintypes.LPARAM,
        wintypes.UINT, wintypes.UINT, ctypes.POINTER(ctypes.c_size_t),
    ]
    user32.SendMessageTimeoutW.restype = wintypes.LPARAM

    with subprocess.Popen([str(executable)], cwd=executable.parent) as app:
        try:
            hwnd = wait_for(lambda: user32.FindWindowW('PTPorfforSkiaNative', TITLE))

            def send(message, value=0, data=0, *, target=hwnd):
                result = ctypes.c_size_t()
                assert user32.SendMessageTimeoutW(target, message, value, data, 2, 3000, ctypes.byref(result))
                return result.value

            def menu_owner():
                info = GuiThreadInfo(cbSize=ctypes.sizeof(GuiThreadInfo))
                assert user32.GetGUIThreadInfo(user32.GetWindowThreadProcessId(hwnd, None), ctypes.byref(info))
                return info.menuOwner if info.flags & 4 else None  # GUI_INMENUMODE

            def click(right):
                client = wintypes.RECT()
                assert user32.GetClientRect(hwnd, ctypes.byref(client))
                x = client.right - right
                user32.UpdateWindow(hwnd)
                screen = wintypes.POINT(x, 24)
                assert user32.ClientToScreen(hwnd, ctypes.byref(screen))
                assert send(0x0084, 0, pack_point(screen.x, screen.y)) == 1
                point = pack_point(x, 24)
                send(0x0201, 1, point)  # WM_LBUTTONDOWN
                send(0x0202, 0, point)  # WM_LBUTTONUP

            wait_for(lambda: not user32.GetMenu(hwnd))
            user32.UpdateWindow(hwnd)
            origin, frame = wintypes.POINT(), wintypes.RECT()
            assert user32.ClientToScreen(hwnd, ctypes.byref(origin))
            assert user32.GetWindowRect(hwnd, ctypes.byref(frame))
            assert (origin.x, origin.y) == (frame.left, frame.top)
            assert send(0x0084, 0, pack_point(origin.x + 100, origin.y + 24)) == 2  # HTCAPTION
            assert send(0x0084, 0, pack_point(origin.x + 1, origin.y + 1)) == 13  # HTTOPLEFT
            assert send(0x0084, 0, pack_point(frame.right - 34, origin.y + 24)) == 1  # Moved close button.
            assert send(0x0084, 0, pack_point(frame.right - 67, origin.y + 24)) == 2  # Gap is draggable.
            assert send(0x0084, 0, pack_point(frame.right - 100, origin.y + 16)) == 2  # Above maximize.
            assert send(0x0084, 0, pack_point(frame.right - 150, origin.y + 48)) == 1  # Relative inset.
            send(0x0205, 0, pack_point(30, 76))  # WM_RBUTTONUP, triggers React onContextMenu
            send(0x0201, 1, pack_point(12, 120))
            edit = user32.GetDlgItem(hwnd, 200)
            assert edit
            send(0x0200, 1, pack_point(70, 12), target=edit)  # Drag from the first click.
            send(0x0202, 0, pack_point(70, 12), target=edit)
            selection = send(0x00b0, target=edit)  # EM_GETSEL
            assert selection >> 16 > selection & 0xffff
            value = ctypes.create_unicode_buffer(128)

            def editor_contains(text):
                user32.UpdateWindow(hwnd)
                send(0x000d, len(value), ctypes.addressof(value), target=edit)  # WM_GETTEXT
                return value.value == text

            wait_for(lambda: editor_contains('menu 30,76'))
            point = wintypes.POINT(20, 12)
            assert user32.ClientToScreen(edit, ctypes.byref(point))
            send(0x007b, edit, pack_point(point.x, point.y), target=edit)  # WM_CONTEXTMENU
            wait_for(lambda: editor_contains('edit menu'))

            # Open the native edit menu on a read-only field that has never had focus.
            previous_edit = edit
            assert user32.PostMessageW(hwnd, 0x0205, 0, pack_point(30, 183))
            def new_editor():
                current = user32.GetDlgItem(hwnd, 200)
                return current if current != previous_edit else None

            edit = wait_for(new_editor)
            owner = wait_for(menu_owner)
            send(0x001f, target=owner)  # WM_CANCELMODE
            wait_for(lambda: not menu_owner())
            send(0x00b1, 0, -1, target=edit)  # EM_SETSEL selects all.
            selection = send(0x00b0, target=edit)
            assert selection == len('read only text') << 16
            send(0x0102, ord('X'), target=edit)  # WM_CHAR
            send(0x000d, len(value), ctypes.addressof(value), target=edit)
            assert value.value == 'read only text'

            click(100)
            wait_for(lambda: user32.IsZoomed(hwnd))
            click(100)
            wait_for(lambda: not user32.IsZoomed(hwnd))
            click(150)
            wait_for(lambda: user32.IsIconic(hwnd))
            send(0x0112, 0xf120)  # WM_SYSCOMMAND, SC_RESTORE
            wait_for(lambda: not user32.IsIconic(hwnd))
            click(34)
            assert app.wait(timeout=10) == 0
        finally:
            if app.poll() is None:
                app.kill()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('reactc', type=Path)
    args = parser.parse_args()
    dist = ROOT / 'dist'
    dist.mkdir(exist_ok=True)
    with TemporaryDirectory(prefix='window-chrome-', dir=dist) as temporary:
        folder = Path(temporary)
        entry = folder / 'app.tsx'
        entry.write_text(ENTRY, encoding='utf-8')
        output = dist / 'reactc' / 'window-chrome'
        subprocess.run([str(args.reactc.resolve()), 'build', str(entry.relative_to(ROOT)), '--target', 'windows',
                        '--name', 'WindowChrome', '--title', TITLE, '--outdir', str(output.relative_to(ROOT))],
                       cwd=ROOT, check=True, timeout=300)
        executable = output / 'WindowChrome.exe'
        subprocess.run([str(executable), '--smoke'], cwd=output, check=True, timeout=30)
        snapshot = json.loads((output / 'native-app-smoke.json').read_text(encoding='utf-8'))
        titlebar = snapshot['tree']['children'][0]
        assert titlebar['props']['data-native-window-titlebar']
        assert titlebar['children'][1]['children'][0]['props']['text'] == '−'

        bmp = (output / 'native-app-smoke.bmp').read_bytes()
        offset, = struct.unpack_from('<I', bmp, 10)
        width, height = struct.unpack_from('<ii', bmp, 18)
        assert height < 0
        for x, y, color in [(5, 20, '4f3421'), (5, 50, '42aeff'),
                            (width - 36, 16, '3a2a84'), (width - 13, 10, '3a2a84'),
                            (width - 8, 16, '4f3421')]:
            pixel = offset + (y * width + x) * 4
            assert bmp[pixel:pixel + 3] == bytes.fromhex(color)
        close_glyph = []
        for y in range(8, 44):
            for x in range(width - 58, width - 12):
                pixel = offset + (y * width + x) * 4
                if min(bmp[pixel:pixel + 3]) > 170:
                    close_glyph.append((x, y))
        assert close_glyph
        assert min(x for x, _ in close_glyph) > width - 37
        assert min(y for _, y in close_glyph) > 25
        check_window(executable)
    print('PASS: relative and parent-anchored caption buttons, Win32 controls, text selection, and React right-click')


if __name__ == '__main__':
    main()
