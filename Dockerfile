# kleib3ry in a container: your library folder, served over HTTP.
#
# Three stages because the front end needs node and no Rust, the server needs
# Rust and no node, and what runs needs neither. Nothing here builds Tauri —
# that is why `core/` was carved out of the desktop shell.
#
#   docker build -t kleib3ry .
#   docker run --rm -p 127.0.0.1:8080:8080 -v /path/to/your/library:/library kleib3ry
#
# See docs/docker.md for the folder layout, uids and the first scan.

# ---- the front end ----------------------------------------------------------
FROM node:22-bookworm-slim AS web
WORKDIR /build

# The lockfile first, on its own, so a source edit does not reinstall the world.
COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json vite.config.ts index.html .env.http ./
COPY scripts ./scripts
COPY src ./src
# tsconfig's `include` covers the tests, so typechecking needs them present.
COPY tests ./tests

# `assets` fetches the pdf.js cmaps and fonts the reader needs at runtime;
# `build:http` is an ordinary build with VITE_DRIVER=http.
RUN npm run assets && npm run build:http

# ---- the server -------------------------------------------------------------
FROM rust:1-bookworm AS server
WORKDIR /build

# `src-tauri` is deliberately not copied: nothing here may depend on the shell.
COPY core ./core
COPY server ./server
# Pure Rust the whole way down: no C toolchain, no native library to link.
RUN cargo build --release --manifest-path server/Cargo.toml

# ---- what actually runs -----------------------------------------------------
FROM debian:bookworm-slim
LABEL org.opencontainers.image.title="kleib3ry"
LABEL org.opencontainers.image.description="A 3D personal library, served from your own folder of books"

COPY --from=server /build/server/target/release/kleib3ry-server /usr/local/bin/kleib3ry-server
COPY --from=web /build/dist /app/dist

# The mount point the compose file and the docs both use.
ENV KLEIB3RY_LIBRARY=/library
EXPOSE 8080

# Deliberately no baked-in uid: the server writes into `<library>/.library/`, and
# a uid that does not own your mounted folder fails on first run. Pass your own:
#
#   docker run --user "$(id -u):$(id -g)" ...
#
ENTRYPOINT ["kleib3ry-server"]
CMD ["--dist", "/app/dist", "--port", "8080", "--bind", "0.0.0.0"]
