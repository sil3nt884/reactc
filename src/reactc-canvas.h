/* Offscreen Canvas2D on Windows GDI+. Canvas handles are local to the JS thread. */
#ifndef REACTC_CANVAS_H
#define REACTC_CANVAS_H

#include <wtypes.h>
#include <gdiplus.h>
#include <objidl.h>
#include <stddef.h>
#include "reactc-webgl.h"

static inline double reactc_canvas_js_number(jsval value) { return value.val; }
static inline double reactc_canvas_double(double value) { return value; }
#define REACTC_CANVAS_NUM(x) _Generic((x), jsval: reactc_canvas_js_number, default: reactc_canvas_double)(x)

enum { REACTC_CANVAS_LIMIT = 64, REACTC_CANVAS_STACK = 64, REACTC_CANVAS_EVENTS = 128 };
enum {
    REACTC_CANVAS_RESIZED = 1, REACTC_CANVAS_CLOSED, REACTC_CANVAS_MOVE,
    REACTC_CANVAS_DOWN, REACTC_CANVAS_UP, REACTC_CANVAS_LEAVE,
    REACTC_CANVAS_OVER, REACTC_CANVAS_WHEEL, REACTC_CANVAS_HWHEEL
};
typedef struct {
    int kind, x, y, keys, detail;
} ReactcCanvasEvent;

typedef struct {
    ULONG_PTR token;
    GpBitmap *bitmap;
    GpGraphics *graphics;
    GpPath *path;
    GraphicsState states[REACTC_CANVAS_STACK];
    int width, height, depth, has_point;
    REAL x, y, start_x, start_y;
    HWND window;
    ReactcWebGL webgl;
    unsigned char *upload;
    size_t upload_size;
    int tracking;
    unsigned event_head, event_count;
    ReactcCanvasEvent events[REACTC_CANVAS_EVENTS], current_event;
} ReactcCanvas;

static __thread ReactcCanvas *reactc_canvases[REACTC_CANVAS_LIMIT];

static int reactc_canvas_copy_webgl(ReactcCanvas *canvas) {
    if (!reactc_webgl_current(&canvas->webgl)) return 0;
    const int width = canvas->width, height = canvas->height;
    unsigned char *rgba = malloc((size_t)width * height * 4);
    if (!rgba) return 0;
    memset(rgba, 0, (size_t)width * height * 4);
    const int separate_read_buffer = canvas->webgl.version >= 3;
    const unsigned int target = separate_read_buffer ? 0x8ca8 : 0x8d40;
    const unsigned int binding = separate_read_buffer ? 0x8caa : 0x8ca6;
    int framebuffer = 0, pack_alignment = 4;
    reactc_angle.get_integer(binding, &framebuffer);
    reactc_angle.get_integer(0x0d05, &pack_alignment);
    reactc_angle.bind_framebuffer(target, 0);
    reactc_angle.pixel_store(0x0d05, 1);
    reactc_angle.read_pixels(0, 0, width, height, 0x1908, 0x1401, rgba);
    reactc_angle.pixel_store(0x0d05, pack_alignment);
    reactc_angle.bind_framebuffer(target, (unsigned int)framebuffer);
    GpRect rect = {0, 0, width, height};
    BitmapData bits = {0};
    int copied = GdipBitmapLockBits(canvas->bitmap, &rect, ImageLockModeWrite,
        PixelFormat32bppARGB, &bits) == Ok;
    if (copied) {
        for (int y = 0; y < height; ++y) {
            const unsigned char *src = rgba + (size_t)(height - y - 1) * width * 4;
            unsigned char *dst = (unsigned char *)bits.Scan0 + (ptrdiff_t)y * bits.Stride;
            for (int x = 0; x < width; ++x) {
                dst[0] = src[2];
                dst[1] = src[1];
                dst[2] = src[0];
                dst[3] = src[3];
                dst += 4;
                src += 4;
            }
        }
        copied = GdipBitmapUnlockBits(canvas->bitmap, &bits) == Ok;
    }
    free(rgba);
    return copied;
}

static ReactcCanvas *reactc_canvas_at(int id) {
    return id > 0 && id <= REACTC_CANVAS_LIMIT ? reactc_canvases[id - 1] : NULL;
}

static void reactc_canvas_enqueue(ReactcCanvas *canvas, ReactcCanvasEvent event) {
    unsigned tail = (canvas->event_head + canvas->event_count) % REACTC_CANVAS_EVENTS;
    if (canvas->event_count) {
        unsigned previous = (tail + REACTC_CANVAS_EVENTS - 1) % REACTC_CANVAS_EVENTS;
        if ((event.kind == REACTC_CANVAS_MOVE || event.kind == REACTC_CANVAS_RESIZED) &&
            canvas->events[previous].kind == event.kind) {
            canvas->events[previous] = event;
            return;
        }
    }
    if (canvas->event_count == REACTC_CANVAS_EVENTS) {
        canvas->event_head = (canvas->event_head + 1) % REACTC_CANVAS_EVENTS;
        --canvas->event_count;
    }
    canvas->events[tail] = event;
    ++canvas->event_count;
}

static LRESULT CALLBACK reactc_canvas_window_proc(HWND window, UINT message, WPARAM keys, LPARAM data) {
    if (message == WM_NCCREATE) {
        CREATESTRUCTW *creation = (CREATESTRUCTW *)data;
        SetWindowLongPtrW(window, GWLP_USERDATA, (LONG_PTR)creation->lpCreateParams);
    }
    ReactcCanvas *canvas = (ReactcCanvas *)GetWindowLongPtrW(window, GWLP_USERDATA);
    if (!canvas) return DefWindowProcW(window, message, keys, data);
    switch (message) {
    case WM_CLOSE:
        DestroyWindow(window);
        return 0;
    case WM_DESTROY:
        canvas->window = NULL;
        reactc_canvas_enqueue(canvas, (ReactcCanvasEvent){.kind = REACTC_CANVAS_CLOSED});
        return 0;
    case WM_SIZE:
        if (keys != SIZE_MINIMIZED && LOWORD(data) && HIWORD(data))
            reactc_canvas_enqueue(canvas, (ReactcCanvasEvent){REACTC_CANVAS_RESIZED, LOWORD(data), HIWORD(data)});
        return 0;
    case WM_MOUSEMOVE: {
        ReactcCanvasEvent event = {REACTC_CANVAS_MOVE, (short)LOWORD(data), (short)HIWORD(data), (int)keys, -1};
        if (!canvas->tracking) {
            TRACKMOUSEEVENT tracking = { sizeof(tracking), TME_LEAVE, window, 0 };
            canvas->tracking = TrackMouseEvent(&tracking);
            if (canvas->tracking) {
                event.kind = REACTC_CANVAS_OVER;
                reactc_canvas_enqueue(canvas, event);
                event.kind = REACTC_CANVAS_MOVE;
            }
        }
        reactc_canvas_enqueue(canvas, event);
        return 0;
    }
    case WM_LBUTTONDOWN: case WM_MBUTTONDOWN: case WM_RBUTTONDOWN:
    case WM_LBUTTONUP: case WM_MBUTTONUP: case WM_RBUTTONUP: {
        const int down = message == WM_LBUTTONDOWN || message == WM_MBUTTONDOWN || message == WM_RBUTTONDOWN;
        const int button = message == WM_MBUTTONDOWN || message == WM_MBUTTONUP ? 1 :
            (message == WM_RBUTTONDOWN || message == WM_RBUTTONUP ? 2 : 0);
        if (down) SetCapture(window);
        else if (!(keys & (MK_LBUTTON | MK_MBUTTON | MK_RBUTTON)) && GetCapture() == window) ReleaseCapture();
        reactc_canvas_enqueue(canvas, (ReactcCanvasEvent){
            down ? REACTC_CANVAS_DOWN : REACTC_CANVAS_UP, (short)LOWORD(data), (short)HIWORD(data), (int)keys, button
        });
        return 0;
    }
    case WM_MOUSEWHEEL: case WM_MOUSEHWHEEL: {
        POINT point = {(short)LOWORD(data), (short)HIWORD(data)};
        if (ScreenToClient(window, &point)) {
            const int horizontal = message == WM_MOUSEHWHEEL;
            const int delta = (short)HIWORD(keys);
            reactc_canvas_enqueue(canvas, (ReactcCanvasEvent){
                horizontal ? REACTC_CANVAS_HWHEEL : REACTC_CANVAS_WHEEL,
                point.x, point.y, LOWORD(keys), horizontal ? delta : -delta
            });
        }
        return 0;
    }
    case WM_MOUSELEAVE: {
        canvas->tracking = 0;
        POINT point = {0};
        if (GetCursorPos(&point)) ScreenToClient(window, &point);
        reactc_canvas_enqueue(canvas, (ReactcCanvasEvent){REACTC_CANVAS_LEAVE, point.x, point.y, 0, -1});
        return 0;
    }
    case WM_PAINT: {
        PAINTSTRUCT paint;
        HDC dc = BeginPaint(window, &paint);
        RECT area;
        GetClientRect(window, &area);
        FillRect(dc, &area, GetStockObject(BLACK_BRUSH));
        GpGraphics *graphics = NULL;
        if (GdipCreateFromHDC(dc, &graphics) == Ok) {
            GdipDrawImageRectI(graphics, (GpImage *)canvas->bitmap, 0, 0, area.right, area.bottom);
            GdipDeleteGraphics(graphics);
        }
        EndPaint(window, &paint);
        return 0;
    }
    default:
        return DefWindowProcW(window, message, keys, data);
    }
}

static int reactc_canvas_open_window(int id) {
    ReactcCanvas *canvas = reactc_canvas_at(id);
    if (!canvas) return 0;
    if (canvas->window) return 1;
    HINSTANCE instance = GetModuleHandleW(NULL);
    WNDCLASSW definition = {0};
    definition.hInstance = instance;
    definition.lpszClassName = L"ReactcCanvasWindow";
    definition.lpfnWndProc = reactc_canvas_window_proc;
    definition.hCursor = LoadCursorW(NULL, MAKEINTRESOURCEW(32512));
    if (!RegisterClassW(&definition) && GetLastError() != ERROR_CLASS_ALREADY_EXISTS) return 0;
    RECT area = {0, 0, canvas->width, canvas->height};
    const DWORD style = WS_OVERLAPPEDWINDOW;
    if (!AdjustWindowRect(&area, style, FALSE)) return 0;
    canvas->event_head = canvas->event_count = 0;
    canvas->window = CreateWindowExW(0, definition.lpszClassName, L"ReactC Canvas", style,
        CW_USEDEFAULT, CW_USEDEFAULT, area.right - area.left, area.bottom - area.top,
        NULL, NULL, instance, canvas);
    if (!canvas->window) return 0;
    ShowWindow(canvas->window, SW_SHOW);
    return 1;
}

static int reactc_canvas_present(int id) {
    ReactcCanvas *canvas = reactc_canvas_at(id);
    if (!canvas || !canvas->window) return 0;
    GdipFlush(canvas->graphics, FlushIntentionSync);
    if (canvas->webgl.context && !reactc_canvas_copy_webgl(canvas)) return 0;
    return RedrawWindow(canvas->window, NULL, NULL, RDW_INVALIDATE | RDW_UPDATENOW);
}

static int reactc_canvas_poll(int id) {
    ReactcCanvas *canvas = reactc_canvas_at(id);
    if (!canvas) return 0;
    MSG message;
    while (canvas->window && PeekMessageW(&message, canvas->window, 0, 0, PM_REMOVE)) {
        TranslateMessage(&message);
        DispatchMessageW(&message);
    }
    if (!canvas->event_count) return 0;
    canvas->current_event = canvas->events[canvas->event_head];
    canvas->event_head = (canvas->event_head + 1) % REACTC_CANVAS_EVENTS;
    --canvas->event_count;
    return canvas->current_event.kind;
}

static int reactc_canvas_event_field(int id, int field) {
    ReactcCanvas *canvas = reactc_canvas_at(id);
    if (!canvas) return 0;
    if (field == 0) return canvas->current_event.x;
    if (field == 1) return canvas->current_event.y;
    if (field == 2) return canvas->current_event.keys;
    return canvas->current_event.detail;
}

static int reactc_canvas_resize(int id, int width, int height) {
    ReactcCanvas *canvas = reactc_canvas_at(id);
    if (!canvas || width < 1 || height < 1 || width > 4096 || height > 4096) return 0;
    GpBitmap *bitmap = NULL;
    GpGraphics *graphics = NULL;
    if (GdipCreateBitmapFromScan0(width, height, 0, PixelFormat32bppARGB, NULL, &bitmap) != Ok) return 0;
    if (GdipGetImageGraphicsContext((GpImage *)bitmap, &graphics) != Ok) {
        GdipDisposeImage((GpImage *)bitmap);
        return 0;
    }
    GdipSetSmoothingMode(graphics, SmoothingModeAntiAlias);
    GdipSetPixelOffsetMode(graphics, PixelOffsetModeHalf);
    if (canvas->webgl.context && !reactc_webgl_resize(&canvas->webgl, width, height)) {
        GdipDeleteGraphics(graphics);
        GdipDisposeImage((GpImage *)bitmap);
        return 0;
    }
    if (canvas->graphics) GdipDeleteGraphics(canvas->graphics);
    if (canvas->bitmap) GdipDisposeImage((GpImage *)canvas->bitmap);
    canvas->bitmap = bitmap;
    canvas->graphics = graphics;
    canvas->width = width;
    canvas->height = height;
    canvas->depth = canvas->has_point = 0;
    GdipResetPath(canvas->path);
    return 1;
}

static void reactc_canvas_destroy(int id) {
    ReactcCanvas *canvas = reactc_canvas_at(id);
    if (!canvas) return;
    reactc_canvases[id - 1] = NULL;
    if (canvas->window) DestroyWindow(canvas->window);
    reactc_webgl_destroy(&canvas->webgl);
    free(canvas->upload);
    if (canvas->graphics) GdipDeleteGraphics(canvas->graphics);
    if (canvas->bitmap) GdipDisposeImage((GpImage *)canvas->bitmap);
    if (canvas->path) GdipDeletePath(canvas->path);
    if (canvas->token) GdiplusShutdown(canvas->token);
    free(canvas);
}

static int reactc_canvas_create(int width, int height) {
    int index = 0;
    while (index < REACTC_CANVAS_LIMIT && reactc_canvases[index]) ++index;
    if (index == REACTC_CANVAS_LIMIT) return 0;
    ReactcCanvas *canvas = calloc(1, sizeof(*canvas));
    if (!canvas) return 0;
    GdiplusStartupInput input = { .GdiplusVersion = 1 };
    reactc_canvases[index] = canvas;
    if (GdiplusStartup(&canvas->token, &input, NULL) != Ok ||
        GdipCreatePath(FillModeWinding, &canvas->path) != Ok ||
        !reactc_canvas_resize(index + 1, width, height)) {
        reactc_canvas_destroy(index + 1);
        return 0;
    }
    return index + 1;
}

static int reactc_canvas_transform(int id, int append, REAL a, REAL b, REAL c, REAL d, REAL e, REAL f) {
    ReactcCanvas *canvas = reactc_canvas_at(id);
    if (!canvas) return 0;
    GpMatrix *matrix = NULL;
    if (GdipCreateMatrix2(a, b, c, d, e, f, &matrix) != Ok) return 0;
    GpStatus status = append
        ? GdipMultiplyWorldTransform(canvas->graphics, matrix, MatrixOrderPrepend)
        : GdipSetWorldTransform(canvas->graphics, matrix);
    GdipDeleteMatrix(matrix);
    return status == Ok;
}

static int reactc_canvas_state(int id, int save) {
    ReactcCanvas *canvas = reactc_canvas_at(id);
    if (!canvas) return 0;
    if (save) {
        if (canvas->depth == REACTC_CANVAS_STACK) return 0;
        if (GdipSaveGraphics(canvas->graphics, &canvas->states[canvas->depth]) != Ok) return 0;
        ++canvas->depth;
    } else if (canvas->depth > 0) {
        if (GdipRestoreGraphics(canvas->graphics, canvas->states[canvas->depth - 1]) != Ok) return 0;
        --canvas->depth;
    }
    return 1;
}

static int reactc_canvas_path(int id, int operation, REAL a, REAL b, REAL c, REAL d, REAL e, REAL f) {
    ReactcCanvas *canvas = reactc_canvas_at(id);
    if (!canvas) return 0;
    GpPath *path = canvas->path;
    GpStatus status = Ok;
    switch (operation) {
    case 0: /* beginPath */
        canvas->has_point = 0;
        return GdipResetPath(path) == Ok;
    case 1: /* moveTo */
        canvas->start_x = canvas->x = a;
        canvas->start_y = canvas->y = b;
        canvas->has_point = 1;
        return GdipStartPathFigure(path) == Ok;
    case 2: /* lineTo */
        if (!canvas->has_point) return reactc_canvas_path(id, 1, a, b, 0, 0, 0, 0);
        status = GdipAddPathLine(path, canvas->x, canvas->y, a, b);
        canvas->x = a;
        canvas->y = b;
        return status == Ok;
    case 3: /* closePath */
        if (!canvas->has_point) return 1;
        canvas->x = canvas->start_x;
        canvas->y = canvas->start_y;
        return GdipClosePathFigure(path) == Ok;
    case 4: /* rect */
        status = GdipStartPathFigure(path);
        if (status == Ok) status = GdipAddPathLine(path, a, b, a + c, b);
        if (status == Ok) status = GdipAddPathLine(path, a + c, b, a + c, b + d);
        if (status == Ok) status = GdipAddPathLine(path, a + c, b + d, a, b + d);
        if (status == Ok) status = GdipClosePathFigure(path);
        canvas->start_x = canvas->x = a;
        canvas->start_y = canvas->y = b;
        canvas->has_point = 1;
        return status == Ok;
    case 5: /* bezierCurveTo */
        if (!canvas->has_point && !reactc_canvas_path(id, 1, a, b, 0, 0, 0, 0)) return 0;
        status = GdipAddPathBezier(path, canvas->x, canvas->y, a, b, c, d, e, f);
        canvas->x = e;
        canvas->y = f;
        return status == Ok;
    case 6: /* quadraticCurveTo */
        if (!canvas->has_point && !reactc_canvas_path(id, 1, a, b, 0, 0, 0, 0)) return 0;
        return reactc_canvas_path(id, 5, (canvas->x + 2*a)/3, (canvas->y + 2*b)/3,
            (c + 2*a)/3, (d + 2*b)/3, c, d);
    default:
        return 0;
    }
}

#include "reactc-canvas-gradient.h"

static int reactc_canvas_draw(int id, int operation, ARGB color, REAL x, REAL y, REAL width, REAL height,
    int use_gradient) {
    ReactcCanvas *canvas = reactc_canvas_at(id);
    if (!canvas) return 0;
    GpGraphics *graphics = canvas->graphics;
    if (operation == 2 || operation == 3) {
        GdipSetPathFillMode(canvas->path, operation == 3 ? FillModeAlternate : FillModeWinding);
    }
    if (operation == 5 || operation == 6) {
        GdipSetPathFillMode(canvas->path, operation == 6 ? FillModeAlternate : FillModeWinding);
        return GdipSetClipPath(graphics, canvas->path, CombineModeIntersect) == Ok;
    }
    if (operation <= 1 && (width == 0 || height == 0)) return 1;
    if (operation == 4 && (x < 0 || x > 2 || y < 0 || y > 2)) return 0;

    ReactcCanvasPaint paint = {0};
    int ready = reactc_canvas_paint(canvas, &paint, color, use_gradient);
    GpStatus status = ready ? Ok : GenericError;
    if (ready == 1 && operation == 4) {
        GpPen *pen = NULL;
        status = GdipCreatePen2(paint.brush, width, UnitWorld, &pen);
        if (status == Ok) {
            const GpLineCap caps[] = { LineCapFlat, LineCapRound, LineCapSquare };
            const GpLineJoin joins[] = { LineJoinMiter, LineJoinRound, LineJoinBevel };
            GdipSetPenStartCap(pen, caps[(int)x]);
            GdipSetPenEndCap(pen, caps[(int)x]);
            GdipSetPenLineJoin(pen, joins[(int)y]);
            if (height > 0) GdipSetPenMiterLimit(pen, height);
            status = GdipDrawPath(graphics, pen, canvas->path);
            GdipDeletePen(pen);
        }
    } else if (ready == 1 && operation <= 1) {
        if (width < 0) { x += width; width = -width; }
        if (height < 0) { y += height; height = -height; }
        CompositingMode previous;
        if (operation == 0) {
            GdipGetCompositingMode(graphics, &previous);
            GdipSetCompositingMode(graphics, CompositingModeSourceCopy);
        }
        status = GdipFillRectangle(graphics, paint.brush, x, y, width, height);
        if (operation == 0) GdipSetCompositingMode(graphics, previous);
    } else if (ready == 1) {
        status = GdipFillPath(graphics, paint.brush, canvas->path);
    }
    reactc_canvas_paint_destroy(&paint);
    return status == Ok;
}

static int reactc_canvas_composite(int id, int copy) {
    ReactcCanvas *canvas = reactc_canvas_at(id);
    return canvas && GdipSetCompositingMode(canvas->graphics,
        copy ? CompositingModeSourceCopy : CompositingModeSourceOver) == Ok;
}

static int reactc_canvas_read_rgba(int id, int x, int y, int width, int height) {
    ReactcCanvas *canvas = reactc_canvas_at(id);
    if (!canvas || width < 1 || height < 1 || width > 4096 || height > 4096 ||
        (size_t)width * height * 4 > canvas->upload_size) return 0;
    if (x >= canvas->width || y >= canvas->height || x <= -width || y <= -height) return 1;
    const int left = x < 0 ? 0 : x, top = y < 0 ? 0 : y;
    const int right = x + width < canvas->width ? x + width : canvas->width;
    const int bottom = y + height < canvas->height ? y + height : canvas->height;
    GpRect rect = {left, top, right - left, bottom - top};
    BitmapData bits = {0};
    if (GdipFlush(canvas->graphics, FlushIntentionSync) != Ok ||
        GdipBitmapLockBits(canvas->bitmap, &rect, ImageLockModeRead, PixelFormat32bppARGB, &bits) != Ok) return 0;
    for (int row = 0; row < rect.Height; row++) {
        const unsigned char *source = (const unsigned char *)bits.Scan0 + (ptrdiff_t)row * bits.Stride;
        unsigned char *destination = canvas->upload + ((size_t)(top - y + row) * width + left - x) * 4;
        for (int column = 0; column < rect.Width; column++) {
            destination[0] = source[2];
            destination[1] = source[1];
            destination[2] = source[0];
            destination[3] = source[3];
            source += 4;
            destination += 4;
        }
    }
    return GdipBitmapUnlockBits(canvas->bitmap, &bits) == Ok;
}

static int reactc_canvas_image(int id, int source, REAL sx, REAL sy, REAL sw, REAL sh,
    REAL dx, REAL dy, REAL dw, REAL dh, REAL alpha, int smoothing) {
    ReactcCanvas *canvas = reactc_canvas_at(id), *image = reactc_canvas_at(source);
    if (!canvas || !image || canvas == image) return 0;
    GdipFlush(image->graphics, FlushIntentionSync);
    GpImageAttributes *attributes = NULL;
    if (GdipCreateImageAttributes(&attributes) != Ok) return 0;
    ColorMatrix color = { .m = {
        {1,0,0,0,0}, {0,1,0,0,0}, {0,0,1,0,0}, {0,0,0,alpha,0}, {0,0,0,0,1}
    }};
    GdipSetImageAttributesColorMatrix(attributes, ColorAdjustTypeBitmap, TRUE, &color, NULL, ColorMatrixFlagsDefault);
    GdipSetInterpolationMode(canvas->graphics, smoothing ? InterpolationModeBilinear : InterpolationModeNearestNeighbor);
    GpStatus status = GdipDrawImageRectRect(canvas->graphics, (GpImage *)image->bitmap,
        dx, dy, dw, dh, sx, sy, sw, sh, UnitPixel, attributes, NULL, NULL);
    GdipDisposeImageAttributes(attributes);
    return status == Ok;
}

/* Copy the decoded bitmap before closing its file or stream. */
static int reactc_canvas_copy_image(GpBitmap *image) {
    UINT width = 0, height = 0;
    int id = 0;
    if (GdipGetImageWidth((GpImage *)image, &width) == Ok &&
        GdipGetImageHeight((GpImage *)image, &height) == Ok &&
        width <= 4096 && height <= 4096) {
        id = reactc_canvas_create((int)width, (int)height);
        if (id && GdipDrawImageRectI(reactc_canvas_at(id)->graphics, (GpImage *)image,
                0, 0, (int)width, (int)height) != Ok) {
            reactc_canvas_destroy(id);
            id = 0;
        }
    }
    return id;
}

static int reactc_canvas_load(const wchar_t *filename) {
    ULONG_PTR token = 0;
    GdiplusStartupInput input = { .GdiplusVersion = 1 };
    if (GdiplusStartup(&token, &input, NULL) != Ok) return 0;
    GpBitmap *image = NULL;
    int id = GdipCreateBitmapFromFile(filename, &image) == Ok ? reactc_canvas_copy_image(image) : 0;
    if (image) GdipDisposeImage((GpImage *)image);
    GdiplusShutdown(token);
    return id;
}

static int reactc_canvas_load_bytes(int id, unsigned int length) {
    ReactcCanvas *canvas = reactc_canvas_at(id);
    if (!canvas || !length || length > canvas->upload_size) return 0;
    HGLOBAL storage = GlobalAlloc(GMEM_MOVEABLE, length);
    if (!storage) return 0;
    void *bytes = GlobalLock(storage);
    if (!bytes) {
        GlobalFree(storage);
        return 0;
    }
    memcpy(bytes, canvas->upload, length);
    GlobalUnlock(storage);
    IStream *stream = NULL;
    if (FAILED(CreateStreamOnHGlobal(storage, TRUE, &stream))) {
        GlobalFree(storage);
        return 0;
    }
    GpBitmap *image = NULL;
    int result = GdipCreateBitmapFromStream(stream, &image) == Ok ? reactc_canvas_copy_image(image) : 0;
    if (image) GdipDisposeImage((GpImage *)image);
    stream->lpVtbl->Release(stream);
    return result;
}

static int reactc_canvas_size(int id, int height) {
    ReactcCanvas *canvas = reactc_canvas_at(id);
    return canvas ? (height ? canvas->height : canvas->width) : 0;
}

static __thread wchar_t reactc_canvas_filename[32768];

static void reactc_canvas_filename_unit(int index, int value) {
    if (index >= 0 && index < 32768) reactc_canvas_filename[index] = (wchar_t)value;
}

static int reactc_canvas_load_filename(void) {
    return reactc_canvas_load(reactc_canvas_filename);
}

/* Font family names and text are staged as UTF-16. The names are terminated
 * by an empty string, followed by the text and its explicit length. */
static __thread REAL reactc_text_metrics[7];

static GpFontFamily *reactc_canvas_font_family(int text_offset) {
    const wchar_t *name = reactc_canvas_filename;
    const wchar_t *end = name + text_offset;
    while (name < end && *name) {
        GpFontFamily *family = NULL;
        GpStatus result;
        if (_wcsicmp(name, L"serif") == 0) result = GdipGetGenericFontFamilySerif(&family);
        else if (_wcsicmp(name, L"monospace") == 0) result = GdipGetGenericFontFamilyMonospace(&family);
        else if (_wcsicmp(name, L"sans-serif") == 0 || _wcsicmp(name, L"system-ui") == 0)
            result = GdipGetGenericFontFamilySansSerif(&family);
        else result = GdipCreateFontFamilyFromName(name, NULL, &family);
        if (result == Ok) return family;
        name += wcslen(name) + 1;
    }
    GpFontFamily *family = NULL;
    return GdipGetGenericFontFamilySansSerif(&family) == Ok ? family : NULL;
}

static int reactc_canvas_text(int id, int text_offset, int length, REAL size,
    int style, int baseline, int align, int operation, REAL x, REAL y,
    REAL max_width, ARGB color, REAL line_width, int use_gradient) {
    ReactcCanvas *canvas = reactc_canvas_at(id);
    if (!canvas || text_offset < 1 || text_offset >= 32768 ||
        length < 0 || length > 32768 - text_offset || !(size > 0 && size <= 4096)) return 0;
    /* Keep the family traversal inside the staged strings. */
    reactc_canvas_filename[text_offset - 1] = 0;
    GpFontFamily *family = reactc_canvas_font_family(text_offset);
    if (!family) return 0;
    BOOL available = FALSE;
    if (GdipIsStyleAvailable(family, style, &available) != Ok || !available) style = FontStyleRegular;

    const wchar_t *text = reactc_canvas_filename + text_offset;
    GpFont *font = NULL;
    GpStringFormat *format = NULL;
    GpPath *glyphs = NULL;
    GpMatrix *transform = NULL;
    ReactcCanvasPaint paint = {0};
    GpPen *pen = NULL;
    UINT16 em = 0, ascent = 0, descent = 0;
    GpRectF layout = { 0, 0, 1000000, 1000000 }, advance = {0}, bounds = {0};
    int result = 0;
    if (GdipGetEmHeight(family, style, &em) != Ok || !em ||
        GdipGetCellAscent(family, style, &ascent) != Ok ||
        GdipGetCellDescent(family, style, &descent) != Ok ||
        GdipCreateFont(family, size, style, UnitPixel, &font) != Ok ||
        GdipCreateStringFormat(StringFormatFlagsNoWrap | StringFormatFlagsNoClip |
            StringFormatFlagsMeasureTrailingSpaces | StringFormatFlagsNoFitBlackBox, 0, &format) != Ok ||
        GdipCreatePath(FillModeWinding, &glyphs) != Ok) goto done;
    if (length) {
        if (GdipMeasureString(canvas->graphics, text, length, font, &layout,
                format, &advance, NULL, NULL) != Ok ||
            GdipAddPathString(glyphs, text, length, family, style, size, &layout, format) != Ok ||
            GdipGetPathWorldBounds(glyphs, &bounds, NULL, NULL) != Ok) goto done;
    }
    const REAL font_ascent = size * ascent / em, font_descent = size * descent / em;
    const REAL line_height = font_ascent + font_descent;
    const REAL baselines[] = {font_ascent, 0, font_ascent * 0.2f, line_height / 2, line_height, line_height};
    const REAL origin_y = baseline >= 0 && baseline < 6 ? baselines[baseline] : font_ascent;
    const REAL ratio = max_width > 0 && max_width < advance.Width ? max_width / advance.Width : 1;
    const REAL aligned_x = align == 1 ? advance.Width / 2 : (align == 2 ? advance.Width : 0);
    if (operation == 0) {
        reactc_text_metrics[0] = advance.Width;
        reactc_text_metrics[1] = aligned_x - bounds.X;
        reactc_text_metrics[2] = bounds.X + bounds.Width - aligned_x;
        reactc_text_metrics[3] = bounds.Height > 0 ? origin_y - bounds.Y : 0;
        reactc_text_metrics[4] = bounds.Height > 0 ? bounds.Y + bounds.Height - origin_y : 0;
        reactc_text_metrics[5] = origin_y;
        reactc_text_metrics[6] = line_height - origin_y;
    } else if (length) {
        if (GdipCreateMatrix2(ratio, 0, 0, 1,
                x - aligned_x * ratio, y - origin_y, &transform) != Ok ||
            GdipTransformPath(glyphs, transform) != Ok) goto done;
        const int ready = reactc_canvas_paint(canvas, &paint, color, use_gradient);
        if (!ready) goto done;
        if (ready == 1 && operation == 1 &&
            GdipFillPath(canvas->graphics, paint.brush, glyphs) != Ok) goto done;
        if (ready == 1 && operation == 2 &&
            (GdipCreatePen2(paint.brush, line_width, UnitWorld, &pen) != Ok ||
             GdipDrawPath(canvas->graphics, pen, glyphs) != Ok)) goto done;
    }
    result = 1;
done:
    if (pen) GdipDeletePen(pen);
    reactc_canvas_paint_destroy(&paint);
    if (transform) GdipDeleteMatrix(transform);
    if (glyphs) GdipDeletePath(glyphs);
    if (format) GdipDeleteStringFormat(format);
    if (font) GdipDeleteFont(font);
    GdipDeleteFontFamily(family);
    return result;
}

static REAL reactc_canvas_text_metric(int field) {
    return field >= 0 && field < 7 ? reactc_text_metrics[field] : 0;
}

static int reactc_canvas_gl_context(int id, int version) {
    ReactcCanvas *canvas = reactc_canvas_at(id);
    if (!canvas || (version != 2 && version != 3)) return 0;
    if (canvas->webgl.context) return canvas->webgl.version == version;
    return reactc_webgl_create(&canvas->webgl, canvas->width, canvas->height, version);
}

static int reactc_canvas_gl_clear_color(int id, float r, float g, float b, float a) {
    ReactcCanvas *canvas = reactc_canvas_at(id);
    if (!canvas || !reactc_webgl_current(&canvas->webgl)) return 0;
    reactc_angle.clear_color(r, g, b, a);
    return 1;
}

static int reactc_canvas_gl_clear(int id, unsigned int mask) {
    ReactcCanvas *canvas = reactc_canvas_at(id);
    if (!canvas || !reactc_webgl_current(&canvas->webgl)) return 0;
    reactc_angle.clear(mask);
    return 1;
}

static uint32_t reactc_canvas_gl_pixel(int id, int x, int y) {
    ReactcCanvas *canvas = reactc_canvas_at(id);
    if (!canvas || !reactc_webgl_current(&canvas->webgl)) return 0;
    unsigned char rgba[4] = {0};
    reactc_angle.read_pixels(x, y, 1, 1, 0x1908, 0x1401, rgba);
    return ((uint32_t)rgba[3] << 24) | ((uint32_t)rgba[0] << 16) | ((uint32_t)rgba[1] << 8) | rgba[2];
}

static __thread struct {
    char text[32768];
    int length, size;
    unsigned int type;
} reactc_webgl_query;

static unsigned int reactc_canvas_gl_query_field(int field, int position) {
    if (field == 0) return (unsigned int)reactc_webgl_query.size;
    if (field == 1) return reactc_webgl_query.type;
    if (field == 3) return (unsigned int)reactc_webgl_query.length;
    return position >= 0 && position < reactc_webgl_query.length
        ? (unsigned char)reactc_webgl_query.text[position] : 0;
}

static void reactc_canvas_gl_input(char *output, size_t capacity) {
    size_t index = 0;
    while (index + 1 < capacity && reactc_canvas_filename[index]) {
        output[index] = (char)reactc_canvas_filename[index];
        ++index;
    }
    output[index] = '\0';
}

static int reactc_canvas_gl_command(int id, int operation, unsigned int a, unsigned int b, int c, int d) {
    ReactcCanvas *canvas = reactc_canvas_at(id);
    if (!canvas || !reactc_webgl_current(&canvas->webgl)) return 0;
    ReactcAngle *gl = &reactc_angle;
    int status = 0;
    switch (operation) {
    case 0: gl->viewport((int)a, (int)b, c, d); break;
    case 1: return (int)gl->create_shader(a);
    case 2: {
        char code[32768];
        reactc_canvas_gl_input(code, sizeof(code));
        const char *source = code;
        gl->shader_source(a, 1, &source, NULL);
        break;
    }
    case 3: gl->compile_shader(a); break;
    case 4: gl->get_shader_iv(a, b, &status); return status;
    case 5: gl->delete_shader(a); break;
    case 6: return (int)gl->create_program();
    case 7: gl->attach_shader(a, b); break;
    case 8: gl->link_program(a); break;
    case 9: gl->get_program_iv(a, b, &status); return status;
    case 10: gl->use_program(a); break;
    case 11: gl->delete_program(a); break;
    case 12: gl->draw_arrays(a, (int)b, c); break;
    case 13: {
        unsigned int buffer = 0;
        gl->gen_buffers(1, &buffer);
        return (int)buffer;
    }
    case 14: gl->delete_buffers(1, &a); break;
    case 15:
        /* Pixel transfer uses host memory in this bridge. */
        if (a == 0x88eb || a == 0x88ec) return 0;
        gl->bind_buffer(a, b);
        break;
    case 16: gl->enable_vertex_attrib(a); break;
    case 17: gl->disable_vertex_attrib(a); break;
    case 18:
        gl->get_integer(0x8895, &status); /* GL_ELEMENT_ARRAY_BUFFER_BINDING */
        if (!status) return 0;
        gl->draw_elements(a, (int)b, (unsigned)c, (const void *)(uintptr_t)(unsigned)d);
        break;
    case 19: return (int)gl->get_error();
    case 20:
        if (a == 0x8872 || a == 0x8a2f) gl->get_integer(a, &status);
        return status;
    case 21: case 22:
        reactc_webgl_query.length = 0;
        (operation == 21 ? gl->get_shader_log : gl->get_program_log)(
            a, sizeof(reactc_webgl_query.text), &reactc_webgl_query.length, reactc_webgl_query.text);
        return reactc_webgl_query.length;
    case 23: case 24:
        reactc_webgl_query.length = reactc_webgl_query.size = reactc_webgl_query.type = 0;
        (operation == 23 ? gl->get_active_attrib : gl->get_active_uniform)(
            a, b, sizeof(reactc_webgl_query.text), &reactc_webgl_query.length,
            &reactc_webgl_query.size, &reactc_webgl_query.type, reactc_webgl_query.text);
        return reactc_webgl_query.length;
    case 25: case 26: case 27: {
        char name[32768];
        reactc_canvas_gl_input(name, sizeof(name));
        if (operation == 25) return gl->get_attrib_location(a, name);
        if (operation == 26) return gl->get_uniform_location(a, name);
        gl->bind_attrib_location(a, b, name);
        break;
    }
    case 28: gl->enable(a); break;
    case 29: gl->disable(a); break;
    case 30: gl->depth_mask(a != 0); break;
    case 31: gl->color_mask(a != 0, b != 0, c != 0, d != 0); break;
    case 32: gl->front_face(a); break;
    case 33: gl->blend_func(a, b); break;
    case 34: gl->blend_func_separate(a, b, (unsigned)c, (unsigned)d); break;
    case 35: gl->blend_equation_separate(a, b); break;
    case 36: gl->bind_framebuffer(a, b); break;
    case 37: {
        unsigned int texture = 0;
        gl->gen_textures(1, &texture);
        return (int)texture;
    }
    case 38: gl->delete_textures(1, &a); break;
    case 39: gl->bind_texture(a, b); break;
    case 40: gl->active_texture(a); break;
    case 41: gl->tex_parameter(a, b, c); break;
    case 42: gl->generate_mipmap(a); break;
    case 43: gl->pixel_store(a, (int)b); break;
    case 44: return 1; /* eglMakeCurrent succeeded above */
    case 45: {
        unsigned int vao = 0;
        gl->gen_vertex_arrays(1, &vao);
        return (int)vao;
    }
    case 46: gl->delete_vertex_arrays(1, &a); break;
    case 47: gl->bind_vertex_array(a); break;
    case 48: gl->vertex_attrib_divisor(a, b); break;
    case 49: gl->draw_arrays_instanced(a, (int)b, c, d); break;
    case 50: {
        int range[2] = { 0, 0 };
        int precision = 0;
        gl->shader_precision(a, b, range, &precision);
        reactc_webgl_query.length = precision;
        reactc_webgl_query.size = range[0];
        reactc_webgl_query.type = range[1];
        break;
    }
    case 51: gl->scissor((int)a, (int)b, c, d); break;
    case 52: case 53: {
        unsigned int object = 0;
        (operation == 52 ? gl->gen_framebuffers : gl->gen_renderbuffers)(1, &object);
        return (int)object;
    }
    case 54: gl->delete_framebuffers(1, &a); break;
    case 55: gl->delete_renderbuffers(1, &a); break;
    case 56: return (int)gl->framebuffer_status(a);
    case 57: gl->bind_renderbuffer(a, b); break;
    case 58: gl->renderbuffer_storage(a, b, c, d); break;
    case 59: gl->framebuffer_renderbuffer(a, b, (unsigned)c, (unsigned)d); break;
    case 60: gl->read_buffer(a); break;
    case 61: gl->stencil_func(a, (int)b, (unsigned)c); break;
    case 62: gl->stencil_op(a, b, (unsigned)c); break;
    case 63: gl->stencil_mask(a); break;
    case 64: gl->clear_stencil((int)a); break;
    case 65: gl->depth_func(a); break;
    case 66:
        reactc_webgl_query.length = 0;
        gl->get_uniform_block_name(a, b, sizeof(reactc_webgl_query.text),
            &reactc_webgl_query.length, reactc_webgl_query.text);
        return reactc_webgl_query.length;
    case 67: {
        char name[32768];
        reactc_canvas_gl_input(name, sizeof(name));
        return (int)gl->uniform_block_index(a, name);
    }
    case 68:
        /* Only scalar queries can write to a single integer. */
        if (c == 0x8a3f || c == 0x8a40 || c == 0x8a42 || c == 0x8a44 || c == 0x8a46)
            gl->get_uniform_block_iv(a, b, (unsigned)c, &status);
        return status;
    case 69: gl->uniform_block_binding(a, b, (unsigned)c); break;
    case 70: gl->bind_buffer_base(a, b, (unsigned)c); break;
    default: return 0;
    }
    return 1;
}

static int reactc_canvas_gl_upload(int id, unsigned int length) {
    ReactcCanvas *canvas = reactc_canvas_at(id);
    if (!canvas || length > 64u * 1024u * 1024u) return 0;
    if (length > canvas->upload_size) {
        unsigned char *next = realloc(canvas->upload, length);
        if (!next) return 0;
        canvas->upload = next;
        canvas->upload_size = length;
    }
    if (length) memset(canvas->upload, 0, length);
    return 1;
}

static void reactc_canvas_gl_upload_byte(int id, unsigned int position, int value) {
    ReactcCanvas *canvas = reactc_canvas_at(id);
    if (canvas && position < canvas->upload_size) canvas->upload[position] = (unsigned char)value;
}

static int reactc_canvas_gl_read(int id, int x, int y, int width, int height) {
    ReactcCanvas *canvas = reactc_canvas_at(id);
    if (!canvas || width < 0 || height < 0 || width > 4096 || height > 4096 ||
        (size_t)width * height * 4 > canvas->upload_size ||
        !reactc_webgl_current(&canvas->webgl)) return 0;
    int alignment = 4;
    reactc_angle.get_integer(0x0d05, &alignment); /* GL_PACK_ALIGNMENT */
    reactc_angle.pixel_store(0x0d05, 1);
    reactc_angle.read_pixels(x, y, width, height, 0x1908, 0x1401, canvas->upload);
    reactc_angle.pixel_store(0x0d05, alignment);
    return 1;
}

static unsigned int reactc_canvas_read_byte(int id, unsigned int position) {
    ReactcCanvas *canvas = reactc_canvas_at(id);
    return canvas && position < canvas->upload_size ? canvas->upload[position] : 0;
}

static int reactc_canvas_gl_buffer(int id, unsigned int target, int replace,
    unsigned int offset, unsigned int length, unsigned int usage) {
    ReactcCanvas *canvas = reactc_canvas_at(id);
    if (!canvas || length > canvas->upload_size || !reactc_webgl_current(&canvas->webgl)) return 0;
    if (replace) reactc_angle.buffer_data(target, length, canvas->upload, usage);
    else reactc_angle.buffer_sub_data(target, offset, length, canvas->upload);
    return 1;
}

static int reactc_canvas_gl_framebuffer_texture(int id, unsigned int target, unsigned int attachment,
    unsigned int texture_target, unsigned int texture, int level) {
    ReactcCanvas *canvas = reactc_canvas_at(id);
    if (!canvas || !reactc_webgl_current(&canvas->webgl)) return 0;
    reactc_angle.framebuffer_texture(target, attachment, texture_target, texture, level);
    return 1;
}

static int reactc_canvas_gl_samples(int id, unsigned int target, int samples, unsigned int format, int width, int height) {
    ReactcCanvas *canvas = reactc_canvas_at(id);
    if (!canvas || !reactc_webgl_current(&canvas->webgl)) return 0;
    reactc_angle.renderbuffer_storage_multisample(target, samples, format, width, height);
    return 1;
}

static int reactc_canvas_gl_draw_buffers(int id, unsigned int count) {
    ReactcCanvas *canvas = reactc_canvas_at(id);
    if (!canvas || count > canvas->upload_size / sizeof(unsigned int) ||
        !reactc_webgl_current(&canvas->webgl)) return 0;
    reactc_angle.draw_buffers((int)count, (const unsigned int *)canvas->upload);
    return 1;
}

static int reactc_canvas_gl_blit(int id, int sx0, int sy0, int sx1, int sy1,
    int dx0, int dy0, int dx1, int dy1, unsigned int mask, unsigned int filter) {
    ReactcCanvas *canvas = reactc_canvas_at(id);
    if (!canvas || !reactc_webgl_current(&canvas->webgl)) return 0;
    reactc_angle.blit_framebuffer(sx0, sy0, sx1, sy1, dx0, dy0, dx1, dy1, mask, filter);
    return 1;
}

static int reactc_canvas_gl_buffer_range(int id, unsigned int target, unsigned int index,
    unsigned int buffer, unsigned int offset, unsigned int size) {
    ReactcCanvas *canvas = reactc_canvas_at(id);
    if (!canvas || !reactc_webgl_current(&canvas->webgl)) return 0;
    reactc_angle.bind_buffer_range(target, index, buffer, offset, size);
    return 1;
}

static int reactc_canvas_gl_copy_texture(int id, unsigned int target, int level, int xoffset, int yoffset,
    int x, int y, int width, int height) {
    ReactcCanvas *canvas = reactc_canvas_at(id);
    if (!canvas || !reactc_webgl_current(&canvas->webgl)) return 0;
    reactc_angle.copy_tex_sub_image(target, level, xoffset, yoffset, x, y, width, height);
    return 1;
}

static int reactc_canvas_gl_attrib(int id, unsigned int slot, int size, unsigned int type,
    int normalized, int stride, unsigned int offset) {
    ReactcCanvas *canvas = reactc_canvas_at(id);
    if (!canvas || !reactc_webgl_current(&canvas->webgl)) return 0;
    int buffer = 0;
    reactc_angle.get_integer(0x8894, &buffer); /* GL_ARRAY_BUFFER_BINDING */
    if (!buffer) return 0;
    const void *address = (const void *)(uintptr_t)offset;
    if (normalized < 0) reactc_angle.vertex_attrib_i_pointer(slot, size, type, stride, address);
    else reactc_angle.vertex_attrib_pointer(slot, size, type, normalized != 0, stride, address);
    return 1;
}

static int reactc_canvas_gl_draw_instanced(int id, unsigned int mode, int count,
    unsigned int type, unsigned int offset, int instances) {
    ReactcCanvas *canvas = reactc_canvas_at(id);
    if (!canvas || !reactc_webgl_current(&canvas->webgl)) return 0;
    int buffer = 0;
    reactc_angle.get_integer(0x8895, &buffer); /* GL_ELEMENT_ARRAY_BUFFER_BINDING */
    if (!buffer) return 0;
    reactc_angle.draw_elements_instanced(mode, count, type, (const void *)(uintptr_t)offset, instances);
    return 1;
}

static int reactc_canvas_gl_polygon_offset(int id, float factor, float units) {
    ReactcCanvas *canvas = reactc_canvas_at(id);
    if (!canvas || !reactc_webgl_current(&canvas->webgl)) return 0;
    reactc_angle.polygon_offset(factor, units);
    return 1;
}

static int reactc_canvas_gl_uniform(int id, int location, int type, int components, int length) {
    ReactcCanvas *canvas = reactc_canvas_at(id);
    if (!canvas || components < 1 || components > 16 || length < 0 || length % components ||
        (size_t)length > canvas->upload_size / 4 || !reactc_webgl_current(&canvas->webgl)) return 0;
    int count = length / components;
    ReactcAngle *gl = &reactc_angle;
    const void *values = canvas->upload;
    switch (type) {
    case 0:
        switch (components) {
        case 1: gl->uniform_float1(location, count, values); break;
        case 2: gl->uniform_float2(location, count, values); break;
        case 3: gl->uniform_float3(location, count, values); break;
        case 4: gl->uniform_float4(location, count, values); break;
        default: return 0;
        }
        break;
    case 1:
        switch (components) {
        case 1: gl->uniform_int1(location, count, values); break;
        case 2: gl->uniform_int2(location, count, values); break;
        case 3: gl->uniform_int3(location, count, values); break;
        case 4: gl->uniform_int4(location, count, values); break;
        default: return 0;
        }
        break;
    case 2:
        switch (components) {
        case 1: gl->uniform_uint1(location, count, values); break;
        case 2: gl->uniform_uint2(location, count, values); break;
        case 3: gl->uniform_uint3(location, count, values); break;
        case 4: gl->uniform_uint4(location, count, values); break;
        default: return 0;
        }
        break;
    case 3:
        switch (components) {
        case 4: gl->uniform_matrix2(location, count, 0, values); break;
        case 9: gl->uniform_matrix3(location, count, 0, values); break;
        case 16: gl->uniform_matrix4(location, count, 0, values); break;
        default: return 0;
        }
        break;
    default: return 0;
    }
    return 1;
}

static int reactc_canvas_gl_texture(int id, int replace, int level, int internal_format,
    int x, int y, int width, int height) {
    ReactcCanvas *canvas = reactc_canvas_at(id);
    if (!canvas || width < 0 || height < 0 || width > 4096 || height > 4096 ||
        (size_t)width * height * 4 > canvas->upload_size || !reactc_webgl_current(&canvas->webgl)) return 0;
    int unpack_alignment = 4;
    reactc_angle.get_integer(0x0cf5, &unpack_alignment); /* GL_UNPACK_ALIGNMENT */
    reactc_angle.pixel_store(0x0cf5, 1);
    if (replace) {
        reactc_angle.tex_image_2d(0x0de1, level, internal_format, width, height, 0, 0x1908, 0x1401, canvas->upload);
    } else {
        reactc_angle.tex_sub_image_2d(0x0de1, level, x, y, width, height, 0x1908, 0x1401, canvas->upload);
    }
    reactc_angle.pixel_store(0x0cf5, unpack_alignment);
    return 1;
}

#endif
