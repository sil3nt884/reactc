/* UI-owned event queue. Resolve a queued event against the latest committed
 * tree when it reaches the broker, because handler tokens contain a revision. */
struct ReactcEvent {
    struct ReactcEvent *next;
    wchar_t node_id[BOX_ID_CAPACITY];
    const char *kind;
    MSG fallback;
    unsigned editor_epoch;
    int modifiers;  /* KEY_SHIFT, KEY_CTRL and KEY_ALT when the key was pressed */
    char payload[];
};

static struct ReactcEvent *native_head, *native_tail, *native_active;
static unsigned native_editor_epoch;

static void native_dispatch(void) {
    while (!native_busy && !native_stopped && native_head) {
        struct ReactcEvent *event = native_head;
        native_head = event->next;
        if (!native_head) native_tail = NULL;
        char command[80000];
        if (event->kind) {
            int node = find_identity(get(snapshot, 1, "tree"), event->node_id, true);
            int p = props(node);
            int token = get(snapshot, p, event->kind);
            int modal = active_modal_node();
            if (!token || equal(snapshot, get(snapshot, p, "disabled"), "true") ||
                (modal && (node < modal || node >= snapshot->t[modal].next)) ||
                ((!strcmp(event->kind, "change") || !strcmp(event->kind, "keyDown")) &&
                 equal(snapshot, get(snapshot, p, "readOnly"), "true"))) {
                free(event);
                continue;
            }
            char handler[8192], revision[64];
            raw(snapshot, token, handler, sizeof(handler));
            raw(snapshot, get(snapshot, 1, "revision"), revision, sizeof(revision));
            int length = snprintf(command, sizeof(command),
                "{\"type\":\"event\",\"revision\":%s,\"handler\":%s,%s}", revision, handler, event->payload);
            if (length < 0 || (size_t)length >= sizeof(command)) fail("Native event exceeds command limit");
        }
        native_active = event;
        native_busy = true;
        KillTimer(window, CORE_TIMER);
        broker_send(event->kind ? command : event->payload);
    }
}

static bool native_enqueue(int node, const char *kind, const char *payload, const MSG *fallback) {
    if (native_stopped) return false;
    size_t size = strlen(payload) + 1;
    struct ReactcEvent *event = calloc(1, sizeof(*event) + size);
    if (!event) fail("Cannot queue native event");
    if (kind) string(snapshot, get(snapshot, node, "id"), event->node_id, BOX_ID_CAPACITY);
    event->kind = kind;
    if (fallback) {
        event->fallback = *fallback;
        event->editor_epoch = native_editor_epoch;
        event->modifiers = current_modifiers();
    }
    memcpy(event->payload, payload, size);
    if (native_tail) native_tail->next = event;
    else native_head = event;
    native_tail = event;
    native_dispatch();
    return true;
}

static void native_clear_events(void) {
    while (native_head) {
        struct ReactcEvent *event = native_head;
        native_head = event->next;
        free(event);
    }
    native_tail = NULL;
    free(native_active);
    native_active = NULL;
}

static void native_send_viewport(HWND hwnd) {
    static int sent_width, sent_height;
    if (!native_frame_ready || native_busy || native_stopped || IsIconic(hwnd) ||
        !equal(snapshot, get(snapshot, 1, "viewportStyles"), "true")) return;
    RECT client;
    if (!GetClientRect(hwnd, &client)) return;
    int next_width = client.right;
    int next_height = client.bottom - (int)chrome_height;
    if (next_width <= 0 || next_height <= 0 ||
        (next_width == sent_width && next_height == sent_height)) return;
    char command[96];
    snprintf(command, sizeof(command), "{\"type\":\"viewport\",\"width\":%d,\"height\":%d}", next_width, next_height);
    sent_width = next_width;
    sent_height = next_height;
    native_enqueue(0, NULL, command, NULL);
}

/* Pointer and focus state for stylesheet :hover and :focus rules. The core
 * receives the innermost tree node under the pointer and the focused editor
 * node. Hit testing waits for the layout of the latest committed tree. */
static wchar_t pointer_target[BOX_ID_CAPACITY];
static bool pointer_inside, boxes_current;
static int pointer_x, pointer_y;

static bool native_interaction_styles(void) {
    return native_frame_ready && equal(snapshot, get(snapshot, 1, "interactionStyles"), "true");
}

static int pointer_box(int x, int y) {
    int floor = viewport_hit_floor((float)x, (float)y);
    for (int i = box_count - 1; i >= floor; i--) {
        if (boxes[i].node && in_box(&boxes[i], (float)x, (float)y)) return i;
    }
    return -1;
}

static void update_pointer_target(void) {
    if (!boxes_current) return;
    *pointer_target = 0;
    if (!pointer_inside) return;
    int box = pointer_box(pointer_x, pointer_y);
    if (box >= 0) string(snapshot, get(snapshot, boxes[box].node, "id"), pointer_target, BOX_ID_CAPACITY);
}

static void native_send_interaction(void) {
    static wchar_t sent_hover[BOX_ID_CAPACITY], sent_focus[BOX_ID_CAPACITY];
    if (!boxes_current || native_busy || native_stopped || !native_interaction_styles()) return;
    wchar_t focus[BOX_ID_CAPACITY] = L"";
    // The native editor exists exactly while its field is the active control.
    if (editor) {
        int node = find_identity(get(snapshot, 1, "tree"), edit_id, edit_native_id);
        if (node) string(snapshot, get(snapshot, node, "id"), focus, BOX_ID_CAPACITY);
    } else if (key_focus.kind) {
        int node = find_identity(get(snapshot, 1, "tree"), key_focus.public_id, key_focus.native_id);
        if (node) string(snapshot, get(snapshot, node, "id"), focus, BOX_ID_CAPACITY);
    }
    if (!wcscmp(sent_hover, pointer_target) && !wcscmp(sent_focus, focus)) return;
    char hover_json[BOX_ID_CAPACITY * 6 + 8] = "null", focus_json[BOX_ID_CAPACITY * 6 + 8] = "null";
    if (*pointer_target) quote(pointer_target, hover_json, sizeof(hover_json));
    if (*focus) quote(focus, focus_json, sizeof(focus_json));
    char command[sizeof(hover_json) + sizeof(focus_json) + 64];
    snprintf(command, sizeof(command), "{\"type\":\"interaction\",\"hover\":%s,\"focus\":%s}", hover_json, focus_json);
    wcscpy(sent_hover, pointer_target);
    wcscpy(sent_focus, focus);
    native_enqueue(0, NULL, command, NULL);
}

/* Called after each layout pass. */
static void native_pointer_frame(void) {
    boxes_current = true;
    update_pointer_target();
    native_send_interaction();
}

/* DOM `key` value for a virtual key, or false for keys that are not reported
 * (modifiers alone and dead keys). Printable keys ignore Ctrl and Alt, so
 * Ctrl+S reports "s" and Ctrl+Shift+S reports "S". */
static bool dom_key_name(const MSG *message, char *out, size_t capacity) {
    static const struct { WPARAM key; const char *name; } named[] = {
        {VK_RETURN, "Enter"}, {VK_ESCAPE, "Escape"}, {VK_TAB, "Tab"}, {VK_BACK, "Backspace"},
        {VK_DELETE, "Delete"}, {VK_INSERT, "Insert"}, {VK_HOME, "Home"}, {VK_END, "End"},
        {VK_PRIOR, "PageUp"}, {VK_NEXT, "PageDown"}, {VK_LEFT, "ArrowLeft"}, {VK_RIGHT, "ArrowRight"},
        {VK_UP, "ArrowUp"}, {VK_DOWN, "ArrowDown"}, {VK_SPACE, " "}, {VK_APPS, "ContextMenu"},
    };
    WPARAM key = message->wParam;
    for (size_t i = 0; i < sizeof(named) / sizeof(*named); i++) {
        if (named[i].key == key) { snprintf(out, capacity, "%s", named[i].name); return true; }
    }
    if (key >= VK_F1 && key <= VK_F24) { snprintf(out, capacity, "F%d", (int)(key - VK_F1 + 1)); return true; }
    if (key == VK_SHIFT || key == VK_CONTROL || key == VK_MENU || key == VK_LWIN || key == VK_RWIN ||
        key == VK_CAPITAL || key == VK_NUMLOCK || key == VK_SCROLL) return false;
    BYTE state[256];
    if (!GetKeyboardState(state)) return false;
    state[VK_CONTROL] = state[VK_LCONTROL] = state[VK_RCONTROL] = 0;
    state[VK_MENU] = state[VK_LMENU] = state[VK_RMENU] = 0;
    wchar_t text[8];
    // Flag 4 leaves the keyboard's dead-key state untouched (Windows 10 1607+).
    int count = ToUnicode((UINT)key, (UINT)((message->lParam >> 16) & 0xff), state, text, 8, 4);
    if (count != 1 && count != 2) return false;
    text[count] = 0;
    if (text[0] < 0x20) return false;
    if (!WideCharToMultiByte(CP_UTF8, 0, text, -1, out, (int)capacity, NULL, NULL)) return false;
    return true;
}

/* Reports shortcut-class key presses to the page before Windows handles
 * them. Typing in a text field stays local: only keys with Ctrl, Alt or the
 * Windows key, and Enter, Escape, Tab and function keys, are reported there.
 * The original message is replayed unless the page calls preventDefault(). */
static bool native_report_key(const MSG *message) {
    if ((message->message != WM_KEYDOWN && message->message != WM_SYSKEYDOWN) ||
        (message->hwnd != window && message->hwnd != editor) || native_stopped || !native_frame_ready ||
        !equal(snapshot, get(snapshot, 1, "keyListeners"), "true")) return false;
    bool shift = GetKeyState(VK_SHIFT) < 0, ctrl = GetKeyState(VK_CONTROL) < 0;
    bool alt = GetKeyState(VK_MENU) < 0, meta = GetKeyState(VK_LWIN) < 0 || GetKeyState(VK_RWIN) < 0;
    WPARAM key = message->wParam;
    if (alt && key == VK_F4) return false;  // closing the window stays with Windows
    if (message->hwnd == editor && !ctrl && !alt && !meta && key != VK_RETURN && key != VK_ESCAPE &&
        key != VK_TAB && !(key >= VK_F1 && key <= VK_F24)) return false;
    char name[32], quoted[200];
    if (!dom_key_name(message, name, sizeof(name))) return false;
    wchar_t wide[32];
    MultiByteToWideChar(CP_UTF8, 0, name, -1, wide, 32);
    quote(wide, quoted, sizeof(quoted));
    char target[BOX_ID_CAPACITY * 6 + 8] = "null";
    int node = 0;
    if (editor && message->hwnd == editor) node = find_identity(get(snapshot, 1, "tree"), edit_id, edit_native_id);
    else if (key_focus.kind) node = find_identity(get(snapshot, 1, "tree"), key_focus.public_id, key_focus.native_id);
    if (node) {
        wchar_t id[BOX_ID_CAPACITY];
        string(snapshot, get(snapshot, node, "id"), id, BOX_ID_CAPACITY);
        quote(id, target, sizeof(target));
    }
    char command[sizeof(target) + 400];
    snprintf(command, sizeof(command),
        "{\"type\":\"key\",\"key\":%s,\"shiftKey\":%s,\"ctrlKey\":%s,\"altKey\":%s,\"metaKey\":%s,\"repeat\":%s,\"target\":%s}",
        quoted, shift ? "true" : "false", ctrl ? "true" : "false", alt ? "true" : "false", meta ? "true" : "false",
        (message->lParam & (1L << 30)) ? "true" : "false", target);
    return native_enqueue(0, NULL, command, message);
}

static void native_enable_caption(HWND hwnd) {
    if (!window_titlebar(get(snapshot, 1, "tree"))) return;
    custom_window_frame = true;
    HMENU menu = GetMenu(hwnd);
    SetMenu(hwnd, NULL);
    if (menu) DestroyMenu(menu);
    HMENU system_menu = GetSystemMenu(hwnd, FALSE);
    AppendMenuW(system_menu, MF_SEPARATOR, 0, NULL);
    AppendMenuW(system_menu, MF_STRING, WINDOW_LICENSES, L"Licenses");
    SetWindowLongPtrW(hwnd, GWL_STYLE, GetWindowLongPtrW(hwnd, GWL_STYLE) & ~WS_VSCROLL);
    SetClassLongPtrW(hwnd, GCL_STYLE, GetClassLongPtrW(hwnd, GCL_STYLE) | CS_DBLCLKS);
    SetWindowPos(hwnd, NULL, 0, 0, 0, 0,
        SWP_FRAMECHANGED | SWP_NOSIZE | SWP_NOMOVE | SWP_NOZORDER | SWP_NOACTIVATE);
}

/* Replays a key the page did not cancel. The default action and the typed
 * character use the modifiers captured at the key press: edit controls
 * perform Ctrl+C, Ctrl+V and Ctrl+X from the control characters. */
static void replay_key(const MSG *original, int modifiers) {
    MSG message = *original;
    replay_modifiers = modifiers;
    key_consumed = false;
    DispatchMessageW(&message);
    replay_modifiers = -1;
    if (key_consumed || (message.message != WM_KEYDOWN && message.message != WM_SYSKEYDOWN)) return;
    BYTE state[256];
    if (!GetKeyboardState(state)) return;
    BYTE shift = modifiers & KEY_SHIFT ? 0x80 : 0, ctrl = modifiers & KEY_CTRL ? 0x80 : 0;
    BYTE alt = modifiers & KEY_ALT ? 0x80 : 0;
    state[VK_SHIFT] = state[VK_LSHIFT] = shift;
    state[VK_CONTROL] = state[VK_LCONTROL] = ctrl;
    state[VK_MENU] = state[VK_LMENU] = alt;
    state[VK_RSHIFT] = state[VK_RCONTROL] = state[VK_RMENU] = 0;
    wchar_t text[8];
    int count = ToUnicode((UINT)message.wParam, (UINT)((message.lParam >> 16) & 0xff), state, text, 8, 4);
    UINT character = message.message == WM_SYSKEYDOWN ? WM_SYSCHAR : WM_CHAR;
    for (int i = 0; i < count; i++) PostMessageW(message.hwnd, character, text[i], message.lParam);
}

static void native_discard_frame(struct ReactcFrame *frame) {
    free(frame->document);
    free(frame);
}

static void native_apply_frame(HWND hwnd, struct ReactcFrame *frame) {
    struct ReactcEvent *event = NULL;
    if (!frame->intermediate) {
        event = native_active;
        native_active = NULL;
    }
    int editor_node = 0;
    bool success = !*frame->fatal && equal(frame->document, get(frame->document, 1, "type"), "snapshot");
    if (success) {
        free(snapshot);
        snapshot = frame->document;
        frame->document = NULL;
        boxes_current = false;
        *native_status = 0;
        update_route_scroll();
        queue_scroll_requests();
        if (editor) {
            editor_node = find_identity(get(snapshot, 1, "tree"), edit_id, edit_native_id);
            if (!editor_node) close_editor();
        }
        if (!native_frame_ready) {
            native_frame_ready = true;
            native_enable_caption(hwnd);
        }
    } else {
        if (*frame->fatal) {
            native_stopped = true;
            MultiByteToWideChar(CP_UTF8, 0, frame->fatal, -1, native_status,
                sizeof(native_status) / sizeof(*native_status));
            native_clear_events();
        } else {
            // The protocol parser bounds strings. Keep the on-screen report
            // short without imposing an additional limit on the core error.
            wcscpy(native_status, L"The application could not complete the operation.");
        }
        FILE *log = fopen(APP_LOG, "a");
        if (log) {
            if (*frame->fatal) fprintf(log, "%s\n", frame->fatal);
            else {
                wchar_t message[512] = {0};
                string(frame->document, get(frame->document, 1, "error"), message, 512);
                if (*message) fprintf(log, "Native application operation failed: %ls\n", message);
                else fputs("Native application operation failed\n", log);
            }
            fclose(log);
        }
    }
    if (frame->intermediate) {
        native_discard_frame(frame);
        InvalidateRect(hwnd, NULL, FALSE);
        return;
    }
    if (smoke && !event) {
        if (!success) {
            native_discard_frame(frame);
            PostQuitMessage(1);
            return;
        }
        SetTimer(hwnd, 1, 200, NULL);
    }
    // A key reported from the main window replays there; one from the editor
    // replays only while the same editor instance is open.
    if (event && event->fallback.hwnd && event->fallback.hwnd == hwnd && !frame->key_prevented) {
        MSG message = event->fallback;
        replay_key(&message, event->modifiers);
    } else if (event && event->fallback.hwnd && event->fallback.hwnd == editor &&
        event->editor_epoch == native_editor_epoch) {
        MSG message = event->fallback;
        // Apply the reply before replaying native input, while preserving a
        // newer draft that already has its own queued change event.
        if (editor_node && !native_head) {
            native_busy = false;
            sync_editor_value(editor_node);
            native_busy = true;
        }
        if (message.message == WM_CONTEXTMENU) {
            if (!frame->context_prevented)
                CallWindowProcW(edit_procedure, editor, message.message, message.wParam, message.lParam);
        } else if (!frame->key_prevented) {
            replay_key(&message, event->modifiers);
        }
    }
    free(event);
    native_discard_frame(frame);
    native_busy = false;
    native_dispatch();
    native_send_viewport(hwnd);
    native_send_interaction();
    arm_core_timer(hwnd);
    InvalidateRect(hwnd, NULL, FALSE);
}
