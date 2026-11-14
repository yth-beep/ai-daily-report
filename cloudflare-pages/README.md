# 反馈后端 · Cloudflare Pages Functions（主后端）

日报页面的「加重 / 减轻 / 清除标记」按钮调用这个后端。它是**主后端**：`*.pages.dev` 在当前网络可访问，
复用已有的 Cloudflare 账号、已有的 KV namespace 和已有的 `FEEDBACK_KEY`，**不需要新账号、新域名或 GitHub 登录**。

> 为什么需要后端：GitHub Pages 是纯静态站点，浏览器里无法安全保存 GitHub Token，也没有任何位置能持久写回仓库。
> 权重必须存在一个有状态的服务里。

## 目录

```
cloudflare-pages/
├── functions/
│   ├── _shared/handler.js    共享实现（Pages 不会把 _ 开头的目录当路由）
│   ├── health.js             GET  /health
│   └── api/
│       ├── feedback.js       POST /api/feedback
│       └── weights.js        GET  /api/weights
├── public/
│   ├── index.html            API 说明页（Pages 需要一个输出目录）
│   └── 404.html              未知路径返回 404
├── test/
│   ├── kv-mock.js            KV 内存替身
│   ├── handler.test.js       API 行为测试（31 项）
│   └── routes.test.js        路由适配器测试（9 项）
├── wrangler.toml             Pages 项目 + KV 绑定 + 非敏感变量
├── package.json
└── .gitignore
```

## API

| 方法 | 路径 | 鉴权 | 说明 |
|---|---|---|---|
| GET | `/health` | 无 | `{ ok: true, version: "1.1.0" }` |
| POST | `/api/feedback` | `X-Feedback-Key` | 保存一次 `+1` / `-1`；条目级 `0` 表示清除 |
| GET | `/api/weights` | `X-Feedback-Key` | 返回各领域累计权重 |

请求体：

```json
{ "domain": "ai-embedded", "delta": 1, "date": "2026-11-14", "eventId": "<UUID v4>" }
```

响应：

```json
{ "ok": true, "domain": "ai-embedded", "delta": 1, "weight": 3, "updatedAt": "2026-11-14T14:00:00.000Z" }
{ "ok": true, "idempotent": true, "domain": "ai-embedded", "weight": 3, "updatedAt": "..." }
{ "ok": true, "weights": { "ai-embedded": { "weight": 3, "updatedAt": "..." } } }
```

错误码：`400` 参数/JSON 非法 · `401` 密钥缺失或错误 · `404` 未知路由 · `405` 方法错误 ·
`409` 权重写入未能收敛（未生效，可用同一 eventId 重试）· `413` 请求体超过 4KB · `500` 内部错误。带 `itemId` 的事件按内容只采用 `at` 最新的一条，旧点击保留审计但不叠加。

> 与 Worker 版唯一差异：请求体过大这里返回 `413`（Worker 版是 `400`）。前端只判断非 2xx，行为等价。

## 数据布局（与 Worker 完全一致，可直接复用）

| Key | Value | 过期 |
|---|---|---|
| `weight:<domain>` | `{"weight": -10..10, "updatedAt": ISO}` | 不过期 |
| `event:<eventId>` | `"1"` | `expirationTtl` 30 天 |

用的是**同一个** KV namespace（`23beae27ecf34a63b89899f0947cd320`），所以 Worker 时期写下的权重会直接被读到，不需要迁移。

## 并发边界（KV 没有 CAS，必须说清楚）

Workers KV 不提供 compare-and-swap，本轮**没有**引入 Durable Object / D1，所以给出的是「明确边界 + 尽量收敛」：

1. **同一 eventId 不会重复生效**：先查回执，命中就直接返回 `idempotent`，不碰计数器。正常双击、客户端重试、网络重发都会走这条路。
2. **先写回执再写权重**：两次写入之间崩溃只会「少记一次」，不会重复计。
3. **写入后回读校验 + 最多 3 次重试**：如果发现自己写进去的值被别的请求用旧值覆盖，就基于新值重算再写一次。
4. **仍然收敛不了就返回 409**，并且删掉刚写的回执，让客户端可以用同一个 eventId 重试——**不会假装成功**。
5. **无法保证的**：两个不同 eventId 在同一毫秒到达、落在不同 colo 时，仍可能丢一次增量（极端窗口）。这个站点是单人日报，每天几次点击，影响可忽略；`GET /api/weights` 能看出实际值，点一次即可补上。

如果以后需要严格线性一致，可选方案是 Durable Object（单实例串行）或 D1（`INSERT OR IGNORE` + `UPDATE ... SET weight = MAX(-10, MIN(10, weight + ?))`）。两者都需要新增绑定，本轮按「复用现有 KV」的要求没有实施。

不记录 IP、User-Agent、Cookie 或任何个人信息。

## 环境变量

| 变量 | 类型 | 说明 |
|---|---|---|
| `WEIGHTS_KV` | KV 绑定 | 已在 `wrangler.toml` 绑定到现有 namespace |
| `FEEDBACK_KEY` | **Secret** | 前端 `X-Feedback-Key` 要比对的值。未配置时所有受保护接口一律 401 |
| `ALLOWED_DOMAINS` | 普通变量 | 逗号分隔的领域 ID，默认 `ai-embedded` |

`FEEDBACK_KEY` **不要写进 `wrangler.toml`、`.dev.vars` 提交、代码或文档**，只用下面的 secret 命令或控制台设置。

## 命令

```bash
cd cloudflare-pages

# 0) 依赖（只在需要时下载，项目本身零运行时依赖）
npx --yes wrangler@latest --version

# 1) 登录（复用已有 Cloudflare 账号，浏览器授权由本人完成）
npx --yes wrangler@latest login

# 2) 创建 Pages 项目（已存在会提示，可跳过）
npx --yes wrangler@latest pages project create ai-daily-report-feedback --production-branch=main

# 3) 本地开发：http://localhost:8788
npx --yes wrangler@latest pages dev

# 4) 测试（不需要 wrangler，纯 node）
npm test

# 5) 设置密钥（交互输入，不落到任何文件）
npx --yes wrangler@latest pages secret put FEEDBACK_KEY --project-name=ai-daily-report-feedback

# 6) 部署到生产
npx --yes wrangler@latest pages deploy public --project-name=ai-daily-report-feedback
```

部署后会得到：

```
https://ai-daily-report-feedback.pages.dev
```

先自查：

```bash
curl https://ai-daily-report-feedback.pages.dev/health
# {"ok":true,"version":"1.1.0"}
```

然后把该域名写进 `docs/assets/feedback-config.js` 的 `apiUrl`，提交并推送。之后各设备首次点击「加重/减轻」时输入一次反馈密钥即可（只存本机 localStorage）。

## 查看 / 修改配置

```bash
# 列出 Pages 项目的环境变量与绑定（控制台等价路径：Workers & Pages → 项目 → Settings）
npx --yes wrangler@latest pages project list
npx --yes wrangler@latest pages deployment list --project-name=ai-daily-report-feedback

# 重新设置密钥（覆盖，不需要删除）
npx --yes wrangler@latest pages secret put FEEDBACK_KEY --project-name=ai-daily-report-feedback

# 查看 KV namespace 列表，确认绑定目标
npx --yes wrangler@latest kv:namespace list
```

绑定关系写在 `wrangler.toml` 的 `[[kv_namespaces]]` 里；改了 binding 需要重新部署才生效。

## 本地 KV 与真实 KV 的区别

`wrangler pages dev` 默认使用**本地模拟的 KV**（存在 `.wrangler/`，已被 gitignore），不会读写线上数据。
要连远端 KV 调试，用 `--remote`（wrangler 4 支持 `--remote` 绑定），这会真实读写线上 namespace，谨慎使用：

```bash
npx --yes wrangler@latest pages dev --remote
```

## 测试

```bash
cd cloudflare-pages
npm test
# 40 passed（31 项 API 行为 + 9 项路由适配器）
```

覆盖：鉴权（缺密钥 / 错密钥 / 未配置密钥）、CORS（放行 / 拒绝 / 预检）、参数校验（领域 / delta / 日期 / eventId / JSON / 4KB）、
`+1`/`-1`/条目级 `0` 清除、同一 itemId 最后一次选择覆盖、幂等、clamp `±10`、事件 TTL、`GET /weights`、405/404、**写入被覆盖后的重试收敛**、
**持续冲突返回 409 且删除回执**、KV 异常 500 不泄漏栈、响应不泄漏密钥、路由文件布局与 `onRequest` 透传。

## 与其它后端的关系

| 目录 | 状态 |
|---|---|
| `cloudflare-pages/` | **主后端**，本文件 |
| `backend/` | Cloudflare Worker，保留作备用（`workers.dev` 在当前网络不可达） |
| `backend-deno/` | Deno Deploy 版，历史备份（Deno Deploy 已停止新注册并宣布 2027 年关闭） |

三者 API 合同一致，切换只改 `docs/assets/feedback-config.js` 的 `apiUrl`。
