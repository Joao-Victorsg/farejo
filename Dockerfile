FROM node:24-bookworm-slim

ENV CI=true
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@11.11.0 --activate

COPY . .
RUN pnpm install --frozen-lockfile --filter @farejo/scraper...

ENV SCRAPE_PLATFORM=all
ENV SCRAPE_TIER=active
ENV SCRAPE_RUNNER=cloud-run

CMD ["pnpm", "--filter", "@farejo/scraper", "scrape"]
