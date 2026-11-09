# Stand-alone Dockerfile for Coolify: paste this into New Resource → "Dockerfile".
# It downloads the game from GitHub, builds it and serves it with nginx on port 80.
#
# In Coolify set: Ports Exposes = 80, Domain = https://your-domain (must be https so
# phones and laptops can install the game). Click Redeploy to pick up new commits.

FROM node:24-slim AS build
ARG REPO=sumitsah250/Forest-Adventure
ARG BRANCH=master
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates && rm -rf /var/lib/apt/lists/*
# Busts Docker's layer cache whenever the branch moves, so redeploys always get the latest commit.
ADD https://api.github.com/repos/${REPO}/git/refs/heads/${BRANCH} /tmp/latest-commit.json
RUN git clone --depth 1 --branch ${BRANCH} https://github.com/${REPO}.git /app
WORKDIR /app
RUN npm ci --no-audit --no-fund && npm run build

FROM nginx:1.27-alpine
COPY --from=build /app/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s CMD wget -qO- http://127.0.0.1/ >/dev/null || exit 1
