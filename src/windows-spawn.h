/* Replacement for Porffor's fork/waitpid implementation of spawnSync. */
typedef struct {
  uv_process_t child;
  uv_timer_t timer;
  int timer_open, status, signal, kill_signal, error;
} PorfWinChild;

static void porf_win_child_exit(uv_process_t *process, int64_t status, int signal) {
  PorfWinChild *child = process->data;
  child->status = (int)status;
  child->signal = signal;
  if (child->timer_open) uv_close((uv_handle_t *)&child->timer, NULL);
  uv_close((uv_handle_t *)process, NULL);
}

static void porf_win_child_timeout(uv_timer_t *timer) {
  PorfWinChild *child = timer->data;
  child->error = ETIMEDOUT;
  uv_process_kill(&child->child, child->kill_signal);
}

static int porf_win_spawn_errno(int error) {
  switch (error) {
    case UV_ENOENT: return ENOENT;
    case UV_ENOTDIR: return ENOTDIR;
    case UV_EACCES: return EACCES;
    case UV_EPERM: return EPERM;
    case UV_EINVAL: return EINVAL;
    case UV_EBADF: return EBADF;
    case UV_ENOMEM: return ENOMEM;
    case UV_E2BIG: return E2BIG;
    default: return EIO;
  }
}

static FILE *porf_win_child_temp(void) {
  wchar_t dir[MAX_PATH], name[MAX_PATH];
  DWORD length = GetTempPathW(MAX_PATH, dir);
  if (!length || length >= MAX_PATH || !GetTempFileNameW(dir, L"rct", 0, name)) {
    errno = EIO;
    return NULL;
  }
  HANDLE file = CreateFileW(name, GENERIC_READ | GENERIC_WRITE, FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
    NULL, OPEN_EXISTING, FILE_ATTRIBUTE_TEMPORARY | FILE_FLAG_DELETE_ON_CLOSE, NULL);
  if (file == INVALID_HANDLE_VALUE) { DeleteFileW(name); errno = EIO; return NULL; }
  int fd = _open_osfhandle((intptr_t)file, _O_RDWR | _O_BINARY | _O_NOINHERIT);
  if (fd < 0) { CloseHandle(file); return NULL; }
  FILE *stream = _fdopen(fd, "w+b");
  if (!stream) _close(fd);
  return stream;
}

static int porf_win_spawn_sync(const char *file, char **argv, char **env, const char *cwd,
    const char *input, size_t input_length, const int modes[3], uint64_t timeout, size_t max_buffer,
    int signal, double *pid, double *status, double *term_signal, double *kill_error,
    double *out_ptr, double *out_len, double *err_ptr, double *err_len) {
  FILE *streams[3] = {0};
  uv_stdio_container_t stdio[3] = {0};
  int error = 0;
  for (int i = 0; i < 3; i++) {
    if (modes[i] == -2) continue;
    stdio[i].flags = UV_INHERIT_FD;
    if (modes[i] >= 0) {
      stdio[i].data.fd = modes[i];
    } else {
      streams[i] = porf_win_child_temp();
      if (!streams[i]) { error = errno; goto done; }
      stdio[i].data.fd = _fileno(streams[i]);
    }
  }
  if (streams[0] && input_length) {
    if (fwrite(input, 1, input_length, streams[0]) != input_length ||
        fflush(streams[0]) != 0 || fseek(streams[0], 0, SEEK_SET) != 0) {
      error = errno ? errno : EIO;
      goto done;
    }
  }
  uv_loop_t loop;
  int result = uv_loop_init(&loop);
  if (result < 0) { error = porf_win_spawn_errno(result); goto done; }
  PorfWinChild child = {0};
  child.kill_signal = signal;
  uv_process_options_t options = {0};
  options.file = file;
  options.args = argv;
  options.env = env;
  options.cwd = *cwd ? cwd : NULL;
  options.stdio = stdio;
  options.stdio_count = 3;
  options.exit_cb = porf_win_child_exit;
  options.flags = UV_PROCESS_WINDOWS_HIDE;
  if (porf_win_verbatim_shell(file, argv)) options.flags |= UV_PROCESS_WINDOWS_VERBATIM_ARGUMENTS;
  result = uv_spawn(&loop, &child.child, &options);
  if (result < 0) {
    error = porf_win_spawn_errno(result);
    if (child.child.type == UV_PROCESS) uv_close((uv_handle_t *)&child.child, NULL);
  } else {
    child.child.data = &child;
    *pid = uv_process_get_pid(&child.child);
    if (timeout) {
      result = uv_timer_init(&loop, &child.timer);
      if (result == 0) {
        child.timer_open = 1;
        child.timer.data = &child;
        result = uv_timer_start(&child.timer, porf_win_child_timeout, timeout, 0);
      }
      if (result < 0) {
        error = porf_win_spawn_errno(result);
        uv_process_kill(&child.child, 9);
      }
    }
  }
  uv_run(&loop, UV_RUN_DEFAULT);
  uv_loop_close(&loop);
  if (error) goto done;
  *status = child.status;
  *term_signal = child.signal;
  *kill_error = child.error;
  for (int i = 1; i <= 2; i++) {
    if (!streams[i]) continue;
    int64_t length = _filelengthi64(_fileno(streams[i]));
    if (length < 0 || fseek(streams[i], 0, SEEK_SET) != 0) { error = EIO; goto done; }
    size_t size = (uint64_t)length > max_buffer ? max_buffer : (size_t)length;
    if ((uint64_t)length > max_buffer && !*kill_error) *kill_error = ENOBUFS;
    char *bytes = malloc(size ? size : 1);
    if (!bytes) { error = ENOMEM; goto done; }
    if (fread(bytes, 1, size, streams[i]) != size) { free(bytes); error = EIO; goto done; }
    *(i == 1 ? out_ptr : err_ptr) = (double)(uintptr_t)bytes;
    *(i == 1 ? out_len : err_len) = (double)size;
  }
done:
  for (int i = 0; i < 3; i++) if (streams[i]) fclose(streams[i]);
  return error;
}
