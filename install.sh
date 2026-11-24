#!/bin/sh
# Installs Uhlaka from its GitHub releases, checked against the release's
# checksums before anything is put in place (ADR 0023). It asks, one step at a
# time, where the site will live and what it needs there (ADR 0048):
#
#   curl -fsSL https://github.com/uhlaka-devs/uhlaka/releases/download/v0.1.0-alpha.9/install.sh | sh
#
# - This computer, to try it: the program in ~/.local/bin, the site in a file.
# - A server of yours (Linux with systemd), as root: the program in /usr/local/bin,
#   a system user, the database and Valkey installed and listening only there (or
#   a database of yours, tested before anything is written), and a systemd service
#   that serves the site and its editor at your address.
# - Docker: a folder with compose.yaml, the program's Dockerfile and its settings,
#   the database and Valkey beside it.
# - A ready platform (Railway, Render, Fly.io): where to read how.
# The site's name, the owner's account and the language are chosen in the browser,
# on the first page, through the link the installer prints.
#
# Every question has an option that answers it, so a script asks nothing:
#
#   curl -fsSL .../install.sh | sh -s -- --host=server --database=postgres --public=https://cms.example.com
#
# Options:
#   --host=computer|server|docker|platform    where the site lives (--server is --host=server)
#   --database=sqlite|postgres|mysql|mariadb  installed for the site; or the address of yours,
#                                             postgres://user:password@host:5432/name or mysql://...
#   --public=URL     the address people will open (https://, or http://localhost for Docker)
#   --port=4321      where the site listens on this machine
#   --no-valkey      no Valkey; each process keeps its own pages and counters
#   --version=X      this release; without it, the newest, pre-releases too
#   --yes            ask nothing; what is not given is the default
# Run again to update; the site is left as it is.
set -eu

# The product's name, as in src/core/name.ts (a test keeps them the same).
NAME=uhlaka
REPOSITORY=uhlaka-devs/uhlaka

host=
public=
port=4321
database=
valkey=yes
version=latest
yes=no
for arg in "$@"; do
  case "$arg" in
    --host=*) host=${arg#--host=} ;;
    --server) host=server ;;
    --public=*) public=${arg#--public=} ;;
    --port=*) port=${arg#--port=} ;;
    --database=*) database=${arg#--database=} ;;
    --version=*) version=${arg#--version=} ;;
    --no-valkey) valkey=no ;;
    --yes) yes=yes ;;
    *) echo "$NAME install: unknown option $arg" >&2; exit 2 ;;
  esac
done

fail() {
  echo "$NAME install: $*" >&2
  exit 1
}

# The answers come from the terminal, also when this script comes through a pipe (curl | sh).
# INSTALL_TTY names another file, to try it; with no terminal, or --yes, nothing is asked.
answers=${INSTALL_TTY:-/dev/tty}
can_ask=no
if [ "$yes" = no ] && (: <"$answers") 2>/dev/null; then
  exec 3<"$answers"
  can_ask=yes
fi

# ask <question> [default]: the answer in $reply. False with nobody to answer.
ask() {
  [ "$can_ask" = yes ] || return 1
  if [ -n "${2:-}" ]; then printf '%s [%s]: ' "$1" "$2"; else printf '%s: ' "$1"; fi
  IFS= read -r reply <&3 || { echo; can_ask=no; return 1; }
  [ -n "$reply" ] || reply=${2:-}
}

# ask_secret <question>: as ask, without showing what is typed.
ask_secret() {
  [ "$can_ask" = yes ] || return 1
  printf '%s: ' "$1"
  stty -echo <&3 2>/dev/null || true
  IFS= read -r reply <&3 || { stty echo <&3 2>/dev/null || true; echo; can_ask=no; return 1; }
  stty echo <&3 2>/dev/null || true
  echo
}

# choose <question> <option>...: the number of the one chosen in $choice, the first by default.
choose() {
  question=$1
  shift
  echo
  echo "$question"
  i=1
  for option in "$@"; do
    echo "  $i) $option"
    i=$((i + 1))
  done
  while :; do
    ask "Choose 1-$#" 1 || { choice=1; return 0; }
    case "$reply" in
      *[!0-9]* | '') ;;
      *) if [ "$reply" -ge 1 ] && [ "$reply" -le $# ]; then choice=$reply; return 0; fi ;;
    esac
    echo "Type a number from 1 to $#."
  done
}

# A value in an address (user, password, name), with what is not a letter or digit written as %XX.
urlencode() {
  printf '%s' "$1" | od -An -v -tx1 | awk '
    BEGIN { for (i = 0; i < 256; i++) n[sprintf("%02x", i)] = i }
    { for (f = 1; f <= NF; f++) { c = sprintf("%c", n[$f]); o = o (c ~ /[A-Za-z0-9._~-]/ ? c : "%" toupper($f)) } }
    END { printf "%s", o }'
}

# A password nobody has to type: the site reads it from its settings.
secret() {
  od -An -N18 -tx1 /dev/urandom | tr -d ' \n'
}

say_cpanel() {
  echo "Shared hosting with cPanel runs PHP, not a program that stays running, so $NAME cannot live there."
  echo "A small VPS, Docker, or a ready platform (Railway, Render, Fly.io) can."
}
say_cloudflare() {
  echo "Cloudflare comes with the site running on Workers, in a later version: you will authorise the installer"
  echo "in your browser, and it will make the Worker, the D1 database and the R2 bucket. For now, choose another."
}

# Step 1 (ADR 0048 d1): where the site will live.
while [ -z "$host" ]; do
  if [ "$can_ask" = no ]; then host=computer; break; fi
  choose "Where will the site live?" \
    "Only this computer, to try it" \
    "A server of mine (a VPS, Linux with systemd)" \
    "Docker" \
    "A ready platform (Railway, Render, Fly.io)" \
    "Cloudflare" \
    "Shared hosting with cPanel"
  case "$choice" in
    1) host=computer ;;
    2) host=server ;;
    3) host=docker ;;
    4) host=platform ;;
    5) say_cloudflare ;;
    6) say_cpanel ;;
  esac
done
case "$host" in
  computer | server | docker | platform) ;;
  cloudflare) say_cloudflare >&2; exit 1 ;;
  cpanel) say_cpanel >&2; exit 1 ;;
  *) fail "--host is computer, server, docker or platform, not $host" ;;
esac

if [ "$host" = platform ]; then
  echo "Railway, Render and Fly.io run the $NAME image from GitHub, with a volume for the site and its address as a setting."
  echo "How, for each of them: https://github.com/$REPOSITORY/blob/main/docs/install/platforms.md"
  exit 0
fi

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

if [ "$host" = server ]; then
  [ "$os" = linux ] || fail "a server is Linux with systemd; on this computer, choose 'only this computer' or Docker"
  [ "$(id -u)" = 0 ] || fail "a server is set up as root, since it installs a service: sudo sh -s -- --host=server ..."
  command -v systemctl >/dev/null 2>&1 || fail "a server needs systemd; without it, Docker is the way"
fi

# Run again on a server: its site is kept, and the program updated.
previous_site=
previous_public=
if [ "$host" = server ] && [ -f "/etc/$NAME/env" ]; then
  previous_site=$(sed -n 's/^UHLAKA_SITE=//p' "/etc/$NAME/env")
  previous_public=$(sed -n 's/^UHLAKA_PUBLIC=//p' "/etc/$NAME/env")
  [ -n "$database" ] || database=$previous_site
  [ -n "$public" ] || public=$previous_public
  echo "This server already has a site; the program is updated and the site is left as it is."
fi

# Step 2 (ADR 0048 d2): the database. Installed by default, or one of yours.
own_details() {
  choose "Which database is it?" "PostgreSQL" "MySQL or MariaDB"
  if [ "$choice" = 1 ]; then scheme=postgres default_port=5432; else scheme=mysql default_port=3306; fi
  ask "Its server (a name or an address)" 127.0.0.1 && db_host=$reply &&
    ask "Its port" "$default_port" && db_port=$reply &&
    ask "The database's name" "$NAME" && db_name=$reply &&
    ask "The user" "$NAME" && db_user=$reply &&
    ask_secret "The password" ||
    fail "a database of yours needs its details, or its address: --database=postgres://user:password@host:5432/name"
  database="$scheme://$(urlencode "$db_user"):$(urlencode "$reply")@$db_host:$db_port/$(urlencode "$db_name")"
}
own=no
if [ -z "$database" ] && [ "$host" != computer ]; then
  if [ "$can_ask" = no ]; then
    database=sqlite
  else
    choose "Which database will the site keep its pages in? The first four are installed for you." \
      "SQLite: a file beside the site, nothing more to install (the simplest)" \
      "PostgreSQL" \
      "MySQL" \
      "MariaDB" \
      "A database of mine, made already, perhaps on another server"
    case "$choice" in
      1) database=sqlite ;;
      2) database=postgres ;;
      3) database=mysql ;;
      4) database=mariadb ;;
      5) own=yes; own_details ;;
    esac
  fi
fi
case "$database" in
  '' | sqlite | postgres | mysql | mariadb) ;;
  *://*) [ -n "$previous_site" ] || own=yes ;;
  *) ;; # a SQLite file of its own
esac

# Step 3: the address people will open.
good_address() {
  case "$1" in
    https://?*) return 0 ;;
    http://localhost | http://localhost:* | http://127.0.0.1 | http://127.0.0.1:*) [ "$host" = docker ] ;;
    *) return 1 ;;
  esac
}
if [ "$host" != computer ]; then
  if [ "$host" = docker ]; then default_public=http://localhost:$port; else default_public=; fi
  while ! good_address "$public"; do
    [ -z "$public" ] || echo "The address starts with https://, like https://cms.example.com."
    if ask "The address people will open (https://...)" "$default_public"; then
      public=${reply%/}
    elif [ -n "$default_public" ] && [ -z "$public" ]; then
      public=$default_public
    else
      fail "--public is the address people will open, like --public=https://cms.example.com"
    fi
  done
fi

# Where the files are: the release on GitHub, or a folder of them (RELEASE_URL, to try a build).
if [ -n "${RELEASE_URL:-}" ]; then
  base=$RELEASE_URL
elif [ "$version" = latest ]; then
  # The newest release, a pre-release among them: during alpha and beta those are all there is (ADR 0045).
  if command -v curl >/dev/null 2>&1; then
    listed=$(curl -fsSL "https://api.github.com/repos/$REPOSITORY/releases?per_page=1") || fail "could not ask GitHub for the newest release"
  else
    listed=$(wget -qO- "https://api.github.com/repos/$REPOSITORY/releases?per_page=1") || fail "could not ask GitHub for the newest release"
  fi
  tag=$(printf '%s' "$listed" | grep -o '"tag_name": *"[^"]*"' | head -n 1 | sed 's/.*"\([^"]*\)"$/\1/')
  [ -n "$tag" ] || fail "GitHub lists no release of $REPOSITORY yet"
  base="https://github.com/$REPOSITORY/releases/download/$tag"
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
download "$base/checksums.sha256" "$work/checksums.sha256" || fail "could not download the checksums from $base"

# fetch <file>: downloaded into $work, and kept only if it is the one the release lists, byte for byte.
fetch() {
  download "$base/$1" "$work/$1" || fail "could not download $base/$1"
  expected=$(awk -v f="$1" '$2 == f { print $1 }' "$work/checksums.sha256")
  [ -n "$expected" ] || fail "the release lists no checksum for $1"
  if command -v sha256sum >/dev/null 2>&1; then
    actual=$(sha256sum "$work/$1" | awk '{ print $1 }')
  else
    actual=$(shasum -a 256 "$work/$1" | awk '{ print $1 }')
  fi
  [ "$actual" = "$expected" ] || fail "$1 does not match its checksum; nothing was installed"
}

# Docker: a folder with what compose needs, and the answers as its settings.
if [ "$host" = docker ]; then
  folder=${INSTALL_DIR:-$PWD/$NAME}
  for each in compose.yaml Dockerfile install.sh; do fetch "$each"; done
  mkdir -p "$folder"
  for each in compose.yaml Dockerfile install.sh; do mv "$work/$each" "$folder/$each"; done
  if [ -f "$folder/.env" ]; then
    echo "$folder already holds a site's settings; they are left as they are, and the files beside them updated."
  else
    password=$(secret)
    profiles=
    case "$database" in
      postgres) profiles=postgres; site="postgres://$NAME:$password@postgres:5432/$NAME" ;;
      mysql | mariadb) profiles=$database; site="mysql://$NAME:$password@$database:3306/$NAME" ;;
      sqlite | '') site=/site/site.db ;;
      *) site=$database ;;
    esac
    [ "$valkey" = no ] || profiles=${profiles:+$profiles,}valkey
    umask 077
    {
      echo "# The site's settings (ADR 0048); compose reads them. Changed here, they count from the next start."
      echo "COMPOSE_PROFILES=$profiles"
      echo "UHLAKA_SITE=$site"
      echo "UHLAKA_PUBLIC=$public"
      echo "UHLAKA_PORT=$port"
      echo "UHLAKA_VERSION=${tag:-$version}"
      echo "DATABASE_PASSWORD=$password"
      [ "$valkey" = no ] || echo "UHLAKA_VALKEY_URL=redis://valkey:6379"
    } >"$folder/.env"
    umask 022
  fi
  [ "$own" = no ] || echo "The site connects to your database when it starts; if it cannot, docker compose logs says why."
  echo
  echo "Ready in $folder. Start it with:"
  echo
  echo "  cd $folder && docker compose up -d --build"
  echo
  echo "Then open the link it prints for the first page, where you name the site and make your account:"
  echo
  echo "  docker compose logs $NAME"
  exit 0
fi

echo "Downloading $file..."
fetch "$file"
chmod 755 "$work/$file"

# A database of yours is tried before anything is written; asked again until it answers, or left.
if [ "$own" = yes ]; then
  while ! "$work/$file" check-database "$database"; do
    if [ "$can_ask" = yes ] && ask "Give the details again? (y/n)" y && [ "$reply" != n ]; then
      own_details
    else
      fail "nothing was installed; check the database's details, or choose one the installer installs"
    fi
  done
fi

if [ "$host" = server ]; then
  bin_dir=/usr/local/bin
else
  bin_dir=${INSTALL_DIR:-$HOME/.local/bin}
fi
mkdir -p "$bin_dir"
# Moved in whole: a program that is running keeps the file it started from.
mv "$work/$file" "$bin_dir/$NAME.new"
mv "$bin_dir/$NAME.new" "$bin_dir/$NAME"
if [ "$os" = darwin ] && command -v codesign >/dev/null 2>&1; then
  codesign --force --sign - "$bin_dir/$NAME" >/dev/null 2>&1 || true
fi
echo "Installed $("$bin_dir/$NAME" version) in $bin_dir."

if [ "$host" = computer ]; then
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

# Packages, from the system's own: apt, dnf, or apk.
updated=no
install_packages() { # <apt names> <dnf names> <apk names>
  if command -v apt-get >/dev/null 2>&1; then
    [ "$updated" = yes ] || { apt-get update -q >/dev/null 2>&1 || true; updated=yes; }
    # shellcheck disable=SC2086
    DEBIAN_FRONTEND=noninteractive apt-get install -y -q $1 >/dev/null 2>&1
  elif command -v dnf >/dev/null 2>&1; then
    # shellcheck disable=SC2086
    dnf install -y -q $2 >/dev/null 2>&1
  elif command -v apk >/dev/null 2>&1 && [ -n "$3" ]; then
    # shellcheck disable=SC2086
    apk add -q $3 >/dev/null 2>&1
  else
    return 1
  fi
}
# start <unit>...: the first of these names the system has, started now and at every boot.
start() {
  for unit in "$@"; do
    if systemctl enable "$unit" >/dev/null 2>&1 && systemctl restart "$unit" >/dev/null 2>&1; then return 0; fi
  done
  return 1
}

# The database the installer installs, listening only on this server, with a user and a password of the site's.
install_postgres() {
  install_packages postgresql postgresql-server '' || return 1
  if command -v postgresql-setup >/dev/null 2>&1 && [ ! -f /var/lib/pgsql/data/PG_VERSION ]; then
    postgresql-setup --initdb >/dev/null 2>&1 || return 1
  fi
  # Red Hat's own rules ask the system who connects (ident); the site connects with its password.
  for hba in /var/lib/pgsql/data/pg_hba.conf; do
    [ -f "$hba" ] && sed -i 's/^\(host .*\) ident$/\1 scram-sha-256/' "$hba"
  done
  start postgresql || return 1
  password=$(secret)
  as_postgres() { (cd / && runuser -u postgres -- "$@"); }
  if [ "$(as_postgres psql -qtAc "SELECT 1 FROM pg_roles WHERE rolname = '$NAME'")" = 1 ]; then
    as_postgres psql -qc "ALTER ROLE $NAME LOGIN PASSWORD '$password'" >/dev/null || return 1
  else
    as_postgres psql -qc "CREATE ROLE $NAME LOGIN PASSWORD '$password'" >/dev/null || return 1
  fi
  [ "$(as_postgres psql -qtAc "SELECT 1 FROM pg_database WHERE datname = '$NAME'")" = 1 ] ||
    as_postgres createdb -O "$NAME" "$NAME" || return 1
  database="postgres://$NAME:$password@127.0.0.1:5432/$NAME"
}
install_mysql() { # mysql | mariadb
  if [ "$1" = mysql ]; then install_packages mysql-server mysql-server '' || return 1; else install_packages mariadb-server mariadb-server '' || return 1; fi
  for conf in /etc/my.cnf.d /etc/mysql/mariadb.conf.d /etc/mysql/mysql.conf.d /etc/mysql/conf.d; do
    if [ -d "$conf" ]; then printf '[mysqld]\nbind-address = 127.0.0.1\n' >"$conf/90-$NAME.cnf"; break; fi
  done
  start mariadb mysql mysqld || return 1
  password=$(secret)
  client=$(command -v mariadb || command -v mysql) || return 1
  "$client" -u root <<EOF || return 1
CREATE DATABASE IF NOT EXISTS $NAME CHARACTER SET utf8mb4;
CREATE USER IF NOT EXISTS '$NAME'@'127.0.0.1' IDENTIFIED BY '$password';
ALTER USER '$NAME'@'127.0.0.1' IDENTIFIED BY '$password';
GRANT ALL PRIVILEGES ON $NAME.* TO '$NAME'@'127.0.0.1';
FLUSH PRIVILEGES;
EOF
  database="mysql://$NAME:$password@127.0.0.1:3306/$NAME"
}
case "$database" in
  sqlite | '') site=$home/site.db ;;
  postgres)
    echo "Installing PostgreSQL..."
    install_postgres || fail "PostgreSQL could not be installed here. Install it yourself and run this again with a database of yours, or choose SQLite."
    site=$database ;;
  mysql | mariadb)
    echo "Installing $database..."
    install_mysql "$database" || fail "$database could not be installed here. Install it yourself and run this again with a database of yours, or choose SQLite."
    site=$database ;;
  *) site=$database ;;
esac

# Valkey (ADR 0044 d4): what the site's processes share, listening only on this machine. Without it the
# site still works, from what each process keeps, so a system without the package is told and goes on.
valkey_url=
if [ "$valkey" = yes ]; then
  if command -v valkey-server >/dev/null 2>&1 || install_packages valkey-server valkey valkey; then
    for conf in /etc/valkey/valkey.conf /etc/valkey.conf; do
      [ -f "$conf" ] || continue
      sed -i 's/^#\{0,1\} *bind .*/bind 127.0.0.1 -::1/; s/^#\{0,1\} *protected-mode .*/protected-mode yes/' "$conf"
      grep -q '^bind ' "$conf" || echo 'bind 127.0.0.1 -::1' >>"$conf"
      break
    done
    start valkey-server valkey && valkey_url=redis://127.0.0.1:6379
  fi
  [ -n "$valkey_url" ] || echo "Valkey could not be installed here; the site keeps its pages and counters in its own memory. Install it later and set UHLAKA_VALKEY_URL in /etc/$NAME/env."
fi

umask 077
cat >"/etc/$NAME/env" <<EOF
UHLAKA_SITE=$site
UHLAKA_PUBLIC=$public
UHLAKA_EXTENSION_RUNNER=/run/$NAME-extensions/runner.sock
EOF
[ -z "$valkey_url" ] || echo "UHLAKA_VALKEY_URL=$valkey_url" >>"/etc/$NAME/env"
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
After=network-online.target valkey-server.service valkey.service postgresql.service mariadb.service mysql.service mysqld.service
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
echo "The site and its editor run on 127.0.0.1:$port. Point the web server that holds the certificate at it; with Caddy:"
echo
echo "  ${public#https://} {"
echo "    reverse_proxy 127.0.0.1:$port"
echo "  }"
echo
# A new link, after the service started, so the one it printed is not the one that counts. On its page
# the owner names the site, chooses its language and makes their account (ADR 0048 d4).
if (cd "$home" && as_service "$bin_dir/$NAME" setup-link "$site" --public="$public" 2>/dev/null); then
  echo "Open it to name the site, choose its language and make your account. It works once."
else
  echo "Sign in at $public/admin/ with your account."
fi
