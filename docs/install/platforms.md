# Uhlaka on Docker and on a ready platform

The installer asks where the site will live (ADR 0048). This page is for two of
its answers: **Docker** on a machine of yours, and a **ready platform** that runs
a container for you (Railway, Render, Fly.io).

Whichever you choose, the site is set up in the browser: the first time it
starts, it prints a link that works once. Open it to name the site, choose its
language and make your account.

## Docker

```sh
curl -fsSL https://github.com/uhlaka-devs/uhlaka/releases/download/v0.1.0-alpha.5/install.sh | sh -s -- --host=docker
```

It asks which database (SQLite, PostgreSQL, MySQL, MariaDB, or one of yours)
and the address people will open, and writes a folder `uhlaka/` with
`compose.yaml`, the `Dockerfile` and `.env`, which holds the answers and the
database's password. Then:

```sh
cd uhlaka && docker compose up -d --build
docker compose logs uhlaka        # the link for the first page
```

The database and Valkey run beside the site and are reached only from it. The
site listens on `127.0.0.1:4321`; put the web server that holds the certificate
in front of it (Caddy: `cms.example.com { reverse_proxy 127.0.0.1:4321 }`).

To update, run the installer again in the same folder: the files are replaced,
`.env` is kept. Then `docker compose up -d --build`.

## A ready platform

Each release publishes an image: `ghcr.io/uhlaka-devs/uhlaka:<version>` (and
`:latest`, the newest, pre-releases too). What every platform needs:

| What | Value |
| --- | --- |
| Image | `ghcr.io/uhlaka-devs/uhlaka:latest` |
| Port | `4321` |
| A volume (a disk) | mounted at `/site`; the site lives there as a file |
| `UHLAKA_PUBLIC` | the site's address, `https://...` |
| `UHLAKA_SITE` (optional) | a database's address, `postgres://...` or `mysql://...`, instead of the file |
| `UHLAKA_VALKEY_URL` (optional) | a Valkey or Redis address, when the site runs in more than one copy |

The link for the first page is in the service's logs.

### Railway

1. New project → **Deploy a Docker image** → `ghcr.io/uhlaka-devs/uhlaka:latest`.
2. On the service: **Settings → Networking → Generate domain**, port `4321`.
3. **Variables**: `UHLAKA_PUBLIC` = the domain it generated, with `https://`.
4. Right-click the service → **Attach volume**, mounted at `/site`.
5. With Railway's PostgreSQL instead of the file: add it to the project, and set
   `UHLAKA_SITE` = `${{Postgres.DATABASE_URL}}`.

### Render

1. **New → Web Service → Existing image** → `ghcr.io/uhlaka-devs/uhlaka:latest`.
2. **Environment**: `UHLAKA_PUBLIC` = `https://<name>.onrender.com` (or your domain).
3. **Disk**: mounted at `/site` (it needs a paid instance; without a disk, use
   Render's PostgreSQL and set `UHLAKA_SITE` to its *Internal Database URL*).
4. Render finds port `4321` by itself.

### Fly.io

A `fly.toml` in an empty folder:

```toml
app = "my-site"

[build]
  image = "ghcr.io/uhlaka-devs/uhlaka:latest"

[env]
  UHLAKA_PUBLIC = "https://my-site.fly.dev"

[mounts]
  source = "site"
  destination = "/site"

[http_service]
  internal_port = 4321
  force_https = true
  auto_stop_machines = "off"
```

Then `fly launch --no-deploy`, `fly volumes create site --size 1`, `fly deploy`,
and `fly logs` for the link.

## Not here

Shared hosting with cPanel runs PHP, not a program that stays running, so
Uhlaka cannot live there. Cloudflare comes with the site running on Workers
(ADR 0037 d4, stage 3).
