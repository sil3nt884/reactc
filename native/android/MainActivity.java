package dev.reactc.host;

import android.app.Activity;
import android.graphics.Typeface;
import android.os.Bundle;
import android.text.Editable;
import android.text.TextWatcher;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.inputmethod.EditorInfo;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.BufferedReader;
import java.io.BufferedWriter;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.io.OutputStreamWriter;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayDeque;
import java.util.Map;
import java.util.HashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public final class MainActivity extends Activity {
    private String origin;
    private static final int BODY_LIMIT = 65536;
    private final ExecutorService core = Executors.newSingleThreadExecutor();
    private final Map<String, Button> buttons = new HashMap<>();
    private volatile Process client;
    private final android.os.Handler timers = new android.os.Handler(android.os.Looper.getMainLooper());
    private volatile boolean closing;
    private BufferedReader output;
    private BufferedWriter input;
    private JSONObject snapshot;
    private LinearLayout content;
    private boolean updating;

    @Override public void onCreate(Bundle saved) {
        super.onCreate(saved);
        ScrollView scroll = new ScrollView(this);
        content = column();
        content.setPadding(dp(16), dp(56), dp(16), dp(24));
        scroll.addView(content);
        setContentView(scroll);
        showStatus("Loading…");
        core.execute(() -> {
            try {
                try (InputStream asset = getAssets().open("http-origin")) {
                    ByteArrayOutputStream bytes = new ByteArrayOutputStream();
                    copy(asset, bytes);
                    origin = bytes.toString("UTF-8");
                }
                File module = File.createTempFile("reactc-page-", ".cwasm", getCacheDir());
                try {
                    try (InputStream asset = getAssets().open("page.cwasm");
                         OutputStream file = new java.io.FileOutputStream(module)) {
                        copy(asset, file);
                    }
                    File runtime = new File(getApplicationInfo().nativeLibraryDir, "libreactc_runtime.so");
                    client = new ProcessBuilder(runtime.getAbsolutePath(), "--precompiled", module.getAbsolutePath())
                        .directory(getFilesDir()).start();
                    if (closing) {
                        client.destroy();
                        return;
                    }
                    drain(client.getErrorStream());
                    output = new BufferedReader(new InputStreamReader(client.getInputStream(), StandardCharsets.UTF_8));
                    input = new BufferedWriter(new OutputStreamWriter(client.getOutputStream(), StandardCharsets.US_ASCII));
                    receive(false);
                } finally {
                    module.delete();
                }
            } catch (Exception error) {
                android.util.Log.e("ReactC", "Could not start compiled page", error);
                runOnUiThread(() -> showStatus(error.toString()));
            }
        });
    }

    private static void copy(InputStream source, OutputStream destination) throws IOException {
        byte[] buffer = new byte[8192];
        int count;
        while ((count = source.read(buffer)) != -1) destination.write(buffer, 0, count);
    }

    private void drain(InputStream stream) {
        Thread backgroundReader = new Thread(() -> {
            try (BufferedReader reader = new BufferedReader(new InputStreamReader(stream, StandardCharsets.UTF_8))) {
                String line;
                while ((line = reader.readLine()) != null) android.util.Log.d("ReactC", line);
            }
            catch (IOException ignored) {}
        }, "reactc-process-output");
        backgroundReader.setDaemon(true);
        backgroundReader.start();
    }

    private void write(JSONObject value) throws Exception {
        String json = value.toString();
        for (int i = 0; i < json.length(); i++) {
            char c = json.charAt(i);
            if (c < 128) input.write(c); else input.write(String.format("\\u%04x", (int)c));
        }
        input.write('\n');
        input.flush();
    }

    private void receive(boolean onlyChange) throws Exception {
        ArrayDeque<JSONObject> pending = new ArrayDeque<>();
        for (int turn = 0; turn < 256; turn++) {
            String line = output.readLine();
            if (line == null) throw new IOException("Compiled page exited");
            JSONObject message = new JSONObject(line);
            if (message.getInt("version") != 1) throw new IOException("Unsupported page protocol version");
            switch (message.getString("type")) {
                case "snapshot":
                    snapshot = message;
                    enqueue(pending, message.optJSONArray("requests"));
                    if (!pending.isEmpty()) {
                        complete(pending.remove());
                        break;
                    }
                    JSONObject tree = snapshot.getJSONObject("tree");
                    long wake = message.optLong("wakeAt", -1);
                    runOnUiThread(() -> {
                        if (closing) return;
                        if (onlyChange) updateControls(tree); else render(tree);
                        timers.removeCallbacksAndMessages(null);
                        if (wake >= 0) timers.postDelayed(this::tick, Math.max(0, wake - System.currentTimeMillis()));
                    });
                    return;
                case "requests":
                    enqueue(pending, message.getJSONArray("requests"));
                    if (pending.isEmpty()) throw new IOException("Compiled page sent an empty request frame");
                    complete(pending.remove());
                    break;
                case "wait":
                    Thread.sleep(Math.max(0, Math.min(5000, message.getLong("wakeAt") - System.currentTimeMillis())));
                    write(new JSONObject().put("type", "tick"));
                    break;
                default: throw new IOException(message.optString("error", "Unexpected page message"));
            }
        }
        throw new IOException("Compiled page exceeded the request limit");
    }

    private void enqueue(ArrayDeque<JSONObject> queue, JSONArray requests) throws Exception {
        if (requests == null) return;
        for (int i = 0; i < requests.length(); i++) queue.add(requests.getJSONObject(i));
    }

    private void complete(JSONObject message) throws Exception {
        write(new JSONObject().put("type", "result").put("id", message.get("id"))
            .put("result", request(message)));
    }

    private JSONObject request(JSONObject message) throws Exception {
        JSONObject args = message.optJSONObject("args");
        String action = message.optString("action");
        String method = args == null ? "" : args.optString("method");
        String path = args == null ? "" : args.optString("path");
        boolean read = action.equals("native.http.read") && (method.equals("GET") || method.equals("HEAD"));
        boolean write = action.equals("native.http.write") && method.matches("POST|PUT|PATCH|DELETE|OPTIONS");
        if (message.optInt("version") != 1 || args == null || !(read || write) || origin.isEmpty() ||
            !origin.equals(args.optString("origin")) || !path.matches("/(?!/)[!-~]{0,2047}") ||
            path.indexOf('\\') >= 0 || path.indexOf('#') >= 0) {
            return new JSONObject().put("ok", false).put("error", "Unsupported native request");
        }
        HttpURLConnection connection = null;
        try {
            connection = (HttpURLConnection) new URL(origin + path).openConnection();
            connection.setInstanceFollowRedirects(false);
            connection.setConnectTimeout(4000);
            connection.setReadTimeout(4000);
            connection.setRequestMethod(method);
            JSONArray headers = args.optJSONArray("headers");
            if (headers != null) {
                if (headers.length() > 64) throw new IOException("Too many HTTP headers");
                int length = 0;
                for (int i = 0; i < headers.length(); i++) {
                    JSONArray header = headers.getJSONArray(i);
                    String key = header.getString(0);
                    String value = header.getString(1);
                    length += key.length() + value.length() + 4;
                    if (length > 8192 || !key.matches("[!#$%&'*+.^_`|~0-9A-Za-z-]+") ||
                        key.toLowerCase(java.util.Locale.ROOT).matches(
                            "host|connection|content-length|transfer-encoding|expect|cookie2|origin|referer|"
                            + "keep-alive|trailer|upgrade|te|via|proxy-.*|sec-.*") ||
                        value.indexOf('\r') >= 0 || value.indexOf('\n') >= 0 || value.indexOf(0) >= 0) {
                        throw new IOException("Invalid HTTP header");
                    }
                    connection.addRequestProperty(key, value);
                }
            }
            if (!args.isNull("body")) {
                byte[] body = args.getString("body").getBytes(StandardCharsets.UTF_8);
                if (read || body.length > BODY_LIMIT) throw new IOException("Invalid HTTP body");
                connection.setDoOutput(true);
                connection.setFixedLengthStreamingMode(body.length);
                try (OutputStream data = connection.getOutputStream()) {
                    data.write(body);
                }
            }
            int status = connection.getResponseCode();
            ByteArrayOutputStream data = new ByteArrayOutputStream();
            try (InputStream body = status < 400 ? connection.getInputStream() : connection.getErrorStream()) {
                if (body != null) {
                    byte[] bytes = new byte[8192];
                    int count;
                    while ((count = body.read(bytes)) != -1) {
                        if (data.size() + count > BODY_LIMIT) throw new IOException("Response too large");
                        data.write(bytes, 0, count);
                    }
                }
            }
            JSONArray replyHeaders = new JSONArray();
            for (Map.Entry<String, java.util.List<String>> header : connection.getHeaderFields().entrySet()) {
                if (header.getKey() != null) for (String value : header.getValue())
                    replyHeaders.put(new JSONArray().put(header.getKey()).put(value));
            }
            return new JSONObject().put("ok", true).put("status", status)
                .put("statusText", connection.getResponseMessage() == null ? "" : connection.getResponseMessage()).put("body", data.toString("UTF-8"))
                .put("headers", replyHeaders);
        } catch (IOException error) {
            return new JSONObject().put("ok", false).put("error", "Page request failed: " + error.getMessage());
        } finally { if (connection != null) connection.disconnect(); }
    }

    private JSONObject find(JSONObject node, String id) {
        if (node == null) return null;
        if (id.equals(node.optString("id"))) return node;
        JSONArray children = node.optJSONArray("children");
        if (children != null) for (int i = 0; i < children.length(); i++) {
            JSONObject match = find(children.optJSONObject(i), id);
            if (match != null) return match;
        }
        return null;
    }

    private void send(String id, String event, String value) {
        if (closing) return;
        core.execute(() -> {
            try {
                if (snapshot == null) return;
                JSONObject node = find(snapshot.optJSONObject("tree"), id);
                if (node == null) return;
                String handler = node.getJSONObject("props").optString(event);
                if (handler.isEmpty()) return;
                JSONObject command = new JSONObject().put("type", "event")
                    .put("revision", snapshot.get("revision")).put("handler", handler);
                if (value != null) command.put("value", value);
                write(command);
                receive(event.equals("change"));
            } catch (Exception error) {
                runOnUiThread(() -> showStatus(error.toString()));
            }
        });
    }

    private int dp(int value) { return Math.round(value * getResources().getDisplayMetrics().density); }

    private LinearLayout column() {
        LinearLayout layout = new LinearLayout(this);
        layout.setOrientation(LinearLayout.VERTICAL);
        return layout;
    }

    private void showStatus(String status) {
        if (closing) return;
        content.removeAllViews();
        TextView text = new TextView(this);
        text.setText(status);
        content.addView(text);
    }

    private void render(JSONObject tree) {
        updating = true;
        try {
            content.removeAllViews();
            buttons.clear();
            content.addView(view(tree));
        } finally { updating = false; }
    }

    private void tick() {
        if (closing) return;
        core.execute(() -> {
            try {
                write(new JSONObject().put("type", "tick"));
                receive(false);
            } catch (Exception error) {
                runOnUiThread(() -> showStatus(error.toString()));
            }
        });
    }

    private void updateControls(JSONObject node) {
        Button button = buttons.get(node.optString("id"));
        JSONObject props = node.optJSONObject("props");
        if (button != null && props != null) button.setEnabled(!props.optBoolean("disabled"));
        JSONArray children = node.optJSONArray("children");
        if (children != null) for (int i = 0; i < children.length(); i++) updateControls(children.optJSONObject(i));
    }

    private String text(JSONObject node) {
        JSONObject props = node.optJSONObject("props");
        StringBuilder value = new StringBuilder(props == null ? "" : props.optString("text"));
        JSONArray children = node.optJSONArray("children");
        if (children != null) for (int i = 0; i < children.length(); i++) value.append(text(children.optJSONObject(i)));
        return value.toString();
    }

    private View view(JSONObject node) {
        String id = node.optString("id");
        JSONObject props = node.optJSONObject("props");
        if (props == null) props = new JSONObject();
        String type = node.optString("type");
        View view;
        if (type.equals("Input") || type.equals("TextArea")) {
            EditText field = new EditText(this);
            field.setSingleLine(type.equals("Input"));
            field.setHint(props.optString("placeholder"));
            field.setText(props.optString("value"));
            field.setImeOptions(EditorInfo.IME_ACTION_DONE);
            field.addTextChangedListener(new TextWatcher() {
                @Override public void beforeTextChanged(CharSequence s, int start, int count, int after) {}
                @Override public void onTextChanged(CharSequence s, int start, int before, int count) {
                    if (!updating) send(id, "change", s.toString());
                }
                @Override public void afterTextChanged(Editable editable) {}
            });
            field.setOnEditorActionListener((ignored, action, key) -> {
                if (action != EditorInfo.IME_ACTION_DONE) return false;
                send(id, "submit", null);
                return true;
            });
            view = field;
        } else if (type.equals("Button")) {
            Button button = new Button(this);
            button.setText(text(node));
            button.setAllCaps(false);
            button.setOnClickListener(ignored -> send(id, "press", null));
            buttons.put(id, button);
            view = button;
        } else if (type.equals("Heading") || type.equals("Text") || type.equals("Label")) {
            TextView label = new TextView(this);
            label.setText(text(node));
            label.setTextSize(type.equals("Heading") ? 28 : 16);
            if (type.equals("Heading")) label.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
            label.setPadding(0, dp(6), 0, dp(6));
            view = label;
        } else {
            LinearLayout layout = column();
            JSONObject style = props.optJSONObject("style");
            JSONArray children = node.optJSONArray("children");
            boolean row = style != null && style.optString("flexDirection").equals("row") &&
                children != null && children.length() < 5;
            if (row) { layout.setOrientation(LinearLayout.HORIZONTAL); layout.setGravity(Gravity.CENTER_VERTICAL); }
            if (children != null) for (int i = 0; i < children.length(); i++) {
                View child = view(children.optJSONObject(i));
                if (row) layout.addView(child, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));
                else layout.addView(child);
            }
            view = layout;
        }
        if (props.has("aria-label")) view.setContentDescription(props.optString("aria-label"));
        view.setEnabled(!props.optBoolean("disabled"));
        return view;
    }

    @Override protected void onDestroy() {
        closing = true;
        timers.removeCallbacksAndMessages(null);
        if (client != null) client.destroy();
        core.shutdownNow();
        super.onDestroy();
    }
}
