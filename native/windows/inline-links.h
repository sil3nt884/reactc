/* Inline styled text and text controls share the surrounding line layout. */
static bool inline_text_button(int node) {
    if (!is(node, "Button") || !equal(snapshot, get(snapshot, props(node), "type"), "button") ||
        get(snapshot, style(node), "backgroundColor") || get(snapshot, style(node), "width")) return false;
    int children = get(snapshot, node, "children");
    if (children) for (int child = children + 1; child < snapshot->t[children].next; child = snapshot->t[child].next) {
        if (!is(child, "Text")) return false;
    }
    return true;
}

static bool needs_inline_layout(int node) {
    if (is(node, "Link") || inline_text_button(node)) return true;
    int children = get(snapshot, node, "children");
    if (children) for (int child = children + 1; child < snapshot->t[children].next; child = snapshot->t[child].next) {
        if (is(child, "Text") && (get(snapshot, style(child), "fontWeight") ||
            get(snapshot, style(child), "fontFamily") || get(snapshot, style(child), "color") ||
            get(snapshot, style(child), "textTransform"))) return true;
        if (needs_inline_layout(child)) return true;
    }
    return false;
}

struct InlineRun {
    int owner;
    uint32_t ink;
    void *face;
    int transform;
};

static void collect_inline(int node, struct InlineRun run, wchar_t *text, struct InlineRun *runs,
    size_t *used, size_t capacity) {
    if (is(node, "Link") || inline_text_button(node)) {
        if (run.owner) fail("Nested native inline controls are unsupported");
        run.owner = node;
    } else if (!is(node, "Text") && !is(node, "Heading") && !is(node, "Label")) {
        fail("Native inline layout requires text content");
    }
    run.ink = color(node, "color", run.ink);
    run.face = font_for(node, run.face);
    int transform = get(snapshot, style(node), "textTransform");
    if (transform) run.transform = transform;
    string(snapshot, get(snapshot, props(node), "text"), text + *used, capacity - *used);
    transform_text(text + *used, run.transform);
    size_t count = wcslen(text + *used);
    for (size_t index = 0; index < count; index++) runs[*used + index] = run;
    *used += count;
    int children = get(snapshot, node, "children");
    if (children) for (int child = children + 1; child < snapshot->t[children].next; child = snapshot->t[child].next) {
        collect_inline(child, run, text, runs, used, capacity);
    }
}

static float run_width(wchar_t *text, size_t begin, size_t end, float size, void *selected) {
    wchar_t saved = text[end];
    text[end] = 0;
    float result = measure_font(text + begin, size, selected);
    text[end] = saved;
    return result;
}

static size_t run_end(const struct InlineRun *runs, size_t begin, size_t end) {
    const struct InlineRun *run = &runs[begin];
    size_t next = begin + 1;
    while (next < end && runs[next].owner == run->owner && runs[next].ink == run->ink &&
        runs[next].face == run->face) next++;
    return next;
}

static float inline_width(wchar_t *text, const struct InlineRun *runs, size_t begin, size_t end, float size) {
    float width = 0;
    while (begin < end) {
        size_t next = run_end(runs, begin, end);
        width += run_width(text, begin, next, size, runs[begin].face);
        begin = next;
    }
    return width;
}

static int box_scroll(const struct Box *box) {
    return box->viewport ? box->viewport_scroll : scroll;
}

static bool in_box(const struct Box *box, float x, float y) {
    float document_y = y + box_scroll(box);
    if (box->clipped && (x < box->clip.left || x >= box->clip.right ||
        document_y < box->clip.top || document_y >= box->clip.bottom)) return false;
    bool visible = box->caption ? y >= 0 && y < chrome_height : y >= chrome_height;
    return visible && x >= box->x && x < box->x + box->w &&
        document_y >= box->y && document_y < box->y + box->h;
}

static void inline_line(wchar_t *text, const struct InlineRun *runs, size_t begin, size_t end,
    const struct Box *block, float y, float line_height, bool draw) {
    float x = block->x;
    if (block->centered_text) {
        x += fmaxf(0, (block->w - inline_width(text, runs, begin, end, block->size)) / 2);
    }
    while (begin < end) {
        const struct InlineRun *run = &runs[begin];
        int owner = run->owner;
        size_t next = run_end(runs, begin, end);
        float advance = run_width(text, begin, next, block->size, run->face);
        if (!draw && owner && advance > 0) {
            if (box_count >= 4096) fail("Too many native link regions");
            struct Box *hit = &boxes[box_count++];
            *hit = (struct Box){.node=owner, .props=props(owner), .x=x, .y=y, .w=advance, .h=line_height, .kind=9, .native_id=true};
            string(snapshot, get(snapshot, owner, "id"), hit->public_id, sizeof(hit->public_id) / sizeof(*hit->public_id));
        }
        if (draw && y - scroll + line_height >= paint_top && y - scroll < height) {
            sk_paint_set_color(paint, run->ink);
            float baseline = y - scroll + block->size;
            draw_text_units(text + begin, next - begin, x, baseline, block->size, run->face);
            if (owner) {
                int variants = get(snapshot, props(owner), "nativeVariants");
                bool underline = (document_underline_links && is(owner, "Link") && !is(block->node, "Link")) ||
                    equal(snapshot, get(snapshot, style(owner), "underline"), "true");
                if (equal(snapshot, get(snapshot, get(snapshot, variants, "hover"), "underline"), "true")) {
                    POINT cursor;
                    struct Box link = {.x=x, .y=y, .w=advance, .h=line_height};
                    if (GetCursorPos(&cursor) && WindowFromPoint(cursor) == window &&
                        ScreenToClient(window, &cursor) && in_box(&link, cursor.x, cursor.y)) underline = true;
                }
                if (underline) {
                    float line = baseline + (float)style_num(owner, "underlineOffset", 1);
                    sk_paint_set_stroke_width(paint, 1);
                    sk_canvas_draw_line(canvas, x, line, x + advance, line, paint);
                }
            }
        }
        begin = next;
        x += advance;
    }
}

static float inline_layout(const struct Box *block, bool draw) {
    int node = block->node;
    size_t capacity = (size_t)(snapshot->t[node].end - snapshot->t[node].start) + 1;
    wchar_t *text = calloc(capacity, sizeof(*text));
    struct InlineRun *runs = calloc(capacity, sizeof(*runs));
    if (!text || !runs) fail("Cannot allocate inline text");
    size_t length = 0, begin = 0;
    collect_inline(node, (struct InlineRun){0, block->foreground, font}, text, runs, &length, capacity);
    float line_height = block->size * (float)style_num(node, "lineHeight", 1.4);
    float y = block->y;
    while (begin < length) {
        size_t end = begin;
        while (end < length && text[end] != L'\n') {
            size_t next = end + 1;
            if (text[end] >= 0xd800 && text[end] <= 0xdbff && next < length &&
                text[next] >= 0xdc00 && text[next] <= 0xdfff) next++;
            if (end > begin && inline_width(text, runs, begin, next, block->size) > block->w) break;
            end = next;
        }
        inline_line(text, runs, begin, end, block, y, line_height, draw);
        y += line_height;
        begin = text[end] == L'\n' ? end + 1 : end;
    }
    free(text);
    free(runs);
    return fmaxf(line_height, y - block->y);
}
