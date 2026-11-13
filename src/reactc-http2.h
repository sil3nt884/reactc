/* nghttp2 owns the wire protocol. The JavaScript transport feeds socket bytes
 * into the session and drains the resulting frames and events after each call. */
#ifndef REACTC_HTTP2_H
#define REACTC_HTTP2_H
#define NGHTTP2_STATICLIB
#include <nghttp2/nghttp2.h>

#ifndef REACTC_NUM
static inline double reactc_num_jsval(jsval value) { return value.val; }
static inline double reactc_num_double(double value) { return value; }
#define REACTC_NUM(x) _Generic((x), jsval: reactc_num_jsval, default: reactc_num_double)(x)
#endif

enum { H2_HEADER = 1, H2_HEADERS, H2_DATA, H2_CLOSE, H2_GOAWAY, H2_END, H2_UPLOAD };
enum { H2_HEADER_LIMIT = 65536 };

typedef struct reactc_h2_event {
    struct reactc_h2_event *next;
    int kind, stream;
    uint32_t detail;
    size_t size;
    uint8_t bytes[];
} reactc_h2_event;

typedef struct reactc_h2_upload {
    struct reactc_h2_upload *next;
    size_t offset, size;
    uint8_t *bytes;
    int live, eof;
} reactc_h2_upload;

typedef struct {
    nghttp2_session *session;
    reactc_h2_event *first, *last;
    reactc_h2_upload *uploads;
    size_t header_bytes;
    const uint8_t *output;
} reactc_h2;

static int reactc_h2_event_push(reactc_h2 *h2, int kind, int stream, uint32_t detail,
                                const uint8_t *a, size_t an, const uint8_t *b, size_t bn) {
    reactc_h2_event *event = malloc(sizeof(*event) + an + bn);
    if (!event) return NGHTTP2_ERR_CALLBACK_FAILURE;
    *event = (reactc_h2_event){NULL, kind, stream, detail, an + bn};
    if (an) memcpy(event->bytes, a, an);
    if (bn) memcpy(event->bytes + an, b, bn);
    if (h2->last) h2->last->next = event;
    else h2->first = event;
    h2->last = event;
    return 0;
}

static void reactc_h2_pop(reactc_h2 *h2) {
    reactc_h2_event *event = h2->first;
    h2->first = event->next;
    if (!h2->first) h2->last = NULL;
    free(event);
}

static void reactc_h2_free(reactc_h2 *h2) {
    if (h2->session) nghttp2_session_del(h2->session);
    while (h2->first) reactc_h2_pop(h2);
    while (h2->uploads) {
        reactc_h2_upload *upload = h2->uploads;
        h2->uploads = upload->next;
        free(upload->bytes);
        free(upload);
    }
    free(h2);
}

static int reactc_h2_begin(nghttp2_session *session, const nghttp2_frame *frame, void *user) {
    ((reactc_h2 *)user)->header_bytes = 0;
    return 0;
}

static int reactc_h2_header(nghttp2_session *session, const nghttp2_frame *frame,
                            const uint8_t *name, size_t namelen, const uint8_t *value, size_t valuelen,
                            uint8_t flags, void *user) {
    reactc_h2 *h2 = user;
    h2->header_bytes += namelen + valuelen + 32;
    if (h2->header_bytes > H2_HEADER_LIMIT) return NGHTTP2_ERR_TEMPORAL_CALLBACK_FAILURE;
    return reactc_h2_event_push(h2, H2_HEADER, frame->hd.stream_id, namelen, name, namelen, value, valuelen);
}

static int reactc_h2_frame(nghttp2_session *session, const nghttp2_frame *frame, void *user) {
    int stream = frame->hd.stream_id;
    if (frame->hd.type == NGHTTP2_GOAWAY)
        return reactc_h2_event_push(user, H2_GOAWAY, 0, frame->goaway.last_stream_id, NULL, 0, NULL, 0);
    if (frame->hd.type == NGHTTP2_HEADERS &&
        reactc_h2_event_push(user, H2_HEADERS, stream, 0, NULL, 0, NULL, 0))
        return NGHTTP2_ERR_CALLBACK_FAILURE;
    if ((frame->hd.type == NGHTTP2_HEADERS || frame->hd.type == NGHTTP2_DATA) &&
        (frame->hd.flags & NGHTTP2_FLAG_END_STREAM))
        return reactc_h2_event_push(user, H2_END, stream, 0, NULL, 0, NULL, 0);
    return 0;
}

static int reactc_h2_data(nghttp2_session *session, uint8_t flags, int32_t stream,
                          const uint8_t *bytes, size_t length, void *user) {
    /* Keep other streams moving even if the application holds this stream's body. */
    if (nghttp2_session_consume_connection(session, length)) return NGHTTP2_ERR_CALLBACK_FAILURE;
    return reactc_h2_event_push(user, H2_DATA, stream, 0, bytes, length, NULL, 0);
}

static int reactc_h2_closed(nghttp2_session *session, int32_t stream, uint32_t error, void *user) {
    reactc_h2 *h2 = user;
    reactc_h2_upload *upload = nghttp2_session_get_stream_user_data(session, stream);
    if (upload) {
        reactc_h2_upload **link = &h2->uploads;
        while (*link != upload) link = &(*link)->next;
        *link = upload->next;
        free(upload->bytes);
        free(upload);
    }
    return reactc_h2_event_push(h2, H2_CLOSE, stream, error, NULL, 0, NULL, 0);
}

static reactc_h2 *reactc_h2_open(void) {
    reactc_h2 *h2 = calloc(1, sizeof(*h2));
    nghttp2_session_callbacks *callbacks;
    nghttp2_option *option;
    if (!h2) return NULL;
    if (nghttp2_session_callbacks_new(&callbacks)) { free(h2); return NULL; }
    if (nghttp2_option_new(&option)) {
        nghttp2_session_callbacks_del(callbacks);
        free(h2);
        return NULL;
    }
    nghttp2_option_set_no_auto_window_update(option, 1);
    nghttp2_session_callbacks_set_on_begin_headers_callback(callbacks, reactc_h2_begin);
    nghttp2_session_callbacks_set_on_header_callback(callbacks, reactc_h2_header);
    nghttp2_session_callbacks_set_on_frame_recv_callback(callbacks, reactc_h2_frame);
    nghttp2_session_callbacks_set_on_data_chunk_recv_callback(callbacks, reactc_h2_data);
    nghttp2_session_callbacks_set_on_stream_close_callback(callbacks, reactc_h2_closed);
    int result = nghttp2_session_client_new2(&h2->session, callbacks, h2, option);
    nghttp2_option_del(option);
    nghttp2_session_callbacks_del(callbacks);
    const nghttp2_settings_entry settings[] = {
        {NGHTTP2_SETTINGS_ENABLE_PUSH, 0},
        {NGHTTP2_SETTINGS_MAX_HEADER_LIST_SIZE, H2_HEADER_LIMIT}
    };
    if (result || nghttp2_submit_settings(h2->session, NGHTTP2_FLAG_NONE, settings, 2)) {
        reactc_h2_free(h2);
        return NULL;
    }
    return h2;
}

static nghttp2_ssize reactc_h2_read_upload(nghttp2_session *session, int32_t stream, uint8_t *buffer,
                                          size_t length, uint32_t *flags, nghttp2_data_source *source, void *user) {
    reactc_h2_upload *upload = source->ptr;
    size_t remaining = upload->size - upload->offset;
    if (!remaining && !upload->eof) return NGHTTP2_ERR_DEFERRED;
    if (length > remaining) length = remaining;
    if (length) memcpy(buffer, upload->bytes + upload->offset, length);
    upload->offset += length;
    if (upload->offset == upload->size) {
        if (upload->eof) *flags |= NGHTTP2_DATA_FLAG_EOF;
        else if (reactc_h2_event_push(user, H2_UPLOAD, stream, 0, NULL, 0, NULL, 0))
            return NGHTTP2_ERR_CALLBACK_FAILURE;
    }
    return length;
}

/* Each field occupies two NUL-terminated strings. nghttp2 copies the headers
 * on submit. Keep a native copy of upload bytes until the stream closes. */
static int reactc_h2_submit(reactc_h2 *h2, char *fields, size_t count,
                             const uint8_t *body, size_t length, int live) {
    nghttp2_nv *headers = calloc(count, sizeof(*headers));
    if (!headers) return NGHTTP2_ERR_NOMEM;
    for (size_t i = 0; i < count; ++i) {
        char *name = fields;
        size_t namelen = strlen(name);
        char *value = name + namelen + 1;
        size_t valuelen = strlen(value);
        fields = value + valuelen + 1;
        uint8_t flags = NGHTTP2_NV_FLAG_NONE;
        if (!strcmp(name, "authorization") || !strcmp(name, "cookie")) flags = NGHTTP2_NV_FLAG_NO_INDEX;
        headers[i] = (nghttp2_nv){(uint8_t *)name, (uint8_t *)value, namelen, valuelen, flags};
    }
    reactc_h2_upload *upload = NULL;
    nghttp2_data_provider2 provider;
    if (length || live) {
        upload = calloc(1, sizeof(*upload));
        if (!upload) { free(headers); return NGHTTP2_ERR_NOMEM; }
        upload->next = h2->uploads;
        upload->live = live;
        upload->eof = !live;
        upload->size = length;
        if (length) {
            upload->bytes = malloc(length);
            if (!upload->bytes) { free(upload); free(headers); return NGHTTP2_ERR_NOMEM; }
            memcpy(upload->bytes, body, length);
        }
        provider = (nghttp2_data_provider2){{.ptr = upload}, reactc_h2_read_upload};
    }
    int stream = nghttp2_submit_request2(h2->session, NULL, headers, count, upload ? &provider : NULL, upload);
    free(headers);
    if (stream < 0 && upload) { free(upload->bytes); free(upload); }
    else if (upload) h2->uploads = upload;
    return stream;
}

static int reactc_h2_feed(reactc_h2 *h2, int stream, const uint8_t *data, size_t length, int eof) {
    reactc_h2_upload *upload = nghttp2_session_get_stream_user_data(h2->session, stream);
    if (!upload || !upload->live) return NGHTTP2_ERR_STREAM_CLOSED;
    uint8_t *bytes = length ? malloc(length) : NULL;
    if (length && !bytes) return NGHTTP2_ERR_NOMEM;
    if (length) memcpy(bytes, data, length);
    free(upload->bytes);
    upload->bytes = bytes;
    upload->offset = 0;
    upload->size = length;
    upload->eof = eof;
    return nghttp2_session_resume_data(h2->session, stream);
}
#endif
