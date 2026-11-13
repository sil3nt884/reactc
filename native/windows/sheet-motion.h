/* Native presentation of the original sheet's one-axis spring and release rules. */
struct SheetSample {float y;ULONGLONG time;};
struct SheetMotion {
    float offset, velocity, target, height, start_y, start_offset, damping;
    ULONGLONG last;
    struct SheetSample samples[5];
    unsigned sample_count;
    bool dragging, animating, closing;
};

static void sheet_animate(struct SheetMotion *motion, float target, float velocity,
    float damping, ULONGLONG now) {
    motion->target = target;
    motion->velocity = velocity;
    motion->damping = damping;
    motion->last = now;
    motion->animating = true;
}

static void sheet_begin_drag(struct SheetMotion *motion, float y, ULONGLONG now) {
    motion->dragging = true;
    motion->animating = false;
    motion->closing = false;
    motion->start_y = y;
    motion->start_offset = motion->offset;
    motion->sample_count = 1;
    motion->samples[0] = (struct SheetSample){y, now};
}

static void sheet_drag_to(struct SheetMotion *motion, float y, ULONGLONG now) {
    float delta = y - motion->start_y;
    if (fabsf(delta) < 6 && motion->sample_count == 1) return;
    float next = motion->start_offset + delta;
    if (next < 0) next = next * motion->height * .55f / (motion->height - .55f * next);
    motion->offset = next;
    if (motion->sample_count == 5) {
        memmove(motion->samples, motion->samples + 1, 4 * sizeof(*motion->samples));
        motion->sample_count--;
    }
    motion->samples[motion->sample_count++] = (struct SheetSample){y, now};
}

static bool sheet_end_drag(struct SheetMotion *motion, ULONGLONG now, bool cancelled, bool reduced) {
    motion->dragging = false;
    unsigned first = 0, last = motion->sample_count - 1;
    while (first < last && now - motion->samples[first].time > 120) first++;
    ULONGLONG elapsed = motion->samples[last].time - motion->samples[first].time;
    float velocity = !cancelled && elapsed
        ? (motion->samples[last].y - motion->samples[first].y) * 1000 / elapsed : 0;
    float projected = motion->offset + velocity * .499f;
    motion->closing = !cancelled && (velocity > 450 || (velocity > -450 && projected > motion->height * .4f));
    if (reduced) {
        motion->offset = 0;
        return motion->closing;
    }
    sheet_animate(motion, motion->closing ? motion->height : 0, velocity, motion->closing ? 1 : .8f, now);
    return false;
}

static bool sheet_step(struct SheetMotion *motion, ULONGLONG now) {
    if (!motion->animating) return false;
    float elapsed = fminf((float)(now - motion->last) / 1000, .064f);
    motion->last = now;
    const float omega = 2 * 3.14159265f / .3f;
    while (elapsed > 0) {
        float step = fminf(elapsed, 1.0f / 240);
        float acceleration = -omega * omega * (motion->offset - motion->target) -
            2 * motion->damping * omega * motion->velocity;
        motion->velocity += acceleration * step;
        motion->offset += motion->velocity * step;
        elapsed -= step;
    }
    if (fabsf(motion->offset - motion->target) >= .5f || fabsf(motion->velocity) >= 8) return false;
    motion->offset = motion->target;
    motion->velocity = 0;
    motion->animating = false;
    return motion->closing;
}
