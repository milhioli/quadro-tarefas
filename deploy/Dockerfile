# Imagem do app (Fase 2b, docs/deploy.md). O contexto do build é a raiz do repositório,
# filtrado pelo .dockerignore (em allowlist: .env, .git e server/data nunca entram).
# Versões fixadas por digest, com pelo menos 2 semanas de lançamento.
ARG NODE_IMAGE=node:24.22.2-bookworm-slim@sha256:01d566e8d94d8c619591d78652babfccd3c6992a3dffa9ed5ab39e11cf6c70e9

# ---------- Build do web (Vite) ----------
FROM ${NODE_IMAGE} AS build
WORKDIR /app
COPY package.json package-lock.json .npmrc tsconfig.base.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY shared/ shared/
COPY web/ web/
RUN npm run build -w web

# ---------- Dependências de runtime ----------
FROM ${NODE_IMAGE} AS deps
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci --ignore-scripts --omit=dev --no-audit --no-fund

# ---------- Runtime ----------
FROM ${NODE_IMAGE}
ENV NODE_ENV=production
WORKDIR /app
COPY --from=deps /app/node_modules node_modules
COPY package.json tsconfig.base.json ./
COPY shared/package.json shared/
COPY shared/src shared/src
COPY server/package.json server/tsconfig.json server/
COPY server/src server/src
COPY --from=build /app/web/dist web/dist
# O código fica do root (só leitura para o usuário node); só /data é gravável.
# Sem npm/yarn/corepack no runtime: nada instala pacote depois do build.
RUN mkdir /data \
  && chown node:node /data \
  && rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
     /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /opt/yarn-* /usr/local/bin/yarn /usr/local/bin/yarnpkg
USER node
WORKDIR /app/server
# O guard só aceita o Host do APP_ORIGIN, inclusive no health check (sem exceção para o loopback).
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD ["node", "-e", "const host=new URL(process.env.APP_ORIGIN).host;require('node:http').get({host:'127.0.0.1',port:3001,path:'/api/health',headers:{host}},(r)=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"]
CMD ["node", "--import", "tsx", "src/index.ts"]
