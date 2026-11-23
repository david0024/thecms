# uhlaka in a container (ADR 0048): the program from its GitHub release, checked
# against the release's checksums by install.sh, as on any computer. The site
# lives in /site (a volume), or in the database UHLAKA_SITE names.
#
#   docker build --build-arg VERSION=0.1.0-alpha.1 -t uhlaka .
#   docker run -p 4321:4321 -v uhlaka:/site -e UHLAKA_PUBLIC=http://localhost:4321 uhlaka
#
# compose.yaml, beside it, runs it with its database and Valkey.
FROM debian:bookworm-slim

ARG VERSION=latest
# RELEASE_URL=file:///release takes the program from the build's own folder instead (the release workflow's image).
ARG RELEASE_URL=
RUN --mount=type=bind,source=.,target=/release \
  apt-get update -q \
  && apt-get install -y -q --no-install-recommends ca-certificates curl \
  && INSTALL_DIR=/usr/local/bin sh /release/install.sh --host=computer --yes --version="$VERSION" \
  && apt-get purge -y -q curl && apt-get autoremove -y -q \
  && rm -rf /var/lib/apt/lists/* \
  && useradd --system --home-dir /site --create-home --shell /usr/sbin/nologin uhlaka \
  && printf '%s\n' '#!/bin/sh' \
    '# A volume a platform mounts arrives owned by root: given to the site, which then runs as its own user.' \
    'if [ "$(id -u)" = 0 ]; then chown uhlaka:uhlaka /site; exec setpriv --reuid=uhlaka --regid=uhlaka --init-groups "$@"; fi' \
    'exec "$@"' >/usr/local/bin/uhlaka-start \
  && chmod 755 /usr/local/bin/uhlaka-start

WORKDIR /site
VOLUME /site
ENV UHLAKA_SITE=/site/site.db \
  UHLAKA_PUBLIC=http://localhost:4321
EXPOSE 4321
# Served with accounts at UHLAKA_PUBLIC; it prints the link for the first page while the site has no owner.
ENTRYPOINT ["uhlaka-start"]
CMD ["uhlaka", "--host=0.0.0.0", "--port=4321"]
