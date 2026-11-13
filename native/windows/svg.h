/* Draw the normalized inline SVG primitives emitted by the native compiler. */
static uint32_t svg_color(struct Json *doc, int token, uint32_t current, uint32_t inherited) {
    if (!token) return inherited;
    if (equal(doc, token, "none")) return 0;
    if (equal(doc, token, "currentColor")) return current;
    struct Token value = doc->t[token];
    int length = value.end - value.start - 2;
    const char *text = doc->text + value.start + 1;
    if (value.type != '"' || (length != 7 && length != 9) || *text != '#') fail("Invalid SVG paint");
    unsigned hex = (unsigned)strtoul(text + 1, NULL, 16);
    return length == 7 ? 0xff000000 | hex : (hex << 24) | (hex >> 8);
}

static int svg_choice(struct Json *doc, int token, int inherited, const char *one, const char *two) {
    if (!token) return inherited;
    if (equal(doc, token, one)) return 1;
    if (equal(doc, token, two)) return 2;
    return 0;
}

static void svg_shape(struct Json *doc, int node, int shape, void *canvas, void *paint, void *path) {
    float x = (float)number(doc, get(doc, node, "x"), 0);
    float y = (float)number(doc, get(doc, node, "y"), 0);
    if (shape == 0) {
        sk_canvas_draw_path(canvas, path, paint);
    } else if (shape == 1) {
        float radius = (float)number(doc, get(doc, node, "r"), 0);
        if (radius > 0) sk_canvas_draw_circle(canvas,
            (float)number(doc, get(doc, node, "cx"), 0),
            (float)number(doc, get(doc, node, "cy"), 0), radius, paint);
    } else {
        float width = (float)number(doc, get(doc, node, "width"), 0);
        float height = (float)number(doc, get(doc, node, "height"), 0);
        if (width <= 0 || height <= 0) return;
        int rx_token = get(doc, node, "rx"), ry_token = get(doc, node, "ry");
        float rx = (float)number(doc, rx_token, number(doc, ry_token, 0));
        float ry = (float)number(doc, ry_token, rx);
        SkRect rect = {x, y, x + width, y + height};
        sk_canvas_draw_round_rect(canvas, &rect, rx, ry, paint);
    }
}

static uint32_t svg_opacity(uint32_t color, double opacity) {
    return ((uint32_t)((color >> 24) * opacity + .5) << 24) | (color & 0xffffff);
}

static void draw_svg(struct Json *doc, int node, void *canvas, void *paint, float x, float y,
    float width, float height, uint32_t current, float rotation) {
    int root = get(doc, node, "props");
    int view = get(doc, root, "viewBox");
    if (!view || doc->t[view].type != '[' || doc->t[view].next != view + 5) fail("Invalid SVG viewport");
    float vx = (float)number(doc, view + 1, 0), vy = (float)number(doc, view + 2, 0);
    float vw = (float)number(doc, view + 3, 0), vh = (float)number(doc, view + 4, 0);
    if (vw <= 0 || vh <= 0) fail("Invalid SVG viewport");
    if (width <= 0 || height <= 0) return;
    float scale = fminf(width / vw, height / vh);
    sk_canvas_save(canvas);
    SkRect clip = {x, y, x + width, y + height};
    sk_canvas_clip_rect_with_operation(canvas, &clip, 1, true);
    sk_canvas_translate(canvas, x + width / 2, y + height / 2);
    if (rotation) sk_canvas_rotate_degrees(canvas, rotation);
    sk_canvas_scale(canvas, scale, scale);
    sk_canvas_translate(canvas, -vx - vw / 2, -vy - vh / 2);

    int style = get(doc, root, "style");
    current = svg_color(doc, get(doc, style, "color"), current, current);
    uint32_t fill = svg_color(doc, get(doc, root, "fill"), current, 0xff000000);
    uint32_t stroke = svg_color(doc, get(doc, root, "stroke"), current, 0);
    double opacity = number(doc, get(doc, style, "opacity"), 1);
    int cap = svg_choice(doc, get(doc, root, "strokeLinecap"), 0, "round", "square");
    int join = svg_choice(doc, get(doc, root, "strokeLinejoin"), 0, "round", "bevel");
    float stroke_width = (float)number(doc, get(doc, root, "strokeWidth"), 1);
    int children = get(doc, node, "children");
    if (children) for (int item = children + 1; item < doc->t[children].next; item = doc->t[item].next) {
        int type = get(doc, item, "type"), props = get(doc, item, "props");
        int shape = equal(doc, type, "SvgPath") ? 0 : equal(doc, type, "SvgCircle") ? 1 : equal(doc, type, "SvgRect") ? 2 : -1;
        if (shape < 0) fail("Unsupported SVG shape");
        void *path = NULL;
        if (shape == 0) {
            wchar_t wide[16385];
            char text[16385];
            string(doc, get(doc, props, "d"), wide, sizeof(wide) / sizeof(*wide));
            path = sk_path_new();
            if (!path || !WideCharToMultiByte(CP_UTF8, WC_ERR_INVALID_CHARS, wide, -1, text, sizeof(text), NULL, NULL) ||
                !sk_path_parse_svg_string(path, text)) fail("Skia could not parse the SVG path");
        }
        int shape_style = get(doc, props, "style");
        uint32_t shape_current = svg_color(doc, get(doc, shape_style, "color"), current, current);
        double alpha = opacity * number(doc, get(doc, shape_style, "opacity"), 1);
        uint32_t ink = svg_opacity(svg_color(doc, get(doc, props, "fill"), shape_current, fill), alpha);
        sk_paint_set_style(paint, 0);
        if (ink >> 24) {
            sk_paint_set_color(paint, ink);
            svg_shape(doc, props, shape, canvas, paint, path);
        }
        ink = svg_opacity(svg_color(doc, get(doc, props, "stroke"), shape_current, stroke), alpha);
        float sw = (float)number(doc, get(doc, props, "strokeWidth"), stroke_width);
        if (ink >> 24 && sw > 0) {
            sk_paint_set_style(paint, 1);
            sk_paint_set_color(paint, ink);
            sk_paint_set_stroke_width(paint, sw);
            sk_paint_set_stroke_cap(paint, svg_choice(doc, get(doc, props, "strokeLinecap"), cap, "round", "square"));
            sk_paint_set_stroke_join(paint, svg_choice(doc, get(doc, props, "strokeLinejoin"), join, "round", "bevel"));
            svg_shape(doc, props, shape, canvas, paint, path);
        }
        if (path) sk_path_delete(path);
    }
    sk_paint_set_style(paint, 0);
    sk_canvas_restore(canvas);
}
