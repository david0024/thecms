#!/bin/sh
# Installs thecms from its GitHub releases, checked against the release's
# checksums before anything is put in place.
#
# On your own computer (Linux or macOS), into ~/.local/bin:
#
#   curl -fsSL https://github.com/david0024/thecms/releases/latest/download/install.sh | sh
#
# On a Linux server, as root: the program in /usr/local/bin, a system user, the
# site in /var/lib/thecms, and a systemd service that serves the editor at your
# address. It prints the link that makes the first owner's account.
#
#   curl -fsSL https://github.com/david0024/thecms/releases/latest/download/install.sh \
#     | sh -s -- --server --public=https://cms.example.com
#
# Options: --server, --public=URL, --port=4321, --database=postgres://... (the
# site in a database server instead of a SQLite file), --version=0.1.0.
# Run again to update; the site is left as it is.
set -eu

# The product's name, as in src/core/name.ts (a test keeps them the same).
NAME=thecms
REPOSITORY=david0024/thecms

server=no
public=
port=4321
database=
version=latest
for arg in "$@"; do
  case "$arg" in
    --server) server=yes ;;
    --public=*) public=${arg#--public=} ;;
    --port=*) port=${arg#--port=} ;;
    --database=*) database=${arg#--database=} ;;
    --version=*) version=${arg#--version=} ;;
    *) echo "$NAME install: unknown option $arg" >&2; exit 2 ;;
  esac
done

fail() {
  echo "$NAME install: $*" >&2
  exit 1
}

case "$(uname -s)" in
  Linux) os=linux ;;
  Darwin) os=darwin ;;
  *) fail "this script is for Linux and macOS; on Windows, use install.ps1" ;;
esac
case "$(uname -m)" in
  x86_64 | amd64) arch=x64 ;;
  aarch64 | arm64) arch=arm64 ;;
  *) fail "no release for $(uname -m)" ;;
esac
file="$NAME-$os-$arch"

if [ "$server" = yes ]; then
  [ "$os" = linux ] || fail "--server is for a Linux server with systemd"
  case "$public" in
    https://*) ;;
    *) fail "--server needs the address people will open, like --public=https://cms.example.com" ;;
  esac
  [ "$(id -u)" = 0 ] || fail "--server sets up a service; run it as root (sudo sh -s -- --server ...)"
  command -v systemctl >/dev/null 2>&1 || fail "--server needs systemd"
fi

# Where the files are: the release on GitHub, or a folder of them (RELEASE_URL, to try a build).
if [ -n "${RELEASE_URL:-}" ]; then
  base=$RELEASE_URL
elif [ "$version" = latest ]; then
  base="https://github.com/$REPOSITORY/releases/latest/download"
else
  base="https://github.com/$REPOSITORY/releases/download/v${version#v}"
fi

download() {
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL "$1" -o "$2"
  elif command -v wget >/dev/null 2>&1; then
    wget -q "$1" -O "$2"
  else
    fail "needs curl or wget"
  fi
}

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
echo "Downloading $file..."
download "$base/$file" "$work/$file" || fail "could not download $base/$file"
download "$base/checksums.sha256" "$work/checksums.sha256" || fail "could not download the checksums"

# The file must be the one the release lists, byte for byte.
expected=$(awk -v f="$file" '$2 == f { print $1 }' "$work/checksums.sha256")
[ -n "$expected" ] || fail "the release lists no checksum for $file"
if command -v sha256sum >/dev/null 2>&1; then
  actual=$(sha256sum "$work/$file" | awk '{ print $1 }')
else
  actual=$(shasum -a 256 "$work/$file" | awk '{ print $1 }')
fi
[ "$actual" = "$expected" ] || fail "$file does not match its checksum; nothing was installed"

if [ "$server" = yes ]; then
  bin_dir=/usr/local/bin
else
  bin_dir=${INSTALL_DIR:-$HOME/.local/bin}
fi
mkdir -p "$bin_dir"
chmod 755 "$work/$file"
# Moved in whole: a program that is running keeps the file it started from.
mv "$work/$file" "$bin_dir/$NAME.new"
mv "$bin_dir/$NAME.new" "$bin_dir/$NAME"
if [ "$os" = darwin ] && command -v codesign >/dev/null 2>&1; then
  codesign --force --sign - "$bin_dir/$NAME" >/dev/null 2>&1 || true
fi
echo "Installed $("$bin_dir/$NAME" version) in $bin_dir."

if [ "$server" = no ]; then
  case ":$PATH:" in
    *":$bin_dir:"*) ;;
    *) echo "Add $bin_dir to your PATH, or run it as $bin_dir/$NAME." ;;
  esac
  echo "In a folder for your site, run: $NAME"
  exit 0
fi

# The server: a user of its own, the site in its home, settings readable only by root and the service.
home=/var/lib/$NAME
id "$NAME" >/dev/null 2>&1 || useradd --system --home-dir "$home" --shell /usr/sbin/nologin "$NAME"
mkdir -p "$home" "/etc/$NAME"
chown "$NAME:$NAME" "$home"
chmod 750 "$home"
site=${database:-$home/site.db}
umask 077
cat >"/etc/$NAME/env" <<EOF
THECMS_SITE=$site
THECMS_PUBLIC=$public
THECMS_EXTENSION_RUNNER=/run/$NAME-extensions/runner.sock
EOF
chown "root:$NAME" "/etc/$NAME/env"
chmod 640 "/etc/$NAME/env"
umask 022

as_service() {
  if command -v runuser >/dev/null 2>&1; then runuser -u "$NAME" -- "$@"; else su -s /bin/sh "$NAME" -c "$*"; fi
}
(cd "$home" && as_service "$bin_dir/$NAME" init "$site" --if-new)

cat >"/etc/systemd/system/$NAME.service" <<EOF
[Unit]
Description=$NAME, the editor of the site at $public
After=network-online.target
Wants=network-online.target

[Service]
User=$NAME
Group=$NAME
WorkingDirectory=$home
EnvironmentFile=/etc/$NAME/env
ExecStart=$bin_dir/$NAME --port=$port
Restart=on-failure
NoNewPrivileges=yes
ProtectSystem=strict
ProtectHome=yes
PrivateTmp=yes
ReadWritePaths=$home

[Install]
WantedBy=multi-user.target
EOF
# Extensions (ADR 0026): each runs where systemd starts it for a connection to this socket, which only the
# service may open: under a user made for that run, with no network, and no way into the site or its settings.
cat >"/etc/systemd/system/$NAME-extensions.socket" <<EOF
[Unit]
Description=Where $NAME runs the code of its extensions

[Socket]
ListenStream=/run/$NAME-extensions/runner.sock
Accept=yes
SocketUser=$NAME
SocketGroup=$NAME
SocketMode=0600
DirectoryMode=0755

[Install]
WantedBy=sockets.target
EOF
cat >"/etc/systemd/system/$NAME-extensions@.service" <<EOF
[Unit]
Description=The code of one $NAME extension

[Service]
ExecStart=$bin_dir/$NAME __extension-runner
StandardInput=socket
StandardOutput=socket
StandardError=journal
DynamicUser=yes
PrivateNetwork=yes
PrivateTmp=yes
ProtectSystem=strict
ProtectHome=yes
InaccessiblePaths=-$home -/etc/$NAME
NoNewPrivileges=yes
ProtectKernelTunables=yes
ProtectKernelModules=yes
ProtectControlGroups=yes
RestrictAddressFamilies=AF_UNIX
MemoryMax=512M
TasksMax=64
EOF
systemctl daemon-reload
systemctl enable --now "$NAME-extensions.socket" >/dev/null 2>&1
systemctl enable "$NAME" >/dev/null 2>&1
systemctl restart "$NAME"

echo
echo "The editor runs on 127.0.0.1:$port. Point the web server that holds the certificate at it; with Caddy:"
echo
echo "  ${public#https://} {"
echo "    reverse_proxy 127.0.0.1:$port"
echo "  }"
echo
# A new link, after the service started, so the one it printed is not the one that counts.
if ! (cd "$home" && as_service "$bin_dir/$NAME" setup-link "$site" --public="$public" 2>/dev/null); then
  echo "Sign in at $public/admin/ with your account."
fi
