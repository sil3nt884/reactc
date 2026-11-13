#include <shlwapi.h>

static const wchar_t *reactc_browser_window_option(const wchar_t *executable) {
    const wchar_t *name = wcsrchr(executable, L'\\');
    name = name ? name + 1 : executable;
    if (!_wcsicmp(name, L"firefox.exe")) return L"-new-window";
    const wchar_t *chromium[] = {L"chrome.exe", L"msedge.exe", L"brave.exe", L"vivaldi.exe", L"chromium.exe"};
    for (size_t i = 0; i < sizeof(chromium) / sizeof(*chromium); i++) {
        if (!_wcsicmp(name, chromium[i])) return L"--new-window";
    }
    return NULL;
}

static bool reactc_registered_edge(wchar_t *executable, DWORD bytes) {
    const wchar_t *path = L"Software\\Microsoft\\Windows\\CurrentVersion\\App Paths\\msedge.exe";
    HKEY keys[] = {HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE};
    DWORD views[] = {RRF_SUBKEY_WOW6464KEY, RRF_SUBKEY_WOW6432KEY};
    for (size_t i = 0; i < sizeof(keys) / sizeof(*keys); i++) {
        for (size_t j = 0; j < sizeof(views) / sizeof(*views); j++) {
            DWORD size = bytes;
            if (RegGetValueW(keys[i], path, NULL, RRF_RT_REG_SZ | RRF_RT_REG_EXPAND_SZ | views[j],
                    NULL, executable, &size) == ERROR_SUCCESS) return true;
        }
    }
    return false;
}

static bool reactc_launch_browser_window(const wchar_t *url, const wchar_t *scheme) {
    wchar_t executable[4096];
    DWORD capacity = sizeof(executable) / sizeof(*executable);
    const wchar_t *option = NULL;
    if (AssocQueryStringW(ASSOCF_IS_PROTOCOL | ASSOCF_NOTRUNCATE, ASSOCSTR_EXECUTABLE,
            scheme, L"open", executable, &capacity) == S_OK) {
        option = reactc_browser_window_option(executable);
    }
    if (!option) {
        if (!reactc_registered_edge(executable, sizeof(executable))) return false;
        option = L"--new-window";
    }

    wchar_t command[6208];
    int length = swprintf(command, sizeof(command) / sizeof(*command), L"\"%ls\" %ls \"%ls\"",
        executable, option, url);
    if (length < 0 || (size_t)length >= sizeof(command) / sizeof(*command)) return false;
    STARTUPINFOW startup = {.cb = sizeof(startup)};
    PROCESS_INFORMATION process;
    if (!CreateProcessW(executable, command, NULL, NULL, FALSE, 0, NULL, NULL, &startup, &process)) return false;
    CloseHandle(process.hThread);
    CloseHandle(process.hProcess);
    return true;
}

static bool reactc_open_url(struct Json *document, int token) {
    if (!token || document->t[token].type != '"') return false;
    int start = document->t[token].start + 1;
    int end = document->t[token].end - 1;
    if (end - start > 8192) return false;
    for (int i = start; i + 6 <= end; i++) {
        if (!memcmp(document->text + i, "\\u0000", 6)) return false;
    }
    wchar_t url[8193];
    string(document, token, url, sizeof(url) / sizeof(*url));
    size_t length = wcslen(url);
    if (length > 2048 || (_wcsnicmp(url, L"https://", 8) && _wcsnicmp(url, L"http://", 7))) return false;
    for (size_t i = 0; i < length; i++) {
        if (url[i] <= 0x20 || url[i] == 0x7f || url[i] == L'"' || url[i] == L'\\') return false;
    }
    URL_COMPONENTS parts = {
        .dwStructSize = sizeof(parts), .dwHostNameLength = (DWORD)-1,
        .dwUserNameLength = (DWORD)-1, .dwPasswordLength = (DWORD)-1,
    };
    if (!WinHttpCrackUrl(url, (DWORD)length, 0, &parts) || !parts.dwHostNameLength ||
        parts.dwUserNameLength || parts.dwPasswordLength) return false;

    return reactc_launch_browser_window(url, parts.nScheme == INTERNET_SCHEME_HTTPS ? L"https" : L"http");
}

static void reactc_host_result(HWND owner, struct Json *document, int request, char *command, size_t capacity) {
    if (reactc_browser_result(owner, document, request, command, capacity)) return;
    if (!equal(document, get(document, request, "action"), "native.window.open")) {
        reactc_http_result(document, request, command, capacity);
        return;
    }
    char id[256];
    raw(document, get(document, request, "id"), id, sizeof(id));
    int args = get(document, request, "args");
    bool opened = equal(document, get(document, request, "version"), "1") &&
        reactc_open_url(document, get(document, args, "url"));
    snprintf(command, capacity, "{\"type\":\"result\",\"id\":%s,\"result\":{\"ok\":%s}}",
        id, opened ? "true" : "false");
}
