FROM node:24-bookworm-slim

ENV CI=true
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@11.11.0 --activate

COPY . .
RUN pnpm install --frozen-lockfile --filter @farejo/scraper...

USER node

CMD ["pnpm", "--filter", "@farejo/scraper", "scrape"]
