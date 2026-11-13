"""Portable subprocess pipes: Windows select() cannot wait on file handles."""
import os
from pathlib import Path
import queue
import shutil
import subprocess
import threading


class Lines:
    def __init__(self,stream):
        self.items=queue.Queue()
        def reader():
            try:
                for line in stream:self.items.put(line)
            except (OSError,ValueError):pass
            finally:self.items.put(None)
        self.thread=threading.Thread(target=reader,daemon=True)
        self.thread.start()

    def read(self,timeout=10):
        try:return self.items.get(timeout=timeout)
        except queue.Empty:raise TimeoutError('Subprocess response timed out') from None


def core_command(binary,wsl=False,distro='Ubuntu'):
    if not wsl:return str(Path(binary).resolve())
    if os.name!='nt':raise ValueError('--wsl is for a Windows host; Linux can run the core directly')
    executable=shutil.which('wsl.exe')
    if not executable:raise ValueError('WSL is not installed. See docs/windows.md')
    prefix=[executable,'--distribution',distro,'--exec']
    result=subprocess.run(prefix+['wslpath','-a','-u',str(Path(binary).resolve())],capture_output=True,text=True,timeout=20)
    path=result.stdout.strip()
    if result.returncode or not path.startswith('/') or '\n' in path:
        raise ValueError('Could not map the native core path into WSL')
    return prefix+[path]
