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
#   WEAVE_ORIGIN               public origin sign-ins return to + the session cookie binds to (unset = loopback)
#   WEAVE_TRUST_PROXY          1 behind a platform proxy: rate limits read X-Forwarded-For (unset)
#   WEAVE_OIDC_ISSUER          an OpenID Connect provider to sign in with  (unset)
#   WEAVE_OIDC_CLIENT_ID       the client id that provider issued; set with the issuer (unset)
#   WEAVE_OIDC_CLIENT_SECRET   the client secret; unset = public client, PKCE alone (unset)
#   WEAVE_OIDC_NAME            the word on the sign-in link                (issuer's host)
#   WEAVE_MAIL_KEY             a Resend API key; with WEAVE_MAIL_FROM, invites are emailed (unset = off)
#   WEAVE_MAIL_FROM            the sender, on a domain Resend has verified (unset)
#   WEAVE_MCP_ORIGINS          other origins the /mcp door answers on, comma separated (unset)
#   WEAVE_WEBHOOK_ALLOW_PRIVATE 1 lets workflow webhooks post to private and loopback addresses (unset = refused)
#   WEAVE_UPDATE_CHECK         off: never ask GitHub for a newer release   (on: once a day)
#   WEAVE_AUTO_UPDATE          1 with `supervise`: install newer releases in place (unset = off)
#   WEAVE_BACKUP_DEST          s3://bucket/prefix: nightly backup at 04:00 UTC   (unset = off)
#   WEAVE_MAX_ROWS             most rows one API call returns for a named limit   (500)
ENV PORT=4400 \
    WEAVE_HOST=0.0.0.0 \
    WEAVE_DATA=/data/workspace.db \
    WEAVE_KEYSTORE=/data/keystore.json

# /data holds everything worth keeping: every workspace .db (yours plus the
# weave docs workspace), files/ for attachments, and the keystore. Owned by
# the unprivileged node user so a named volume inherits writable ownership.
# Each platform mounts /data itself (Railway volume, Fly mount, compose named
# volume); there is no VOLUME instruction because Railway refuses one.
RUN mkdir -p /data && chown node:node /data
USER node

EXPOSE 4400
# The slim image has no curl; node's fetch is enough for a probe.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4400)+'/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"

CMD ["node", "bin/weave.js", "serve"]
