/* Inserted after the pinned Porffor porf_fs_op definition. Its JS layer owns
 * argument validation, callbacks, promises, and stream lifecycle. */
#include <limits.h>

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

static int porf_win_fs_open(const wchar_t *path, int flags, int mode) {
  const int supported = _O_WRONLY | _O_RDWR | _O_APPEND | _O_CREAT | _O_TRUNC | _O_EXCL;
  if (flags & ~supported) { errno = ENOSYS; return -1; }
  int fd = _wopen(path, flags | _O_BINARY | _O_NOINHERIT,
    _S_IREAD | ((mode & 0200) ? _S_IWRITE : 0));
  // A GUI process can start without CRT stdio handles. Preserve descriptor
  // numbers 0 through 2 for the protocol even in that case.
  int reserved[3], count = 0;
  while (fd >= 0 && fd < 3) {
    reserved[count++] = fd;
    fd = _dup(fd);
  }
  int error = errno;
  while (count) _close(reserved[--count]);
  errno = error;
  if (fd < 0 && errno == EACCES) {
    DWORD attributes = GetFileAttributesW(path);
    if (attributes != INVALID_FILE_ATTRIBUTES && (attributes & FILE_ATTRIBUTE_DIRECTORY)) errno = EISDIR;
  }
  return fd;
}

static i64 porf_win_fs_transfer(porf_fs_op *o, int writing) {
  unsigned length = o->len > INT_MAX ? INT_MAX : (unsigned)o->len;
#ifdef NATIVE_CORE_IN_PROCESS
  if (o->fd < 3) {
    if (o->pos < 0 && !writing && o->fd == 0) return native_core_read(o->buf, length);
    if (o->pos < 0 && writing && (o->fd == 1 || o->fd == 2))
      return native_core_write(o->fd, o->buf, length);
    errno = EBADF;
    return -1;
  }
#endif
  i64 position = -1;
  if (o->pos >= 0) {
    position = _lseeki64(o->fd, 0, SEEK_CUR);
    if (position < 0 || _lseeki64(o->fd, o->pos, SEEK_SET) < 0) return -1;
  }
  i64 result = writing ? _write(o->fd, o->buf, length) : _read(o->fd, o->buf, length);
  if (position >= 0) {
    int error = errno;
    if (_lseeki64(o->fd, position, SEEK_SET) < 0 && result >= 0) return -1;
    errno = error;
  }
  return result;
}

static void porf_win_fs_stat(const struct _stat64 *st, i64 *out) {
  out[0] = st->st_dev; out[1] = st->st_mode; out[2] = st->st_nlink;
  out[3] = st->st_uid; out[4] = st->st_gid; out[5] = st->st_rdev;
  out[7] = st->st_ino; out[8] = st->st_size;
  out[10] = st->st_atime; out[12] = st->st_mtime; out[14] = st->st_ctime;
  out[16] = st->st_ctime; /* CRT st_ctime is the creation time on Windows. */
}

static int porf_win_fs_readdir(porf_fs_op *o, const wchar_t *path) {
  DWORD attributes = GetFileAttributesW(path);
  if (attributes == INVALID_FILE_ATTRIBUTES) return porf_win_fs_error(GetLastError());
  if (!(attributes & FILE_ATTRIBUTE_DIRECTORY)) return ENOTDIR;

  size_t length = wcslen(path);
  if (!length) return ENOENT;
  wchar_t *pattern = malloc((length + 3) * sizeof(*pattern));
  if (!pattern) return ENOMEM;
  memcpy(pattern, path, length * sizeof(*pattern));
  if (path[length - 1] != L'\\' && path[length - 1] != L'/' && path[length - 1] != L':')
    pattern[length++] = L'\\';
  pattern[length++] = L'*';
  pattern[length] = 0;

  WIN32_FIND_DATAW entry;
  HANDLE search = FindFirstFileW(pattern, &entry);
  DWORD last = GetLastError();
  free(pattern);
  if (search == INVALID_HANDLE_VALUE)
    return last == ERROR_FILE_NOT_FOUND ? 0 : porf_win_fs_error(last);
  int error = 0;
  size_t capacity = 0;
  do {
    if (!wcscmp(entry.cFileName, L".") || !wcscmp(entry.cFileName, L"..")) continue;
    int bytes = WideCharToMultiByte(CP_UTF8, WC_ERR_INVALID_CHARS, entry.cFileName, -1, NULL, 0, NULL, NULL);
    if (!bytes) { error = EINVAL; break; }
    size_t required = o->data_len + 1 + (size_t)bytes;
    if (required > capacity) {
      capacity = required * 2;
      char *grown = realloc(o->data, capacity);
      if (!grown) { error = ENOMEM; break; }
      o->data = grown;
    }
    int link = (entry.dwFileAttributes & FILE_ATTRIBUTE_REPARSE_POINT) &&
      (entry.dwReserved0 == IO_REPARSE_TAG_SYMLINK || entry.dwReserved0 == IO_REPARSE_TAG_MOUNT_POINT);
    o->data[o->data_len] = link ? 10 : (entry.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY) ? 4 : 8;
    if (!WideCharToMultiByte(CP_UTF8, WC_ERR_INVALID_CHARS, entry.cFileName, -1,
        o->data + o->data_len + 1, bytes, NULL, NULL)) { error = EINVAL; break; }
    o->data_len = required;
  } while (FindNextFileW(search, &entry));
  if (!error && (last = GetLastError()) != ERROR_NO_MORE_FILES) error = porf_win_fs_error(last);
  FindClose(search);
  return error;
}

static i64 porf_win_fs_readfile(porf_fs_op *o, const wchar_t *path) {
  int fd = path ? porf_win_fs_open(path, o->flags, 0) : _dup(o->fd);
  o->mode = fd >= 0;
  if (fd < 0) return -1;
  struct _stat64 st;
  if (_fstat64(fd, &st) == 0 && st.st_size > INT_MAX) {
    _close(fd);
    errno = EFBIG;
    return -1;
  }
  FILE *stream = _fdopen(fd, "rb");
  if (!stream) {
    int error = errno;
    _close(fd);
    errno = error;
    return -1;
  }
  o->data = porf_node_slurp(stream, &o->data_len);
  int error = ferror(stream) ? (errno ? errno : EIO) : 0;
  fclose(stream);
  if (!error) return 0;
  errno = error;
  return -1;
}

static i64 porf_win_fs_writefile(porf_fs_op *o, const wchar_t *path) {
  int fd = path ? porf_win_fs_open(path, o->flags, o->mode) : o->fd;
  o->mode = fd >= 0;
  if (fd < 0) return -1;
  int error = 0;
  for (i64 done = 0; done < o->len;) {
    unsigned count = o->len - done > INT_MAX ? INT_MAX : (unsigned)(o->len - done);
    int n = _write(fd, o->buf + done, count);
    if (n <= 0) { error = n < 0 ? errno : EIO; break; }
    done += n;
  }
  if (path && _close(fd) != 0 && !error) error = errno;
  if (!error) return 0;
  errno = error;
  return -1;
}

static char *porf_win_fs_utf8(const wchar_t *path) {
  int count = WideCharToMultiByte(CP_UTF8, 0, path, -1, NULL, 0, NULL, NULL);
  char *out = count > 0 ? malloc(count) : NULL;
  if (out && WideCharToMultiByte(CP_UTF8, 0, path, -1, out, count, NULL, NULL)) return out;
  free(out);
  errno = ENOMEM;
  return NULL;
}

static int porf_win_fs_is_dir(const wchar_t *path) {
  DWORD attributes = GetFileAttributesW(path);
  return attributes != INVALID_FILE_ATTRIBUTES && (attributes & FILE_ATTRIBUTE_DIRECTORY);
}

static int porf_win_fs_separator(wchar_t c) { return c == L'\\' || c == L'/'; }

// fs.mkdir(path, {recursive: true}). o->data receives the first directory
// created, which Node returns; it stays empty when nothing was created.
static i64 porf_win_fs_mkdirp(porf_fs_op *o, wchar_t *path) {
  if (porf_win_fs_is_dir(path)) return 0;
  if (GetFileAttributesW(path) != INVALID_FILE_ATTRIBUTES) { errno = EEXIST; return -1; }
  size_t length = wcslen(path), start = 0;
  if (length >= 2 && path[1] == L':') {
    start = 2;  // drive letter
  } else if (length >= 2 && porf_win_fs_separator(path[0]) && porf_win_fs_separator(path[1])) {
    int separators = 0;  // \\server\share
    for (start = 2; start < length && separators < 2; start++) separators += porf_win_fs_separator(path[start]);
  }
  while (start < length && porf_win_fs_separator(path[start])) start++;
  for (size_t i = start; i <= length; i++) {
    if (i < length && !porf_win_fs_separator(path[i])) continue;
    wchar_t saved = path[i];
    path[i] = 0;
    if (*path && !porf_win_fs_is_dir(path)) {
      if (_wmkdir(path) == 0) {
        if (!o->data && (o->data = porf_win_fs_utf8(path))) o->data_len = strlen(o->data);
      } else if (errno != EEXIST || !porf_win_fs_is_dir(path)) {
        int error = errno == EEXIST ? ENOTDIR : errno;
        path[i] = saved;
        errno = error;
        return -1;
      }
    }
    path[i] = saved;
  }
  return 0;
}

// Removes a file, or a directory and everything in it. Links to directories
// are removed without following them.
static int porf_win_fs_remove_tree(const wchar_t *path) {
  DWORD attributes = GetFileAttributesW(path);
  if (attributes == INVALID_FILE_ATTRIBUTES) return porf_win_fs_error(GetLastError());
  if (attributes & FILE_ATTRIBUTE_READONLY) SetFileAttributesW(path, attributes & ~FILE_ATTRIBUTE_READONLY);
  if (!(attributes & FILE_ATTRIBUTE_DIRECTORY) || (attributes & FILE_ATTRIBUTE_REPARSE_POINT)) {
    BOOL removed = attributes & FILE_ATTRIBUTE_DIRECTORY ? RemoveDirectoryW(path) : DeleteFileW(path);
    return removed ? 0 : porf_win_fs_error(GetLastError());
  }
  size_t length = wcslen(path);
  wchar_t *pattern = malloc((length + 3) * sizeof(wchar_t));
  if (!pattern) return ENOMEM;
  swprintf(pattern, length + 3, L"%ls\\*", path);
  WIN32_FIND_DATAW entry;
  HANDLE find = FindFirstFileW(pattern, &entry);
  free(pattern);
  int error = 0;
  if (find != INVALID_HANDLE_VALUE) {
    do {
      if (!wcscmp(entry.cFileName, L".") || !wcscmp(entry.cFileName, L"..")) continue;
      size_t size = length + wcslen(entry.cFileName) + 2;
      wchar_t *child = malloc(size * sizeof(wchar_t));
      if (!child) { error = ENOMEM; break; }
      swprintf(child, size, L"%ls\\%ls", path, entry.cFileName);
      error = porf_win_fs_remove_tree(child);
      free(child);
    } while (!error && FindNextFileW(find, &entry));
    FindClose(find);
  }
  if (!error && !RemoveDirectoryW(path)) error = porf_win_fs_error(GetLastError());
  return error;
}

// Seconds since the epoch, as Node passes them, to a Windows FILETIME.
static FILETIME porf_win_fs_filetime(f64 seconds) {
  ULONGLONG ticks = (ULONGLONG)(seconds * 10000000.0) + 116444736000000000ULL;
  FILETIME time = { (DWORD)ticks, (DWORD)(ticks >> 32) };
  return time;
}

static i64 porf_win_fs_utimes(porf_fs_op *o, const wchar_t *path) {
  HANDLE file = path
    ? CreateFileW(path, FILE_WRITE_ATTRIBUTES, FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE, NULL,
        OPEN_EXISTING, FILE_FLAG_BACKUP_SEMANTICS, NULL)
    : (HANDLE)_get_osfhandle(o->fd);
  if (file == INVALID_HANDLE_VALUE) { errno = path ? porf_win_fs_error(GetLastError()) : EBADF; return -1; }
  FILETIME access = porf_win_fs_filetime(o->atime), write = porf_win_fs_filetime(o->mtime);
  BOOL done = SetFileTime(file, NULL, &access, &write);
  DWORD error = GetLastError();
  if (path) CloseHandle(file);
  if (done) return 0;
  errno = porf_win_fs_error(error);
  return -1;
}

// Windows keeps only a read-only attribute: the owner write bit decides it.
static int porf_win_fs_mode(i32 mode) { return mode & 0200 ? _S_IREAD | _S_IWRITE : _S_IREAD; }

static SRWLOCK porf_win_fd_locks[64];

static void porf_fs_run(void *arg) {
  porf_fs_op *o = arg;
  // libuv can run file requests concurrently. Keep a positioned operation's
  // seek/transfer/restore sequence atomic against other file operations.
  SRWLOCK *lock = !o->path && o->fd >= 3 ? &porf_win_fd_locks[o->fd % 64] : NULL;
  if (lock) AcquireSRWLockExclusive(lock);
  wchar_t *path = NULL, *path2 = NULL;
  struct _stat64 st;
  i64 result = -1;
  if (o->path && !(path = porf_win_fs_path(o->path))) goto done;
  if (o->path2 && !(path2 = porf_win_fs_path(o->path2))) goto done;
  if (!path && o->fd >= 0 && o->fd < 3 && o->kind != PORF_FS_READ && o->kind != PORF_FS_WRITE) {
    errno = EBADF;
    goto done;
  }
  switch (o->kind) {
    case PORF_FS_OPEN: result = porf_win_fs_open(path, o->flags, o->mode); break;
    case PORF_FS_CLOSE: result = _close(o->fd); break;
    case PORF_FS_READ: case PORF_FS_WRITE:
      result = porf_win_fs_transfer(o, o->kind == PORF_FS_WRITE); break;
    case PORF_FS_STAT: case PORF_FS_FSTAT:
      result = path ? _wstat64(path, &st) : _fstat64(o->fd, &st);
      if (result == 0) porf_win_fs_stat(&st, o->stat);
      break;
    case PORF_FS_READFILE: result = porf_win_fs_readfile(o, path); break;
    case PORF_FS_WRITEFILE: result = porf_win_fs_writefile(o, path); break;
    case PORF_FS_UNLINK: result = _wunlink(path); break;
    case PORF_FS_RMDIR: result = _wrmdir(path); break;
    case PORF_FS_REALPATH:
      o->data = porf_win_fs_realpath(path);
      if (o->data) { o->data_len = strlen(o->data); result = 0; }
      break;
    case PORF_FS_RENAME:
      if (MoveFileExW(path, path2, MOVEFILE_REPLACE_EXISTING)) result = 0;
      else errno = porf_win_fs_error(GetLastError());
      break;
    case PORF_FS_ACCESS: result = _waccess(path, o->mode & 6); break;
    case PORF_FS_MKDIR: result = _wmkdir(path); break;
    case PORF_FS_MKDIRP: result = porf_win_fs_mkdirp(o, path); break;
    case PORF_FS_RM: {
      DWORD attributes = GetFileAttributesW(path);
      int error;
      if (attributes == INVALID_FILE_ATTRIBUTES) error = porf_win_fs_error(GetLastError());
      else if ((attributes & FILE_ATTRIBUTE_DIRECTORY) && !(attributes & FILE_ATTRIBUTE_REPARSE_POINT) && !o->flags) error = EISDIR;
      else error = porf_win_fs_remove_tree(path);
      if (error) errno = error;
      else result = 0;
      break;
    }
    case PORF_FS_MKDTEMP: {
      static const wchar_t letters[] = L"abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
      size_t length = wcslen(path);
      if (length < 6 || wcscmp(path + length - 6, L"XXXXXX")) { errno = EINVAL; break; }
      for (int attempt = 0; attempt < 100; attempt++) {
        unsigned char random[6];
        if (porf_win_entropy(random, sizeof(random))) { errno = EIO; break; }
        for (int k = 0; k < 6; k++) path[length - 6 + k] = letters[random[k] % 62];
        if (_wmkdir(path) == 0) {
          if ((o->data = porf_win_fs_utf8(path))) { o->data_len = strlen(o->data); result = 0; }
          break;
        }
        if (errno != EEXIST) break;
      }
      break;
    }
    case PORF_FS_CHMOD: result = _wchmod(path, porf_win_fs_mode(o->mode)); break;
    case PORF_FS_FCHMOD: {
      HANDLE file = (HANDLE)_get_osfhandle(o->fd);
      FILE_BASIC_INFO info;
      if (file == INVALID_HANDLE_VALUE) { errno = EBADF; break; }
      if (!GetFileInformationByHandleEx(file, FileBasicInfo, &info, sizeof(info))) { errno = porf_win_fs_error(GetLastError()); break; }
      if (o->mode & 0200) info.FileAttributes &= ~FILE_ATTRIBUTE_READONLY;
      else info.FileAttributes |= FILE_ATTRIBUTE_READONLY;
      if (SetFileInformationByHandle(file, FileBasicInfo, &info, sizeof(info))) result = 0;
      else errno = porf_win_fs_error(GetLastError());
      break;
    }
    case PORF_FS_UTIMES: case PORF_FS_FUTIMES: result = porf_win_fs_utimes(o, path); break;
    case PORF_FS_READDIR:
      errno = porf_win_fs_readdir(o, path);
      if (!errno) result = 0;
      break;
    case PORF_FS_FSYNC: result = _commit(o->fd); break;
    case PORF_FS_COPYFILE:
      if (o->flags & 4) errno = ENOSYS;
      else if (CopyFileW(path, path2, (o->flags & 1) != 0)) result = 0;
      else errno = porf_win_fs_error(GetLastError());
      break;
    case PORF_FS_FTRUNCATE:
      errno = _chsize_s(o->fd, o->len);
      if (!errno) result = 0;
      break;
    default: errno = ENOSYS;
  }
done:
  o->result = result;
  o->err = result < 0 ? errno : 0;
  free(path2);
  free(path);
  if (lock) ReleaseSRWLockExclusive(lock);
}
