/* Windows x64 arena adapter for the pinned Porffor C backend.
 * MinGW supplies native Windows clock_gettime/nanosleep; link it statically.
 * Reserve the 4 GiB arena, commit on demand, and zero discarded GC ranges.
 */
#if !defined(_WIN32) || !defined(_WIN64)
#error Windows runtime requires a Windows x64 C target
#endif
/* Porffor handles its own JS exception unwinding. Restore the saved C context
 * directly to avoid the CRT trying to unwind coroutine frames through SEH. */
#define __USE_MINGW_SETJMP_NON_SEH
#define WIN32_LEAN_AND_MEAN
#include <winsock2.h>
#include <ws2tcpip.h>
#include <windows.h>
#include <bcrypt.h>
#include <psapi.h>
#include <io.h>
#include <fcntl.h>
#include <errno.h>
#include <stdint.h>
#include <time.h>
#include <stdlib.h>
#include <string.h>
#include <wchar.h>
#include <direct.h>
#include <tlhelp32.h>
#ifndef SIGKILL
#define SIGKILL 9
#endif

/* Shell commands arrive as Node builds them on Windows: cmd.exe /d /s /c
 * "<command>". cmd does not parse C runtime quoting, so libuv must pass them
 * verbatim (Node sets windowsVerbatimArguments for the same reason). */
static inline int porf_win_verbatim_shell(const char *file, char **argv) {
  if (!file || !argv) return 0;
  const char *base = file + strlen(file);
  while (base > file && base[-1] != '\\' && base[-1] != '/') base--;
  return (!_stricmp(base, "cmd.exe") || !_stricmp(base, "cmd")) && argv[0] && argv[1] && argv[2] && argv[3] &&
    argv[4] && !argv[5] && !strcmp(argv[1], "/d") && !strcmp(argv[2], "/s") && !strcmp(argv[3], "/c") &&
    argv[4][0] == '"';
}

static inline int porf_win_entropy(void *buffer, size_t length) {
  return BCryptGenRandom(NULL, buffer, (ULONG)length, BCRYPT_USE_SYSTEM_PREFERRED_RNG) != 0;
}
#define PROT_NONE 0
#define PROT_READ 1
#define PROT_WRITE 2
#define MAP_PRIVATE 1
#define MAP_ANONYMOUS 2
#define MAP_FIXED 4
#define MAP_FAILED ((void*)-1)
#define MADV_DONTNEED 4
static void *mmap(void *at, size_t len, int prot, int flags, int fd, int64_t off) {
  if (fd != -1 || !(flags & MAP_ANONYMOUS) || off != 0) {
    errno = ENOSYS;
    return MAP_FAILED;
  }
  if (flags & MAP_FIXED) {
    // Porffor trims the arena tail while retaining its address reservation.
    if (prot != PROT_NONE || !VirtualFree(at, len, MEM_DECOMMIT)) {
      errno = ENOMEM;
      return MAP_FAILED;
    }
    return at;
  }
  DWORD mode = MEM_RESERVE | (prot == PROT_NONE ? 0 : MEM_COMMIT);
  DWORD protection = prot == PROT_NONE ? PAGE_NOACCESS : PAGE_READWRITE;
  void *p = VirtualAlloc(at, len, mode, protection);
  if (!p && at) p = VirtualAlloc(NULL, len, mode, protection);
  if (!p) errno = ENOMEM;
  return p ? p : MAP_FAILED;
}
static int mprotect(void *at, size_t len, int prot) {
  if (prot != (PROT_READ | PROT_WRITE)) { errno = ENOSYS; return -1; }
  if (VirtualAlloc(at, len, MEM_COMMIT, PAGE_READWRITE)) return 0;
  errno = ENOMEM;
  return -1;
}
static int madvise(void *at, size_t len, int advice) {
  if (advice != MADV_DONTNEED) { errno = ENOSYS; return -1; }
  // MEM_RESET does not guarantee zeroes. Decommit/recommit preserves the
  // reservation and provides the zeroed storage expected by Porffor's GC.
  if (VirtualFree(at, len, MEM_DECOMMIT) &&
      VirtualAlloc(at, len, MEM_COMMIT, PAGE_READWRITE)) return 0;
  errno = ENOMEM;
  return -1;
}

/* Porffor's stream internals also initialize its Node process support. */
static char *porf_win_path_utf8(const wchar_t *path) {
  int size = WideCharToMultiByte(CP_UTF8, WC_ERR_INVALID_CHARS, path, -1, NULL, 0, NULL, NULL);
  if (!size) { errno = EINVAL; return NULL; }
  char *bytes = malloc((size_t)size);
  if (!bytes) { errno = ENOMEM; return NULL; }
  if (WideCharToMultiByte(CP_UTF8, WC_ERR_INVALID_CHARS, path, -1, bytes, size, NULL, NULL)) return bytes;
  free(bytes);
  errno = EINVAL;
  return NULL;
}

/* The Node loader can need realpath without the async filesystem backend. */
static wchar_t *porf_win_fs_path(const char *utf8) {
  int count = MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, utf8, -1, NULL, 0);
  if (!count) { errno = EINVAL; return NULL; }
  wchar_t *path = malloc((size_t)count * sizeof(*path));
  if (!path) { errno = ENOMEM; return NULL; }
  if (MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, utf8, -1, path, count)) return path;
  free(path);
  errno = EINVAL;
  return NULL;
}

static int porf_win_fs_error(DWORD code) {
  switch (code) {
    case ERROR_FILE_NOT_FOUND: case ERROR_PATH_NOT_FOUND: case ERROR_INVALID_DRIVE: return ENOENT;
    case ERROR_DIRECTORY: return ENOTDIR;
    case ERROR_FILE_EXISTS: case ERROR_ALREADY_EXISTS: return EEXIST;
    case ERROR_ACCESS_DENIED: case ERROR_SHARING_VIOLATION: case ERROR_LOCK_VIOLATION: return EACCES;
    case ERROR_DISK_FULL: case ERROR_HANDLE_DISK_FULL: return ENOSPC;
    case ERROR_DIR_NOT_EMPTY: return ENOTEMPTY;
    case ERROR_NOT_SAME_DEVICE: return EXDEV;
    case ERROR_FILENAME_EXCED_RANGE: return ENAMETOOLONG;
    case ERROR_INVALID_NAME: case ERROR_INVALID_PARAMETER: return EINVAL;
    case ERROR_NOT_ENOUGH_MEMORY: case ERROR_OUTOFMEMORY: return ENOMEM;
    default: return EIO;
  }
}

static char *porf_win_fs_realpath(const wchar_t *path) {
  HANDLE file = CreateFileW(path, 0, FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
    NULL, OPEN_EXISTING, FILE_FLAG_BACKUP_SEMANTICS, NULL);
  if (file == INVALID_HANDLE_VALUE) { errno = porf_win_fs_error(GetLastError()); return NULL; }
  wchar_t resolved[32768];
  DWORD capacity = sizeof(resolved) / sizeof(*resolved);
  DWORD length = GetFinalPathNameByHandleW(file, resolved, capacity, FILE_NAME_NORMALIZED);
  DWORD error = GetLastError();
  CloseHandle(file);
  if (!length || length >= capacity) {
    errno = length ? ENAMETOOLONG : porf_win_fs_error(error);
    return NULL;
  }
  const wchar_t *name = resolved;
  if (!wcsncmp(resolved, L"\\\\?\\UNC\\", 8)) {
    resolved[6] = L'\\';
    name += 6;
  } else if (!wcsncmp(resolved, L"\\\\?\\", 4) && resolved[5] == L':') {
    name += 4;
  }
  return porf_win_path_utf8(name);
}

static char *porf_win_fs_realpath_utf8(const char *utf8) {
  wchar_t *path = porf_win_fs_path(utf8);
  if (!path) return NULL;
  char *resolved = porf_win_fs_realpath(path);
  free(path);
  return resolved;
}

static char *porf_win_getcwd(void) {
  wchar_t *path = _wgetcwd(NULL, 0);
  if (!path) return NULL;
  char *bytes = porf_win_path_utf8(path);
  free(path);
  return bytes;
}

static char *porf_win_executable(void) {
  wchar_t path[32768];
  DWORD length = GetModuleFileNameW(NULL, path, sizeof(path) / sizeof(*path));
  return length && length < sizeof(path) / sizeof(*path) ? porf_win_path_utf8(path) : NULL;
}

static DWORD porf_win_parent_pid(void) {
  HANDLE snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
  if (snapshot == INVALID_HANDLE_VALUE) return 0;
  DWORD pid = GetCurrentProcessId(), parent = 0;
  PROCESSENTRY32W entry = { .dwSize = sizeof(entry) };
  if (Process32FirstW(snapshot, &entry)) do {
    if (entry.th32ProcessID == pid) { parent = entry.th32ParentProcessID; break; }
  } while (Process32NextW(snapshot, &entry));
  CloseHandle(snapshot);
  return parent;
}

static void porf_win_console_size(int fd, double *columns, double *rows) {
  CONSOLE_SCREEN_BUFFER_INFO screen;
  intptr_t handle = _get_osfhandle(fd);
  if (handle != -1 && GetConsoleScreenBufferInfo((HANDLE)handle, &screen)) {
    *columns = screen.srWindow.Right - screen.srWindow.Left + 1;
    *rows = screen.srWindow.Bottom - screen.srWindow.Top + 1;
  }
}

/* In-process cores write protocol output to the host through memory. The
 * macros are defined after <stdio.h> so its declarations stay intact. */
#ifdef NATIVE_CORE_IN_PROCESS
#include <stdio.h>
long long native_core_read(void *buffer, unsigned length);
long long native_core_write(int descriptor, const void *buffer, unsigned length);
int native_core_printf(const char *format, ...);
int native_core_putchar(int character);
size_t native_core_fwrite(const void *data, size_t size, size_t count, FILE *stream);
int native_core_fputs(const char *text, FILE *stream);
int native_core_fputc(int character, FILE *stream);
void native_core_console_stderr(int enabled);
#define printf native_core_printf
#define putchar native_core_putchar
#define fwrite native_core_fwrite
#define fputs native_core_fputs
#define fputc native_core_fputc
#define PORF_CONSOLE_STDERR_BEGIN native_core_console_stderr(1)
#define PORF_CONSOLE_STDERR_END native_core_console_stderr(0)
#else
#define PORF_CONSOLE_STDERR_BEGIN fflush(stdout); const int porf_out = dup(1); dup2(2, 1)
#define PORF_CONSOLE_STDERR_END fflush(stdout); dup2(porf_out, 1); close(porf_out)
#endif
