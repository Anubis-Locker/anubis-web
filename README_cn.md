# Anubis-Security-Tool (web)

基于浏览器的终端 / SSH / SFTP / RDP / VNC 客户端,是 [electerm-web](https://github.com/electerm/electerm-web)(MIT,© ZHAO Xudong)的加固分支。品牌配置见 `src/app/common/brand.config.js`。

English: [README.md](README.md)

## 快速开始

```bash
# Linux / macOS(需要 Node.js 24+、git、编译工具)
curl -fsSL https://raw.githubusercontent.com/ai-security-tool/web/main/scripts/one-line-web.sh | bash
# Windows:下载并运行 scripts\one-line-web.bat
```

脚本从 `ANUBIS_REPO_URL`(默认 `https://github.com/ai-security-tool/web.git`,占位地址)克隆并构建,自动生成 `.env` 中的 `SERVER_SECRET` / `SERVER_PASS`。运行 `./run-electerm-web.sh`,访问 http://127.0.0.1:5577。

手动安装:

```bash
git clone https://github.com/ai-security-tool/web.git && cd web
cp .sample.env .env        # 设置 SERVER_SECRET 和 SERVER_PASS
npm config set legacy-peer-deps true
npm i && npm run build
npm run prod
```

## Docker

```bash
cp .sample.env .env
docker compose up -d --build   # web + nginx,http://127.0.0.1:8080
```

## 安全默认值

- 认证默认开启,仅 `ENABLE_AUTH=0` 时关闭;不会向匿名访客发放 token。
- 生产环境下,`SERVER_SECRET` / `SERVER_PASS` 缺失、过弱或为默认值时拒绝启动。
- 登录按 IP 限速,token 默认 12 小时过期(`TOKEN_EXPIRED_TIME`)。
- 修复 `?init=` 反射型 XSS;CORS 默认不允许跨域(`CORS_ORIGINS`)。
- MCP 仅监听本机回环地址,必须提供 Bearer token(`MCP_TOKEN`)。
- 位于 nginx 之后请设置 `TRUST_PROXY=1`,并务必使用 HTTPS。

## 说明

- 所有依赖均解析到 `@ai-security-tool/*` 作用域(需设置 `NPM_REGISTRY_URL`,见 `.npmrc`)。
- 保留上游版权与署名,见 `LICENSE`。

## 许可证

MIT,见 [LICENSE](LICENSE)。
