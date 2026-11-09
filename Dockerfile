# Hollow Creek (Poacher Panic + Campus Quest) as a static site served by nginx.
#
# Coolify: New Resource → Public Repository → this repo, Build Pack "Dockerfile",
# Ports Exposes 80, and an https:// domain (HTTPS is required to install the app).
#
# Local: docker build -t hollow-creek . && docker run -p 8080:80 hollow-creek

FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build

FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s CMD wget -qO- http://127.0.0.1/ >/dev/null || exit 1
