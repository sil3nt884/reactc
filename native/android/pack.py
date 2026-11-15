"""Package a reactc page as a signed Android arm64 APK."""
import hashlib
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
from xml.sax.saxutils import escape, quoteattr
from zipfile import ZIP_DEFLATED, ZipFile


def run(*command):
    subprocess.run(command, check=True)


def required(path, description):
    if not path.is_file():
        raise ValueError(f"{description} missing at {path}")
    return path


def sdk_tools(sdk):
    override = os.environ.get("REACTC_ANDROID_BUILD_TOOLS")
    if override:
        return Path(override)
    versions = [
        (tuple(map(int, folder.name.split("."))), folder)
        for folder in (sdk / "build-tools").glob("*")
        if re.fullmatch(r"\d+\.\d+\.\d+", folder.name) and (folder / "aapt2").is_file()
    ]
    if not versions:
        raise ValueError(f"install Android SDK Build-Tools under {sdk}")
    return max(versions)[1]


def signing_key():
    custom = os.environ.get("REACTC_ANDROID_KEYSTORE")
    if custom:
        if not os.environ.get("REACTC_ANDROID_KEY_ALIAS") or not os.environ.get("REACTC_ANDROID_KS_PASS"):
            raise ValueError("set REACTC_ANDROID_KEY_ALIAS and REACTC_ANDROID_KS_PASS with a custom keystore")
        return Path(custom), os.environ["REACTC_ANDROID_KEY_ALIAS"], "env:REACTC_ANDROID_KS_PASS"

    path = Path.home() / ".android" / "debug.keystore"
    if not path.exists():
        path.parent.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(dir=path.parent) as stage:
            candidate = Path(stage) / "debug.keystore"
            run("keytool", "-genkeypair", "-keystore", candidate, "-storepass", "android",
                "-alias", "androiddebugkey", "-keypass", "android", "-keyalg", "RSA", "-keysize", "2048",
                "-validity", "10000", "-dname", "CN=Android Debug,O=Android,C=US")
            try:
                os.link(candidate, path)
            except FileExistsError:
                pass
    return path, "androiddebugkey", "pass:android"


def pack(module, output, name, title, origin, root):
    sdk_path = os.environ.get("ANDROID_HOME") or os.environ.get("ANDROID_SDK_ROOT")
    if not sdk_path:
        raise ValueError("set ANDROID_HOME to the Linux Android SDK")
    sdk = Path(sdk_path)
    tools = sdk_tools(sdk)
    platform = required(sdk / "platforms/android-35/android.jar", "Android SDK platform 35")
    for command in ("java", "javac", "keytool"):
        if not shutil.which(command):
            raise ValueError(f"{command} is missing from PATH; install JDK 17 or newer")
    aapt2, d8, align, signer = [
        required(tools / command, f"Android SDK Build-Tools {command}")
        for command in ("aapt2", "d8", "zipalign", "apksigner")
    ]
    wasmtime = required(root / "tools/wasmtime-pack-linux/wasmtime",
                        "Wasmtime for Android compilation (run sh tools/install-wasmtime.sh linux)")
    runtime = Path(os.environ.get("REACTC_ANDROID_RUNTIME", root / "dist/wasm-runtime/android/reactc-runtime"))
    if not runtime.is_file() and "REACTC_ANDROID_RUNTIME" not in os.environ:
        run("sh", root / "native/wasm/build.sh", "android")
    required(runtime, "Android WASM runtime")
    license_file = required(runtime.with_name("Wasmtime-LICENSE"), "Wasmtime license")
    slug = re.sub(r"[^a-z0-9]+", "_", name.lower()).strip("_")[:40]
    suffix = hashlib.sha256(name.encode()).hexdigest()[:10]
    app_id = os.environ.get("REACTC_ANDROID_APPLICATION_ID", f"dev.reactc.app_{slug}_{suffix}")
    if not re.fullmatch(r"[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)+", app_id):
        raise ValueError("invalid Android application ID")
    key, alias, password = signing_key()

    with tempfile.TemporaryDirectory(prefix=".reactc-apk-", dir=output.parent) as stage:
        work = Path(stage)
        classes = work / "classes"
        dex = work / "dex"
        classes.mkdir()
        dex.mkdir()
        native = work / "page.cwasm"
        unsigned, aligned, signed = [work / base for base in ("unsigned.apk", "aligned.apk", "signed.apk")]
        manifest = work / "AndroidManifest.xml"
        manifest.write_text(f"""<manifest xmlns:android="http://schemas.android.com/apk/res/android"
    package={quoteattr(app_id)} android:versionCode="1" android:versionName="1.0">
  <uses-sdk android:minSdkVersion="26" android:targetSdkVersion="35"/>
  <uses-permission android:name="android.permission.INTERNET"/>
  <application android:label="@string/app_name" android:extractNativeLibs="true"
      android:usesCleartextTraffic="{str(origin.startswith('http:')).lower()}"
      android:theme="@android:style/Theme.Material.Light.NoActionBar">
    <activity android:name="dev.reactc.host.MainActivity" android:exported="true"
        android:configChanges="keyboardHidden|orientation|screenSize">
      <intent-filter>
        <action android:name="android.intent.action.MAIN"/>
        <category android:name="android.intent.category.LAUNCHER"/>
      </intent-filter>
    </activity>
  </application>
</manifest>
""", encoding="utf-8")
        # Escape Android resource syntax in the application caption.
        label = title.replace("\\", "\\\\").replace('"', '\\"').replace("\n", "\\n")
        res = work / "res"
        values = res / "values"
        values.mkdir(parents=True)
        (values / "strings.xml").write_text(
            f'<resources><string name="app_name">"{escape(label)}"</string></resources>\n', encoding="utf-8")
        resources = work / "resources.zip"
        run(wasmtime, "compile", "-C", "collector=drc", "-W", "exceptions=y", "-O", "opt-level=0",
            "--target", "aarch64-linux-android", module, "-o", native)
        run("javac", "--release", "8", "-cp", platform, "-d", classes, root / "native/android/MainActivity.java")
        run(d8, "--min-api", "26", "--lib", platform, "--output", dex, *sorted(classes.rglob("*.class")))
        run(aapt2, "compile", "--dir", res, "-o", resources)
        run(aapt2, "link", "-I", platform, "--manifest", manifest, "-o", unsigned, resources)
        with ZipFile(unsigned, "a", compression=ZIP_DEFLATED) as apk:
            apk.write(dex / "classes.dex", "classes.dex")
            apk.write(runtime, "lib/arm64-v8a/libreactc_runtime.so")
            apk.write(native, "assets/page.cwasm")
            apk.write(license_file, "assets/Wasmtime-LICENSE")
            apk.writestr("assets/http-origin", origin)
        run(align, "-f", "-P", "16", "4", unsigned, aligned)
        run(signer, "sign", "--ks", key, "--ks-key-alias", alias, "--ks-pass", password, "--out", signed, aligned)
        run(signer, "verify", signed)
        os.replace(signed, output)


if __name__ == "__main__":
    module, output, name, title, origin, root = sys.argv[1:]
    try:
        pack(Path(module), Path(output), name, title, origin, Path(root))
    except (OSError, ValueError, subprocess.CalledProcessError) as error:
        sys.exit(f"Android package: {error}")
