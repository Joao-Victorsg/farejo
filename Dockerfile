FROM node:24-bookworm-slim@sha256:d6aa754f16b3197301076f047b5def2f02ea1dbbc2ca920407d46d7ec7f87b20

ENV CI=true
ENV COREPACK_HOME=/usr/local/share/corepack
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@11.11.0 --activate
ENV COREPACK_ENABLE_NETWORK=0

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/scraper apps/scraper
COPY packages packages
RUN pnpm install --frozen-lockfile --filter @farejo/scraper...

USER node

CMD ["pnpm", "--filter", "@farejo/scraper", "scrape"]
