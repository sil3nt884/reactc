#!/bin/sh
set -eu

tool_dir="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
case "${1:-}" in
  '') target=host; cc="${CC:-cc}"; cxx="${CXX:-c++}"; ar="${AR:-ar}" ;;
  --windows)
    target=win
    cross=${WINDOWS_BIN_PREFIX:-x86_64-w64-mingw32-}
    cc="${WINDOWS_CC:-${cross}gcc}"; cxx="${WINDOWS_CXX:-${cross}g++}"; ar="${cross}ar"
    ;;
  *) echo 'Usage: sh tools/install-node-libs.sh [--windows]' >&2; exit 2 ;;
esac
cc="$(command -v "$cc")"
cxx="$(command -v "$cxx")"
ar="$(command -v "$ar")"

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
jobs="${JOBS:-4}"
prefix="$work/install"
mkdir -p "$prefix/lib" "$prefix/include" "$prefix/notices"

checkout() {
  git init -q "$work/$1"
  git -C "$work/$1" fetch --quiet --depth=1 "$2" "$3"
  git -C "$work/$1" checkout --quiet --detach FETCH_HEAD
}

windows_cmake() {
  source_dir="$1"; build_dir="$2"; shift 2
  cmake -G Ninja -S "$source_dir" -B "$build_dir" -DCMAKE_SYSTEM_NAME=Windows \
    -DCMAKE_C_COMPILER="$cc" -DCMAKE_CXX_COMPILER="$cxx" -DCMAKE_AR="$ar" \
    -DCMAKE_INSTALL_PREFIX="$prefix" -DCMAKE_INSTALL_LIBDIR=lib \
    -DCMAKE_BUILD_TYPE=Release -DBUILD_SHARED_LIBS=OFF "$@"
}

if [ "$target" = win ]; then
  checkout uv https://github.com/libuv/libuv.git 5152db2cbfeb5582e9c27c5ea1dba2cd9e10759b
  checkout zlib https://github.com/madler/zlib.git 51b7f2abdade71cd9bb0e7a373ef2610ec6f9daf
  checkout brotli https://github.com/google/brotli.git ed738e842d2fbdf2d6459e39267a633c4a9b2f5d
  checkout zstd https://github.com/facebook/zstd.git f8745da6ff1ad1e7bab384bd1f9d742439278e99
  checkout openssl https://github.com/openssl/openssl.git 67b5686b4419b4cb8caa502711c41815f5279751
  windows_cmake "$work/uv" "$work/build-uv" -DLIBUV_BUILD_SHARED=OFF -DLIBUV_BUILD_TESTS=OFF
  cmake --build "$work/build-uv" --parallel "$jobs"
  cmake --install "$work/build-uv"
  windows_cmake "$work/zlib" "$work/build-zlib" -DZLIB_BUILD_EXAMPLES=OFF
  cmake --build "$work/build-zlib" --target zlibstatic --parallel "$jobs"
  cp "$work/build-zlib/libzlibstatic.a" "$prefix/lib/libz.a"
  cp "$work/zlib/zlib.h" "$work/build-zlib/zconf.h" "$prefix/include/"
  windows_cmake "$work/brotli" "$work/build-brotli" -DBROTLI_DISABLE_TESTS=ON
  cmake --build "$work/build-brotli" --parallel "$jobs"
  cmake --install "$work/build-brotli"
  windows_cmake "$work/zstd/build/cmake" "$work/build-zstd" -DZSTD_BUILD_SHARED=OFF \
    -DZSTD_BUILD_PROGRAMS=OFF -DZSTD_BUILD_TESTS=OFF
  cmake --build "$work/build-zstd" --parallel "$jobs"
  cmake --install "$work/build-zstd"
  (
    cd "$work/openssl"
    CC="$cc" AR="$ar" RANLIB="${cross}ranlib" perl Configure mingw64 --prefix="$prefix" --libdir=lib \
      no-shared no-tests no-apps no-docs no-module no-quic
    make -j "$jobs" build_libs
    make install_dev
  )
  cp "$work/uv/LICENSE" "$prefix/notices/libuv.txt"
  cp "$work/uv/LICENSE-extra" "$prefix/notices/libuv-extra.txt"
  cp "$work/zlib/LICENSE" "$prefix/notices/zlib.txt"
  cp "$work/brotli/LICENSE" "$prefix/notices/brotli.txt"
  cp "$work/zstd/LICENSE" "$prefix/notices/zstd.txt"
  cp "$work/openssl/LICENSE.txt" "$prefix/notices/openssl.txt"
fi

checkout porffor https://github.com/CanadaHonk/porffor.git a081ebd71177b898b2859298376e3191f088af32
checkout uws https://github.com/uNetworking/uWebSockets.git 360c276d609d59af56ae6932adb95154ace9f15f
git -C "$work/uws" submodule update --init --depth=1 uSockets
for change in "$work"/porffor/compiler/uwebsockets/*.patch; do
  git -C "$work/uws" apply "$change"
done
mkdir "$work/objects"
socket_source="$work/uws/uSockets/src"
for source in "$socket_source"/*.c "$socket_source"/eventing/*.c "$socket_source"/crypto/*.c "$socket_source"/crypto/*.cpp; do
  case "$source" in
    *.cpp) compiler="$cxx"; language=-std=c++17 ;;
    *) compiler="$cc"; language=-std=gnu11 ;;
  esac
  "$compiler" "$language" -O2 -D_GNU_SOURCE -D_WIN32_WINNT=0x0A00 \
    -DLIBUS_USE_LIBUV -DLIBUS_USE_OPENSSL -I"$prefix/include" -I"$socket_source" \
    -c "$source" -o "$work/objects/$(basename "$source").o"
done
"$ar" rcs "$prefix/lib/libusockets.a" "$work"/objects/*.o
cp -R "$work/uws/src" "$prefix/include/uws"
mkdir "$prefix/include/usockets"
cp "$socket_source/libusockets.h" "$prefix/include/usockets/"
cp "$work/uws/LICENSE" "$prefix/notices/uWebSockets.txt"
cp "$work/uws/uSockets/LICENSE" "$prefix/notices/uSockets.txt"
mkdir -p "$tool_dir/node-$target"
cp -R "$prefix"/. "$tool_dir/node-$target/"
