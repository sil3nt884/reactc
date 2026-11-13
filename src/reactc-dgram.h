/* reactc UDP sockets (node:dgram) on Porffor's libuv loop. Included into the
 * compiled program after Porffor's libuv backend (porf_uv_loop, porf_node_u8,
 * porf_node_bytes). Events call the JavaScript dispatcher set by
 * src/node-net/dgram.js directly from libuv callbacks, as Porffor's HTTP
 * bridge does; the dispatcher reads the event through the accessors below. */
#ifndef REACTC_DGRAM_H
#define REACTC_DGRAM_H

#ifndef REACTC_NUM
static inline double reactc_num_jsval(jsval value) { return value.val; }
static inline double reactc_num_double(double value) { return value; }
#define REACTC_NUM(x) _Generic((x), jsval: reactc_num_jsval, default: reactc_num_double)(x)
#endif

enum { REACTC_UDP_MAX = 1024 };
enum { REACTC_UDP_MESSAGE = 1, REACTC_UDP_SENT = 2, REACTC_UDP_ERROR = 3, REACTC_UDP_CLOSED = 4 };

typedef struct { uv_udp_t handle; int id; int family; } reactc_udp_socket;
typedef struct { uv_udp_send_t req; int id; int request; uv_buf_t buf; } reactc_udp_send_req;

static reactc_udp_socket *reactc_udp_sockets[REACTC_UDP_MAX];
static jsval reactc_udp_js = { 0.0, 0 };

/* the event being dispatched */
static int reactc_udp_event_kind, reactc_udp_event_id, reactc_udp_event_request;
static long reactc_udp_event_status;
static const char *reactc_udp_event_data;
static size_t reactc_udp_event_len;
static char reactc_udp_event_address[64];
static int reactc_udp_event_port, reactc_udp_event_family;

static void reactc_udp_emit(int kind, int id, long status) {
  reactc_udp_event_kind = kind;
  reactc_udp_event_id = id;
  reactc_udp_event_status = status;
  if (reactc_udp_js.type) porf_call_dynamic(reactc_udp_js, (jsval){ 0.0, 0 }, (jsval){ 0.0, 0 }, 0, NULL);
}

static void reactc_udp_describe(const struct sockaddr *addr) {
  reactc_udp_event_address[0] = 0;
  reactc_udp_event_port = 0;
  reactc_udp_event_family = 0;
  if (!addr) return;
  if (addr->sa_family == AF_INET6) {
    const struct sockaddr_in6 *in6 = (const struct sockaddr_in6 *)addr;
    uv_ip6_name(in6, reactc_udp_event_address, sizeof reactc_udp_event_address);
    reactc_udp_event_port = ntohs(in6->sin6_port);
    reactc_udp_event_family = 6;
  } else {
    const struct sockaddr_in *in4 = (const struct sockaddr_in *)addr;
    uv_ip4_name(in4, reactc_udp_event_address, sizeof reactc_udp_event_address);
    reactc_udp_event_port = ntohs(in4->sin_port);
    reactc_udp_event_family = 4;
  }
}

static void reactc_udp_alloc(uv_handle_t *handle, size_t suggested, uv_buf_t *buf) {
  (void)handle;
  buf->base = malloc(suggested);
  buf->len = buf->base ? suggested : 0;
}

/* not static: the shared-heap transform wraps these by name */
void reactc_udp_on_recv(uv_udp_t *handle, ssize_t nread, const uv_buf_t *buf, const struct sockaddr *addr, unsigned flags) {
  (void)flags;
  const int id = ((reactc_udp_socket *)handle)->id;
  if (nread < 0) {
    reactc_udp_describe(NULL);
    reactc_udp_emit(REACTC_UDP_ERROR, id, (long)nread);
  } else if (addr) {   /* nread 0 without an address: nothing more to read */
    reactc_udp_describe(addr);
    reactc_udp_event_data = buf->base;
    reactc_udp_event_len = (size_t)nread;
    reactc_udp_emit(REACTC_UDP_MESSAGE, id, (long)nread);
    reactc_udp_event_data = NULL;
  }
  free(buf->base);
}

void reactc_udp_on_send(uv_udp_send_t *req, int status) {
  reactc_udp_send_req *send = (reactc_udp_send_req *)req;
  reactc_udp_event_request = send->request;
  reactc_udp_emit(REACTC_UDP_SENT, send->id, status);
  free(send->buf.base);
  free(send);
}

void reactc_udp_on_close(uv_handle_t *handle) {
  reactc_udp_socket *socket = (reactc_udp_socket *)handle;
  const int id = socket->id;
  reactc_udp_sockets[id] = NULL;
  free(socket);
  reactc_udp_emit(REACTC_UDP_CLOSED, id, 0);
}

static int reactc_udp_address(const char *host, int port, int family, struct sockaddr_storage *out) {
  if (!host || !*host) host = family == 6 ? "::" : "0.0.0.0";
  if (!strcmp(host, "localhost")) host = family == 6 ? "::1" : "127.0.0.1";
  if (family == 6 || strchr(host, ':')) return uv_ip6_addr(host, port, (struct sockaddr_in6 *)out);
  return uv_ip4_addr(host, port, (struct sockaddr_in *)out);
}

/* --- the operations dgram.js calls; each returns 0 or a libuv error ---- */

static int reactc_udp_create(int family) {
  for (int id = 1; id < REACTC_UDP_MAX; id++) {
    if (reactc_udp_sockets[id]) continue;
    reactc_udp_socket *socket = calloc(1, sizeof *socket);
    if (!socket) return UV_ENOMEM;
    int error = uv_udp_init_ex(porf_uv_loop, &socket->handle, family == 6 ? AF_INET6 : AF_INET);
    if (error) { free(socket); return error; }
    socket->id = id;
    socket->family = family;
    reactc_udp_sockets[id] = socket;
    return id;
  }
  return UV_EMFILE;
}

static uv_udp_t *reactc_udp_handle(int id) {
  return id > 0 && id < REACTC_UDP_MAX && reactc_udp_sockets[id] ? &reactc_udp_sockets[id]->handle : NULL;
}

static int reactc_udp_bind(int id, const char *host, int port, int reuse, int ipv6_only) {
  uv_udp_t *handle = reactc_udp_handle(id);
  if (!handle) return UV_EBADF;
  struct sockaddr_storage addr;
  int error = reactc_udp_address(host, port, reactc_udp_sockets[id]->family, &addr);
  if (error) return error;
  unsigned flags = (reuse ? UV_UDP_REUSEADDR : 0) | (ipv6_only ? UV_UDP_IPV6ONLY : 0);
  error = uv_udp_bind(handle, (const struct sockaddr *)&addr, flags);
  if (error) return error;
  return uv_udp_recv_start(handle, reactc_udp_alloc, reactc_udp_on_recv);
}

static int reactc_udp_send(int id, const char *data, size_t len, const char *host, int port, int request) {
  uv_udp_t *handle = reactc_udp_handle(id);
  if (!handle) return UV_EBADF;
  struct sockaddr_storage addr;
  int error = reactc_udp_address(host, port, reactc_udp_sockets[id]->family, &addr);
  if (error) return error;
  reactc_udp_send_req *send = calloc(1, sizeof *send);
  if (!send) return UV_ENOMEM;
  send->id = id;
  send->request = request;
  send->buf = uv_buf_init(malloc(len ? len : 1), (unsigned)len);
  memcpy(send->buf.base, data, len);
  error = uv_udp_send(&send->req, handle, &send->buf, 1, (const struct sockaddr *)&addr, reactc_udp_on_send);
  if (error) { free(send->buf.base); free(send); }
  return error;
}

static int reactc_udp_close(int id) {
  uv_udp_t *handle = reactc_udp_handle(id);
  if (!handle) return UV_EBADF;
  uv_udp_recv_stop(handle);
  uv_close((uv_handle_t *)handle, reactc_udp_on_close);
  return 0;
}

/* the bound address, through the event fields */
static int reactc_udp_sockname(int id) {
  uv_udp_t *handle = reactc_udp_handle(id);
  if (!handle) return UV_EBADF;
  struct sockaddr_storage addr;
  int len = sizeof addr;
  int error = uv_udp_getsockname(handle, (struct sockaddr *)&addr, &len);
  if (!error) reactc_udp_describe((const struct sockaddr *)&addr);
  return error;
}

static int reactc_udp_option(int id, int option, int value, const char *group, const char *iface) {
  uv_udp_t *handle = reactc_udp_handle(id);
  if (!handle) return UV_EBADF;
  switch (option) {
    case 1: return uv_udp_set_broadcast(handle, value);
    case 2: return uv_udp_set_ttl(handle, value);
    case 3: return uv_udp_set_multicast_ttl(handle, value);
    case 4: return uv_udp_set_multicast_loop(handle, value);
    case 5: return uv_udp_set_membership(handle, group, iface && *iface ? iface : NULL, UV_JOIN_GROUP);
    case 6: return uv_udp_set_membership(handle, group, iface && *iface ? iface : NULL, UV_LEAVE_GROUP);
    case 7: if (value) uv_ref((uv_handle_t *)handle); else uv_unref((uv_handle_t *)handle); return 0;
  }
  return UV_EINVAL;
}

static const char *reactc_udp_error_name(int code) { return uv_err_name(code); }
#endif
