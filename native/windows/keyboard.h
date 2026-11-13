/* Windows keyboard defaults: focus traversal, activation, document scrolling
 * and text-editing shortcuts. In reactc apps the page sees shortcut keys first
 * (reactc-events.h) and these defaults run only without preventDefault(). */
#include <wctype.h>

static bool tab_stop(const struct Box *box) {
    if (box->caption || !box->node) return false;
    if (box->scroll_region) return equal(snapshot, get(snapshot, box->props, "tabIndex"), "0");
    // Buttons, inputs, selects, textareas and links, as in a browser.
    if (!(box->kind >= 1 && box->kind <= 4) && box->kind != 9 && box->kind != 10) return false;
    if (box->kind == 1 && get(snapshot, box->props, "data-native-window-command")) return false;
    return !equal(snapshot, get(snapshot, box->props, "disabled"), "true");
}

static bool editing_box(const struct Box *box) {
    return editor && (box->kind == 2 || box->kind == 4) && box->native_id == edit_native_id &&
        !wcscmp(box->public_id, edit_id);
}

static bool focused_box(const struct Box *box) {
    if (editing_box(box)) return true;
    if (box->scroll_region) return same_control(box, &scroll_focus);
    return key_focus.kind && same_control(box, &key_focus);
}

static void clear_keyboard_focus(void) {
    key_focus = (struct Box){0};
    scroll_focus = (struct Box){0};
}

/* Scroll the document so a keyboard-focused box is visible. Boxes inside
 * nested scroll regions or fixed overlays keep their own scroll position. */
static void reveal_box(const struct Box *box) {
    if (box->viewport || box->clipped) return;
    float top = box->y - scroll, bottom = top + box->h;
    if (top < chrome_height) scroll = (int)(box->y - chrome_height - 8);
    else if (bottom > height) scroll = (int)(box->y + box->h - height + 8);
    scroll = (int)fmaxf(0, fminf((float)scroll, (float)(content_height - height)));
}

static void focus_box(const struct Box *box) {
    struct Box target = *box;
    clear_keyboard_focus();
    reveal_box(&target);
    if (target.kind == 2 || target.kind == 4) {
        if (!editing_box(&target)) activate(&target);
    } else {
        close_editor();
        SetFocus(window);
        if (target.scroll_region) scroll_focus = target;
        else key_focus = target;
    }
    InvalidateRect(window, NULL, FALSE);
    native_send_interaction();
}

static void keyboard_navigate(bool reverse) {
    UpdateWindow(window);  // lay out the latest snapshot before reading boxes
    int modal = modal_box_index();
    if (active_modal_node() && modal < 0) return;
    int floor = modal >= 0 ? (bottom_sheet(boxes[modal].node) ? modal : modal + 1) : 0;
    int end = modal >= 0 ? boxes[modal].end : box_count;
    int current = -1;
    for (int i = floor; i < end; i++) {
        if (focused_box(&boxes[i])) { current = i; break; }
    }
    int direction = reverse ? -1 : 1;
    for (int i = current >= 0 ? current + direction : reverse ? end - 1 : floor; i >= floor && i < end; i += direction) {
        // Inline links contribute one box per line; they are one stop.
        if (!tab_stop(&boxes[i]) || (current >= 0 && same_control(&boxes[i], &boxes[current]))) continue;
        focus_box(&boxes[i]);
        return;
    }
    // Past the last stop, focus leaves the page as it does in a browser.
    close_editor();
    SetFocus(window);
    clear_keyboard_focus();
    InvalidateRect(window, NULL, FALSE);
}

static bool document_scroll_key(WPARAM key, bool shift) {
    if (active_modal_node()) return false;
    int page = (int)fmaxf(40, (float)height - chrome_height - 40);
    int next = scroll;
    switch (key) {
    case VK_UP: next -= 40; break;
    case VK_DOWN: next += 40; break;
    case VK_PRIOR: next -= page; break;
    case VK_NEXT: next += page; break;
    case VK_SPACE: next += shift ? -page : page; break;
    case VK_HOME: next = 0; break;
    case VK_END: next = content_height; break;
    default: return false;
    }
    scroll = (int)fmaxf(0, fminf((float)next, (float)(content_height - height)));
    InvalidateRect(window, NULL, FALSE);
    return true;
}

/* Main-window key defaults. Returns true when the key was consumed. */
static bool window_key_default(WPARAM key) {
    bool shift = modifier_down(VK_SHIFT), ctrl = modifier_down(VK_CONTROL);
    if (key == VK_TAB && !ctrl) { keyboard_navigate(shift); return true; }
    if (key_focus.kind && (key == VK_RETURN || (key == VK_SPACE && key_focus.kind != 9 && key_focus.kind != 10))) {
        struct Box target = key_focus;
        activate(&target);
        return true;
    }
    if (scroll_focus.kind || ctrl) return false;
    return document_scroll_key(key, shift);
}

static void delete_previous_word(void) {
    DWORD start = 0, end = 0;
    SendMessageW(editor, EM_GETSEL, (WPARAM)&start, (LPARAM)&end);
    if (start == end) {
        wchar_t text[16384];
        GetWindowTextW(editor, text, sizeof(text) / sizeof(*text));
        DWORD at = start < wcslen(text) ? start : (DWORD)wcslen(text);
        while (at > 0 && iswspace(text[at - 1])) at--;
        while (at > 0 && !iswspace(text[at - 1])) at--;
        start = at;
    }
    SendMessageW(editor, EM_SETSEL, start, end);
    SendMessageW(editor, EM_REPLACESEL, TRUE, (LPARAM)L"");
}

/* Text-editor key defaults, called by the edit control's window procedure.
 * Returns true when the message was consumed. */
static bool editor_key_default(HWND hwnd, UINT message, WPARAM key) {
    if (hwnd != editor) return false;
    bool ctrl = modifier_down(VK_CONTROL), alt = modifier_down(VK_MENU);
    if (message == WM_CHAR) {
        // Swallow the control characters produced by the shortcuts below, and
        // the beep a single-line edit control makes for Enter.
        return key == L'\t' || key == 0x01 || key == 0x7f || (key == L'\r' && editing == 2);
    }
    if (message != WM_KEYDOWN) return false;
    if (key == VK_TAB && !ctrl && !alt) { keyboard_navigate(modifier_down(VK_SHIFT)); return true; }
    if (ctrl && !alt && key == 'A') { SendMessageW(editor, EM_SETSEL, 0, -1); return true; }
    if (ctrl && !alt && key == VK_BACK) { delete_previous_word(); return true; }
    if (key == VK_RETURN && editing == 2 && !ctrl && !alt) {
        int node = find_identity(get(snapshot, 1, "tree"), edit_id, edit_native_id);
        if (node && get(snapshot, props(node), "submit")) send_control_event(node, "submit", "\"value\":null");
        return true;
    }
    return false;
}
