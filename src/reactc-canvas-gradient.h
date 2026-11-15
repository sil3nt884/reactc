/* Canvas gradients rasterized in device space and painted with a GDI+ brush. */
#ifndef REACTC_CANVAS_GRADIENT_H
#define REACTC_CANVAS_GRADIENT_H

#include <math.h>

enum { REACTC_GRADIENT_STOPS = 4096 };
typedef struct { double offset; ARGB color; } ReactcGradientStop;
typedef struct {
    int radial, count;
    double x, y, radius, dx, dy, dr;
    ReactcGradientStop stops[REACTC_GRADIENT_STOPS];
} ReactcGradient;

static __thread ReactcGradient reactc_gradient;

static int reactc_canvas_gradient(int radial, double x0, double y0, double r0,
    double x1, double y1, double r1, int count) {
    if (count < 0 || count > REACTC_GRADIENT_STOPS) return 0;
    reactc_gradient.radial = radial;
    reactc_gradient.count = count;
    reactc_gradient.x = x0;
    reactc_gradient.y = y0;
    reactc_gradient.radius = r0;
    reactc_gradient.dx = x1 - x0;
    reactc_gradient.dy = y1 - y0;
    reactc_gradient.dr = r1 - r0;
    return 1;
}

static void reactc_canvas_gradient_stop(int slot, double offset, ARGB color) {
    if (slot >= 0 && slot < reactc_gradient.count)
        reactc_gradient.stops[slot] = (ReactcGradientStop){offset, color};
}

static ARGB reactc_gradient_color(const ReactcGradient *gradient, double offset) {
    if (!gradient->count || !isfinite(offset)) return 0;
    const ReactcGradientStop *stops = gradient->stops;
    int low = 0, high = gradient->count;
    while (low < high) {
        int middle = low + (high - low) / 2;
        if (stops[middle].offset <= offset) low = middle + 1;
        else high = middle;
    }
    if (!low) return stops[0].color;
    if (low == gradient->count) return stops[low - 1].color;
    const ReactcGradientStop a = stops[low - 1], b = stops[low];
    const double t = (offset - a.offset) / (b.offset - a.offset);
    ARGB color = 0;
    for (int shift = 0; shift < 32; shift += 8) {
        const double start = (a.color >> shift) & 255, end = (b.color >> shift) & 255;
        color |= (ARGB)(start + (end - start) * t + 0.5) << shift;
    }
    return color;
}

static double reactc_radial_offset(const ReactcGradient *gradient, double a, double x, double y) {
    const double r = gradient->radius, dr = gradient->dr;
    const double b = -2 * (x * gradient->dx + y * gradient->dy + r * dr);
    const double c = x * x + y * y - r * r;
    if (a == 0) {
        if (b == 0) return NAN;
        const double t = -c / b;
        return r + t * dr >= 0 ? t : NAN;
    }
    const double discriminant = b * b - 4 * a * c;
    if (discriminant < 0) return NAN;
    const double root = sqrt(discriminant);
    /* Compute the two roots without subtracting nearly equal values. */
    const double q = -0.5 * (b + copysign(root, b));
    const double first = q / a, second = q != 0 ? c / q : first;
    const double high = fmax(first, second), low = fmin(first, second);
    if (r + high * dr >= 0) return high;
    return r + low * dr >= 0 ? low : NAN;
}

typedef struct {
    GpBrush *brush;
    GpBitmap *bitmap;
    ARGB *pixels;
} ReactcCanvasPaint;

static void reactc_canvas_paint_destroy(ReactcCanvasPaint *paint) {
    if (paint->brush) GdipDeleteBrush(paint->brush);
    if (paint->bitmap) GdipDisposeImage((GpImage *)paint->bitmap);
    free(paint->pixels);
}

/* 0 means failure, 1 means the brush is ready, and 2 means no drawing. */
static int reactc_canvas_paint(ReactcCanvas *canvas, ReactcCanvasPaint *paint, ARGB color, int use_gradient) {
    const ReactcGradient *gradient = &reactc_gradient;
    const double distance = gradient->dx * gradient->dx + gradient->dy * gradient->dy;
    if (use_gradient && distance == 0 && (!gradient->radial || gradient->dr == 0)) return 2;
    if (!use_gradient || !gradient->count) {
        GpSolidFill *solid = NULL;
        const GpStatus status = GdipCreateSolidFill(use_gradient ? 0 : color, &solid);
        paint->brush = (GpBrush *)solid;
        return status == Ok;
    }

    GpMatrix *inverse = NULL;
    if (GdipCreateMatrix(&inverse) != Ok) return 0;
    REAL matrix[6];
    int status = 0;
    if (GdipGetWorldTransform(canvas->graphics, inverse) != Ok) goto done;
    if (GdipInvertMatrix(inverse) != Ok) {
        status = 2;
        goto done;
    }
    if (GdipGetMatrixElements(inverse, matrix) != Ok) goto done;
    const int width = canvas->width, height = canvas->height;
    paint->pixels = malloc((size_t)width * height * sizeof(*paint->pixels));
    if (!paint->pixels) goto done;
    const double a = distance - gradient->dr * gradient->dr;
    for (int row = 0; row < height; row++) {
        for (int column = 0; column < width; column++) {
            const double x = matrix[0] * (column + 0.5) + matrix[2] * (row + 0.5) + matrix[4] - gradient->x;
            const double y = matrix[1] * (column + 0.5) + matrix[3] * (row + 0.5) + matrix[5] - gradient->y;
            const double offset = gradient->radial ? reactc_radial_offset(gradient, a, x, y) :
                (x * gradient->dx + y * gradient->dy) / distance;
            paint->pixels[(size_t)row * width + column] = reactc_gradient_color(gradient, offset);
        }
    }
    if (GdipCreateBitmapFromScan0(width, height, width * 4, PixelFormat32bppARGB,
            (BYTE *)paint->pixels, &paint->bitmap) != Ok) goto done;
    GpTexture *texture = NULL;
    const GpStatus texture_status = GdipCreateTexture((GpImage *)paint->bitmap, WrapModeClamp, &texture);
    paint->brush = (GpBrush *)texture;
    if (texture_status != Ok || GdipSetTextureTransform(texture, inverse) != Ok) goto done;
    status = 1;
done:
    GdipDeleteMatrix(inverse);
    return status;
}

#endif
