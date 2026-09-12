# weave — one container, no build step, no npm install (zero runtime
# dependencies). Pinned to an exact node 22.x-slim tag: node:sqlite needs
# ≥ 22.16, and an exact tag is what Dependabot/Renovate can bump.
FROM node:22.23.2-slim

WORKDIR /opt/weave
COPY --chown=node:node . .

# The environment contract (Handbook → "Environment reference"):
#   PORT                       listen port; Railway and Fly set it        (4400)
#   WEAVE_HOST                 bind address; a container needs 0.0.0.0    (127.0.0.1)
#   WEAVE_DATA                 the workspace .db; files/ + weave.db beside it
#   WEAVE_KEYSTORE             the secrets file; set here so it lives on the volume
#   WEAVE_KEYSTORE_PASSPHRASE  derives the keystore key; no key file on disk (unset)
#   WEAVE_ORIGIN               reserved for phase 2 (passkeys); not read yet
#   WEAVE_BACKUP_DEST          reserved for phase 3 (backup); not read yet
ENV PORT=4400 \
    WEAVE_HOST=0.0.0.0 \
    WEAVE_DATA=/data/workspace.db \
    WEAVE_KEYSTORE=/data/keystore.json

# /data holds everything worth keeping: every workspace .db (yours plus the
# weave docs workspace), files/ for attachments, and the keystore. Owned by
# the unprivileged node user so a named volume inherits writable ownership.
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME /data

EXPOSE 4400
# The slim image has no curl; node's fetch is enough for a probe.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4400)+'/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"

CMD ["node", "bin/weave.js", "serve"]
