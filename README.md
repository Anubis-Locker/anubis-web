# Anubis-Security-Tool (web)

Browser-based terminal / SSH / SFTP / RDP / VNC client, a hardened fork of [electerm-web](https://github.com/electerm/electerm-web) (MIT, © ZHAO Xudong). Brand values live in `src/app/common/brand.config.js`.

Chinese: [README_cn.md](README_cn.md)

## Quick start

```bash
# Linux / macOS (Node.js 24+, git, build tools)
curl -fsSL https://raw.githubusercontent.com/ai-security-tool/web/main/scripts/one-line-web.sh | bash
# Windows
# download scripts\one-line-web.bat and run it
```

The script clones `ANUBIS_REPO_URL` (default `https://github.com/ai-security-tool/web.git`, a placeholder), builds, and creates `.env` with generated `SERVER_SECRET` / `SERVER_PASS`. Start with `./run-electerm-web.sh` and open http://127.0.0.1:5577.

Manual:

```bash
git clone https://github.com/ai-security-tool/web.git && cd web
cp .sample.env .env        # set SERVER_SECRET and SERVER_PASS
npm config set legacy-peer-deps true
npm i && npm run build
npm run prod
```

## Docker

```bash
cp .sample.env .env   # fill SERVER_SECRET / SERVER_PASS
docker compose up -d --build   # web + nginx on http://127.0.0.1:8080
```

Container runs as non-root, read-only rootfs, all caps dropped, data in the `anubis-data` volume. Put TLS in front (see `examples/nginx-ssl.conf`).

## Security defaults

| Area | Behaviour |
|---|---|
| Auth | ON unless `ENABLE_AUTH=0`. No token is handed to anonymous visitors. |
| Production | Refuses to start if `SERVER_SECRET` / `SERVER_PASS` are missing, weak or default. |
| Login | Per-IP rate limit (`LOGIN_MAX_FAILS`, `LOGIN_WINDOW_MS`), timing-safe compare. Tokens expire after `TOKEN_EXPIRED_TIME` (12h). |
| XSS | `?init=` and other page data are serialized safely in `index.pug`. |
| CORS | No cross-origin access unless listed in `CORS_ORIGINS`. |
| MCP widget | Loopback only (`MCP_ALLOW_REMOTE=1` to override), bearer token required (`MCP_TOKEN`). |
| Proxy | Set `TRUST_PROXY=1` behind nginx. |

See `.sample.env` for all variables. Run behind HTTPS; the app can open shells and read/write files for any authenticated user, so treat credentials like root access.

## Data and legacy electerm data

Data lives in `DB_PATH` (default `./data`). The web app never moves data automatically: to reuse
an existing electerm desktop/web data folder, **copy** it (do not delete the original) and point
`DB_PATH` at the copy, e.g. `DB_PATH=/home/me/.config/anubis` after
`cp -r ~/.config/electerm ~/.config/anubis` (macOS: `~/Library/Application Support/electerm`,
Windows: `%APPDATA%\electerm`). Docker: mount the copy on the `anubis-data` volume.

## Logos and icons (`BRAND_RES_DIR`)

Logos/icons come from the resource package, found at `BRAND_RES_DIR` (relative to this repo or
absolute), else `../resource`, else `node_modules/@ai-security-tool/resource`. The same folder is
used by the vite dev server, the `@brand-res` alias and `build/bin/copy.js`.
## Notes

- all dependencies resolve to the `@ai-security-tool/*` scope (set `NPM_REGISTRY_URL`, see `.npmrc`).
- Upstream attribution is kept in `LICENSE` and widget author fields.

## License

MIT, see [LICENSE](LICENSE).
