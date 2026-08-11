# kleib3ry in a container: your library folder, served over HTTP.
#
# Three stages, because the three things being built have nothing to do with
# each other. The front end needs node and no Rust; the server needs Rust and no
# node; the image that runs needs neither — a static-ish binary and a folder of
# files. Notably absent is anything to do with Tauri: the desktop shell is not
# built here at all, which is the entire reason `core/` was carved out of it.
# A container that had to link GTK and WebKit in order to read a directory would
# be an order of magnitude larger than this one.
#
#   docker build -t kleib3ry .
#   docker run --rm -p 8080:8080 -v /path/to/your/library:/library kleib3ry
#
# See docs/docker.md for the rest of it — the folder layout it expects, how to
# run as your own user, and what to do about a first scan.

# ---- the front end ----------------------------------------------------------
FROM node:22-bookworm-slim AS web
WORKDIR /build

# The lockfile first, on its own, so a source edit does not reinstall the world.
COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json vite.config.ts index.html .env.http ./
COPY scripts ./scripts
COPY src ./src
# `tsc --noEmit` covers the tests as well as the app — see tsconfig's `include` —
# so they have to be here even though nothing runs them in this stage.
COPY tests ./tests

# `assets` copies pdf.js's cmaps and standard fonts into public/, which the
# reader needs at runtime and which are deliberately not committed.
# `build:http` is an ordinary build with VITE_DRIVER=http, which is what selects
# the driver that talks to the server below.
RUN npm run assets && npm run build:http

# ---- the server -------------------------------------------------------------
FROM rust:1-bookworm AS server
WORKDIR /build

# Only the two crates that matter. `src-tauri` is not copied, so nothing here can
# accidentally start depending on the desktop shell.
COPY core ./core
COPY server ./server
# rusqlite is built with its bundled SQLite, so this needs a C compiler — which
# the rust image already has — and nothing else.
RUN cargo build --release --manifest-path server/Cargo.toml

# ---- what actually runs -----------------------------------------------------
FROM debian:bookworm-slim
LABEL org.opencontainers.image.title="kleib3ry"
LABEL org.opencontainers.image.description="A 3D personal library, served from your own folder of books"

COPY --from=server /build/server/target/release/kleib3ry-server /usr/local/bin/kleib3ry-server
COPY --from=web /build/dist /app/dist

# Where the library folder is expected to be mounted. Overridable, but this is
# the one the compose file and the docs both use.
ENV KLEIB3RY_LIBRARY=/library
EXPOSE 8080

# Deliberately *not* dropping to a fixed unprivileged uid.
#
# The server writes into `<library>/.library/` — the index, the cover cache, the
# book layout — and a baked-in uid that does not own your mounted folder is a
# first run that fails with a permission error nobody can act on. Pass your own
# instead, which is both safer and specific to you:
#
#   docker run --user "$(id -u):$(id -g)" ...
#
ENTRYPOINT ["kleib3ry-server"]
CMD ["--dist", "/app/dist", "--port", "8080", "--bind", "0.0.0.0"]
