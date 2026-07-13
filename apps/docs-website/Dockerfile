FROM node:24-alpine@sha256:a0b9bf06e4e6193cf7a0f58816cc935ff8c2a908f81e6f1a95432d679c54fbfd AS build

WORKDIR /app

RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/docs-website/package.json apps/docs-website/package.json
RUN pnpm install --frozen-lockfile --filter docs-website...

COPY apps/docs-website apps/docs-website
WORKDIR /app/apps/docs-website
RUN pnpm build

FROM nginxinc/nginx-unprivileged:1.29-alpine@sha256:0c79d56aee561a1d81c63f00eee5fb5fe29279560cdc55e91425133104c7fbe6

COPY apps/docs-website/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/docs-website/dist /usr/share/nginx/html
COPY LICENSES/Apache-2.0.txt /usr/share/doc/towk-docs/LICENSE
COPY NOTICE /usr/share/doc/towk-docs/NOTICE

USER 101:101
EXPOSE 8080
