"""Verify page keyboard events and Windows keyboard defaults.

The host protocol checks cover element onKeyDown bubbling, preventDefault,
Enter submission and (with --window-keys) window and document listeners. The
Windows checks post key messages: they cover Tab focus traversal, Enter and
Space activation, Enter submission from the native editor and function keys.
Posted messages carry no modifier state, so Ctrl and Shift shortcuts are
covered by the protocol checks only.
"""
import argparse
from contextlib import closing
import importlib.util
from pathlib import Path
import subprocess
import sys
from tempfile import TemporaryDirectory
import time

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'host'))
from native_page import Session, find, text_of


def key(page, name, target=None, ctrl=False, shift=False):
    page.send({'type': 'key', 'key': name, 'shiftKey': shift, 'ctrlKey': ctrl, 'altKey': False,
               'metaKey': False, 'repeat': False, 'target': target})
    return page.snapshot.get('keyDefaultPrevented', False)


def node_id(page, public_id):
    return find(page.snapshot, public_id)['id']


def status(page):
    return text_of(find(page.snapshot, 'status'))


def check_host(executable):
    with closing(Session(str(executable))) as page:
        assert page.snapshot.get('keyListeners') is True
        name = find(page.snapshot, 'name')
        assert 'submit' in name['props'] and 'keyDown' in name['props']
        page.event('name', 'change', 'Ada Ω')
        page.event('name', 'submit')
        assert status(page) == 'submitted Ada Ω / presses 0 / last none', status(page)
        assert key(page, 's', node_id(page, 'name'), ctrl=True) is False
        assert status(page).endswith('last s+ctrl'), status(page)
        assert key(page, 'Escape', node_id(page, 'name')) is True
        assert find(page.snapshot, 'name')['props']['value'] == ''
        # A key on a nested button bubbles to its ancestor's onKeyDown.
        assert key(page, 'F2', node_id(page, 'second')) is False
        assert status(page).endswith('last panel F2'), status(page)
        assert key(page, 'F3') is False
        assert status(page).endswith('last panel F2')


def check_window_keys(executable):
    with closing(Session(str(executable))) as page:
        assert page.snapshot.get('keyListeners') is True
        assert key(page, 's', ctrl=True) is True
        assert text_of(find(page.snapshot, 'log')) == 'saved'
        assert key(page, 'F1') is False
        assert text_of(find(page.snapshot, 'log')) == 'help'
        assert key(page, 'x') is False


def gui():
    spec = importlib.util.spec_from_file_location('notes_win32', ROOT / 'scripts' / 'check-original-notes-win32.py')
    win = importlib.util.module_from_spec(spec)
    sys.path.insert(0, str(ROOT / 'scripts'))
    spec.loader.exec_module(win)
    return win


def post_key(win, hwnd, virtual_key, modifiers=()):
    """Post WM_KEYDOWN. Modifiers are set in the keyboard state the app thread
    shares with this thread while their input queues are attached."""
    if not modifiers:
        assert win.user.PostMessageW(hwnd, 0x0100, virtual_key, 1)  # WM_KEYDOWN, repeat count 1
        return
    c = win.c
    user, kernel = c.WinDLL('user32'), c.WinDLL('kernel32')
    user.GetWindowThreadProcessId.restype = c.c_ulong
    target = user.GetWindowThreadProcessId(c.c_void_p(hwnd), None)
    here = kernel.GetCurrentThreadId()
    assert user.AttachThreadInput(here, target, True)
    try:
        state = (c.c_ubyte * 256)()
        assert user.GetKeyboardState(state)
        for modifier in modifiers:
            state[modifier] |= 0x80
        assert user.SetKeyboardState(state)
        assert win.user.PostMessageW(hwnd, 0x0100, virtual_key, 1)
        time.sleep(.15)  # long enough for the app to retrieve the message; shorter than a page round trip
        for modifier in modifiers:
            state[modifier] &= ~0x80
        user.SetKeyboardState(state)
    finally:
        user.AttachThreadInput(here, target, False)


def launch(win, executable, title):
    folder = TemporaryDirectory(prefix='reactc-keys-')
    app = subprocess.Popen([str(executable)], cwd=folder.name)
    hwnd = win.wait_for(lambda: win.find(app.pid, 'PTPorfforSkiaNative', title), f'Missing {title} window')
    window = win.Window.__new__(win.Window)
    window.app, window.hwnd = app, hwnd
    win.user.SetWindowPos(hwnd, None, 60, 60, 520, 640, 0x0014)
    time.sleep(1)
    return folder, app, window


def close(win, folder, app, window):
    try:
        win.send(window.hwnd, 0x0010)
        assert app.wait(timeout=8) == 0
        assert not (Path(folder.name) / 'native-app-error.log').exists(), 'Native app reported an error'
    finally:
        if app.poll() is None:
            app.kill()
        folder.cleanup()


def check_windows(executable):
    win = gui()
    folder, app, window = launch(win, executable, 'Keyboard shortcuts')
    try:
        client = (0, 0, 500, 560)
        editor = lambda: win.user.GetDlgItem(window.hwnd, 200)
        post_key(win, window.hwnd, 0x09)  # Tab: the first stop is the name field
        field = win.wait_for(editor, 'Tab did not focus the name field')
        text = win.c.create_unicode_buffer('Ada')
        win.send(field, 0x00c2, 1, win.c.addressof(text))  # EM_REPLACESEL
        # Below the edit control, so its caret cannot change the capture.
        below = (0, window.client_rect(field)[3] + 12, 500, 560)
        time.sleep(.3)
        pending = window.capture(*below)
        post_key(win, field, 0x0d)  # Enter submits the form; the status line changes
        win.wait_for(lambda: window.capture(*below) != pending, 'Enter in the field did not submit the form')
        post_key(win, field, 0x09)  # Tab leaves the field for the submit button
        win.wait_for(lambda: not editor(), 'Tab did not leave the name field')
        submitted = win.wait_for(lambda: window.capture(*client), 'Cannot capture the window')
        post_key(win, window.hwnd, 0x09)  # Tab to "First"
        win.wait_for(lambda: window.capture(*client) != submitted, 'Tab did not draw a focus ring on First')
        time.sleep(.3)
        focused = window.capture(*client)
        post_key(win, window.hwnd, 0x0d)  # Enter presses First
        win.wait_for(lambda: window.capture(*client) != focused, 'Enter did not press the focused button')
        time.sleep(.3)
        once = window.capture(*client)
        post_key(win, window.hwnd, 0x20)  # Space presses First again
        win.wait_for(lambda: window.capture(*client) != once, 'Space did not press the focused button')
        time.sleep(.3)
        twice = window.capture(*client)
        post_key(win, window.hwnd, 0x09)  # Tab to "Second", inside the panel
        win.wait_for(lambda: window.capture(*client) != twice, 'Tab did not move focus to Second')
        time.sleep(.3)
        second = window.capture(*client)
        post_key(win, window.hwnd, 0x71)  # F2 bubbles to the panel's onKeyDown
        win.wait_for(lambda: window.capture(*client) != second, 'F2 did not reach the page')
        post_key(win, window.hwnd, 0x09)  # Tab past the last stop clears focus
        post_key(win, window.hwnd, 0x09)  # and the next Tab starts again at the name field
        field = win.wait_for(editor, 'Tab did not wrap to the name field')
        window_text = lambda: (lambda buffer: (win.send(field, 0x000d, len(buffer), win.c.addressof(buffer)),
                                              buffer.value)[1])(win.c.create_unicode_buffer(256))
        replacement = win.c.create_unicode_buffer('Ada Lovelace')  # kept alive until sent
        win.send(field, 0x000c, 0, win.c.addressof(replacement))  # WM_SETTEXT
        win.send(field, 0x00b1, 12, 12)  # caret at the end
        post_key(win, field, 0x08, (0x11,))  # Ctrl+Backspace deletes the previous word
        try:
            win.wait_for(lambda: window_text() == 'Ada ', 'Ctrl+Backspace did not delete the previous word')
        except AssertionError:
            raise AssertionError(f'Ctrl+Backspace left {window_text()!r}') from None
        post_key(win, field, ord('A'), (0x11,))  # Ctrl+A selects all
        start, end = win.c.c_ulong(), win.c.c_ulong()
        win.send(field, 0x00b0, win.c.addressof(start), win.c.addressof(end))  # EM_GETSEL
        assert (start.value, end.value) == (0, 4), (start.value, end.value)
        post_key(win, field, 0x09, (0x10,))  # Shift+Tab from the first stop leaves the page
        win.wait_for(lambda: not editor(), 'Shift+Tab did not leave the name field')
    finally:
        close(win, folder, app, window)
    print('PASS: Windows Tab and Shift+Tab traversal, Enter submission, Enter and Space activation, F2, '
          'Ctrl+Backspace and Ctrl+A')


def check_windows_window_keys(executable):
    win = gui()
    folder, app, window = launch(win, executable, 'Window keys')
    try:
        client = (0, 0, 500, 300)
        before = window.capture(*client)
        post_key(win, window.hwnd, 0x70)  # F1 reaches the document listener
        win.wait_for(lambda: window.capture(*client) != before, 'F1 did not reach the document listener')
    finally:
        close(win, folder, app, window)
    print('PASS: Windows delivered F1 to a document keydown listener')


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('host', type=Path, help='compiled examples/keyboard-shortcuts.tsx core')
    parser.add_argument('--window-keys', type=Path, help='reactc host build of scripts/fixtures/reactc-window-keys')
    parser.add_argument('--windows', type=Path, help='Windows build of the example')
    parser.add_argument('--windows-window-keys', type=Path, help='Windows build of the fixture')
    args = parser.parse_args()
    if args.host.suffix != '.exe':
        check_host(args.host.resolve())
        if args.window_keys:
            check_window_keys(args.window_keys.resolve())
    if args.windows:
        check_windows(args.windows.resolve())
    if args.windows_window_keys:
        check_windows_window_keys(args.windows_window_keys.resolve())
    print('PASS: keyboard events bubble from the focused node to window listeners; preventDefault and Enter submission work')


if __name__ == '__main__':
    main()
