/* The broker owns protocol waits and host I/O. The window thread receives
 * render snapshots by ownership transfer and never waits for the core. */
enum { REACTC_FRAME = WM_APP + 10 };

struct ReactcFrame {
    struct Json *document;
    bool intermediate;
    bool key_prevented, context_prevented;
    char fatal[256];
};

static HWND broker_window;
static HANDLE broker_wake;
static void *volatile broker_command;
static volatile LONG broker_stopping;

static void broker_publish(struct ReactcFrame *frame) {
    if (InterlockedCompareExchange(&broker_stopping, 0, 0) ||
        !PostMessageW(broker_window, REACTC_FRAME, 0, (LPARAM)frame)) {
        free(frame->document);
        free(frame);
    }
}

static void broker_fail(const char *message) {
    struct ReactcFrame *frame = calloc(1, sizeof(*frame));
    if (frame) {
        snprintf(frame->fatal, sizeof(frame->fatal), "%s", message);
        broker_publish(frame);
    }
    ExitThread(1);
}

static struct Json *broker_publish_snapshot(struct Json *document) {
    struct ReactcFrame *frame = calloc(1, sizeof(*frame));
    struct Json *next = malloc(sizeof(*next));
    if (!frame || !next) fail("Cannot allocate native render snapshot");
    frame->document = document;
    frame->intermediate = true;
    broker_publish(frame);
    return next;
}

static void broker_settle(struct ReactcFrame *result, struct Json *request, char *command) {
    struct Json *frame = result->document;
    char *queue[256];
    size_t head = 0, tail = 0;
    for (unsigned cycle = 0; cycle < 256; cycle++) {
        int type = get(frame, 1, "type");
        if (equal(frame, type, "error")) break;
        if (equal(frame, type, "wait")) {
            int delay = core_timer_delay_for(frame);
            if (delay < 0) fail("Native timer wait requires a deadline");
            if (cycle == 255) fail("Native timer cycle exceeded its limit");
            if (delay) Sleep((DWORD)delay);
            send_peer(&core, core_tick, frame);
            continue;
        }
        int requests = get(frame, 1, "requests");
        if (requests && frame->t[requests].type != '[') fail("Invalid native request array");
        if (equal(frame, type, "requests")) {
            if (!requests || requests + 1 >= frame->t[requests].next ||
                frame->t[requests + 1].next != frame->t[requests].next) fail("Invalid blocking native request");
            reactc_host_result(broker_window, frame, requests + 1, command, JSON_BYTES);
        } else if (equal(frame, type, "snapshot")) {
            result->key_prevented |= equal(frame, get(frame, 1, "keyDefaultPrevented"), "true");
            result->context_prevented |= equal(frame, get(frame, 1, "contextMenuDefaultPrevented"), "true");
            if (requests) for (int i = requests + 1; i < frame->t[requests].next; i = frame->t[i].next) {
                if (tail == sizeof(queue) / sizeof(*queue)) fail("Too many native requests");
                size_t length = (size_t)(frame->t[i].end - frame->t[i].start) + 1;
                queue[tail] = malloc(length);
                if (!queue[tail]) fail("Cannot allocate native request");
                raw(frame, i, queue[tail++], length);
            }
            if (head == tail) break;
            frame = broker_publish_snapshot(frame);
            result->document = frame;
            char *payload = queue[head++];
            memcpy(request->text, payload, strlen(payload) + 1);
            free(payload);
            parse(request);
            reactc_host_result(broker_window, request, 1, command, JSON_BYTES);
        } else {
            fail("Core returned an invalid native frame");
        }
        send_peer(&core, command, frame);
        if (cycle == 255) fail("Native request cycle exceeded its limit");
    }
    while (head < tail) free(queue[head++]);
}

static DWORD WINAPI broker_main(void *unused) {
    (void)unused;
    on_native_worker = true;
    struct Json *request = malloc(sizeof(*request));
    char *command = malloc(JSON_BYTES);
    if (!request || !command) fail("Cannot allocate native broker buffers");

    char *next = NULL;
    do {
        struct ReactcFrame *result = calloc(1, sizeof(*result));
        if (!result) fail("Cannot allocate native result");
        result->document = malloc(sizeof(*result->document));
        if (!result->document) fail("Cannot allocate native frame");
        if (next) {
            send_peer(&core, next, result->document);
            free(next);
        } else {
            receive(&core, result->document);
        }
        broker_settle(result, request, command);
        broker_publish(result);
        WaitForSingleObject(broker_wake, INFINITE);
        next = InterlockedExchangePointer(&broker_command, NULL);
    } while (!InterlockedCompareExchange(&broker_stopping, 0, 0) && next);

    free(next);
    free(command);
    free(request);
    return 0;
}

static void broker_start(HWND owner) {
    broker_window = owner;
    broker_wake = CreateEventW(NULL, FALSE, FALSE, NULL);
    if (!broker_wake) fail("Cannot create native broker signal");
    HANDLE thread = CreateThread(NULL, 0, broker_main, NULL, 0, NULL);
    if (!thread) fail("Cannot start native broker");
    CloseHandle(thread);
}

static void broker_send(const char *command) {
    char *copy = strdup(command);
    if (!copy) fail("Cannot allocate native command");
    InterlockedExchangePointer(&broker_command, copy);
    SetEvent(broker_wake);
}

static void broker_stop(void) {
    InterlockedExchange(&broker_stopping, 1);
    SetEvent(broker_wake);
#ifdef NATIVE_CORE_IN_PROCESS
    EnterCriticalSection(&to_core.lock);
    to_core.closed = true;
    LeaveCriticalSection(&to_core.lock);
    WakeAllConditionVariable(&to_core.changed);
#endif
}
