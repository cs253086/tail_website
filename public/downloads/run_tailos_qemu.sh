#!/usr/bin/env bash
# TailOS QEMU one-command launcher.
#
# Downloads the prebuilt TailOS kernel (tail_qemu.rfs) and data disk
# (tail_disk.img), verifies them against the published checksums, and boots
# them in QEMU.
#
# Usage:
#   # Run remotely:
#   curl -sSL https://tail-os.com/downloads/run_tailos_qemu.sh | bash
#
#   # Or locally:
#   ./scripts/run_tailos_qemu.sh
#
# Environment overrides:
#   BASE_URL     Where the images and SHA256SUMS are published
#                (default: https://tail-os.com/downloads)
#   CACHE_DIR    Where images are cached (default: ~/.cache/tailos)
#
# Exit with Ctrl-A then X from inside QEMU.

set -euo pipefail

BASE_URL="${BASE_URL:-https://tail-os.com/downloads}"
CACHE_DIR="${CACHE_DIR:-$HOME/.cache/tailos}"

say() { printf '==> %s\n' "$*"; }
die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }

say "TailOS QEMU launcher"

command -v qemu-system-aarch64 >/dev/null 2>&1 \
    || die "qemu-system-aarch64 not found. Install with: sudo apt-get install -y qemu-system-aarch64 qemu-utils"
command -v gzip >/dev/null 2>&1 || die "gzip not found"

if command -v sha256sum >/dev/null 2>&1; then
    sha256() { sha256sum "$1" | cut -d' ' -f1; }
elif command -v shasum >/dev/null 2>&1; then
    sha256() { shasum -a 256 "$1" | cut -d' ' -f1; }
else
    die "need sha256sum or shasum to verify the images"
fi

download() {
    local url="$1" dest="$2"
    if command -v curl >/dev/null 2>&1; then
        curl -fsSL "$url" -o "$dest"
    elif command -v wget >/dev/null 2>&1; then
        wget -q "$url" -O "$dest"
    else
        die "need curl or wget to download images"
    fi
}

mkdir -p "$CACHE_DIR"
# Downloads land here first. It is inside the cache directory so the final move
# is a rename on one filesystem: a file appears in the cache whole or not at all.
work="$(mktemp -d "$CACHE_DIR/.download.XXXXXX")"
trap 'rm -rf "$work"' EXIT

# Fetched on every run. The images keep stable names across rebuilds, so a cache
# that trusted any file already present would boot the first image it ever
# downloaded forever -- and would equally trust one a dropped connection had cut
# short. A file counts as cached only once it has been verified against the
# published checksum, and only while that checksum is still the published one.
download "$BASE_URL/SHA256SUMS" "$work/SHA256SUMS"

expected() {
    awk -v name="$1" '$2 == name { print $1 }' "$work/SHA256SUMS"
}

ensure() {
    local name="$1" path="$CACHE_DIR/$1" want
    want="$(expected "$name")"
    [[ -n "$want" ]] || die "SHA256SUMS does not list $name"

    # The stamp records the checksum a cached file was verified against, and is
    # compared instead of re-hashing the file. QEMU writes to the disk image while
    # the guest runs, so hashing it would throw the guest's changes away on every
    # launch; comparing stamps replaces the file only when a new image is published.
    if [[ -f "$path" && -f "$path.sha256" && "$(cat "$path.sha256")" == "$want" ]]; then
        printf '    cached: %s\n' "$path"
        return
    fi

    printf '    fetching %s\n' "$BASE_URL/$name.gz"
    download "$BASE_URL/$name.gz" "$work/$name.gz"
    # gzip fails the same way for a download cut short and for a disk that fills while
    # unpacking; its own message, printed just above, says which.
    gzip -dc "$work/$name.gz" > "$work/$name" \
        || die "could not unpack $name.gz (see the error above); nothing was cached"
    [[ "$(sha256 "$work/$name")" == "$want" ]] \
        || die "$name does not match its published checksum; nothing was cached"
    mv -f "$work/$name" "$path"
    printf '%s\n' "$want" > "$path.sha256"
}

say "Ensuring images in $CACHE_DIR"
ensure tail_qemu.rfs
ensure tail_disk.img

# exec replaces this shell, so the EXIT trap would never run.
rm -rf "$work"
trap - EXIT

say "Booting TailOS (exit with Ctrl-A then X)"
# The same NIC `make run` attaches: a USB network device on the dwc2 controller,
# behind QEMU's user-mode networking, which needs no privileges on the host. Without
# it the USB root port is empty, and the guest reports "[FAIL] usb no device on the
# root port" and refuses its default route on every boot.
qemu=(qemu-system-aarch64
    -M raspi3b
    -kernel "$CACHE_DIR/tail_qemu.rfs"
    -serial mon:stdio
    -drive "file=$CACHE_DIR/tail_disk.img,format=raw,if=sd"
    -netdev user,id=tailnet0
    -device usb-net,netdev=tailnet0)

# `curl … | bash` leaves this script's stdin as the download pipe, and QEMU would
# inherit it: the guest boots to its prompt, but nothing typed reaches it and Ctrl-A X
# cannot quit. When there is a terminal, QEMU is given that instead. Only QEMU's stdin
# is redirected -- bash is still reading the rest of this script from the pipe, and
# an `exec </dev/tty` would make it wait for the remaining lines to be typed. The
# whole if-block is parsed before any of it runs, so it is safe to read from a pipe.
if [[ ! -t 0 ]] && { : </dev/tty; } 2>/dev/null; then
    exec "${qemu[@]}" </dev/tty
fi
exec "${qemu[@]}"
