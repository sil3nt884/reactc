// The protocol worker handles persistence. UI operations are marshalled to
// the window thread so the native dialogs are owned by the app's window.
enum { REACTC_BROWSER_DIALOG = WM_APP + 11 };
enum { BROWSER_KEY_LIMIT = 512, BROWSER_VALUE_LIMIT = 32768 };
#ifndef NATIVE_APP_STORAGE_SCOPE
#define NATIVE_APP_STORAGE_SCOPE L"standalone"
#endif
static const wchar_t browser_storage_path[] = L"Software\\reactc\\Storage\\" NATIVE_APP_STORAGE_SCOPE;

static wchar_t *browser_text(struct Json *document, int token, size_t limit, size_t *length) {
    if (!token || document->t[token].type != '"') return NULL;
    size_t bytes = document->t[token].end - document->t[token].start - 2;
    if (bytes > limit * 6) return NULL;
    wchar_t *text = malloc((bytes + 1) * sizeof(*text));
    if (!text) return NULL;
    *length = string(document, token, text, bytes + 1);
    if (*length <= limit) return text;
    free(text);
    return NULL;
}

static bool browser_storage_key(struct Json *document, int token, wchar_t *encoded) {
    size_t length;
    wchar_t *key = browser_text(document, token, BROWSER_KEY_LIMIT, &length);
    if (!key) return false;
    const wchar_t hex[] = L"0123456789abcdef";
    encoded[0] = L'k';
    for (size_t i = 0; i < length; i++) {
        unsigned unit = key[i];
        for (unsigned j = 0; j < 4; j++)
            encoded[1 + i * 4 + j] = hex[(unit >> ((3 - j) * 4)) & 15];
    }
    encoded[1 + length * 4] = 0;
    free(key);
    return true;
}

static void browser_storage_result(struct Json *document, int args, const char *id, char *command, size_t capacity) {
    int operation = get(document, args, "operation");
    bool ok = false;
    wchar_t *output = NULL;
    size_t length = 0;
    wchar_t key[BROWSER_KEY_LIMIT * 4 + 2];
    bool set = equal(document, operation, "set"), remove = equal(document, operation, "remove");
    bool read = equal(document, operation, "get");
    if (equal(document, operation, "clear")) {
        LSTATUS status = RegDeleteTreeW(HKEY_CURRENT_USER, browser_storage_path);
        ok = status == ERROR_SUCCESS || status == ERROR_FILE_NOT_FOUND;
    } else if ((set || remove || read) && browser_storage_key(document, get(document, args, "key"), key)) {
        HKEY storage;
        LSTATUS status = set
            ? RegCreateKeyExW(HKEY_CURRENT_USER, browser_storage_path, 0, NULL, 0, KEY_SET_VALUE, NULL, &storage, NULL)
            : RegOpenKeyExW(HKEY_CURRENT_USER, browser_storage_path, 0, remove ? KEY_SET_VALUE : KEY_QUERY_VALUE, &storage);
        if (status == ERROR_FILE_NOT_FOUND && !set) ok = true;
        if (status == ERROR_SUCCESS) {
            if (set) {
                wchar_t *input = browser_text(document, get(document, args, "value"), BROWSER_VALUE_LIMIT, &length);
                if (input) {
                    ok = RegSetValueExW(storage, key, 0, REG_BINARY, (BYTE *)input,
                        (DWORD)(length * sizeof(*input))) == ERROR_SUCCESS;
                    free(input);
                }
            } else if (remove) {
                status = RegDeleteValueW(storage, key);
                ok = status == ERROR_SUCCESS || status == ERROR_FILE_NOT_FOUND;
            } else {
                DWORD bytes = BROWSER_VALUE_LIMIT * sizeof(wchar_t), type;
                output = malloc(bytes);
                if (output) {
                    status = RegQueryValueExW(storage, key, NULL, &type, (BYTE *)output, &bytes);
                    ok = status == ERROR_FILE_NOT_FOUND ||
                        (status == ERROR_SUCCESS && type == REG_BINARY && bytes % sizeof(wchar_t) == 0);
                    if (status == ERROR_SUCCESS && ok) length = bytes / sizeof(wchar_t);
                    else { free(output); output = NULL; }
                }
            }
            RegCloseKey(storage);
        }
    }
    if (ok && output) {
        int prefix = snprintf(command, capacity, "{\"type\":\"result\",\"id\":%s,\"result\":{\"ok\":true,\"value\":", id);
        quote_units(output, length, command + prefix, capacity - prefix - 2);
        strcat(command, "}}");
    } else {
        snprintf(command, capacity, "{\"type\":\"result\",\"id\":%s,\"result\":{\"ok\":%s,\"value\":null}}",
            id, ok ? "true" : "false");
    }
    free(output);
}

static bool browser_write_download(const wchar_t *path, const wchar_t *text, size_t length) {
    int size = length ? WideCharToMultiByte(CP_UTF8, WC_ERR_INVALID_CHARS, text, (int)length, NULL, 0, NULL, NULL) : 0;
    if (length && size <= 0) return false;
    char *bytes = malloc(size ? (size_t)size : 1);
    if (!bytes) return false;
    bool converted = !size || WideCharToMultiByte(CP_UTF8, WC_ERR_INVALID_CHARS, text, (int)length,
        bytes, size, NULL, NULL) == size;
    wchar_t directory[MAX_PATH], temporary[MAX_PATH];
    wcscpy(directory, path);
    wchar_t *slash = wcsrchr(directory, L'\\');
    if (!converted || !slash) { free(bytes); return false; }
    slash[1] = 0;
    if (!GetTempFileNameW(directory, L"rct", 0, temporary)) { free(bytes); return false; }
    HANDLE file = CreateFileW(temporary, GENERIC_WRITE, 0, NULL, TRUNCATE_EXISTING, FILE_ATTRIBUTE_NORMAL, NULL);
    DWORD written = 0;
    bool ok = false;
    if (file != INVALID_HANDLE_VALUE) {
        ok = WriteFile(file, bytes, (DWORD)size, &written, NULL) && written == (DWORD)size;
        ok = CloseHandle(file) && ok;
    }
    if (ok) ok = MoveFileExW(temporary, path, MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH) != FALSE;
    if (!ok) DeleteFileW(temporary);
    free(bytes);
    return ok;
}

static int browser_download(HWND owner, struct Json *document, int args) {
    size_t name_length, length;
    wchar_t *name = browser_text(document, get(document, args, "name"), 240, &name_length);
    wchar_t *content = browser_text(document, get(document, args, "content"), 65536, &length);
    int result = 0;
    if (name && content && name_length && wcslen(name) == name_length && !wcspbrk(name, L"\\/:*?\"<>|") &&
        wcscmp(name, L".") && wcscmp(name, L"..")) {
        bool valid = true;
        for (size_t i = 0; i < name_length; i++) if (name[i] < 32) valid = false;
        if (valid) {
            wchar_t path[MAX_PATH];
            wcscpy(path, name);
            OPENFILENAMEW dialog = {
                .lStructSize = sizeof(dialog), .hwndOwner = owner, .lpstrFile = path, .nMaxFile = MAX_PATH,
                .lpstrTitle = L"Save download", .Flags = OFN_PATHMUSTEXIST | OFN_OVERWRITEPROMPT | OFN_NOCHANGEDIR,
            };
            if (GetSaveFileNameW(&dialog)) result = browser_write_download(path, content, length) ? 2 : 0;
            else if (!CommDlgExtendedError()) result = 1;
        }
    }
    free(name);
    free(content);
    return result;
}

struct ReactcBrowserDialog {
    struct Json *document;
    int args;
    bool download;
};

static void *volatile browser_pending_dialog;

static LRESULT reactc_browser_dialog(HWND owner, const struct ReactcBrowserDialog *call) {
    if (!call || InterlockedCompareExchangePointer(&browser_pending_dialog, NULL, (void *)call) != call) return 0;
    if (call->download) return browser_download(owner, call->document, call->args);
    int kind = get(call->document, call->args, "kind");
    bool confirm = equal(call->document, kind, "confirm");
    if (!confirm && !equal(call->document, kind, "alert")) return 0;
    size_t length;
    wchar_t *message = browser_text(call->document, get(call->document, call->args, "message"), 4096, &length);
    if (!message) return 0;
    int result = 0;
    if (wcslen(message) == length) {
        int pressed = MessageBoxW(owner, message, NATIVE_APP_TITLE,
            confirm ? MB_OKCANCEL | MB_ICONQUESTION : MB_OK | MB_ICONINFORMATION);
        if (pressed) result = pressed == IDOK ? 2 : 1;
    }
    free(message);
    return result;
}

static bool reactc_browser_result(HWND owner, struct Json *document, int request, char *command, size_t capacity) {
    int action = get(document, request, "action");
    bool storage = equal(document, action, "native.browser.storage");
    bool download = equal(document, action, "native.browser.download");
    if (!storage && !download && !equal(document, action, "native.browser.dialog")) return false;
    char id[256];
    raw(document, get(document, request, "id"), id, sizeof(id));
    int args = get(document, request, "args");
    int result = 0;
    if (equal(document, get(document, request, "version"), "1")) {
        if (storage) {
            browser_storage_result(document, args, id, command, capacity);
            return true;
        }
        struct ReactcBrowserDialog call = {document, args, download};
        InterlockedExchangePointer(&browser_pending_dialog, &call);
        result = (int)SendMessageW(owner, REACTC_BROWSER_DIALOG, 0, (LPARAM)&call);
        InterlockedCompareExchangePointer(&browser_pending_dialog, NULL, &call);
    }
    snprintf(command, capacity, "{\"type\":\"result\",\"id\":%s,\"result\":{\"ok\":%s,\"accepted\":%s}}",
        id, result ? "true" : "false", result == 2 ? "true" : "false");
    return true;
}
