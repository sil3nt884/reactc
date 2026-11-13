/* The compiled application core running inside the host process.
 *
 * The core is a program that reads protocol lines from standard input and
 * writes them to standard output. Built with NATIVE_CORE_IN_PROCESS, those
 * reads and writes are redirected here: two in-memory byte queues between the
 * host's UI thread and the core's own thread. No child process, pipe or
 * system call is involved in a message. */
#include <stdarg.h>

struct CoreChannel {
    CRITICAL_SECTION lock;
    CONDITION_VARIABLE changed;
    char *bytes;
    size_t start, end, capacity;
    bool closed;
};

static struct CoreChannel to_core, from_core;
static HANDLE core_thread;

static void channel_open(struct CoreChannel *channel) {
    InitializeCriticalSection(&channel->lock);
    InitializeConditionVariable(&channel->changed);
}

static void channel_append(struct CoreChannel *channel, const char *bytes, size_t size) {
    EnterCriticalSection(&channel->lock);
    if (channel->start == channel->end) channel->start = channel->end = 0;
    if (channel->end + size > channel->capacity) {
        size_t used = channel->end - channel->start;
        size_t capacity = channel->capacity ? channel->capacity : 65536;
        while (capacity < used + size) capacity *= 2;
        char *grown = malloc(capacity);
        if (!grown) abort();
        if (used) memcpy(grown, channel->bytes + channel->start, used);
        free(channel->bytes);
        channel->bytes = grown;
        channel->capacity = capacity;
        channel->start = 0;
        channel->end = used;
    }
    memcpy(channel->bytes + channel->end, bytes, size);
    channel->end += size;
    LeaveCriticalSection(&channel->lock);
    WakeAllConditionVariable(&channel->changed);
}

/* Called by the core, on its own thread. */

static _Thread_local bool console_stderr;

void native_core_console_stderr(int enabled) {
    console_stderr = enabled != 0;
}

long long native_core_read(void *buffer, unsigned length) {
    EnterCriticalSection(&to_core.lock);
    while (to_core.start == to_core.end && !to_core.closed) {
        SleepConditionVariableCS(&to_core.changed, &to_core.lock, INFINITE);
    }
    size_t available = to_core.end - to_core.start;
    size_t taken = available < length ? available : length;
    if (taken) memcpy(buffer, to_core.bytes + to_core.start, taken);
    to_core.start += taken;
    LeaveCriticalSection(&to_core.lock);
    return (long long)taken; /* 0 is end of input: the host is closing. */
}

long long native_core_write(int descriptor, const void *buffer, unsigned length) {
    if (descriptor == 1) channel_append(&from_core, buffer, length);
    return length;
}

size_t native_core_fwrite(const void *data, size_t size, size_t count, FILE *stream) {
    if (stream != stdout) return fwrite(data, size, count, stream);
    if (console_stderr) return fwrite(data, size, count, stderr);
    channel_append(&from_core, data, size * count);
    return count;
}

int native_core_fputs(const char *text, FILE *stream) {
    if (stream != stdout) return fputs(text, stream);
    if (console_stderr) return fputs(text, stderr);
    channel_append(&from_core, text, strlen(text));
    return 0;
}

int native_core_fputc(int character, FILE *stream) {
    if (stream != stdout) return fputc(character, stream);
    if (console_stderr) return fputc(character, stderr);
    char byte = (char)character;
    channel_append(&from_core, &byte, 1);
    return character;
}

int native_core_putchar(int character) {
    return native_core_fputc(character, stdout);
}

int native_core_printf(const char *format, ...) {
    char small[512];
    va_list arguments;
    va_start(arguments, format);
    if (console_stderr) {
        int written = vfprintf(stderr, format, arguments);
        va_end(arguments);
        return written;
    }
    int size = vsnprintf(small, sizeof(small), format, arguments);
    va_end(arguments);
    if (size < 0) return size;
    if ((size_t)size < sizeof(small)) {
        channel_append(&from_core, small, (size_t)size);
        return size;
    }
    char *large = malloc((size_t)size + 1);
    if (!large) abort();
    va_start(arguments, format);
    vsnprintf(large, (size_t)size + 1, format, arguments);
    va_end(arguments);
    channel_append(&from_core, large, (size_t)size);
    free(large);
    return size;
}

/* Called by the host transport. */

static DWORD WINAPI core_thread_main(void *unused) {
    (void)unused;
    char *arguments[] = {APP_CORE_NAME, NULL};
    reactc_core_main(1, arguments);
    /* The core only returns at end of input. Wake a host still waiting on it. */
    EnterCriticalSection(&from_core.lock);
    from_core.closed = true;
    LeaveCriticalSection(&from_core.lock);
    WakeAllConditionVariable(&from_core.changed);
    return 0;
}

static void core_start(void) {
    channel_open(&to_core);
    channel_open(&from_core);
    /* Component trees recurse deeply; reserve more than a default thread stack. */
    core_thread = CreateThread(NULL, 256u * 1024 * 1024, core_thread_main, NULL,
        STACK_SIZE_PARAM_IS_A_RESERVATION, NULL);
    if (!core_thread) fail("Cannot start the application core");
}

static void core_send(const char *line, size_t length) {
    channel_append(&to_core, line, length);
    channel_append(&to_core, "\n", 1);
}

/* Copies the next complete protocol line into `out`. */
static size_t core_receive(char *out, size_t capacity) {
    size_t scanned = 0;
    EnterCriticalSection(&from_core.lock);
    for (;;) {
        size_t size = from_core.end - from_core.start;
        const char *from = size ? from_core.bytes + from_core.start : NULL;
        const char *newline = size > scanned ? memchr(from + scanned, '\n', size - scanned) : NULL;
        if (newline) {
            size_t length = (size_t)(newline - from);
            if (length + 1 >= capacity) {
                LeaveCriticalSection(&from_core.lock);
                fail("Native snapshot exceeds 2 MiB");
            }
            memcpy(out, from, length);
            out[length] = 0;
            from_core.start += length + 1;
            LeaveCriticalSection(&from_core.lock);
            return length;
        }
        scanned = size;
        if (from_core.closed) {
            LeaveCriticalSection(&from_core.lock);
            fail("The application core exited");
        }
        SleepConditionVariableCS(&from_core.changed, &from_core.lock, INFINITE);
    }
}
