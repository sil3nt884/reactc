#!/bin/sh
# Installs tools/local: the C toolchain reactc runs.
# - GCC 15 for Linux targets and MinGW-w64 (POSIX threads) for Windows
#   targets, plus cmake, ninja, make and the development libraries reactc
#   links (libuv, OpenSSL, zlib, Brotli, zstd). They are extracted from Ubuntu
#   26.04 packages into a relocatable sysroot (tools/local/sysroot).
# - Wrapper scripts in tools/local/bin (cc, c++, x86_64-w64-mingw32-*).
# - Node 22 for the build scripts (tools/local/node-v22.16.0-linux-x64).
#
# Run it on Ubuntu 26.04: WSL on Windows, a Linux machine, or a container
# (CI uses ubuntu:26.04). It writes only under tools/local, and uses
# `apt-get download` and `dpkg -x`, so it needs no root once the package
# lists exist (`sudo apt-get update` first on a fresh system).
#
#   sh tools/install-toolchain.sh
#   REACTC_TOOLS_LOCAL=/elsewhere sh tools/install-toolchain.sh
set -eu

tool_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
local_dir=${REACTC_TOOLS_LOCAL:-$tool_dir/local}
node_version=v22.16.0
node_sha256=f4cb75bb036f0d0eddf6b79d9596df1aaab9ddccd6a20bf489be5abe9467e84e

. /etc/os-release
if [ "${VERSION_ID:-}" != "26.04" ] && [ -z "${REACTC_ANY_DISTRO:-}" ]; then
  echo "install-toolchain.sh expects Ubuntu 26.04 (found ${PRETTY_NAME:-unknown})." >&2
  echo "Executables built by its compilers need a glibc this new. Set REACTC_ANY_DISTRO=1 to try anyway." >&2
  exit 1
fi

packages='
  binutils binutils-x86-64-linux-gnu libbinutils libctf0 libctf-nobfd0 libsframe3 libjansson4
  cpp-15-x86-64-linux-gnu gcc-15-x86-64-linux-gnu g++-15-x86-64-linux-gnu gcc-15-base
  libgcc-15-dev libstdc++-15-dev libgcc-s1 libstdc++6 libc6 libc6-dev linux-libc-dev
  libisl23 libmpc3 libmpfr6 libgmp10 zlib1g libzstd1
  binutils-mingw-w64-x86-64 gcc-mingw-w64-base gcc-mingw-w64-x86-64-posix
  gcc-mingw-w64-x86-64-posix-runtime g++-mingw-w64-x86-64-posix mingw-w64-common mingw-w64-x86-64-dev
  cmake cmake-data make ninja-build libarchive13t64 libjsoncpp26 librhash1 libuv1t64 libxml2-16 libexpat1
  libuv1-dev libssl-dev zlib1g-dev libbrotli-dev libbrotli1 libzstd-dev
'

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

echo "Downloading Ubuntu packages..."
(cd "$work" && apt-get download $packages)

echo "Extracting into $local_dir/sysroot..."
rm -rf "$local_dir/sysroot" "$local_dir/bin"
mkdir -p "$local_dir/sysroot" "$local_dir/bin"
for deb in "$work"/*.deb; do dpkg -x "$deb" "$local_dir/sysroot"; done

# Documentation is not needed to compile, and Debian's doc symlinks point at
# absolute paths that do not exist here. Absolute symlinks are made relative
# to the sysroot, and any left dangling are removed, so the release packager
# can copy the tree with symlinks resolved (for zip archives).
sysroot="$local_dir/sysroot"
rm -rf "$sysroot/usr/share/doc" "$sysroot/usr/share/man" "$sysroot/usr/share/info" "$sysroot/usr/share/locale" \
  "$sysroot/usr/share/lintian" "$sysroot/usr/share/bug"
# Kernel netfilter headers include names that differ only in case
# (xt_connmark.h, xt_CONNMARK.h), which collide when the Windows package is
# unpacked on a case-insensitive filesystem. reactc never uses them.
rm -rf "$sysroot"/usr/include/linux/netfilter*
dupes=$(cd "$sysroot" && find . | tr 'A-Z' 'a-z' | sort | uniq -d | head -5)
if [ -n "$dupes" ]; then
  echo "Names that differ only in case remain in the sysroot:" >&2
  echo "$dupes" >&2
  exit 1
fi
find "$sysroot" -type l | while read -r link; do
  target=$(readlink "$link")
  case "$target" in
    /*) if [ -e "$sysroot$target" ]; then
          ln -sfn "$(realpath --relative-to="$(dirname "$link")" "$sysroot$target")" "$link"
        else
          rm -f "$link"
        fi ;;
  esac
done
find "$sysroot" -xtype l -delete

# glibc's linker scripts (libc.so, libm.so) name absolute paths such as
# /lib64/ld-linux-x86-64.so.2. Point them inside the sysroot with ld's "="
# prefix, so no lib/lib64 symlinks are needed.
for script in $(grep -lI 'GNU ld script' "$local_dir"/sysroot/usr/lib/x86_64-linux-gnu/*.so 2>/dev/null); do
  sed -i \
    -e 's#\([ (]\)/lib64/#\1=/usr/lib/x86_64-linux-gnu/#g' \
    -e 's#\([ (]\)/usr/lib/x86_64-linux-gnu/#\1=/usr/lib/x86_64-linux-gnu/#g' \
    -e 's#\([ (]\)/lib/x86_64-linux-gnu/#\1=/usr/lib/x86_64-linux-gnu/#g' \
    "$script"
done

# The wrappers find the sysroot next to them, so tools/local can move.
wrapper() {
  name=$1
  shift
  {
    echo '#!/bin/sh'
    echo 'root=$(CDPATH= cd -- "$(dirname -- "$0")/../sysroot" && pwd)'
    echo 'export LD_LIBRARY_PATH="$root/usr/lib/x86_64-linux-gnu${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"'
    echo "exec $*"
  } > "$local_dir/bin/$name"
  chmod +x "$local_dir/bin/$name"
}
gcc_flags='--sysroot="$root" -B"$root/usr/bin/" -B"$root/usr/lib/gcc/x86_64-linux-gnu/15/"'
wrapper cc "\"\$root/usr/bin/x86_64-linux-gnu-gcc-15\" $gcc_flags -L\"\$root/usr/lib/x86_64-linux-gnu\" \"\$@\""
wrapper c++ "\"\$root/usr/bin/x86_64-linux-gnu-g++-15\" $gcc_flags \"\$@\""
wrapper x86_64-w64-mingw32-gcc '"$root/usr/bin/x86_64-w64-mingw32-gcc-posix" "$@"'
wrapper x86_64-w64-mingw32-g++ '"$root/usr/bin/x86_64-w64-mingw32-g++-posix" "$@"'
for tool in ar nm objcopy objdump windres ranlib; do
  wrapper "x86_64-w64-mingw32-$tool" "\"\$root/usr/bin/x86_64-w64-mingw32-$tool\" \"\$@\""
done
# The native library installers build with these, so the system needs none.
# cmake finds its modules next to its binary in the sysroot.
for tool in cmake ninja make; do
  wrapper "$tool" "\"\$root/usr/bin/$tool\" \"\$@\""
done
wrapper ar '"$root/usr/bin/x86_64-linux-gnu-ar" "$@"'
wrapper ranlib '"$root/usr/bin/x86_64-linux-gnu-ranlib" "$@"'

echo "Installing Node $node_version..."
archive="$work/node.tar.xz"
curl --fail --location --retry 3 "https://nodejs.org/dist/$node_version/node-$node_version-linux-x64.tar.xz" -o "$archive"
printf '%s  %s\n' "$node_sha256" "$archive" | sha256sum --check --quiet
rm -rf "$local_dir/node-$node_version-linux-x64"
tar -xJf "$archive" -C "$local_dir"

echo "Checking the compilers..."
printf '#include <stdio.h>\nint main(void) { puts("ok"); return 0; }\n' > "$work/hello.c"
"$local_dir/bin/cc" -O2 "$work/hello.c" -o "$work/hello"
"$work/hello"
"$local_dir/bin/x86_64-w64-mingw32-gcc" -O2 -static "$work/hello.c" -o "$work/hello.exe"
test -s "$work/hello.exe"
echo "tools/local is ready: $local_dir"
