# OpenOS Web deployment / Web 部署

## English

The Web release is a self-contained, single-user OpenOS stack for a local browser. It contains the compiled React frontend, a bundled local Bridge, and a zero-dependency Node.js launcher.

### Requirements and startup

- Node.js 22 or newer
- macOS, Linux, or Windows with loopback networking available

```bash
7z x OpenOS-0.1.0-web.7z
cd OpenOS-0.1.0-web
cp .env.example .env   # optional; providers can also be configured in Settings
npm start
# Open http://127.0.0.1:5178
```

The launcher serves `public/`, starts the bundled Bridge on loopback, and proxies `/api` on the same origin. Application data is written to `data/` by default.

| Variable | Default | Purpose |
| --- | --- | --- |
| `OPENOS_WEB_HOST` | `127.0.0.1` | Browser-facing listen host |
| `OPENOS_WEB_PORT` | `5178` | Browser-facing port |
| `OPENOS_BRIDGE_PORT` | `47821` | Private loopback Bridge port |
| `OPENOS_DATA_DIR` | `./data` | Persistent settings, conversations, and generated apps |
| `OPENOS_WEB_ALLOW_REMOTE` | unset | Must be `1` before binding to a non-loopback host |

### Operations and security

- Health check: `GET http://127.0.0.1:5178/api/health`.
- Logs are written to stdout/stderr. Keep process-manager logs private because provider errors may contain operational metadata.
- Back up `data/` before upgrading. Roll back by stopping the process, restoring the backup if necessary, and starting the previous versioned archive.
- This package is for a trusted, single-user environment. It does not implement accounts, tenants, or remote-user authorization. Keep the default loopback binding. If remote access is unavoidable, put the Web port behind authenticated TLS access and explicitly set `OPENOS_WEB_ALLOW_REMOTE=1`; never expose the private Bridge port.

## 简体中文

Web 发布包是一套面向本机浏览器的单用户 OpenOS，内含编译后的 React 前端、已打包的本地 Bridge，以及零依赖的 Node.js 启动器。

### 环境与启动

- Node.js 22 或更高版本
- macOS、Linux 或 Windows，并且本机回环网络可用

```bash
7z x OpenOS-0.1.0-web.7z
cd OpenOS-0.1.0-web
cp .env.example .env   # 可选；也可以在设置界面连接模型厂商
npm start
# 打开 http://127.0.0.1:5178
```

启动器会托管 `public/`，在回环地址启动内置 Bridge，并通过同源 `/api` 反向代理访问。应用数据默认写入 `data/`。

| 变量 | 默认值 | 用途 |
| --- | --- | --- |
| `OPENOS_WEB_HOST` | `127.0.0.1` | 浏览器访问的监听地址 |
| `OPENOS_WEB_PORT` | `5178` | 浏览器访问端口 |
| `OPENOS_BRIDGE_PORT` | `47821` | 仅回环可见的 Bridge 端口 |
| `OPENOS_DATA_DIR` | `./data` | 设置、会话和生成应用的持久化目录 |
| `OPENOS_WEB_ALLOW_REMOTE` | 未设置 | 绑定非回环地址前必须显式设为 `1` |

### 运维与安全

- 健康检查：`GET http://127.0.0.1:5178/api/health`。
- 日志输出到 stdout/stderr。进程管理器日志应保持私密，因为厂商错误可能带有运行元数据。
- 升级前备份 `data/`。回滚时停止进程，必要时恢复备份，再启动上一版本的压缩包。
- 该发布包只面向可信的单用户环境，不提供账号、租户或远程用户鉴权。应保留默认回环绑定。必须远程访问时，请在 Web 端口前增加带身份认证的 TLS 网关，再显式设置 `OPENOS_WEB_ALLOW_REMOTE=1`；不要暴露 Bridge 私有端口。
