# 反馈后端（Cloudflare Worker + Workers KV）

日报页面的「加重 / 减轻」按钮直接调用这里的 API，用户**不需要登录 GitHub**。

## 目录

```
backend/
├── src/index.js           Worker 入口（路由、鉴权、校验、KV 读写）
├── wrangler.toml.example  配置示例（复制为 wrangler.toml 后填写）
├── package.json           仅说明 wrangler 开发/部署命令，无真实凭据
├── test/index.test.js     后端测试（KV mock，不连真实 Cloudflare）
└── README.md              本文档
```

## API

| 方法 | 路径 | 鉴权 | 说明 |
|---|---|---|---|
| GET | `/health` | 无 | 返回 `{ok:true, version}` |
| POST | `/api/feedback` | `X-Feedback-Key` | 提交一次 `+1`/`-1` 权重调整 |
| GET | `/api/weights` | `X-Feedback-Key` | 返回各领域累计权重 |

`POST /api/feedback` 请求体（JSON）：

```json
{ "domain": "ai-embedded", "delta": 1, "date": "2026-11-14", "eventId": "<UUID>" }
```

- `domain`：只允许 `ALLOWED_DOMAINS` 里的领域 ID（首版 `ai-embedded`）。
- `delta`：只允许 `+1` 或 `-1`。
- `date`：`YYYY-MM-DD`，限制合理时间范围。
- `eventId`：客户端生成的 UUID，用于幂等，同一 ID 只生效一次。

## 数据（KV）

- `weight:<domain>` → `{"weight": <int>, "updatedAt": "<ISO>"}`，累计权重范围 `-10 ~ +10`。
- `event:<eventId>` → 回执，TTL 30 天。

**不记录** IP、User-Agent、Cookie 或任何个人信息。

## 部署步骤（人工）

1. 安装 wrangler（一次性）：`npm install -g wrangler`。
2. 登录：`npx wrangler login`。
3. 在 Cloudflare 控制台创建 KV namespace，记下 id。
4. 复制 `wrangler.toml.example` 为 `wrangler.toml`，填入 KV namespace id（`id` 和 `preview_id`）。
5. 设置 Secret（不要写入任何文件）：`npx wrangler secret put FEEDBACK_KEY`，输入一个随机长字符串。
6. 本地调试：`npx wrangler dev`（默认 `http://localhost:8787`）。
7. 部署：`npx wrangler deploy`，得到形如 `https://ai-daily-report-feedback.<子域>.workers.dev` 的地址。
8. 把该地址填入 `docs/assets/feedback-config.js` 的 `apiUrl`。

## 轮换密钥

`npx wrangler secret put FEEDBACK_KEY` 重新输入新密钥即可覆盖。轮换后，各设备下次提交会被 401 拒绝并提示重新输入密钥。

## 安全

- CORS 只允许 `https://yth-beep.github.io` 和本地开发地址。
- 请求体限制 4 KB。
- 返回 JSON，不泄漏密钥或异常栈。
- 密钥错误 401；参数错误 400；方法错误 405；未知路由 404。
- `FEEDBACK_KEY` 只存在 Cloudflare Secret，不进入仓库文件。

## 测试（本地，不连真实 Cloudflare）

```bash
cd backend
npm test
```

使用内存 KV mock，覆盖鉴权、CORS、参数校验、+1/-1、幂等、权重 clamp 和 `GET /weights`。
