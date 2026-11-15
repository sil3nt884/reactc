#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include <wasmtime.h>
#include <wasi.h>

static bool preopen(wasi_config_t *wasi, const char *mapping) {
    const char *separator = strstr(mapping, "::");
    if (!separator) return *mapping && wasi_config_preopen_dir(wasi, mapping, mapping, true);
    if (separator == mapping || !separator[2]) return false;
    size_t length = (size_t)(separator - mapping);
    char *host = malloc(length + 1);
    if (!host) return false;
    memcpy(host, mapping, length);
    host[length] = '\0';
    bool success = wasi_config_preopen_dir(wasi, host, separator + 2, true);
    free(host);
    return success;
}

static bool read_module(const char *path, wasm_byte_vec_t *bytes) {
    FILE *file = fopen(path, "rb");
    if (!file) return false;
    long length = fseek(file, 0, SEEK_END) == 0 ? ftell(file) : -1;
    bool success = false;
    if (length > 0 && fseek(file, 0, SEEK_SET) == 0) {
        wasm_byte_vec_new_uninitialized(bytes, (size_t)length);
        success = fread(bytes->data, 1, bytes->size, file) == bytes->size;
    }
    fclose(file);
    return success;
}

static void report(const wasm_name_t *message) {
    fputs("reactc-runtime: ", stderr);
    fwrite(message->data, 1, message->size, stderr);
    fputc('\n', stderr);
}

int main(int argc, char **argv) {
    int status = 1, arg = 1;
    bool precompiled = false;
    wasi_config_t *wasi = wasi_config_new();
    while (arg < argc && strcmp(argv[arg], "--dir") == 0) {
        if (++arg == argc || !preopen(wasi, argv[arg])) {
            fputs("reactc-runtime: cannot grant directory, use --dir HOST[::GUEST]\n", stderr);
            wasi_config_delete(wasi);
            return 2;
        }
        arg++;
    }
    if (arg < argc && strcmp(argv[arg], "--precompiled") == 0) {
        precompiled = true;
        arg++;
    }
    if (arg == argc || argv[arg][0] == '-') {
        fputs("usage: reactc-runtime [--dir HOST[::GUEST]] [--precompiled] APP [APP_ARGS...]\n", stderr);
        wasi_config_delete(wasi);
        return 2;
    }
    if (!wasi_config_set_argv(wasi, (size_t)(argc - arg), (const char **)(argv + arg))) {
        fputs("reactc-runtime: app arguments must be UTF-8\n", stderr);
        wasi_config_delete(wasi);
        return 2;
    }
    wasi_config_inherit_stdin(wasi);
    wasi_config_inherit_stdout(wasi);
    wasi_config_inherit_stderr(wasi);

    wasm_byte_vec_t bytes = {0};
    if (!precompiled && !read_module(argv[arg], &bytes)) {
        fprintf(stderr, "reactc-runtime: cannot read %s\n", argv[arg]);
        wasm_byte_vec_delete(&bytes);
        wasi_config_delete(wasi);
        return 1;
    }

    wasm_config_t *config = wasm_config_new();
    wasmtime_config_wasm_exceptions_set(config, true);
    wasmtime_config_cranelift_opt_level_set(config, WASMTIME_OPT_LEVEL_NONE);
    wasm_engine_t *engine = wasm_engine_new_with_config(config);
    wasmtime_store_t *store = wasmtime_store_new(engine, NULL, NULL);
    wasmtime_context_t *context = wasmtime_store_context(store);
    wasmtime_linker_t *linker = wasmtime_linker_new(engine);
    wasmtime_module_t *module = NULL;
    wasm_trap_t *trap = NULL;

    wasmtime_error_t *error = wasmtime_context_set_wasi(context, wasi);
    if (error) goto done;
    error = wasmtime_linker_define_wasi(linker);
    if (error) goto done;
    // The caller must explicitly select a trusted, locally compiled artifact.
    error = precompiled
        ? wasmtime_module_deserialize_file(engine, argv[arg], &module)
        : wasmtime_module_new(engine, (const uint8_t *)bytes.data, bytes.size, &module);
    if (error) goto done;

    wasmtime_instance_t instance;
    error = wasmtime_linker_instantiate(linker, context, module, &instance, &trap);
    if (error || trap) goto done;
    wasmtime_extern_t start;
    if (!wasmtime_instance_export_get(context, &instance, "_start", 6, &start) ||
        start.kind != WASMTIME_EXTERN_FUNC) {
        fputs("reactc-runtime: expected a WASI command with a _start export\n", stderr);
        goto done;
    }
    error = wasmtime_func_call(context, &start.of.func, NULL, 0, NULL, 0, &trap);
    if (!error && !trap) status = 0;

done:
    if (error) {
        wasm_name_t message;
        if (!wasmtime_error_exit_status(error, &status)) {
            wasmtime_error_message(error, &message);
            report(&message);
            wasm_name_delete(&message);
        }
        wasmtime_error_delete(error);
    }
    if (trap) {
        wasm_name_t message;
        wasm_trap_message(trap, &message);
        report(&message);
        wasm_name_delete(&message);
        wasm_trap_delete(trap);
    }
    if (module) wasmtime_module_delete(module);
    wasm_byte_vec_delete(&bytes);
    wasmtime_linker_delete(linker);
    wasmtime_store_delete(store);
    wasm_engine_delete(engine);
    return status;
}
