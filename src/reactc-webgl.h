/* EGL/GLES context for the native WebGL bridge. */
#ifndef REACTC_WEBGL_H
#define REACTC_WEBGL_H

typedef void *ReactcEglObject;
typedef unsigned int ReactcEglBool;
typedef int ReactcEglInt;

typedef struct {
    HMODULE egl, gles;
    ReactcEglObject display, config;
    ReactcEglBool (WINAPI *terminate)(ReactcEglObject);
    ReactcEglObject (WINAPI *create_surface)(ReactcEglObject, ReactcEglObject, const ReactcEglInt *);
    ReactcEglBool (WINAPI *destroy_surface)(ReactcEglObject, ReactcEglObject);
    ReactcEglObject (WINAPI *create_context)(ReactcEglObject, ReactcEglObject, ReactcEglObject, const ReactcEglInt *);
    ReactcEglBool (WINAPI *destroy_context)(ReactcEglObject, ReactcEglObject);
    ReactcEglBool (WINAPI *make_current)(ReactcEglObject, ReactcEglObject, ReactcEglObject, ReactcEglObject);
    void (WINAPI *clear_color)(float, float, float, float);
    void (WINAPI *clear)(unsigned int);
    void (WINAPI *read_pixels)(int, int, int, int, unsigned int, unsigned int, void *);
    void (WINAPI *viewport)(int, int, int, int);
    unsigned int (WINAPI *create_shader)(unsigned int);
    void (WINAPI *shader_source)(unsigned int, int, const char *const *, const int *);
    void (WINAPI *compile_shader)(unsigned int);
    void (WINAPI *get_shader_iv)(unsigned int, unsigned int, int *);
    void (WINAPI *delete_shader)(unsigned int);
    unsigned int (WINAPI *create_program)(void);
    void (WINAPI *attach_shader)(unsigned int, unsigned int);
    void (WINAPI *link_program)(unsigned int);
    void (WINAPI *get_program_iv)(unsigned int, unsigned int, int *);
    void (WINAPI *use_program)(unsigned int);
    void (WINAPI *delete_program)(unsigned int);
    void (WINAPI *draw_arrays)(unsigned int, int, int);
    void (WINAPI *gen_buffers)(int, unsigned int *);
    void (WINAPI *delete_buffers)(int, const unsigned int *);
    void (WINAPI *bind_buffer)(unsigned int, unsigned int);
    void (WINAPI *buffer_data)(unsigned int, ptrdiff_t, const void *, unsigned int);
    void (WINAPI *buffer_sub_data)(unsigned int, ptrdiff_t, ptrdiff_t, const void *);
    void (WINAPI *enable_vertex_attrib)(unsigned int);
    void (WINAPI *disable_vertex_attrib)(unsigned int);
    void (WINAPI *vertex_attrib_pointer)(unsigned int, int, unsigned int, unsigned char, int, const void *);
    void (WINAPI *draw_elements)(unsigned int, int, unsigned int, const void *);
    unsigned int (WINAPI *get_error)(void);
    void (WINAPI *get_integer)(unsigned int, int *);
    void (WINAPI *get_shader_log)(unsigned int, int, int *, char *);
    void (WINAPI *get_program_log)(unsigned int, int, int *, char *);
    void (WINAPI *get_active_attrib)(unsigned int, unsigned int, int, int *, int *, unsigned int *, char *);
    void (WINAPI *get_active_uniform)(unsigned int, unsigned int, int, int *, int *, unsigned int *, char *);
    int (WINAPI *get_attrib_location)(unsigned int, const char *);
    int (WINAPI *get_uniform_location)(unsigned int, const char *);
    void (WINAPI *bind_attrib_location)(unsigned int, unsigned int, const char *);
    void (WINAPI *enable)(unsigned int);
    void (WINAPI *disable)(unsigned int);
    void (WINAPI *depth_mask)(unsigned char);
    void (WINAPI *color_mask)(unsigned char, unsigned char, unsigned char, unsigned char);
    void (WINAPI *front_face)(unsigned int);
    void (WINAPI *blend_func)(unsigned int, unsigned int);
    void (WINAPI *blend_func_separate)(unsigned int, unsigned int, unsigned int, unsigned int);
    void (WINAPI *blend_equation_separate)(unsigned int, unsigned int);
    void (WINAPI *bind_framebuffer)(unsigned int, unsigned int);
    void (WINAPI *gen_textures)(int, unsigned int *);
    void (WINAPI *delete_textures)(int, const unsigned int *);
    void (WINAPI *bind_texture)(unsigned int, unsigned int);
    void (WINAPI *active_texture)(unsigned int);
    void (WINAPI *tex_parameter)(unsigned int, unsigned int, int);
    void (WINAPI *tex_image_2d)(unsigned int, int, int, int, int, int, unsigned int, unsigned int, const void *);
    void (WINAPI *tex_sub_image_2d)(unsigned int, int, int, int, int, int, unsigned int, unsigned int, const void *);
    void (WINAPI *generate_mipmap)(unsigned int);
    void (WINAPI *pixel_store)(unsigned int, int);
    void (WINAPI *gen_vertex_arrays)(int, unsigned int *);
    void (WINAPI *delete_vertex_arrays)(int, const unsigned int *);
    void (WINAPI *bind_vertex_array)(unsigned int);
    void (WINAPI *vertex_attrib_divisor)(unsigned int, unsigned int);
    void (WINAPI *draw_arrays_instanced)(unsigned int, int, int, int);
    void (WINAPI *draw_elements_instanced)(unsigned int, int, unsigned int, const void *, int);
    void (WINAPI *shader_precision)(unsigned int, unsigned int, int *, int *);
    void (WINAPI *polygon_offset)(float, float);
    void (WINAPI *scissor)(int, int, int, int);
    void (WINAPI *uniform_float1)(int, int, const float *);
    void (WINAPI *uniform_int1)(int, int, const int *);
    void (WINAPI *uniform_uint1)(int, int, const unsigned int *);
    void (WINAPI *uniform_float2)(int, int, const float *);
    void (WINAPI *uniform_int2)(int, int, const int *);
    void (WINAPI *uniform_uint2)(int, int, const unsigned int *);
    void (WINAPI *uniform_float3)(int, int, const float *);
    void (WINAPI *uniform_int3)(int, int, const int *);
    void (WINAPI *uniform_uint3)(int, int, const unsigned int *);
    void (WINAPI *uniform_float4)(int, int, const float *);
    void (WINAPI *uniform_int4)(int, int, const int *);
    void (WINAPI *uniform_uint4)(int, int, const unsigned int *);
    void (WINAPI *uniform_matrix2)(int, int, unsigned char, const float *);
    void (WINAPI *uniform_matrix3)(int, int, unsigned char, const float *);
    void (WINAPI *uniform_matrix4)(int, int, unsigned char, const float *);
    void (WINAPI *gen_framebuffers)(int, unsigned int *);
    void (WINAPI *delete_framebuffers)(int, const unsigned int *);
    unsigned int (WINAPI *framebuffer_status)(unsigned int);
    void (WINAPI *framebuffer_texture)(unsigned int, unsigned int, unsigned int, unsigned int, int);
    void (WINAPI *gen_renderbuffers)(int, unsigned int *);
    void (WINAPI *delete_renderbuffers)(int, const unsigned int *);
    void (WINAPI *bind_renderbuffer)(unsigned int, unsigned int);
    void (WINAPI *renderbuffer_storage)(unsigned int, unsigned int, int, int);
    void (WINAPI *renderbuffer_storage_multisample)(unsigned int, int, unsigned int, int, int);
    void (WINAPI *framebuffer_renderbuffer)(unsigned int, unsigned int, unsigned int, unsigned int);
    void (WINAPI *draw_buffers)(int, const unsigned int *);
    void (WINAPI *read_buffer)(unsigned int);
    void (WINAPI *blit_framebuffer)(int, int, int, int, int, int, int, int, unsigned int, unsigned int);
    void (WINAPI *stencil_func)(unsigned int, int, unsigned int);
    void (WINAPI *stencil_op)(unsigned int, unsigned int, unsigned int);
    void (WINAPI *stencil_mask)(unsigned int);
    void (WINAPI *clear_stencil)(int);
    void (WINAPI *depth_func)(unsigned int);
    void (WINAPI *get_uniform_block_name)(unsigned int, unsigned int, int, int *, char *);
    unsigned int (WINAPI *uniform_block_index)(unsigned int, const char *);
    void (WINAPI *get_uniform_block_iv)(unsigned int, unsigned int, unsigned int, int *);
    void (WINAPI *uniform_block_binding)(unsigned int, unsigned int, unsigned int);
    void (WINAPI *bind_buffer_base)(unsigned int, unsigned int, unsigned int);
    void (WINAPI *bind_buffer_range)(unsigned int, unsigned int, unsigned int, ptrdiff_t, ptrdiff_t);
    void (WINAPI *vertex_attrib_i_pointer)(unsigned int, int, unsigned int, int, const void *);
    void (WINAPI *copy_tex_sub_image)(unsigned int, int, int, int, int, int, int, int);
    unsigned int users;
} ReactcAngle;

static __thread ReactcAngle reactc_angle;

static HMODULE reactc_angle_load(const wchar_t *filename) {
    wchar_t path[32768];
    DWORD length = GetModuleFileNameW(NULL, path, sizeof(path) / sizeof(*path));
    if (!length || length >= sizeof(path) / sizeof(*path)) return NULL;
    wchar_t *tail = wcsrchr(path, L'\\');
    if (!tail || (size_t)(tail - path) + wcslen(filename) + 2 > sizeof(path) / sizeof(*path)) return NULL;
    wcscpy(tail + 1, filename);
    return LoadLibraryExW(path, NULL, LOAD_LIBRARY_SEARCH_DLL_LOAD_DIR | LOAD_LIBRARY_SEARCH_SYSTEM32);
}

static void reactc_angle_release(void) {
    ReactcAngle *angle = &reactc_angle;
    if (angle->display && angle->terminate) angle->terminate(angle->display);
    if (angle->gles) FreeLibrary(angle->gles);
    if (angle->egl) FreeLibrary(angle->egl);
    memset(angle, 0, sizeof(*angle));
}

static int reactc_angle_init(void) {
    ReactcAngle *angle = &reactc_angle;
    if (angle->display) return 1;
    angle->egl = reactc_angle_load(L"libEGL.dll");
    angle->gles = reactc_angle_load(L"libGLESv2.dll");
    if (!angle->egl || !angle->gles) goto failed;
    ReactcEglObject (WINAPI *platform)(unsigned int, void *, const ReactcEglInt *) =
        (void *)GetProcAddress(angle->egl, "eglGetPlatformDisplayEXT");
    ReactcEglBool (WINAPI *initialize)(ReactcEglObject, ReactcEglInt *, ReactcEglInt *) =
        (void *)GetProcAddress(angle->egl, "eglInitialize");
    ReactcEglBool (WINAPI *bind_api)(unsigned int) = (void *)GetProcAddress(angle->egl, "eglBindAPI");
    ReactcEglBool (WINAPI *choose)(ReactcEglObject, const ReactcEglInt *, ReactcEglObject *, ReactcEglInt, ReactcEglInt *) =
        (void *)GetProcAddress(angle->egl, "eglChooseConfig");
    if (!platform || !initialize || !bind_api || !choose) goto failed;
#define REACTC_ANGLE_PROC(module, field, export_name) \
    if (!(angle->field = (void *)GetProcAddress(angle->module, export_name))) goto failed
    REACTC_ANGLE_PROC(egl, terminate, "eglTerminate");
    REACTC_ANGLE_PROC(egl, create_surface, "eglCreatePbufferSurface");
    REACTC_ANGLE_PROC(egl, destroy_surface, "eglDestroySurface");
    REACTC_ANGLE_PROC(egl, create_context, "eglCreateContext");
    REACTC_ANGLE_PROC(egl, destroy_context, "eglDestroyContext");
    REACTC_ANGLE_PROC(egl, make_current, "eglMakeCurrent");
    REACTC_ANGLE_PROC(gles, clear_color, "glClearColor");
    REACTC_ANGLE_PROC(gles, clear, "glClear");
    REACTC_ANGLE_PROC(gles, read_pixels, "glReadPixels");
    REACTC_ANGLE_PROC(gles, viewport, "glViewport");
    REACTC_ANGLE_PROC(gles, create_shader, "glCreateShader");
    REACTC_ANGLE_PROC(gles, shader_source, "glShaderSource");
    REACTC_ANGLE_PROC(gles, compile_shader, "glCompileShader");
    REACTC_ANGLE_PROC(gles, get_shader_iv, "glGetShaderiv");
    REACTC_ANGLE_PROC(gles, delete_shader, "glDeleteShader");
    REACTC_ANGLE_PROC(gles, create_program, "glCreateProgram");
    REACTC_ANGLE_PROC(gles, attach_shader, "glAttachShader");
    REACTC_ANGLE_PROC(gles, link_program, "glLinkProgram");
    REACTC_ANGLE_PROC(gles, get_program_iv, "glGetProgramiv");
    REACTC_ANGLE_PROC(gles, use_program, "glUseProgram");
    REACTC_ANGLE_PROC(gles, delete_program, "glDeleteProgram");
    REACTC_ANGLE_PROC(gles, draw_arrays, "glDrawArrays");
    REACTC_ANGLE_PROC(gles, gen_buffers, "glGenBuffers");
    REACTC_ANGLE_PROC(gles, delete_buffers, "glDeleteBuffers");
    REACTC_ANGLE_PROC(gles, bind_buffer, "glBindBuffer");
    REACTC_ANGLE_PROC(gles, buffer_data, "glBufferData");
    REACTC_ANGLE_PROC(gles, buffer_sub_data, "glBufferSubData");
    REACTC_ANGLE_PROC(gles, enable_vertex_attrib, "glEnableVertexAttribArray");
    REACTC_ANGLE_PROC(gles, disable_vertex_attrib, "glDisableVertexAttribArray");
    REACTC_ANGLE_PROC(gles, vertex_attrib_pointer, "glVertexAttribPointer");
    REACTC_ANGLE_PROC(gles, draw_elements, "glDrawElements");
    REACTC_ANGLE_PROC(gles, get_error, "glGetError");
    REACTC_ANGLE_PROC(gles, get_integer, "glGetIntegerv");
    REACTC_ANGLE_PROC(gles, get_shader_log, "glGetShaderInfoLog");
    REACTC_ANGLE_PROC(gles, get_program_log, "glGetProgramInfoLog");
    REACTC_ANGLE_PROC(gles, get_active_attrib, "glGetActiveAttrib");
    REACTC_ANGLE_PROC(gles, get_active_uniform, "glGetActiveUniform");
    REACTC_ANGLE_PROC(gles, get_attrib_location, "glGetAttribLocation");
    REACTC_ANGLE_PROC(gles, get_uniform_location, "glGetUniformLocation");
    REACTC_ANGLE_PROC(gles, bind_attrib_location, "glBindAttribLocation");
    REACTC_ANGLE_PROC(gles, enable, "glEnable");
    REACTC_ANGLE_PROC(gles, disable, "glDisable");
    REACTC_ANGLE_PROC(gles, depth_mask, "glDepthMask");
    REACTC_ANGLE_PROC(gles, color_mask, "glColorMask");
    REACTC_ANGLE_PROC(gles, front_face, "glFrontFace");
    REACTC_ANGLE_PROC(gles, blend_func, "glBlendFunc");
    REACTC_ANGLE_PROC(gles, blend_func_separate, "glBlendFuncSeparate");
    REACTC_ANGLE_PROC(gles, blend_equation_separate, "glBlendEquationSeparate");
    REACTC_ANGLE_PROC(gles, bind_framebuffer, "glBindFramebuffer");
    REACTC_ANGLE_PROC(gles, gen_textures, "glGenTextures");
    REACTC_ANGLE_PROC(gles, delete_textures, "glDeleteTextures");
    REACTC_ANGLE_PROC(gles, bind_texture, "glBindTexture");
    REACTC_ANGLE_PROC(gles, active_texture, "glActiveTexture");
    REACTC_ANGLE_PROC(gles, tex_parameter, "glTexParameteri");
    REACTC_ANGLE_PROC(gles, tex_image_2d, "glTexImage2D");
    REACTC_ANGLE_PROC(gles, tex_sub_image_2d, "glTexSubImage2D");
    REACTC_ANGLE_PROC(gles, generate_mipmap, "glGenerateMipmap");
    REACTC_ANGLE_PROC(gles, pixel_store, "glPixelStorei");
    REACTC_ANGLE_PROC(gles, gen_vertex_arrays, "glGenVertexArrays");
    REACTC_ANGLE_PROC(gles, delete_vertex_arrays, "glDeleteVertexArrays");
    REACTC_ANGLE_PROC(gles, bind_vertex_array, "glBindVertexArray");
    REACTC_ANGLE_PROC(gles, vertex_attrib_divisor, "glVertexAttribDivisor");
    REACTC_ANGLE_PROC(gles, draw_arrays_instanced, "glDrawArraysInstanced");
    REACTC_ANGLE_PROC(gles, draw_elements_instanced, "glDrawElementsInstanced");
    REACTC_ANGLE_PROC(gles, shader_precision, "glGetShaderPrecisionFormat");
    REACTC_ANGLE_PROC(gles, polygon_offset, "glPolygonOffset");
    REACTC_ANGLE_PROC(gles, scissor, "glScissor");
    REACTC_ANGLE_PROC(gles, uniform_float1, "glUniform1fv");
    REACTC_ANGLE_PROC(gles, uniform_int1, "glUniform1iv");
    REACTC_ANGLE_PROC(gles, uniform_uint1, "glUniform1uiv");
    REACTC_ANGLE_PROC(gles, uniform_float2, "glUniform2fv");
    REACTC_ANGLE_PROC(gles, uniform_int2, "glUniform2iv");
    REACTC_ANGLE_PROC(gles, uniform_uint2, "glUniform2uiv");
    REACTC_ANGLE_PROC(gles, uniform_float3, "glUniform3fv");
    REACTC_ANGLE_PROC(gles, uniform_int3, "glUniform3iv");
    REACTC_ANGLE_PROC(gles, uniform_uint3, "glUniform3uiv");
    REACTC_ANGLE_PROC(gles, uniform_float4, "glUniform4fv");
    REACTC_ANGLE_PROC(gles, uniform_int4, "glUniform4iv");
    REACTC_ANGLE_PROC(gles, uniform_uint4, "glUniform4uiv");
    REACTC_ANGLE_PROC(gles, uniform_matrix2, "glUniformMatrix2fv");
    REACTC_ANGLE_PROC(gles, uniform_matrix3, "glUniformMatrix3fv");
    REACTC_ANGLE_PROC(gles, uniform_matrix4, "glUniformMatrix4fv");
    REACTC_ANGLE_PROC(gles, gen_framebuffers, "glGenFramebuffers");
    REACTC_ANGLE_PROC(gles, delete_framebuffers, "glDeleteFramebuffers");
    REACTC_ANGLE_PROC(gles, framebuffer_status, "glCheckFramebufferStatus");
    REACTC_ANGLE_PROC(gles, framebuffer_texture, "glFramebufferTexture2D");
    REACTC_ANGLE_PROC(gles, gen_renderbuffers, "glGenRenderbuffers");
    REACTC_ANGLE_PROC(gles, delete_renderbuffers, "glDeleteRenderbuffers");
    REACTC_ANGLE_PROC(gles, bind_renderbuffer, "glBindRenderbuffer");
    REACTC_ANGLE_PROC(gles, renderbuffer_storage, "glRenderbufferStorage");
    REACTC_ANGLE_PROC(gles, renderbuffer_storage_multisample, "glRenderbufferStorageMultisample");
    REACTC_ANGLE_PROC(gles, framebuffer_renderbuffer, "glFramebufferRenderbuffer");
    REACTC_ANGLE_PROC(gles, draw_buffers, "glDrawBuffers");
    REACTC_ANGLE_PROC(gles, read_buffer, "glReadBuffer");
    REACTC_ANGLE_PROC(gles, blit_framebuffer, "glBlitFramebuffer");
    REACTC_ANGLE_PROC(gles, stencil_func, "glStencilFunc");
    REACTC_ANGLE_PROC(gles, stencil_op, "glStencilOp");
    REACTC_ANGLE_PROC(gles, stencil_mask, "glStencilMask");
    REACTC_ANGLE_PROC(gles, clear_stencil, "glClearStencil");
    REACTC_ANGLE_PROC(gles, depth_func, "glDepthFunc");
    REACTC_ANGLE_PROC(gles, get_uniform_block_name, "glGetActiveUniformBlockName");
    REACTC_ANGLE_PROC(gles, uniform_block_index, "glGetUniformBlockIndex");
    REACTC_ANGLE_PROC(gles, get_uniform_block_iv, "glGetActiveUniformBlockiv");
    REACTC_ANGLE_PROC(gles, uniform_block_binding, "glUniformBlockBinding");
    REACTC_ANGLE_PROC(gles, bind_buffer_base, "glBindBufferBase");
    REACTC_ANGLE_PROC(gles, bind_buffer_range, "glBindBufferRange");
    REACTC_ANGLE_PROC(gles, vertex_attrib_i_pointer, "glVertexAttribIPointer");
    REACTC_ANGLE_PROC(gles, copy_tex_sub_image, "glCopyTexSubImage2D");
#undef REACTC_ANGLE_PROC
    enum {
        PLATFORM_ANGLE = 0x3202, PLATFORM_TYPE = 0x3203, PLATFORM_D3D11 = 0x3208,
        DEVICE_TYPE = 0x3209, DEVICE_WARP = 0x320b, EGL_NONE = 0x3038, GLES_API = 0x30a0
    };
    const ReactcEglInt hardware[] = { PLATFORM_TYPE, PLATFORM_D3D11, EGL_NONE };
    const ReactcEglInt warp[] = { PLATFORM_TYPE, PLATFORM_D3D11, DEVICE_TYPE, DEVICE_WARP, EGL_NONE };
    angle->display = platform(PLATFORM_ANGLE, NULL, hardware);
    if (!angle->display || !initialize(angle->display, NULL, NULL)) {
        angle->display = platform(PLATFORM_ANGLE, NULL, warp);
        if (!angle->display || !initialize(angle->display, NULL, NULL)) goto failed;
    }
    enum {
        RED = 0x3024, GREEN = 0x3023, BLUE = 0x3022, ALPHA = 0x3021,
        DEPTH = 0x3025, STENCIL = 0x3026, SURFACE_TYPE = 0x3033, PBUFFER = 1,
        RENDERABLE_TYPE = 0x3040, GLES2 = 0x04, GLES3 = 0x40
    };
    const ReactcEglInt config[] = {
        RED, 8, GREEN, 8, BLUE, 8, ALPHA, 8, DEPTH, 24, STENCIL, 8,
        SURFACE_TYPE, PBUFFER, RENDERABLE_TYPE, GLES2 | GLES3, EGL_NONE
    };
    ReactcEglInt count = 0;
    if (!bind_api(GLES_API) || !choose(angle->display, config, &angle->config, 1, &count) || !count) goto failed;
    return 1;
failed:
    reactc_angle_release();
    return 0;
}

typedef struct {
    ReactcEglObject context, surface;
    int version;
} ReactcWebGL;

static int reactc_webgl_resize(ReactcWebGL *gl, int width, int height) {
    ReactcAngle *angle = &reactc_angle;
    const ReactcEglInt attributes[] = { 0x3057, width, 0x3056, height, 0x3038 };
    ReactcEglObject surface = angle->create_surface(angle->display, angle->config, attributes);
    if (!surface) return 0;
    if (!angle->make_current(angle->display, surface, surface, gl->context)) {
        angle->destroy_surface(angle->display, surface);
        return 0;
    }
    if (gl->surface) angle->destroy_surface(angle->display, gl->surface);
    gl->surface = surface;
    return 1;
}

static void reactc_webgl_destroy(ReactcWebGL *gl) {
    if (!gl->context) return;
    ReactcAngle *angle = &reactc_angle;
    angle->make_current(angle->display, NULL, NULL, NULL);
    if (gl->surface) angle->destroy_surface(angle->display, gl->surface);
    angle->destroy_context(angle->display, gl->context);
    memset(gl, 0, sizeof(*gl));
    if (!--angle->users) reactc_angle_release();
}

static int reactc_webgl_create(ReactcWebGL *gl, int width, int height, int version) {
    if (!reactc_angle_init()) return 0;
    ReactcAngle *angle = &reactc_angle;
    const ReactcEglInt attributes[] = { 0x3098, version, 0x3038 };
    gl->context = angle->create_context(angle->display, angle->config, NULL, attributes);
    if (!gl->context) {
        if (!angle->users) reactc_angle_release();
        return 0;
    }
    gl->version = version;
    ++angle->users;
    if (!reactc_webgl_resize(gl, width, height)) {
        reactc_webgl_destroy(gl);
        return 0;
    }
    angle->viewport(0, 0, width, height);
    return 1;
}

static int reactc_webgl_current(ReactcWebGL *gl) {
    return gl->context && reactc_angle.make_current(reactc_angle.display, gl->surface, gl->surface, gl->context);
}

#endif
