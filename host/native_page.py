"""Native Tk widgets hosting a persistent Porffor executable. No WebView.

The host owns widgets, I/O and HTTP. Compiled TSX owns state, validation and
action callbacks. --demo uses a local example server, never the PT service.
"""
import argparse
import json
import queue
import shutil
import subprocess
import sys
import threading
import time
import urllib.request
from pathlib import Path
from process_io import Lines,core_command
from native_http import read_http
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


def text_of(node):
    return node.get('props', {}).get('text', '') + ''.join(text_of(child) for child in node.get('children', []))


def find(snapshot, element_id):
    def walk(node):
        if node.get('props', {}).get('id') == element_id:
            return node
        for child in node.get('children', []):
            result = walk(child)
            if result:
                return result
    return walk(snapshot['tree'])


def wasi_command(binary, runner=None, directories=(), *, runtime=None):
    if runtime:
        command = [runtime]
    else:
        local = Path(__file__).resolve().parents[1] / 'tools' / 'wasmtime' / 'wasmtime'
        runner = runner or (str(local) if local.is_file() and sys.platform.startswith('linux') else shutil.which('wasmtime'))
        if not runner:
            raise ValueError('Install Wasmtime or pass --wasmtime with its executable path')
        command = [runner, 'run', '-W', 'exceptions=y', '-O', 'opt-level=0']
    for directory in directories:
        command.extend(['--dir', directory])
    return command + [str(Path(binary).resolve())]


class Session:
    def __init__(self, binary, transport=None, startup_timeout=10):
        self.transport = transport
        self.process = subprocess.Popen(binary if isinstance(binary,list) else [binary], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                        stderr=subprocess.PIPE, text=True, encoding='utf-8', bufsize=1)
        self.lines = Lines(self.process.stdout)
        # Drain stderr without logging potentially sensitive process state.
        def drain_errors():
            try:
                while self.process.stderr.read(4096):pass
            except (OSError,ValueError):pass
        threading.Thread(target=drain_errors,daemon=True).start()
        try:self.snapshot = self.receive(startup_timeout)
        except Exception:
            self.close()
            raise

    def receive(self, timeout=10):
        for _ in range(257):
            try:line=self.lines.read(timeout)
            except TimeoutError:
                raise RuntimeError('Compiled page timed out')
            if not line:
                raise RuntimeError('Compiled page exited unexpectedly')
            value = json.loads(line)
            kind = value.get('type')
            if value.get('version') != 1:
                raise RuntimeError('Invalid page protocol version')
            if kind == 'snapshot':
                self.snapshot = value
                return value
            if self.transport and kind == 'requests' and len(value['requests']) == 1:
                request = value['requests'][0]
                self.write({'type': 'result', 'id': request['id'], 'result': self.transport(request)})
            elif self.transport and kind == 'wait':
                time.sleep(max(0, value['wakeAt'] / 1000 - time.time()))
                self.write({'type': 'tick'})
            else:
                raise RuntimeError(value.get('error', 'Invalid page protocol'))
        raise RuntimeError('Too many blocking native frames')

    def write(self, command):
        self.process.stdin.write(json.dumps(command, ensure_ascii=True) + '\n')
        self.process.stdin.flush()

    def send(self, command):
        self.write(command)
        return self.receive()

    def event(self, element_id, event, value=None):
        node = find(self.snapshot, element_id)
        if not node or event not in node['props']:
            raise RuntimeError('Unknown native control')
        command = {'type': 'event', 'revision': self.snapshot['revision'], 'handler': node['props'][event]}
        if event == 'change':
            command['value'] = value
        return self.send(command)

    def close(self):
        if self.process.poll() is None:
            self.process.stdin.close()
            try:
                self.process.wait(timeout=3)
            except subprocess.TimeoutExpired:
                self.process.kill()
                self.process.wait()
        self.process.stdout.close()
        self.process.stderr.close()


class DemoServer(ThreadingHTTPServer):
    def __init__(self):
        super().__init__(('127.0.0.1', 0), DemoHandler)
        self.records = []
        self.fail_save = False


class DemoHandler(BaseHTTPRequestHandler):
    def do_POST(self):
        try:
            size = int(self.headers.get('Content-Length', '0'))
            if self.path != '/actions' or not 0 < size <= 65536:
                raise ValueError('Invalid request')
            request = json.loads(self.rfile.read(size))
            if request.get('version') != 1 or request.get('action') != 'profile.save':
                raise ValueError('Action denied')
            args = request['args']
            if not isinstance(args.get('fullName'), str) or not 1 <= len(args['fullName'].strip()) <= 100:
                raise ValueError('Invalid name')
            if type(args.get('heightCm')) not in (int, float) or not 30 <= args['heightCm'] <= 300:
                raise ValueError('Invalid height')
            if not isinstance(args.get('goals'), str) or len(args['goals']) > 1000:
                raise ValueError('Invalid goals')
            if self.server.fail_save:
                result = {'ok': False}
            else:
                self.server.records.append(args)
                result = {'ok': True}
            self.send_response(200)
        except (ValueError, KeyError, TypeError, json.JSONDecodeError):
            result = {'ok': False}
            self.send_response(400)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        self.wfile.write(json.dumps(result).encode())

    def log_message(self, *args):
        pass


def invoke(endpoint, request, allowed_actions=None):
    allowed_actions = allowed_actions or ['profile.save']
    if request.get('version') != 1 or request.get('action') not in allowed_actions:
        return {'ok': False}
    # Credentials, auth and CSRF integration are intentionally not implemented.
    payload = {key: request[key] for key in ('version', 'action', 'args')}
    message = urllib.request.Request(endpoint, data=json.dumps(payload).encode(),
                                     headers={'Content-Type': 'application/json'}, method='POST')
    try:
        with urllib.request.urlopen(message, timeout=5) as response:
            return json.load(response)
    except Exception:
        return {'ok': False}


class NativeWindow:
    def __init__(self, session, endpoint, allowed_actions=None, download_dir=None, renderer_class=None, geometry='600x780', transport=None):
        import tkinter as tk
        from widgets import NativeRenderer
        self.session, self.endpoint = session, endpoint
        self.allowed_actions = allowed_actions or ['profile.save']
        self.transport = transport
        self.download_dir = Path(download_dir or 'dist/downloads')
        self.root = tk.Tk()
        self.root.title('Porffor · native client · DEMO')
        self.root.geometry(geometry)
        self.root.minsize(360, 540)
        self.results = queue.Queue()
        self.renderer = (renderer_class or NativeRenderer)(self.root, self.event)
        self.root.protocol('WM_DELETE_WINDOW', self.root.destroy)
        self.apply(session.snapshot)
        self.root.after(30, self.poll_results)

    def event(self, node_id, event, value=None):
        node = self.renderer.nodes[node_id]
        command = {'type':'event', 'revision':self.session.snapshot['revision'], 'handler':node['props'][event]}
        if event == 'change':
            command['value'] = value
        self.apply(self.session.send(command))

    def apply(self, snapshot):
        self.renderer.apply(snapshot)
        for request in snapshot['requests']:
            def worker(message=request):
                result = self.transport(message) if self.transport else invoke(self.endpoint, message, self.allowed_actions)
                download = result.get('download')
                if result.get('ok') and download:
                    name, content = download.get('name', ''), download.get('content', '')
                    if name in ['demo-profile-export.json', 'demo-training-notes.txt'] and isinstance(content, str) and len(content) <= 1048576:
                        try:
                            self.download_dir.mkdir(parents=True, exist_ok=True)
                            target = self.download_dir / name
                            target.write_text(content, encoding='utf-8')
                            download['savedTo'] = str(target.resolve())
                        except OSError:
                            download['savedTo'] = 'Could not save file; preview remains available.'
                self.results.put({'type':'result', 'id':message['id'], 'result':result})
            threading.Thread(target=worker, daemon=True).start()

    def poll_results(self):
        while not self.results.empty():
            self.apply(self.session.send(self.results.get_nowait()))
        self.root.after(30, self.poll_results)


def smoke(session, endpoint, server):
    session.event('full-name', 'change', 'Ada Ω 😀')
    session.event('height', 'change', '181')
    session.event('goals', 'change', 'Run a 5K')
    snapshot = session.event('save', 'press')
    assert text_of(find(snapshot, 'status')) == 'Saving…'
    assert find(snapshot, 'save')['props']['disabled'] is True
    request = snapshot['requests'][0]
    result = session.send({'type':'result', 'id':request['id'], 'result':invoke(endpoint, request)})
    assert text_of(find(result, 'status')) == 'Saved successfully'
    assert server.records[-1] == {'fullName':'Ada Ω 😀', 'heightCm':181, 'goals':'Run a 5K'}
    session.event('height', 'change', '999')
    invalid = session.event('save', 'press')
    assert not invalid['requests']
    assert 'between 30 and 300' in text_of(find(invalid, 'status'))
    print('PASS: persistent native page edits, Unicode, validation, real localhost HTTP Save and result handling')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--binary', default='dist/page/app')
    endpoint = parser.add_mutually_exclusive_group(required=True)
    endpoint.add_argument('--demo', action='store_true')
    endpoint.add_argument('--server', help='Compatible development action endpoint; no authentication adapter yet')
    endpoint.add_argument('--http', action='store_true', help='Enable reactc HTTP requests')
    parser.add_argument('--smoke', action='store_true')
    parser.add_argument('--renderer', choices=['tk','skia'], default='tk')
    parser.add_argument('--wsl',action='store_true',help='Windows host with the Linux core in WSL; not a Windows .exe')
    parser.add_argument('--wsl-distro',default='Ubuntu')
    engine = parser.add_mutually_exclusive_group()
    engine.add_argument('--wasmtime', help='Wasmtime executable for a .wasm page')
    engine.add_argument('--wasm-runtime', help='Native reactc-runtime executable for a .wasm page')
    parser.add_argument('--wasi-dir', action='append', default=[], metavar='HOST[::GUEST]',
                        help='Grant a .wasm page access to a directory (repeatable)')
    parser.add_argument('--actions', help='JSON array of allowed development action IDs')
    args = parser.parse_args()
    try:
        wasm = Path(args.binary).suffix.lower() == '.wasm'
        if wasm:
            if args.wsl:
                parser.error('--wsl applies to Linux executables; run .wasm with Wasmtime')
            command = wasi_command(args.binary, args.wasmtime, args.wasi_dir, runtime=args.wasm_runtime)
        else:
            if args.wasmtime or args.wasm_runtime or args.wasi_dir:
                parser.error('--wasmtime, --wasm-runtime, and --wasi-dir require a .wasm page')
            command = core_command(args.binary, args.wsl, args.wsl_distro)
    except ValueError as error:
        parser.error(str(error))
    server = None
    if args.demo:
        server = DemoServer()
        threading.Thread(target=server.serve_forever, daemon=True).start()
        args.server = 'http://127.0.0.1:%s/actions' % server.server_port
    session = None
    try:
        transport = read_http if args.http else None
        session = Session(command, transport=transport, startup_timeout=60 if wasm else 10)
        if args.smoke:
            if not server:
                parser.error('--smoke requires --demo')
            smoke(session, args.server, server)
        else:
            allowed = json.loads(Path(args.actions).read_text()) if args.actions else None
            if args.renderer=='skia':
                from skia_renderer import SkiaRenderer
                window=NativeWindow(session,args.server,allowed,renderer_class=SkiaRenderer,geometry='390x844',transport=transport)
                window.root.title('Native app · Skia' if args.http else 'Web source · Skia · DEMO')
                window.root.minsize(320,540)
            else:
                window=NativeWindow(session,args.server,allowed,transport=transport)
                if args.http:
                    window.root.title('Native app')
            window.root.mainloop()
    finally:
        if session:
            session.close()
        if server:
            server.shutdown()
            server.server_close()


if __name__ == '__main__':
    main()
