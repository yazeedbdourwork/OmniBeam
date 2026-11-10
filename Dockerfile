# OmniBeam self-host image: the same server.js and site that run omnibeam.site.
#   docker build -t omnibeam .
#   docker run -d -p 3000:3000 -v omnibeam-data:/data --name omnibeam omnibeam
# Then open http://localhost:3000 (or put it behind HTTPS, see SELF-HOSTING.md).
FROM node:22-alpine

LABEL org.opencontainers.image.title="OmniBeam" \
      org.opencontainers.image.description="Send files and text between your devices in the browser. WebRTC, end to end encrypted, no account." \
      org.opencontainers.image.source="https://github.com/yazeedbdourwork/OmniBeam" \
      org.opencontainers.image.licenses="NOASSERTION"

# omnibeam.site's own analytics, Meta pixel, donation link and alert email stay off in your copy.
# Set them to your own values with -e (or in docker-compose.yml) if you want them.
# NODE_ENV is left unset on purpose: then devices are grouped by the address they connect from, also without a
# proxy in front. Set NODE_ENV=production only behind a proxy that always sends X-Forwarded-For (SELF-HOSTING.md).
ENV PORT=3000 \
    DATA_DIR=/data \
    SITE_URL=http://localhost:3000 \
    GA_ID= \
    FB_PIXEL_ID= \
    SUPPORT_URL= \
    ALERT_EMAIL= \
    WEEKLY=false

WORKDIR /app

# No npm install: the only runtime dependency (ws) and the minifier (terser) are vendored in vendor/.
COPY --chown=node:node package.json server.js service-worker.js ./
COPY --chown=node:node vendor ./vendor
COPY --chown=node:node public ./public

RUN mkdir -p /data && chown node:node /data
VOLUME ["/data"]
USER node

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT}/config.json" > /dev/null || exit 1

CMD ["node", "server.js"]
