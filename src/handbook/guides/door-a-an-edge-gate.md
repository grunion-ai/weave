# Door A: an edge gate

A gate in front of the port. weave keeps binding `127.0.0.1` (or the container's `0.0.0.0` behind a platform that only routes the custom domain); the gate is what the internet talks to. Five gates, one config block each, one check each. All five stack in front of door C without either side knowing.

With a gate in place, turn `requireAuth` on as well when agents reach the instance over HTTP: with requireAuth on, every page and API call needs a token, so a gate that admits a person still does not hand an agent anonymous write.

## Cloudflare Access

Free to fifty users. The DNS record is proxied, a tunnel carries traffic to the box, and an Access application decides who gets through.

```yaml
# ~/.cloudflared/config.yml  (cloudflared tunnel create weave; cloudflared tunnel route dns weave weave.example.com)
tunnel: <tunnel-id>
credentials-file: /home/weave/.cloudflared/<tunnel-id>.json
ingress:
  - hostname: weave.example.com
    service: http://127.0.0.1:4400
  - service: http_status:404
```

In Zero Trust → Access → Applications, add a self-hosted application for `weave.example.com` with one policy: **Allow** → Emails → the people who belong. Agents get a **service token** (Access → Service Auth) and send it as `CF-Access-Client-Id` / `CF-Access-Client-Secret` headers on every call.

**Check:** `curl -sI https://weave.example.com/api/health` answers `302` to `*.cloudflareaccess.com`. The same call with the two service-token headers answers `200` and `{"ok":true`.

## Tailscale

Private to your devices, nothing exposed, no certificate to manage, no public URL (the limit is stated on the **choose your door** page). One command on the server:

```bash
tailscale serve --bg 4400
```

**Check:** `tailscale serve status` lists `https://<machine>.<tailnet>.ts.net → http://127.0.0.1:4400`. That URL opens on another device in the tailnet and does not resolve anywhere else.

## Caddy `basic_auth`

A public hostname with automatic TLS and one shared password. Make the hash with `caddy hash-password`, then:

```caddyfile
# /etc/caddy/Caddyfile
weave.example.com {
	basic_auth {
		you $2a$14$replace-with-your-bcrypt-hash
	}
	reverse_proxy 127.0.0.1:4400
}
```

One credential for everyone: every person who gets in is whatever `requireAuth` says they are. Fine for one operator; for distinct identities use one of the gates below.

**Check:** `curl -sI https://weave.example.com/` answers `401`; `curl -sI -u you:password https://weave.example.com/api/health` answers `200`.

## oauth2-proxy

Sign in with GitHub, Google, or any OIDC provider; the proxy holds the session and forwards to weave.

```ini
# /etc/oauth2-proxy.cfg  (oauth2-proxy --config /etc/oauth2-proxy.cfg)
http_address = "127.0.0.1:4180"
upstreams = ["http://127.0.0.1:4400"]
provider = "github"
client_id = "<oauth app id>"
client_secret = "<oauth app secret>"
cookie_secret = "<python3 -c 'import secrets; print(secrets.token_urlsafe(32))'>"
email_domains = ["example.com"]
redirect_url = "https://weave.example.com/oauth2/callback"
```

Caddy (or nginx) terminates TLS for `weave.example.com` and `reverse_proxy 127.0.0.1:4180`.

**Check:** the hostname redirects to the provider's sign-in page; an address outside `email_domains` is refused with `403` after signing in; yours lands on weave.

## Authelia

Self-hosted SSO with two-factor, driven through Caddy's `forward_auth`.

```yaml
# authelia/configuration.yml (excerpt)
access_control:
  default_policy: deny
  rules:
    - domain: weave.example.com
      policy: two_factor
```

```caddyfile
weave.example.com {
	forward_auth 127.0.0.1:9091 {
		uri /api/authz/forward-auth
		copy_headers Remote-User Remote-Groups Remote-Email Remote-Name
	}
	reverse_proxy 127.0.0.1:4400
}
```

**Check:** the hostname redirects to Authelia's portal; after the second factor the same URL draws weave; `curl -sI https://weave.example.com/api/health` answers `401` from Authelia, never weave's JSON.

## How you know it worked

Three checks, whichever gate you chose:

1. A private browser window gets the gate before any weave page.
2. `curl -sI https://weave.example.com/api/health` answers a redirect or `401` from the gate, or `200` only with the gate's own credential (service token, basic auth, cookie).
3. A record created through the gate is there after the gate is restarted: the gate holds sessions, weave holds data, and neither borrowed the other's.