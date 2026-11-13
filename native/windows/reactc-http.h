#include <wctype.h>
#include "gateway-http.h"

/* Native fetch for reactc apps. Requests carry {origin, path, method,
 * headers?: [[name, value], ...], body?: text}; native.http.read carries GET
 * and HEAD, native.http.write POST, PUT, PATCH, DELETE and OPTIONS. Results
 * carry {ok, status, statusText, headers, body}. Redirects, authentication
 * prompts and cookies stay disabled, as for the gateway. */
enum {
    REACTC_HTTP_BODY_LIMIT = 65536, REACTC_HTTP_REQUEST_LIMIT = 65536,
    REACTC_HTTP_HEADER_LIMIT = 8192, REACTC_HTTP_HEADER_COUNT = 64,
    /* The page core reads commands of at most 256 KiB. */
    REACTC_HTTP_COMMAND_LIMIT = 262000,
};

static const char *reactc_http_methods_read[] = {"GET", "HEAD"};
static const char *reactc_http_methods_write[] = {"POST", "PUT", "PATCH", "DELETE", "OPTIONS"};

static bool reactc_http_token(const wchar_t *text) {
    if (!*text) return false;
    for (const wchar_t *c = text; *c; c++) {
        if (*c > 126 || !(iswalnum(*c) || wcschr(L"!#$%&'*+.^_`|~-", *c))) return false;
    }
    return true;
}

/* Header names a browser sets itself; the host owns these. */
static bool reactc_http_forbidden(const wchar_t *name) {
    static const wchar_t *names[] = {
        L"accept-charset", L"accept-encoding", L"access-control-request-headers", L"access-control-request-method",
        L"connection", L"content-length", L"cookie2", L"date", L"dnt", L"expect", L"host", L"keep-alive",
        L"origin", L"referer", L"te", L"trailer", L"transfer-encoding", L"upgrade", L"via",
    };
    for (size_t i = 0; i < sizeof(names) / sizeof(*names); i++) if (!_wcsicmp(name, names[i])) return true;
    return !_wcsnicmp(name, L"proxy-", 6) || !_wcsnicmp(name, L"sec-", 4);
}

/* Builds "Name: value\r\n" lines from the request's header pairs. */
static bool reactc_http_headers(struct Json *document, int token, wchar_t *out, size_t capacity) {
    *out = 0;
    if (!token) return true;
    if (document->t[token].type != '[') return false;
    size_t used = 0;
    int count = 0;
    for (int pair = token + 1; pair < document->t[token].next; pair = document->t[pair].next) {
        if (document->t[pair].type != '[' || ++count > REACTC_HTTP_HEADER_COUNT) return false;
        int name_token = pair + 1;
        if (name_token >= document->t[pair].next) return false;
        int value_token = document->t[name_token].next;
        if (value_token >= document->t[pair].next || document->t[value_token].next != document->t[pair].next ||
            document->t[name_token].type != '"' || document->t[value_token].type != '"' ||
            document->t[name_token].end - document->t[name_token].start > 258 ||
            document->t[value_token].end - document->t[value_token].start > REACTC_HTTP_HEADER_LIMIT) return false;
        wchar_t name[257], value[REACTC_HTTP_HEADER_LIMIT + 1];
        string(document, name_token, name, sizeof(name) / sizeof(*name));
        string(document, value_token, value, sizeof(value) / sizeof(*value));
        if (!reactc_http_token(name) || reactc_http_forbidden(name) || wcspbrk(value, L"\r\n")) return false;
        int written = swprintf(out + used, capacity - used, L"%ls: %ls\r\n", name, value);
        if (written < 0 || used + (size_t)written >= capacity || used + (size_t)written > REACTC_HTTP_HEADER_LIMIT) return false;
        used += (size_t)written;
    }
    return true;
}

static DWORD reactc_http_payload(struct Json *document, int token, char *payload) {
    if (document->t[token].type != '"' ||
        document->t[token].end - document->t[token].start - 2 > REACTC_HTTP_REQUEST_LIMIT * 6) return (DWORD)-1;
    wchar_t *text = calloc(REACTC_HTTP_REQUEST_LIMIT + 1, sizeof(*text));
    if (!text) fail("Cannot allocate a native HTTP request body");
    size_t length = string(document, token, text, REACTC_HTTP_REQUEST_LIMIT + 1);
    DWORD size = (DWORD)-1;
    if (wcslen(text) == length) {
        int bytes = length ? WideCharToMultiByte(CP_UTF8, WC_ERR_INVALID_CHARS, text, (int)length,
            payload, REACTC_HTTP_REQUEST_LIMIT, NULL, NULL) : 0;
        if (bytes || !length) size = (DWORD)bytes;
    }
    free(text);
    return size;
}

struct ReactcHttpResponse {
    DWORD status;
    wchar_t status_text[256];
    wchar_t *raw_headers;   /* CRLF-separated, from WinHTTP */
    wchar_t *body;
};

static bool reactc_http_request(const wchar_t *origin, const wchar_t *path, const wchar_t *method,
    const wchar_t *headers, const char *payload, DWORD payload_size, struct ReactcHttpResponse *response) {
    URL_COMPONENTS url = {0};
    wchar_t hostname[256];
    url.dwStructSize = sizeof(url);
    url.lpszHostName = hostname;
    url.dwHostNameLength = sizeof(hostname) / sizeof(*hostname);
    url.dwUserNameLength = url.dwPasswordLength = url.dwUrlPathLength = url.dwExtraInfoLength = (DWORD)-1;
    if (!WinHttpCrackUrl(origin, 0, 0, &url) || !url.dwHostNameLength || !url.nPort ||
        url.dwUserNameLength || url.dwPasswordLength || url.dwUrlPathLength || url.dwExtraInfoLength ||
        (url.nScheme != INTERNET_SCHEME_HTTP && url.nScheme != INTERNET_SCHEME_HTTPS)) return false;

    struct GatewayConnection connection = {0};
    connection.secure = url.nScheme == INTERNET_SCHEME_HTTPS;
    connection.session = WinHttpOpen(L"reactc", WINHTTP_ACCESS_TYPE_NO_PROXY,
        WINHTTP_NO_PROXY_NAME, WINHTTP_NO_PROXY_BYPASS, 0);
    if (!connection.session) return false;
    HINTERNET request = NULL;
    bool success = false;
    char *bytes = NULL;
    if (!WinHttpSetTimeouts(connection.session, 5000, 5000, 5000, 5000)) goto done;
    connection.connection = WinHttpConnect(connection.session, hostname, url.nPort, 0);
    request = gateway_request(&connection, method, path);
    if (!request || !WinHttpSendRequest(request, *headers ? headers : WINHTTP_NO_ADDITIONAL_HEADERS,
        *headers ? (DWORD)-1 : 0, (void *)payload, payload_size, payload_size, 0) ||
        !WinHttpReceiveResponse(request, NULL)) goto done;
    DWORD size = sizeof(response->status);
    if (!WinHttpQueryHeaders(request, WINHTTP_QUERY_STATUS_CODE | WINHTTP_QUERY_FLAG_NUMBER,
        WINHTTP_HEADER_NAME_BY_INDEX, &response->status, &size, WINHTTP_NO_HEADER_INDEX)) goto done;
    size = sizeof(response->status_text);
    if (!WinHttpQueryHeaders(request, WINHTTP_QUERY_STATUS_TEXT, WINHTTP_HEADER_NAME_BY_INDEX,
        response->status_text, &size, WINHTTP_NO_HEADER_INDEX)) response->status_text[0] = 0;
    size = 0;
    WinHttpQueryHeaders(request, WINHTTP_QUERY_RAW_HEADERS_CRLF, WINHTTP_HEADER_NAME_BY_INDEX,
        WINHTTP_NO_OUTPUT_BUFFER, &size, WINHTTP_NO_HEADER_INDEX);
    if (GetLastError() == ERROR_INSUFFICIENT_BUFFER && size) {
        response->raw_headers = calloc(size / sizeof(wchar_t) + 1, sizeof(wchar_t));
        if (!response->raw_headers) fail("Cannot allocate native HTTP response headers");
        if (!WinHttpQueryHeaders(request, WINHTTP_QUERY_RAW_HEADERS_CRLF, WINHTTP_HEADER_NAME_BY_INDEX,
            response->raw_headers, &size, WINHTTP_NO_HEADER_INDEX)) response->raw_headers[0] = 0;
    }

    bytes = malloc(REACTC_HTTP_BODY_LIMIT + 1);
    response->body = calloc(REACTC_HTTP_BODY_LIMIT + 1, sizeof(wchar_t));
    if (!bytes || !response->body) fail("Cannot allocate a native HTTP response body");
    size_t used = 0;
    while (used <= REACTC_HTTP_BODY_LIMIT) {
        DWORD count;
        if (!WinHttpReadData(request, bytes + used, (DWORD)(REACTC_HTTP_BODY_LIMIT + 1 - used), &count)) goto done;
        if (!count) {
            int units = used ? MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS,
                bytes, (int)used, response->body, REACTC_HTTP_BODY_LIMIT) : 0;
            if (used && (!units || memchr(bytes, 0, used))) goto done;
            response->body[units] = 0;
            success = true;
            break;
        }
        used += count;
    }

done:
    free(bytes);
    if (request) WinHttpCloseHandle(request);
    if (connection.connection) WinHttpCloseHandle(connection.connection);
    WinHttpCloseHandle(connection.session);
    return success;
}

/* Appends the response headers as JSON pairs with lower-case names. */
static bool reactc_http_append_headers(const wchar_t *raw, char *command, size_t capacity) {
    size_t used = strlen(command);
    if (used + 2 >= capacity) return false;
    command[used++] = '[';
    command[used] = 0;
    bool first = true;
    const wchar_t *line = raw ? wcsstr(raw, L"\r\n") : NULL;  /* skip the status line */
    while (line) {
        line += 2;
        const wchar_t *end = wcsstr(line, L"\r\n");
        size_t length = end ? (size_t)(end - line) : wcslen(line);
        const wchar_t *colon = wmemchr(line, L':', length);
        if (colon && colon > line && length < 16384) {
            wchar_t name[257], value[16384];
            size_t name_length = (size_t)(colon - line);
            if (name_length < 257) {
                wmemcpy(name, line, name_length);
                name[name_length] = 0;
                const wchar_t *start = colon + 1;
                while (start < line + length && (*start == L' ' || *start == L'\t')) start++;
                size_t value_length = (size_t)(line + length - start);
                wmemcpy(value, start, value_length);
                value[value_length] = 0;
                CharLowerBuffW(name, (DWORD)name_length);
                if (reactc_http_token(name)) {
                    if (used + 2 * 6 * (name_length + value_length) + 8 >= capacity) return false;
                    if (!first) command[used++] = ',';
                    command[used++] = '[';
                    quote(name, command + used, capacity - used);
                    used += strlen(command + used);
                    command[used++] = ',';
                    quote(value, command + used, capacity - used);
                    used += strlen(command + used);
                    command[used++] = ']';
                    command[used] = 0;
                    first = false;
                }
            }
        }
        line = end;
        if (end && !end[2]) break;
    }
    if (used + 2 >= capacity) return false;
    command[used++] = ']';
    command[used] = 0;
    return true;
}

static const wchar_t *reactc_http_method(struct Json *document, int action, int method_token, wchar_t *method) {
    bool read = equal(document, action, "native.http.read"), write = equal(document, action, "native.http.write");
    const char **methods = read ? reactc_http_methods_read : reactc_http_methods_write;
    size_t count = read ? sizeof(reactc_http_methods_read) / sizeof(*reactc_http_methods_read)
        : sizeof(reactc_http_methods_write) / sizeof(*reactc_http_methods_write);
    if (!read && !write) return NULL;
    for (size_t i = 0; i < count; i++) {
        if (equal(document, method_token, methods[i])) {
            MultiByteToWideChar(CP_UTF8, 0, methods[i], -1, method, 16);
            return method;
        }
    }
    return NULL;
}

static void reactc_http_result(struct Json *document, int request, char *command, size_t capacity) {
    int args = get(document, request, "args");
    int origin_token = get(document, args, "origin"), path_token = get(document, args, "path");
    int action = get(document, request, "action");
    wchar_t method_text[16];
    const wchar_t *method = reactc_http_method(document, action, get(document, args, "method"), method_text);
    char id[256];
    raw(document, get(document, request, "id"), id, sizeof(id));
    const char *error = "This host has no handler for the requested action";
    if (method && equal(document, get(document, request, "version"), "1")) {
        error = "Invalid native HTTP request";
        int body_token = get(document, args, "body");
        bool read = !wcscmp(method, L"GET") || !wcscmp(method, L"HEAD");
        static char payload[REACTC_HTTP_REQUEST_LIMIT];
        static wchar_t headers[REACTC_HTTP_HEADER_LIMIT + 64];
        DWORD payload_size = 0;
        bool valid_body = !body_token || (!read && (payload_size = reactc_http_payload(document, body_token, payload)) != (DWORD)-1);
        if (origin_token && path_token && valid_body &&
            reactc_http_headers(document, get(document, args, "headers"), headers, sizeof(headers) / sizeof(*headers)) &&
            document->t[origin_token].end - document->t[origin_token].start <= 258 &&
            document->t[path_token].end - document->t[path_token].start <= 4098) {
            wchar_t origin[257], path[4097];
            string(document, origin_token, origin, sizeof(origin) / sizeof(*origin));
            string(document, path_token, path, sizeof(path) / sizeof(*path));
            if (wcslen(path) <= 2048 && gateway_local_path(path)) {
                struct ReactcHttpResponse response = {0};
                if (reactc_http_request(origin, path, method, headers, body_token ? payload : NULL, payload_size, &response)) {
                    size_t limit = capacity < REACTC_HTTP_COMMAND_LIMIT ? capacity : REACTC_HTTP_COMMAND_LIMIT;
                    int prefix = snprintf(command, limit,
                        "{\"type\":\"result\",\"id\":%s,\"result\":{\"ok\":true,\"status\":%lu,\"statusText\":",
                        id, (unsigned long)response.status);
                    bool fits = prefix > 0 && (size_t)prefix + 16 + wcslen(response.status_text) * 6 < limit;
                    if (fits) {
                        quote(response.status_text, command + prefix, limit - prefix);
                        strcat(command, ",\"headers\":");
                        fits = reactc_http_append_headers(response.raw_headers, command, limit);
                    }
                    size_t used = strlen(command);
                    fits = fits && used + 16 + wcslen(response.body) * 6 < limit;
                    if (fits) {
                        strcat(command, ",\"body\":");
                        used = strlen(command);
                        quote(response.body, command + used, limit - used - 2);
                        strcat(command, "}}");
                    }
                    free(response.raw_headers);
                    free(response.body);
                    if (fits) return;
                    error = "The native HTTP response is too large";
                } else {
                    free(response.raw_headers);
                    free(response.body);
                    error = "Native HTTP request failed";
                }
            }
        }
    }
    snprintf(command, capacity, "{\"type\":\"result\",\"id\":%s,\"result\":{\"ok\":false,\"error\":\"%s\"}}", id, error);
}
