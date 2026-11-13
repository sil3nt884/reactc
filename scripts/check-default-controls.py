"""Verify default control borders and themed window chrome for unstyled controls."""
import argparse
from contextlib import closing
import json
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'host'))
from native_page import Session, find, text_of

DEFAULT_BORDER = 0x8f959e  # light-document default control border
TINTED_BORDER = 0xd22f8c
CUSTOM_BORDER = 0x5c9bff
LIGHT_BANNER = 0xe9ebee
DARK_BANNER = 0x16181c


def style(snapshot, node_id):
    return find(snapshot, node_id)['props'].get('style', {})


def check_tree(snapshot):
    border_keys = {'borderWidth', 'borderTopWidth', 'borderBottomWidth', 'borderLeftWidth', 'borderRightWidth'}
    for node_id in ('plain-input', 'plain-notes', 'plain-button', 'tinted-input'):
        assert not border_keys & style(snapshot, node_id).keys(), f'{node_id} must rely on the default border'
    assert style(snapshot, 'tinted-input')['borderColor'] == '#d22f8c'
    assert style(snapshot, 'borderless-input')['borderWidth'] == 0
    assert style(snapshot, 'custom-input')['borderWidth'] == 2
    assert snapshot['tree']['props']['style']['backgroundColor'] == '#ffffff'


def check_host(executable):
    with closing(Session(str(executable))) as page:
        check_tree(page.snapshot)
        page.event('plain-input', 'change', 'Ada Ω')
        page.event('plain-button', 'press')
        assert text_of(find(page.snapshot, 'summary')) == 'Ada Ω / 1'
        check_tree(page.snapshot)


def pixels(bitmap):
    """Yield RGB values of an uncompressed 24- or 32-bit BMP."""
    offset = int.from_bytes(bitmap[10:14], 'little')
    width = int.from_bytes(bitmap[18:22], 'little', signed=True)
    height = abs(int.from_bytes(bitmap[22:26], 'little', signed=True))
    depth = int.from_bytes(bitmap[28:30], 'little') // 8
    assert bitmap.startswith(b'BM') and depth in (3, 4)
    stride = (width * depth + 3) & ~3
    for row in range(height):
        start = offset + row * stride
        for column in range(width):
            b, g, r = bitmap[start + column * depth:start + column * depth + 3]
            yield r << 16 | g << 8 | b


def near(color, target, tolerance=10):
    return all(abs((color >> shift & 255) - (target >> shift & 255)) <= tolerance for shift in (16, 8, 0))


def check_windows(executable):
    snapshot = executable.parent / 'native-app-smoke.json'
    snapshot.unlink(missing_ok=True)
    subprocess.run([str(executable), '--smoke'], cwd=executable.parent, check=True, timeout=30)
    tree = json.loads(snapshot.read_text(encoding='utf-8'))
    check_tree(tree)
    # Without a WindowTitleBar, Windows builds get the default frame.
    frame = tree['tree']['children'][0]
    assert frame['props']['data-native-window-titlebar'] is True, frame
    assert frame['props']['style']['backgroundColor'] == '#e9ebee'  # follows the light root
    assert [child['props'].get('data-native-window-command') for child in frame['children'][1:]] == [
        'minimize', 'maximize', 'close']
    assert text_of(frame['children'][0]) == 'Default controls'
    counts = {name: 0 for name in ('default', 'tinted', 'custom', 'light', 'dark')}
    for color in pixels((executable.parent / 'native-app-smoke.bmp').read_bytes()):
        counts['default'] += near(color, DEFAULT_BORDER)
        counts['tinted'] += near(color, TINTED_BORDER, 24)  # 1px edges are antialiased
        counts['custom'] += near(color, CUSTOM_BORDER)
        counts['light'] += color == LIGHT_BANNER
        counts['dark'] += color == DARK_BANNER
    # Each default border spans hundreds of pixels; the banner is 40px tall.
    assert counts['default'] > 200, counts
    assert counts['tinted'] > 60 and counts['custom'] > 100, counts
    assert counts['light'] > 1000 and counts['dark'] == 0, counts
    check_editor_overlay(executable)
    print('PASS: Windows Skia drew default and tinted control borders, light window chrome and a field-coloured editor')


def check_editor_overlay(executable):
    """The native edit control takes the field's colours, not a fixed dark fill."""
    import importlib.util
    import time
    from tempfile import TemporaryDirectory
    sys.path.insert(0, str(ROOT / 'scripts'))
    spec = importlib.util.spec_from_file_location('notes_win32', ROOT / 'scripts' / 'check-original-notes-win32.py')
    win = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(win)
    with TemporaryDirectory(prefix='reactc-default-controls-') as folder, \
            subprocess.Popen([str(executable)], cwd=folder) as app:
        try:
            hwnd = win.wait_for(lambda: win.find(app.pid, 'PTPorfforSkiaNative', 'Default controls'), 'Missing window')
            window = win.Window.__new__(win.Window)
            window.app, window.hwnd = app, hwnd
            time.sleep(1)
            # The default frame replaces the system caption and the Licenses menu bar.
            import ctypes
            from ctypes import wintypes
            user32 = ctypes.WinDLL('user32')
            user32.GetMenu.argtypes, user32.GetMenu.restype = [wintypes.HWND], wintypes.HMENU
            assert not user32.GetMenu(hwnd), 'The default frame kept the menu bar'
            outer, inner = wintypes.RECT(), wintypes.RECT()
            user32.GetWindowRect(hwnd, ctypes.byref(outer))
            user32.GetClientRect(hwnd, ctypes.byref(inner))
            assert inner.bottom == outer.bottom - outer.top, 'The system caption is still shown'
            left, top, right, bottom = window.client_rect(window.editor(200, 134))
            time.sleep(.5)
            inside = window.capture(left + 2, top + 2, right - 2, bottom - 2)
            colors = [inside[i + 2] << 16 | inside[i + 1] << 8 | inside[i] for i in range(0, len(inside), 4)]
            white = sum(color == 0xffffff for color in colors)
            assert white > len(colors) * .8, f'editor overlay is not the field colour: {white}/{len(colors)} white'
            win.send(hwnd, 0x0010)
            assert app.wait(timeout=8) == 0
        finally:
            if app.poll() is None:
                app.kill()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('host', type=Path)
    parser.add_argument('--windows', type=Path)
    args = parser.parse_args()
    check_host(args.host.resolve())
    if args.windows:
        check_windows(args.windows.resolve())
    print('PASS: unstyled controls keep default borders; border-color tints, border width 0 removes, and edits work')


if __name__ == '__main__':
    main()
