"""Run the full native fetch app as a Windows executable against a local echo server.

Run with a Windows Python from the checkout:

    python scripts/check-reactc-fetch-windows.py compiler/target/debug/reactc.exe

The app sends PUT, PATCH, DELETE, OPTIONS and POST requests with an
Authorization header through the Windows host (WinHTTP) and reads status
text, response headers and bodies. The rendered result is read from the
executable's --smoke snapshot.
"""
import argparse
from http.server import ThreadingHTTPServer
import importlib.util
import json
from pathlib import Path
import subprocess
from tempfile import TemporaryDirectory
import threading

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('reactc_http', ROOT / 'scripts' / 'check-reactc-http.py')
http_check = importlib.util.module_from_spec(spec)
spec.loader.exec_module(http_check)


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('reactc', type=Path)
    reactc = parser.parse_args().reactc.resolve()
    dist = ROOT / 'dist'
    dist.mkdir(exist_ok=True)
    with TemporaryDirectory(prefix='reactc-fetch-', dir=dist) as directory, \
            ThreadingHTTPServer(('127.0.0.1', 0), http_check.FullHandler) as server:
        folder = Path(directory)
        worker = threading.Thread(target=server.serve_forever)
        worker.start()
        try:
            entry = folder / 'full.tsx'
            entry.write_text(http_check.FULL_ENTRY, encoding='utf-8')
            output = folder / 'windows'
            subprocess.run([str(reactc), 'build', str(entry), '--http-origin', f'http://127.0.0.1:{server.server_port}',
                            '--target', 'windows', '--name', 'FetchProbe', '--outdir', str(output)],
                           cwd=ROOT, check=True, timeout=600)
            subprocess.run([str(output / 'FetchProbe.exe'), '--smoke'], cwd=output, check=True, timeout=60)
            snapshot = json.loads((output / 'native-app-smoke.json').read_text(encoding='utf-8'))
            result = http_check.text_of(http_check.find(snapshot, 'result'))
            assert result == http_check.FULL_EXPECTED, result
        finally:
            server.shutdown()
            worker.join()
    print('PASS: Windows WinHTTP fetch sent every method with Authorization, bodies and Headers, '
          'and returned status text and response headers')


if __name__ == '__main__':
    main()
