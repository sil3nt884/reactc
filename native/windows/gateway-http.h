#include <winhttp.h>
#include <limits.h>

/* Each instance owns one origin and one in-memory WinHTTP session. */
struct GatewayConnection {
    LONG references;
    HINTERNET session;
    HINTERNET connection;
    const wchar_t *origin;
    bool secure;
    bool cookies;
};

struct GatewayHttp { struct GatewayConnection *active; };

static void gateway_release(struct GatewayConnection *connection) {
    if (!connection || InterlockedDecrement(&connection->references) != 0) return;
    if (connection->connection) WinHttpCloseHandle(connection->connection);
    if (connection->session) WinHttpCloseHandle(connection->session);
    free(connection);
}

static struct GatewayConnection *gateway_retain(const struct GatewayHttp *gateway) {
    if (gateway->active) InterlockedIncrement(&gateway->active->references);
    return gateway->active;
}

static void gateway_close(struct GatewayHttp *gateway) {
    struct GatewayConnection *connection = gateway->active;
    gateway->active = NULL;
    gateway_release(connection);
}

static bool gateway_open(struct GatewayHttp *gateway, const wchar_t *host, INTERNET_PORT port,
    const wchar_t *origin, bool secure, bool cookies) {
    if (!secure && wcscmp(host, L"127.0.0.1")) return false;
    if (gateway->active) return false;
    struct GatewayConnection *connection = calloc(1, sizeof(*connection));
    if (!connection) return false;
    connection->references = 1;
    connection->session = WinHttpOpen(L"reactc", secure ? WINHTTP_ACCESS_TYPE_AUTOMATIC_PROXY :
        WINHTTP_ACCESS_TYPE_NO_PROXY, WINHTTP_NO_PROXY_NAME, WINHTTP_NO_PROXY_BYPASS, 0);
    if (!connection->session || !WinHttpSetTimeouts(connection->session, 5000, 5000, 5000, 5000)) {
        gateway_release(connection);
        return false;
    }
    connection->connection = WinHttpConnect(connection->session, host, port, 0);
    if (!connection->connection) {
        gateway_release(connection);
        return false;
    }
    connection->origin = origin;
    connection->secure = secure;
    connection->cookies = cookies;
    gateway->active = connection;
    return true;
}

static bool gateway_local_path(const wchar_t *path) {
    if (path[0] != L'/' || path[1] == L'/') return false;
    for (const wchar_t *p = path; *p; p++) {
        if (*p <= L' ' || *p == 127 || *p == L'\\' || *p == L'#') return false;
    }
    return true;
}

static HINTERNET gateway_request(const struct GatewayConnection *connection, const wchar_t *method, const wchar_t *path) {
    if (!connection || !gateway_local_path(path)) return NULL;
    HINTERNET request = WinHttpOpenRequest(connection->connection, method, path, NULL,
        WINHTTP_NO_REFERER, WINHTTP_DEFAULT_ACCEPT_TYPES, connection->secure ? WINHTTP_FLAG_SECURE : 0);
    if (!request) return NULL;
    DWORD disabled = WINHTTP_DISABLE_REDIRECTS | WINHTTP_DISABLE_AUTHENTICATION;
    if (!connection->cookies) disabled |= WINHTTP_DISABLE_COOKIES;
    if (WinHttpSetOption(request, WINHTTP_OPTION_DISABLE_FEATURE, &disabled, sizeof(disabled))) return request;
    WinHttpCloseHandle(request);
    return NULL;
}

static bool gateway_json_method(struct GatewayHttp *gateway, const wchar_t *method, const wchar_t *path,
    const char *post, size_t post_size, char *response, size_t capacity, DWORD *status) {
    if (capacity < 2 || capacity > INT_MAX || post_size > MAXDWORD || (!post && post_size)) return false;
    *status = 0;
    response[0] = 0;
    HINTERNET request = gateway_request(gateway->active, method, path);
    if (!request) return false;
    bool success = false;
    wchar_t headers[1024];
    int length = swprintf(headers, sizeof(headers) / sizeof(*headers),
        L"Origin: %ls\r\nAccept: application/json\r\nCache-Control: no-store\r\n%ls", gateway->active->origin,
        post ? L"Content-Type: application/json\r\n" : L"");
    if (length < 0 || (size_t)length >= sizeof(headers) / sizeof(*headers)) goto done;
    if (!WinHttpSendRequest(request, headers, (DWORD)length, (void *)post, (DWORD)post_size, (DWORD)post_size, 0) ||
        !WinHttpReceiveResponse(request, NULL)) goto done;

    DWORD status_size = sizeof(*status);
    if (!WinHttpQueryHeaders(request, WINHTTP_QUERY_STATUS_CODE | WINHTTP_QUERY_FLAG_NUMBER,
        WINHTTP_HEADER_NAME_BY_INDEX, status, &status_size, WINHTTP_NO_HEADER_INDEX)) goto done;
    if (*status == 204 || *status < 200 || (*status >= 300 && *status < 400)) {
        success = true;
        goto done;
    }

    wchar_t content_type[256];
    DWORD content_type_size = sizeof(content_type);
    if (!WinHttpQueryHeaders(request, WINHTTP_QUERY_CONTENT_TYPE, WINHTTP_HEADER_NAME_BY_INDEX,
        content_type, &content_type_size, WINHTTP_NO_HEADER_INDEX) ||
        _wcsnicmp(content_type, L"application/json", 16) ||
        (content_type[16] && content_type[16] != L';')) {
        success = *status >= 400;
        goto done;
    }

    size_t used = 0;
    while (used < capacity) {
        DWORD bytes = 0;
        if (!WinHttpReadData(request, response + used, (DWORD)(capacity - used), &bytes)) goto done;
        if (!bytes) {
            response[used] = 0;
            success = used ? !memchr(response, 0, used) &&
                MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, response, (int)used, NULL, 0) > 0 : *status >= 400;
            break;
        }
        used += bytes;
    }

done:
    if (!success) response[0] = 0;
    WinHttpCloseHandle(request);
    return success;
}

static bool gateway_json(struct GatewayHttp *gateway, const wchar_t *path, const char *post, size_t post_size,
    char *response, size_t capacity, DWORD *status) {
    return gateway_json_method(gateway, post ? L"POST" : L"GET", path, post, post_size, response, capacity, status);
}
