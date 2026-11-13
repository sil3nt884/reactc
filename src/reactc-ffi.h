/* reactc native library calls (FFI): load any library with a C ABI and call
 * its functions with signatures given at runtime. Used by @reactc/native.
 *
 * x86-64 only. Arguments are 64-bit slots tagged integer or floating point:
 * - System V (Linux): integer slots fill rdi, rsi, rdx, rcx, r8, r9 and
 *   floating slots fill xmm0-7, each in their own order; the rest go to the
 *   stack in declaration order. Calling through a prototype whose register
 *   parameters are all filled puts every further argument on the stack in
 *   that order, so one prototype serves every signature.
 * - Windows x64: the first four arguments go in rcx/rdx/r8/r9 or xmm0-3 by
 *   position, the rest on the stack. Sixteen prototypes cover the integer or
 *   floating choice for the four register positions.
 * A float (f32) travels as its 32 bits in the low half of a slot. Structs by
 * value are not supported; pass a pointer to one.
 */
#ifndef REACTC_FFI_H
#define REACTC_FFI_H
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#ifdef _WIN32
#include <windows.h>
#else
#include <dlfcn.h>
#endif

enum { REACTC_FFI_MAX_ARGS = 32 };

/* Porffor passes a parameter either boxed (jsval) or, when every caller
   passes a number, as a plain double; REACTC_NUM reads either. The header is
   included after Porffor defines jsval. */
static inline double reactc_ffi_num_jsval(jsval value) { return value.val; }
static inline double reactc_ffi_num_double(double value) { return value; }
#define REACTC_NUM(x) _Generic((x), jsval: reactc_ffi_num_jsval, default: reactc_ffi_num_double)(x)
#define REACTC_U64(hi, lo) (((uint64_t)(uint32_t)REACTC_NUM(hi) << 32) | (uint32_t)REACTC_NUM(lo))

static __thread uint64_t reactc_ffi_slots[REACTC_FFI_MAX_ARGS];
static __thread unsigned char reactc_ffi_floats[REACTC_FFI_MAX_ARGS];
static __thread int reactc_ffi_count;
static __thread uint64_t reactc_ffi_result;     /* integer result, or floating result bits */
static __thread char reactc_ffi_error[512];

static void reactc_ffi_set_error(const char *prefix, const char *detail) {
  snprintf(reactc_ffi_error, sizeof reactc_ffi_error, "%s%s", prefix, detail ? detail : "");
}

/* --- libraries and symbols ------------------------------------------------ */

/* Opens a library: a path or name; "" means the program itself (and, on
   Linux, everything it links, such as libc). Returns 0 on failure. */
static uint64_t reactc_ffi_open(const char *path) {
#ifdef _WIN32
  HMODULE module;
  if (!path || !*path) module = GetModuleHandleW(NULL);
  else {
    wchar_t wide[1024];
    if (!MultiByteToWideChar(CP_UTF8, 0, path, -1, wide, 1024)) { reactc_ffi_set_error("bad library name: ", path); return 0; }
    module = LoadLibraryW(wide);
  }
  if (!module) {
    char message[256];
    snprintf(message, sizeof message, "%s (error %lu)", path, (unsigned long)GetLastError());
    reactc_ffi_set_error("cannot load library ", message);
    return 0;
  }
  return (uint64_t)(uintptr_t)module;
#else
  void *handle = dlopen(path && *path ? path : NULL, RTLD_NOW | RTLD_LOCAL);
  if (!handle) { reactc_ffi_set_error("cannot load library: ", dlerror()); return 0; }
  return (uint64_t)(uintptr_t)handle;
#endif
}

static uint64_t reactc_ffi_symbol(uint64_t library, const char *name) {
#ifdef _WIN32
  FARPROC address = GetProcAddress((HMODULE)(uintptr_t)library, name);
  if (!address) { reactc_ffi_set_error("symbol not found: ", name); return 0; }
  return (uint64_t)(uintptr_t)address;
#else
  dlerror();
  void *address = dlsym((void *)(uintptr_t)library, name);
  if (!address) { reactc_ffi_set_error("symbol not found: ", name); return 0; }
  return (uint64_t)(uintptr_t)address;
#endif
}

/* --- calls -------------------------------------------------------------- */

static void reactc_ffi_begin(void) { reactc_ffi_count = 0; }

static int reactc_ffi_push(uint64_t bits, int floating) {
  if (reactc_ffi_count >= REACTC_FFI_MAX_ARGS) return 0;
  reactc_ffi_slots[reactc_ffi_count] = bits;
  reactc_ffi_floats[reactc_ffi_count] = (unsigned char)floating;
  reactc_ffi_count++;
  return 1;
}

static double reactc_ffi_double_of(uint64_t bits) { double value; memcpy(&value, &bits, 8); return value; }
static uint64_t reactc_ffi_bits_of(double value) { uint64_t bits; memcpy(&bits, &value, 8); return bits; }

typedef uint64_t u64f;
#define REACTC_FFI_STACK20 u64f, u64f, u64f, u64f, u64f, u64f, u64f, u64f, u64f, u64f, \
  u64f, u64f, u64f, u64f, u64f, u64f, u64f, u64f, u64f, u64f
#define REACTC_FFI_S(a) a[0], a[1], a[2], a[3], a[4], a[5], a[6], a[7], a[8], a[9], \
  a[10], a[11], a[12], a[13], a[14], a[15], a[16], a[17], a[18], a[19]

/* Calls `fn` with the pushed arguments. returns_float: the result comes back
   in a floating register. variadic: a C function declared with `...`.
   Returns 1, or 0 with an error message when the signature does not fit. */
static int reactc_ffi_call(uint64_t fn, int returns_float, int variadic) {
  void *target = (void *)(uintptr_t)fn;
  uint64_t stack[20] = {0};
  int stacked = 0;
  const int count = reactc_ffi_count;
#ifdef _WIN32
  /* positions 0-3 in registers, the rest on the stack as raw 8-byte slots */
  uint64_t reg[4] = {0};
  int mask = 0;
  for (int i = 0; i < count; i++) {
    if (i < 4) {
      reg[i] = reactc_ffi_slots[i];
      /* a variadic callee reads every argument from the integer registers */
      if (reactc_ffi_floats[i] && !variadic) mask |= 1 << i;
    } else {
      if (stacked >= 20) { reactc_ffi_set_error("too many arguments", ""); return 0; }
      stack[stacked++] = reactc_ffi_slots[i];
    }
  }
  const double d0 = reactc_ffi_double_of(reg[0]), d1 = reactc_ffi_double_of(reg[1]),
               d2 = reactc_ffi_double_of(reg[2]), d3 = reactc_ffi_double_of(reg[3]);
#define REACTC_FFI_W(R, T0, T1, T2, T3, A0, A1, A2, A3) \
  ((R (*)(T0, T1, T2, T3, REACTC_FFI_STACK20))target)(A0, A1, A2, A3, REACTC_FFI_S(stack))
#define REACTC_FFI_CASES(R, OUT) \
  switch (mask) { \
    case 0:  OUT REACTC_FFI_W(R, u64f, u64f, u64f, u64f, reg[0], reg[1], reg[2], reg[3]); break; \
    case 1:  OUT REACTC_FFI_W(R, double, u64f, u64f, u64f, d0, reg[1], reg[2], reg[3]); break; \
    case 2:  OUT REACTC_FFI_W(R, u64f, double, u64f, u64f, reg[0], d1, reg[2], reg[3]); break; \
    case 3:  OUT REACTC_FFI_W(R, double, double, u64f, u64f, d0, d1, reg[2], reg[3]); break; \
    case 4:  OUT REACTC_FFI_W(R, u64f, u64f, double, u64f, reg[0], reg[1], d2, reg[3]); break; \
    case 5:  OUT REACTC_FFI_W(R, double, u64f, double, u64f, d0, reg[1], d2, reg[3]); break; \
    case 6:  OUT REACTC_FFI_W(R, u64f, double, double, u64f, reg[0], d1, d2, reg[3]); break; \
    case 7:  OUT REACTC_FFI_W(R, double, double, double, u64f, d0, d1, d2, reg[3]); break; \
    case 8:  OUT REACTC_FFI_W(R, u64f, u64f, u64f, double, reg[0], reg[1], reg[2], d3); break; \
    case 9:  OUT REACTC_FFI_W(R, double, u64f, u64f, double, d0, reg[1], reg[2], d3); break; \
    case 10: OUT REACTC_FFI_W(R, u64f, double, u64f, double, reg[0], d1, reg[2], d3); break; \
    case 11: OUT REACTC_FFI_W(R, double, double, u64f, double, d0, d1, reg[2], d3); break; \
    case 12: OUT REACTC_FFI_W(R, u64f, u64f, double, double, reg[0], reg[1], d2, d3); break; \
    case 13: OUT REACTC_FFI_W(R, double, u64f, double, double, d0, reg[1], d2, d3); break; \
    case 14: OUT REACTC_FFI_W(R, u64f, double, double, double, reg[0], d1, d2, d3); break; \
    default: OUT REACTC_FFI_W(R, double, double, double, double, d0, d1, d2, d3); break; \
  }
  if (returns_float) { double value = 0; REACTC_FFI_CASES(double, value =) reactc_ffi_result = reactc_ffi_bits_of(value); }
  else { uint64_t value = 0; REACTC_FFI_CASES(uint64_t, value =) reactc_ffi_result = value; }
#undef REACTC_FFI_CASES
#undef REACTC_FFI_W
#else
  /* integer and floating registers fill independently; the overflow keeps
     declaration order on the stack */
  uint64_t ints[6] = {0};
  double floats[8] = {0};
  int used_ints = 0, used_floats = 0;
  for (int i = 0; i < count; i++) {
    if (reactc_ffi_floats[i] && used_floats < 8) floats[used_floats++] = reactc_ffi_double_of(reactc_ffi_slots[i]);
    else if (!reactc_ffi_floats[i] && used_ints < 6) ints[used_ints++] = reactc_ffi_slots[i];
    else {
      if (stacked >= 20) { reactc_ffi_set_error("too many arguments", ""); return 0; }
      stack[stacked++] = reactc_ffi_slots[i];
    }
  }
  if (variadic) {
    /* through a variadic prototype the compiler sets %al to the number of
       vector registers, as a variadic callee expects */
    if (stacked) { reactc_ffi_set_error("variadic calls take at most 6 integer and 8 floating arguments", ""); return 0; }
    if (returns_float) {
      double value = ((double (*)(u64f, u64f, u64f, u64f, u64f, u64f, ...))target)(ints[0], ints[1], ints[2], ints[3], ints[4], ints[5],
        floats[0], floats[1], floats[2], floats[3], floats[4], floats[5], floats[6], floats[7]);
      reactc_ffi_result = reactc_ffi_bits_of(value);
    } else {
      reactc_ffi_result = ((u64f (*)(u64f, u64f, u64f, u64f, u64f, u64f, ...))target)(ints[0], ints[1], ints[2], ints[3], ints[4], ints[5],
        floats[0], floats[1], floats[2], floats[3], floats[4], floats[5], floats[6], floats[7]);
    }
    return 1;
  }
#define REACTC_FFI_PROTO(R) R (*)(u64f, u64f, u64f, u64f, u64f, u64f, double, double, double, double, double, double, double, double, REACTC_FFI_STACK20)
#define REACTC_FFI_ARGS ints[0], ints[1], ints[2], ints[3], ints[4], ints[5], floats[0], floats[1], floats[2], floats[3], \
  floats[4], floats[5], floats[6], floats[7], REACTC_FFI_S(stack)
  if (returns_float) reactc_ffi_result = reactc_ffi_bits_of(((REACTC_FFI_PROTO(double))target)(REACTC_FFI_ARGS));
  else reactc_ffi_result = ((REACTC_FFI_PROTO(u64f))target)(REACTC_FFI_ARGS);
#undef REACTC_FFI_ARGS
#undef REACTC_FFI_PROTO
#endif
  return 1;
}

/* --- memory -------------------------------------------------------------- */

static uint64_t reactc_ffi_alloc(uint64_t size) { return (uint64_t)(uintptr_t)calloc(1, size ? (size_t)size : 1); }
static void reactc_ffi_free(uint64_t address) { free((void *)(uintptr_t)address); }

/* kind: 1 i8, 2 u8, 3 i16, 4 u16, 5 i32, 6 u32, 7 i64/u64/pointer, 8 f32, 9 f64 */
static uint64_t reactc_ffi_read(uint64_t address, int kind) {
  const void *at = (const void *)(uintptr_t)address;
  switch (kind) {
    case 1: { int8_t v; memcpy(&v, at, 1); return (uint64_t)(int64_t)v; }
    case 2: { uint8_t v; memcpy(&v, at, 1); return v; }
    case 3: { int16_t v; memcpy(&v, at, 2); return (uint64_t)(int64_t)v; }
    case 4: { uint16_t v; memcpy(&v, at, 2); return v; }
    case 5: { int32_t v; memcpy(&v, at, 4); return (uint64_t)(int64_t)v; }
    case 6: { uint32_t v; memcpy(&v, at, 4); return v; }
    case 8: { float v; memcpy(&v, at, 4); return reactc_ffi_bits_of((double)v); }
    default: { uint64_t v; memcpy(&v, at, 8); return v; }
  }
}

static void reactc_ffi_write(uint64_t address, int kind, uint64_t bits) {
  void *at = (void *)(uintptr_t)address;
  switch (kind) {
    case 1: case 2: { uint8_t v = (uint8_t)bits; memcpy(at, &v, 1); break; }
    case 3: case 4: { uint16_t v = (uint16_t)bits; memcpy(at, &v, 2); break; }
    case 5: case 6: { uint32_t v = (uint32_t)bits; memcpy(at, &v, 4); break; }
    case 8: { float v = (float)reactc_ffi_double_of(bits); memcpy(at, &v, 4); break; }
    default: memcpy(at, &bits, 8); break;
  }
}

static uint64_t reactc_ffi_strlen(uint64_t address) { return address ? strlen((const char *)(uintptr_t)address) : 0; }

/* --- callbacks: C calling into JavaScript ----------------------------------
 *
 * 64 entry stubs, 16 bytes apart, each loading its slot number and jumping to
 * a common entry. The common entry saves the argument registers into a frame
 * and calls reactc_ffi_dispatch, which calls the JavaScript dispatcher (set by
 * @reactc/native); it decodes the arguments from the frame by the callback's
 * signature, calls the callback and writes the result back into the frame,
 * which the entry returns in rax and xmm0.
 *
 * Frame (u64 slots): System V: ints 0-5, floats 6-13, int result 14, float
 * result 15. Windows x64: ints 0-3, floats 4-7 (by position), results 8, 9.
 * Further arguments are read from the caller's stack. Callbacks run on the
 * thread that calls them, which must be the thread that runs JavaScript (for
 * example during the native call that was given the callback). */
enum { REACTC_FFI_CALLBACKS = 64 };
static jsval porf_call_dynamic(jsval fn, jsval thisv, jsval newtv, i32 argc, u64 *argv);
static jsval reactc_ffi_js_dispatch = { 0.0, 0 };
static __thread int reactc_ffi_cb_slot;
static __thread uint64_t *reactc_ffi_cb_frame;
static __thread uint64_t *reactc_ffi_cb_stack;

__attribute__((used, noinline)) void reactc_ffi_dispatch(int slot, uint64_t *frame, uint64_t *stack) {
  const int saved_slot = reactc_ffi_cb_slot;
  uint64_t *saved_frame = reactc_ffi_cb_frame, *saved_stack = reactc_ffi_cb_stack;
  reactc_ffi_cb_slot = slot;
  reactc_ffi_cb_frame = frame;
  reactc_ffi_cb_stack = stack;
  if (reactc_ffi_js_dispatch.type) porf_call_dynamic(reactc_ffi_js_dispatch, (jsval){ 0.0, 0 }, (jsval){ 0.0, 0 }, 0, NULL);
  reactc_ffi_cb_slot = saved_slot;
  reactc_ffi_cb_frame = saved_frame;
  reactc_ffi_cb_stack = saved_stack;
}

#ifdef _WIN32
__asm__(
  ".text\n"
  ".p2align 4\n"
  "reactc_ffi_cb_common:\n"
  "  pushq %rbp\n"
  "  movq %rsp, %rbp\n"
  "  subq $112, %rsp\n"            /* 32 shadow + 80 frame */
  "  movq %rcx, 32(%rsp)\n"
  "  movq %rdx, 40(%rsp)\n"
  "  movq %r8, 48(%rsp)\n"
  "  movq %r9, 56(%rsp)\n"
  "  movsd %xmm0, 64(%rsp)\n"
  "  movsd %xmm1, 72(%rsp)\n"
  "  movsd %xmm2, 80(%rsp)\n"
  "  movsd %xmm3, 88(%rsp)\n"
  "  movl %eax, %ecx\n"
  "  leaq 32(%rsp), %rdx\n"
  "  leaq 48(%rbp), %r8\n"          /* fifth argument: return address + 32 shadow bytes above rbp+8 */
  "  call reactc_ffi_dispatch\n"
  "  movq 96(%rsp), %rax\n"
  "  movsd 104(%rsp), %xmm0\n"
  "  leave\n"
  "  ret\n"
  ".p2align 4\n"
  "reactc_ffi_cb_stubs:\n"
  "  .set reactc_ffi_cb_n, 0\n"
  "  .rept 64\n"
  "  .p2align 4\n"
  "  movl $reactc_ffi_cb_n, %eax\n"
  "  jmp reactc_ffi_cb_common\n"
  "  .set reactc_ffi_cb_n, reactc_ffi_cb_n + 1\n"
  "  .endr\n"
);
enum { REACTC_FFI_FRAME_FLOATS = 4, REACTC_FFI_FRAME_RESULT = 8 };
#else
__asm__(
  ".text\n"
  ".p2align 4\n"
  "reactc_ffi_cb_common:\n"
  "  pushq %rbp\n"
  "  movq %rsp, %rbp\n"
  "  subq $128, %rsp\n"            /* 16 u64 slots */
  "  movq %rdi, 0(%rsp)\n"
  "  movq %rsi, 8(%rsp)\n"
  "  movq %rdx, 16(%rsp)\n"
  "  movq %rcx, 24(%rsp)\n"
  "  movq %r8, 32(%rsp)\n"
  "  movq %r9, 40(%rsp)\n"
  "  movsd %xmm0, 48(%rsp)\n"
  "  movsd %xmm1, 56(%rsp)\n"
  "  movsd %xmm2, 64(%rsp)\n"
  "  movsd %xmm3, 72(%rsp)\n"
  "  movsd %xmm4, 80(%rsp)\n"
  "  movsd %xmm5, 88(%rsp)\n"
  "  movsd %xmm6, 96(%rsp)\n"
  "  movsd %xmm7, 104(%rsp)\n"
  "  movl %eax, %edi\n"
  "  movq %rsp, %rsi\n"
  "  leaq 16(%rbp), %rdx\n"         /* stack arguments start above the return address */
  "  call reactc_ffi_dispatch\n"
  "  movq 112(%rsp), %rax\n"
  "  movsd 120(%rsp), %xmm0\n"
  "  leave\n"
  "  ret\n"
  ".p2align 4\n"
  "reactc_ffi_cb_stubs:\n"
  "  .set reactc_ffi_cb_n, 0\n"
  "  .rept 64\n"
  "  .p2align 4\n"
  "  movl $reactc_ffi_cb_n, %eax\n"
  "  jmp reactc_ffi_cb_common\n"
  "  .set reactc_ffi_cb_n, reactc_ffi_cb_n + 1\n"
  "  .endr\n"
);
enum { REACTC_FFI_FRAME_FLOATS = 6, REACTC_FFI_FRAME_RESULT = 14 };
#endif
extern char reactc_ffi_cb_stubs[] __asm__("reactc_ffi_cb_stubs");

static uint64_t reactc_ffi_callback_address(int slot) { return (uint64_t)(uintptr_t)(reactc_ffi_cb_stubs + 16 * slot); }
static int reactc_ffi_windows_abi(void) {
#ifdef _WIN32
  return 1;
#else
  return 0;
#endif
}
/* the current callback's slot, its saved registers and stack arguments */
static int reactc_ffi_callback_slot(void) { return reactc_ffi_cb_slot; }
static uint64_t reactc_ffi_callback_frame(int index) { return reactc_ffi_cb_frame[index]; }
static uint64_t reactc_ffi_callback_stack(int index) { return reactc_ffi_cb_stack[index]; }
static void reactc_ffi_callback_return(uint64_t bits, int floating) {
  reactc_ffi_cb_frame[REACTC_FFI_FRAME_RESULT + (floating ? 1 : 0)] = bits;
}
#endif
