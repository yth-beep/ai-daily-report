# AI × 嵌入式 信息日报（GitHub Pages 站点）

> **阶段：上线前清理（第五阶段）+ 后端迁移（第六、七阶段）。** 站点名称「AI × 嵌入式 信息日报」，示例/占位页已从站点移除，`reports/` 为空，首页显示「日报将在首次采集后生成」。
> **反馈主后端为 Cloudflare Pages Functions**（`cloudflare-pages/`，`*.pages.dev` 可访问，复用现有账号、KV 与 `FEEDBACK_KEY`）；Cloudflare Worker（`backend/`）为备用，Deno Deploy 版（`backend-deno/`）因官方停止注册并宣布 2027 年关闭，仅作历史备份。
> 变更只做代码与本地测试：**没有** push、**没有**部署、**没有**创建账号、**没有**注册 Windows 定时任务、**没有**连接真实平台。
> `agent-synergy/` 已废弃，本项目不引用、不复制、不修改其中任何代码，也不把它作为技术底座。

站点面向 **AI 大模型 × 嵌入式** 交叉领域（端侧 AI、边缘推理、TinyML、AIoT、MCU/RTOS、NPU、模型量化与部署）。数据链路是：本地采集 → 结构化条目 → 分级日报 Markdown → 渲染成静态页面 → 走发布护栏提交到 Pages。原有的发布护栏与全部回归测试保持不变。

工作区已存在 `.git`。默认模式下脚本**不执行任何写 Git 操作**；`--publish` 是唯一能触发真实提交推送的开关，且带有源文件、remote、退出码三重护栏。所有发布相关测试都在临时目录 + 本地 bare 仓库完成，从不连接真实 GitHub。

---

## 1. 目录结构

```
E:\大学\项目\
├── docs/                          GitHub Pages 站点目录（Pages 只渲染这里）
│   ├── index.html                 站点首页，列表区块由脚本全量重建
│   ├── .nojekyll                  跳过 Jekyll 处理，保证静态资源原样发布
│   ├── assets/styles.css          浅色响应式样式，手机端可读
│   ├── assets/feedback-config.js  反馈后端地址配置（apiUrl 占位，不写密钥）
│   ├── assets/feedback.js         加重/减轻按钮调用后端的前端逻辑
│   └── reports/YYYY-MM-DD.html    生成的每日网页（当前为空，首次采集后生成）
├── reports/YYYY-MM-DD.md          本地权威日报源文件（不进入公开仓库；当前为空）
├── tests/
│   └── fixtures/2026-11-12.md     示例日报（仅测试用，不参与站点渲染）
├── config/
│   ├── runtime.json               时区、开机延迟、22:00、remote/branch、github、评分阈值、采集/总结器配置
│   ├── sources.json               数据源列表（RSS/Atom、手工 JSONL 投递）
│   └── topics.json                领域配置（id/name/enabled/weight/keywords/exclude_keywords）
├── backend/                       Cloudflare Worker 反馈后端（备用，无 Secret，可公开）
│   ├── src/index.js               Worker 入口（/health、/api/feedback、/api/weights）
│   ├── wrangler.toml.example      配置示例（KV binding + 领域白名单占位）
│   ├── package.json               仅 wrangler 开发/部署命令说明
│   ├── test/index.test.js         后端测试（KV mock，不连真实 Cloudflare）
│   └── README.md                  部署与密钥配置步骤
├── cloudflare-pages/              Cloudflare Pages Functions 反馈后端（主后端，无 Secret，可公开）
│   ├── functions/_shared/handler.js  共享实现（鉴权/CORS/校验/KV 写入）
│   ├── functions/health.js           GET  /health
│   ├── functions/api/feedback.js     POST /api/feedback
│   ├── functions/api/weights.js      GET  /api/weights
│   ├── public/                       Pages 输出目录（说明页 + 404 页）
│   ├── test/                         40 项测试（KV 内存替身）
│   ├── wrangler.toml                 Pages 项目 + 现有 KV 绑定 + ALLOWED_DOMAINS
│   └── README.md                     部署命令、并发边界、密钥设置
├── backend-deno/                  Deno Deploy 反馈后端（历史备份，已停止注册）
│   ├── main.ts                    Deno.serve 入口 + Deno KV 原子写
│   ├── test.ts                    34 项测试（内存 KV mock）
│   ├── deno.json                  tasks / 严格 TS / unstable kv 声明
│   └── README.md                  部署、环境变量与密钥轮换步骤
├── .github/
│   └── ISSUE_TEMPLATE/weight-feedback.yml  旧 Issue 表单（历史兼容，默认流程不用）
├── scripts/
│   ├── common.py                  时区、极简 Markdown 渲染、页面/首页生成、偏好反馈注入
│   ├── publish_state.py           公开白名单、远端发布状态核对、发布回执
│   ├── render.py                  渲染 + 首页入口更新
│   ├── startup_check.py           开机检查：本地网页 + 远端发布状态 + 补发
│   ├── prepare_publish.py         22:00 发布准备 / 受控发布
│   ├── runtime.py                 运行时配置加载 + 退出码约定
│   ├── topics.py                  领域配置加载 + 本地权重覆盖（热更新）
│   ├── scoring.py                 关键词命中 / 排除词过滤 / 权重排序 / 重要性分级
│   ├── feedback.py                偏好区域 HTML（按钮）+ 旧 Issue 解析（历史兼容）
│   ├── sync_feedback.py           从后端 GET /api/weights 拉权重（优先后端）
│   ├── collect_core.py            条目 schema、去重、逐条 checkpoint
│   ├── adapters.py                数据源适配器（rss / jsonl）+ 扩展点
│   ├── summarizer.py              汇总器接口（分级日报，默认「未AI总结」）
│   ├── collect.py                 采集运行器（跑所有启用的适配器）
│   ├── run_boot.py                开机入口：查昨天发布 -> 补发或采集
│   ├── run_nightly.py             22:00 入口：缺数据失败 -> 汇总 -> 渲染 -> 发布准备
│   ├── regression_test.py         发布链路回归测试（临时目录 + 本地 bare repo）
│   ├── regression_test_stage2.py  第二阶段采集/汇总回归测试
│   ├── regression_test_stage3.py  第三阶段领域/评分/反馈回归测试
│   ├── regression_test_stage4.py  第四阶段后端反馈/同步回归测试
│   ├── regression_test_stage5.py  第五阶段生产入口自动同步回归测试
│   └── install_tasks.ps1          Windows 定时任务示例（只提供，未注册）
├── state/                         运行时状态（已被 .gitignore 排除）
│   ├── startup_last_run.json      开机检查的「今日已执行」日期标记
│   ├── published/YYYY-MM-DD.json  push 成功后的发布回执（仅供审计）
│   ├── collections/YYYY-MM-DD.<源>.jsonl  逐条采集 checkpoint（去重、续采）
│   ├── inbox/                     手工投递目录（JSONL/JSON 采集器产出）
│   ├── topics_override.json       本机权重覆盖（不破坏公共配置）
│   └── feedback_processed.json    旧 Issue 幂等记录（历史兼容）
├── .gitignore
└── README.md
```

## 2. 环境要求

- Python 3.9+（本机 3.13），**零第三方依赖**，不需要 `pip install`。
- 所有日期固定按 **Asia/Shanghai**（UTC+8，无夏令时）计算。Windows 没有系统时区数据库，`zoneinfo` 不可用时回退固定 `+08:00`，结果一致且不需要 `tzdata`。
- 脚本通过 `__file__` 推导项目根目录，不硬编码中文路径；Git 调用不用 shell，避免路径/引号问题。

## 3. 如何使用

```bash
# 渲染全部日报 / 只渲染某天（可反复运行；reports/ 为空时首页显示「日报将在首次采集后生成」）
python scripts/render.py
python scripts/render.py --date 2026-11-20

# 开机检查：默认检查昨天，只做本地核对，不自动推送
python scripts/startup_check.py
python scripts/startup_check.py --date 2026-11-20 --force     # 测试/手动重跑
python scripts/startup_check.py --publish                     # 允许真实补发（需自己配好远端）

# 22:00 发布准备：生成网页 + 打印白名单 git 命令，不执行
python scripts/prepare_publish.py
python scripts/prepare_publish.py --date 2026-11-20           # 指定日期（补发用）
python scripts/prepare_publish.py --publish                   # 真实白名单提交推送

# 回归测试（临时目录 + 本地 bare repo，不碰真实仓库）
python scripts/regression_test.py
```

`startup_check.py` 与 `prepare_publish.py` 都支持 `--remote`（默认 `origin`）、`--branch`（默认 `main`）。

### 退出码（定时任务据此判断成败）

| 码 | `prepare_publish.py` | `startup_check.py` |
|---|---|---|
| 0 | dry-run 或发布成功 / 已确认可开始采集 | `start_collection` 或 `skipped_already_run` |
| 2 | 缺当天 `reports/<date>.md` 或日期非法（**立即中止，不做任何 git 操作**） | `pending_remote_publish`（不能开始采集） |
| 3 | 无 Git 仓库 / 未配置 remote | 日期非法 |
| 4 | `git add` 失败 | — |
| 5 | `git commit` 失败 | — |
| 6 | `git push` 失败 | — |

**关键约束**：`git add` / `commit` / `push` 任一真实失败都返回非 0；「没有新改动可提交」不是错误，会跳过 commit 并继续 push 已有提交，因此提交成功但推送失败后能可靠续推。

## 4. 公开仓库边界（第二轮修正）

> **公开仓库里所有被 Git 跟踪的文件都能被任何人看到。**
> GitHub Pages 选择 `/docs` 只表示**站点渲染来源是 docs/**，不等于「只有 docs/ 会公开」。
> `reports/`、`scripts/`、`state/`、`.workbuddy/`、Cookie、密钥、原始对话 JSON 一旦被 `git add`，就会出现在公开仓库里。

因此本模板采用**双层约束**：

1. **发布白名单**（唯一允许进入公开仓库的路径，定义在 `scripts/publish_state.py`）：
   ```
   git add -- docs README.md .gitignore
   ```
   **禁止 `git add .`**。脚本永远只执行白名单 add；回归测试会验证两份「查找开源项目」原始对话文件、`agent-synergy/`、`.workbuddy/`、`reports/`、`secret.key` 都不会被选中。
2. **`.gitignore`** 额外排除 `agent-synergy/`、`.workbuddy/`、`state/`、两份原始对话记录文件、Cookie / 登录态、密钥、原始采集数据（`raw/`、`*.jsonl`、`*.har` 等）与临时文件。只防「误添加」，不能替代白名单。

Pages 配置（**本轮未做任何线上操作**）：仓库推送后，在 **Settings → Pages** 选 `Deploy from a branch` → **Branch `main` / 文件夹 `/docs`** → Save，访问 `https://<用户名>.github.io/<仓库名>/`。

## 5. 22:00 更新原理

```
每天 22:00（示例任务，尚未注册）
  → prepare_publish.py
  → 硬门禁：reports/<今天>.md 不存在 ⇒ 立即返回 2，不渲染、不 git add/commit/push
  → 有源文件：render_all() 生成网页，rebuild_index() 全量重建首页（幂等）
  → 打印白名单 git 命令（git add -- docs README.md .gitignore / commit / push）
  → 默认 [DRY-RUN]，不执行任何 git 命令，不推送
  → 仅 --publish 时真实执行：
       无 .git 或 remote ⇒ 3；add 失败 ⇒ 4；commit 失败 ⇒ 5；push 失败 ⇒ 6
  → push 成功后写 state/published/<date>.json 回执（仅审计，不作为发布依据）
```

是否「已发布」由 `remote_publish_status()` 以**远端分支提交内容**判定，不看本地文件、也不看回执。

## 6. 开机检查与远端发布确认

```
开机登录后延迟 5 分钟（示例任务，尚未注册）
  → startup_check.py
  → 日期标记：今天已成功过(start_collection) ⇒ skipped_already_run；
              今天上次未完成 ⇒ 继续重试补齐
  → 本地侧：.md + .html 都有 / 只补网页 / 只写「缺失占位」页（不伪造内容）
  → 远端侧：git ls-remote 取 <remote>/<branch> 的 HEAD，
             用 git ls-tree 核对该提交是否包含 docs/reports/<昨天>.html
  → 只有「本地网页存在 + 源文件存在 + 远端状态 verified」才输出 start_collection(0)
  → 其余一律 pending_remote_publish(2)：
       no_git / no_remote / remote_unreachable / unverified / not_published
       都会打印明确的待发布状态与补发命令；默认不自动推送
  → 带 --publish 才尝试真实补发，补发后再次核对远端，确认成功才升级为 start_collection
```

远端状态含义：`verified` 远端提交确实含昨日网页；`not_published` 远端无该网页；`no_remote` 未配置远端；`remote_unreachable` 读不到远端；`unverified` 远端提交对象本地不可见、无法核对内容。**后四种都不能开始采集**。

## 7. 定时任务示例（只提供，未注册）

`scripts/install_tasks.ps1` 默认只打印，加 `-Apply` 才会注册。两点修正：

- **不再用裸 `python`**：脚本解析当前解释器的绝对路径（`sys.executable`），也可用 `-PythonPath` 显式指定，避免任务计划程序在非交互环境找不到命令。
- **明确区分两类任务**：
  - 当前会注册的只有两个 **DRY-RUN** 任务：`DailyReport-StartupCheck-DRYRUN`（登录 + 5 分钟）、`DailyReport-2200-Prepare-DRYRUN`（每天 22:00），参数里**没有** `--publish`，只准备本地文件和检查状态，**不会更新 GitHub**。
  - 将来真正的发布任务（`prepare_publish.py --publish`、`startup_check.py --publish`）在本模板里**只打印说明、不创建、不注册**；必须等 GitHub remote、凭据、分支都配置好之后再单独决定。

若某台机器的 `New-ScheduledTaskTrigger -AtLogOn` 不支持 `Delay`，脚本会提示在任务计划程序里手动补 5 分钟延迟。

## 8. 安全边界

- 公开内容的**仓库边界**由白名单决定；页面文字只由 `reports/` 生成后落到 `docs/`。脚本不读取或上传 `.workbuddy/` 记忆、原始对话 JSON、Cookie、API Key、原始采集数据。
- 两份「查找开源项目-大模型自动收集信息…」原始对话文件已写入 `.gitignore`，且不在发布白名单内；**未删除、未移动任何现有用户文件**。
- 示例日报已移出站点：内容保存在 `tests/fixtures/2026-11-12.md`，只被回归测试复制进临时目录使用，**不参与正式渲染**；公开站点里没有示例页，也没有「缺失占位」页。
- 所有发布回归测试都在系统临时目录的本地 bare 仓库里进行，没有连接或推送真实 GitHub。

## 9. 回归测试（第二轮新增）

```bash
python scripts/regression_test.py
```

覆盖 8 组、共 20+ 条断言：缺当天源 + `--publish` 立即中止且不产生提交；模拟 push 失败返回非 0；修好远端后续推能跳过 commit 直接 push；白名单提交树不含私有数据；无 remote / 远端未含昨日发布时不输出 `start_collection`；远端已确认发布时输出 `start_collection`；默认 dry-run 不产生提交；首页幂等；`.gitignore` 命中 5 类非公开路径。实际运行结果记录在 `.workbuddy/memory/2026-11-13-acceptance-rework.md`。

## 10. 已知限制 / 后续再做

- **没有真实 GitHub 仓库、remote 与凭据**；`--publish` 只在本地 bare repo 回归测试中验证过，未对真实 GitHub 执行。首次真实发布需人工确认 remote URL、分支 `main`、凭据与 Pages 设置。
- **没有注册任何 Windows 定时任务**；当前示例任务都是 dry-run，不会自动更新 GitHub。
- **没有真实采集流程**；`reports/` 目前为空（首次采集后才会出现 `YYYY-MM-DD.md`），缺当天源文件时 22:00 脚本直接失败退出（非 0），这是有意的告警设计，不会编造内容。
- `remote_publish_status()` 依赖本地能读到远端 HEAD 对应的 commit 对象；若远端由他人推送、本地没有该对象，会返回 `unverified`（保守不开始采集），需要 `git fetch` 后再检查。
- 渲染器是零依赖简化实现，不支持表格；行内代码内不要混用粗体/链接。
- `docs/reports/` 当前为空；只有本地跑过「缺失补发」测试时才会出现带「缺失占位」徽章的页面，那不代表真实日报，删除后重跑 `python scripts/render.py` 即可。

---

## 11. 第二阶段：生产运行器 + 采集框架

### 11.1 目标流程

**开机后 5 分钟（`run_boot.py`）**：
1. 检查昨天是否已确认发布（复用 `startup_check.py` 的远端核对）。
2. 未发布 → 尝试补发/准备；补发失败则**明确失败退出，不开始采集**。
3. 已发布 → 启动当天采集（`collect.py`）。

**22:00（`run_nightly.py`）**：
1. 检查当天采集结果；无数据 → 失败退出，不发布。
2. 用汇总器生成当天 Markdown 日报。
3. 渲染 `docs/reports/YYYY-MM-DD.html` 并更新首页。
4. 走现有发布护栏，默认 dry-run；显式 `--publish` 才 `git commit + push`。

### 11.2 采集接口（`collect_core.py` + `adapters.py`）

每个采集条目固定包含：`id`（内容哈希）、`title`、`url`、`published`（发布时间）、`summary`（简介/字幕/OCR 摘要）、`author`（作者）、`platform`（来源平台）、`video_url`（视频链接）、`fetched`（抓取时间）、`source_type`、`source_id`。

- **按 URL/哈希去重**：`content_hash(title, url, summary)` 生成稳定 id，重复条目跳过。
- **逐条 checkpoint**：每条处理后立即写入 `state/collections/<date>.<源>.jsonl`，中途退出后可续跑（已处理的条目不再重复）。
- **只读公开内容**：绝不点赞、评论、私信、关注、投稿。
- **遇到 401/403/429、验证码或登录要求立即停止并记录，不绕过**（`CollectionError` 直接抛出并留日志）。

### 11.3 数据源适配器

已实现两个可测试适配器（`scripts/adapters.py`）：

| 适配器 | 类型 | 说明 |
|---|---|---|
| `RSSAdapter` | `rss` | 公开 RSS/Atom 订阅源，仅用 `xml.etree` + `urllib`（零依赖），在 `config/sources.json` 配 `url` |
| `JSONLAdapter` | `jsonl` | 手工投递：读 `state/inbox/` 下的 `.jsonl` / `.json`（数组或单对象），方便接入你或其他采集器产出 |

**如何添加数据源**：编辑 `config/sources.json`，在 `sources` 数组里加一项并 `"enabled": true`。`rss` 型填 `url`；`jsonl` 型把文件放进 `state/inbox/`（条目至少含 `title`，可选 `url`/`published`/`summary`，也兼容中文键 `标题`/`链接`/`发布时间`/`摘要`）。

**如何接入新平台（抖音/B站等）**：在 `adapters.py` 里新增一个 `BaseAdapter` 子类，实现 `collect()` 返回条目列表，并把类型名注册进 `ADAPTERS` 字典。**本轮刻意不写任何抖音/B站的登录或抓取逻辑**，只保留清晰的 adapter 扩展点。

### 11.4 汇总器接口（`summarizer.py`）

- 默认 `mode = "none"`：**不调用任何模型**，生成明确标注「**未AI总结**」的基础清单（诚实降级，不假装已由大模型总结）。
- `mode = "command"`：可配置本地模型调用命令（`summarizer.command`），条目以 JSON 走 stdin，stdout 作为正文；命令失败会抛错并让夜间入口非零退出。**密钥从不写死**，命令由 `config/runtime.json` 提供。

### 11.5 两个生产入口的退出码

| 码 | `run_boot.py` | `run_nightly.py` |
|---|---|---|
| 0 | 已发布→采集完成 / 采集跳过 | 生成日报并发布准备成功（dry-run 或发布） |
| 1 | 配置错误 | 配置错误 |
| 2 | 采集无数据 | 缺当天数据（不生成、不发布） |
| 3 | 补发失败（不开始采集） | 发布准备/推送失败 |
| 4 | 采集失败 | — |

`collect.py` 自身：0 成功（含 0 条）、1 配置错误、4 采集失败。

### 11.6 定时任务示例（`install_tasks.ps1`）

已把两个 DRY-RUN 任务指向两个生产入口：

- `DailyReport-Boot-DRYRUN`：登录 + 5 分钟 → `run_boot.py`（默认无 `--publish`）
- `DailyReport-Nightly-DRYRUN`：每天 22:00 → `run_nightly.py`（默认无 `--publish`）

脚本保留绝对 Python 路径解析，并新增 `-EnablePublish` 开关：只有显式传入才给命令追加 `--publish`。**默认仍是只打印、不注册**，`-Apply` 才注册 DRY-RUN 任务；真实发布任务（`--publish`）仍只打印说明、不创建。

### 11.7 仍需人工配置（未在本轮完成）

- **真实 GitHub 仓库、remote、凭据、Pages 配置、首次白名单发布** —— 全部留待人工。
- **注册 Windows 定时任务**（`-Apply`）—— 当前未注册。
- **接入真实公开 RSS/Atom 源**（`config/sources.json` 里示例源默认 `enabled: false`）。
- **抖音/B站采集** —— 需另写 adapter（登录/授权不在本轮范围）。
- **接入真实模型总结器** —— 配 `summarizer.command`，默认仍是「未AI总结」清单。

---

## 12. 第三阶段：热更新领域 + 分级日报 + 权重反馈

### 12.1 热更新领域配置（`config/topics.json`）

领域（关注主题）完全由 `config/topics.json` 描述，**新增领域只需改 JSON，不用改代码**。每个领域至少包含：

- `id`（唯一标识，如 `ai-embedded`）
- `name`（显示名）
- `enabled`（是否启用）
- `weight`（基础权重）
- `keywords`（命中关键词）
- `exclude_keywords`（排除词，命中即过滤）

所有采集、评分、总结运行时都会重新读取该文件（无缓存），因此编辑后下次运行即生效。

**如何新增领域**：在 `topics` 数组里加一项即可，例如：

```json
{"id": "ml-ops", "name": "机器学习工程", "enabled": true, "weight": 2.0,
 "keywords": ["MLOps", "训练", "数据标注"], "exclude_keywords": ["招生"]}
```

**本机权重覆盖**（不破坏公共基础配置）：人工反馈写入 `state/topics_override.json`（如 `{"ai-embedded": {"delta": 1}}`），与 `config/topics.json` 分开。最终权重 = `clamp(base_weight + delta, -10, +10)`。

### 12.2 分级日报

- 每条内容保留：来源平台、标题、作者、发布时间、视频 URL、简介/字幕/OCR 摘要。
- 重要性分数 = `领域有效权重 × 命中关键词数`；`score >= threshold`（`config/runtime.json` 的 `scoring.threshold`，默认 1.5）判为**重要**，其余为**次要**。
- **重要条目**：详细段落，含标题、视频链接、来源、作者、为什么值得看（命中关键词）、2-4 个关键要点。
- **次要条目**：一行概括 + 视频链接，避免日报膨胀。
- 命中排除词的内容被过滤掉，不进日报。
- 页面明确标识「**AI 总结**」或「**未AI总结**」；没有模型时绝不假装已总结。

### 12.3 网页上的「加重/减轻」反馈（专用后端，无需登录）

GitHub Pages 是纯静态站点，**不能写回仓库，也无法在浏览器里安全保存 GitHub Token**。为了手机和电脑点击「加重/减轻」都能直接提交、不跳 GitHub、不需要平台账号登录，反馈改走**Cloudflare Pages Functions + Workers KV**：

1. 日报末尾的「偏好调整」区域，对出现的领域显示「加重」「减轻」按钮。
2. 点击后**直接调用后端** `POST /api/feedback`，不再跳转 GitHub。
3. 首次点击弹出简洁设置框，让用户输入**反馈密钥**；密钥保存在该浏览器 `localStorage`，本设备之后不再重复输入（提示「本设备本地保存，可清除」）。
4. 用 `crypto.randomUUID()` 生成 `eventId` 保证幂等。
5. 成功显示「已加重/已减轻」；失败显示可读错误，不假装成功。
6. API 地址未配置时按钮禁用并提示先部署后端。

后端地址配置在 `docs/assets/feedback-config.js`（源码里 `apiUrl` 为空占位，**不写密钥**）。

### 12.4 本地同步（`scripts/sync_feedback.py`）

优先后端模式，从 `GET /api/weights` 拉取累计权重，写入 `state/topics_override.json` 供下次采集/总结使用：

```bash
# 用环境变量传入后端地址和密钥（不写入仓库/配置文件）
export FEEDBACK_API_URL="https://ai-daily-report-feedback.pages.dev"
export FEEDBACK_KEY="你的反馈密钥"
python scripts/sync_feedback.py
```

- 权重范围 `[-10, +10]`。
- 旧的 GitHub Issue 解析函数保留仅作历史兼容，用户界面和默认流程**完全不用 GitHub 登录**。

**生产入口会自动同步，无需手动运行**：`run_boot.py` 在昨天确认发布后、开始采集前同步；`run_nightly.py` 在生成日报前再同步一次（保证 22:00 前的新反馈被使用）。两者都通过同一个公共函数 `sync_backend_weights_soft()` 调用，**始终走后端模式，绝不落到 GitHub Issues**。行为：

| 场景 | 行为 |
|---|---|
| 未配置 `FEEDBACK_API_URL` / `FEEDBACK_KEY` | 打印「后端尚未配置，使用本地权重」，继续，不报失败 |
| 后端网络失败 / 401 / 其他错误 | 保留已有本地权重，打印警告，继续采集/发布，不阻断 |
| 同步成功 | 写入 `state/topics_override.json`，随后的评分/分级立即使用新权重 |

### 12.5 哪些数据本地保存 / 哪些在云端

- **本地保存**（`state/`，已被 `.gitignore` 排除）：采集 checkpoint、权重覆盖 `topics_override.json`、发布回执。
- **云端公开仓库**：只发布 `docs/`、`README.md`、`.gitignore`、`.github/`、`backend/`、`backend-deno/`、`cloudflare-pages/`（白名单）。后端源码与前端配置可公开；**反馈密钥 `FEEDBACK_KEY` 永不发布**（只存在 Cloudflare Secret / Pages Secret 里）。
- 浏览器的 `localStorage` 只存该设备的反馈密钥，不作为跨设备权威数据。

### 12.6 `sync_feedback.py` 退出码

| 码 | 含义 |
|---|---|
| 0 | 同步成功（后端模式拉取权重 / 历史模式无新反馈） |
| 1 | 配置错误（缺 `FEEDBACK_API_URL`/`FEEDBACK_KEY` 等） |
| 2 | 后端/网络不可用或密钥错误（保留上次权重） |

---

## 13. 后端部署（主：Cloudflare Pages Functions）

**为什么必须有后端才能写数据**：GitHub Pages 是纯静态文件服务，前端无法把「点击加重」写回仓库，浏览器里也没有安全的地方存 GitHub Token；因此需要一个有状态的后端接收并保存权重，前端只发请求。

**为什么主后端是 Cloudflare Pages Functions**：Worker 已经部署成功，但**当前网络无法访问 `*.workers.dev`**；Deno Deploy 已停止新账号注册并宣布 2027 年关闭，不能作为长期依赖。`*.pages.dev` 在当前网络实测可访问，并且能**复用已有的 Cloudflare 账号、已有的 KV namespace 和已有的 `FEEDBACK_KEY`**，不需要新账号、新域名或 GitHub 登录。因此主后端改为 Pages Functions，Worker 与 Deno 版代码都保留作备份，不删除。

三种后端的路由、鉴权头、请求体、响应体与错误码语义一致，切换只改一处：`docs/assets/feedback-config.js` 的 `apiUrl`。前端和 `scripts/sync_feedback.py` 不需要区分后端类型。

### 13.1 代码位置

```
cloudflare-pages/
├── functions/
│   ├── _shared/handler.js    共享实现（`_` 开头的目录不会被当成路由）
│   ├── health.js             GET  /health
│   └── api/feedback.js       POST /api/feedback
│       api/weights.js        GET  /api/weights
├── public/                   Pages 输出目录（说明页 + 404 页）
├── test/                     40 项测试（KV 内存替身，不联网）
├── wrangler.toml             Pages 项目 + KV 绑定 + 非敏感变量
└── README.md                 部署、命令、并发边界说明
```

### 13.2 部署步骤（人工）

1. 复用已有 Cloudflare 账号登录：`npx --yes wrangler@latest login`（浏览器授权由你本人完成）。
2. 创建 Pages 项目（已存在可跳过）：

   ```bash
   cd cloudflare-pages
   npx --yes wrangler@latest pages project create ai-daily-report-feedback --production-branch=main
   ```

3. 确认 `wrangler.toml` 里的 KV 绑定是现有 namespace（`23beae27ecf34a63b89899f0947cd320`），`ALLOWED_DOMAINS=ai-embedded`。
4. 设置密钥（交互输入，**不写入任何文件**）：

   ```bash
   npx --yes wrangler@latest pages secret put FEEDBACK_KEY --project-name=ai-daily-report-feedback
   ```

   可以直接填 Worker 里那个 `FEEDBACK_KEY`，这样本机环境变量和各设备已输入的密钥都不用改。
5. 部署：

   ```bash
   npx --yes wrangler@latest pages deploy public --project-name=ai-daily-report-feedback
   ```

6. 得到 `https://ai-daily-report-feedback.pages.dev`，先 `curl .../health` 验证 `{"ok":true,...}`。
7. 把该域名填进 `docs/assets/feedback-config.js` 的 `apiUrl`（**不带** `/api/...` 路径），提交并推送。
8. 本机设置 `FEEDBACK_API_URL` / `FEEDBACK_KEY` 后，`run_boot.py`、`run_nightly.py` 会自动同步权重。

完整命令与排错见 `cloudflare-pages/README.md`。

### 13.3 本地开发

```bash
cd cloudflare-pages
npx --yes wrangler@latest pages dev     # http://localhost:8788，本地模拟 KV
```

`wrangler pages dev` 默认使用本地模拟 KV（`.wrangler/`，已 gitignore），不读写线上数据。`--remote` 才会连真实 KV，谨慎使用。

### 13.4 后端测试

```bash
cd cloudflare-pages
npm test        # node --test，40 passed，不联网、不需要 wrangler
```

覆盖：鉴权（缺密钥 / 错密钥 / 未配置密钥）、CORS（放行 / 拒绝 / 预检）、参数校验（领域 / delta / 日期 / eventId / JSON / 4KB）、`+1`/`-1`、幂等、clamp `±10`、事件 TTL、`GET /weights`、405/404、写入被覆盖后的重试收敛、持续冲突返回 409 且删除回执、KV 异常 500 不泄漏栈、路由文件布局与 `onRequest` 透传。

### 13.5 并发边界（KV 没有 CAS）

Pages 用的是 Workers KV，**没有 compare-and-swap**，本轮没有引入 Durable Object / D1，所以给的是「明确边界 + 尽量收敛」：

- 先查 `event:<eventId>` 回执，命中直接返回 `idempotent`，**同一 eventId 不会重复计数**（双击、客户端重试、网络重发都走这条）。
- **先写回执再写权重**：中途失败只会少记一次，不会重复计。
- 写权重后**回读校验**，发现被旧值覆盖就基于新值重算，最多 3 次。
- 仍收敛不了返回 `409` 并删掉刚写的回执，客户端可用同一 eventId 重试——**不假装成功**。
- **无法保证**：两个不同 eventId 在同一毫秒、不同 colo 到达时仍可能丢一次增量。本站是单人日报，每天几次点击，可忽略；`GET /api/weights` 能看出实际值。

要严格线性一致，可选 Durable Object 或 D1（`INSERT OR IGNORE` + `UPDATE ... SET weight = MAX(-10, MIN(10, weight + ?))`），需要新增绑定，本轮按「复用现有 KV」的要求未实施。

---

## 14. Deno Deploy（历史备份，不再作为依赖）

`backend-deno/` 保留但不再使用：Deno Deploy 已停止新账号注册（`403 SIGNUP_UNAVAILABLE`）并宣布 2027 年 4 月关闭，不能作为长期后端。代码与 34 项测试仍在，需要时可参考其 `README.md` 重新启用。

---

## 15. Cloudflare Worker（备用后端）

备用路径：`*.workers.dev` 在当前网络不可达，但代码与 19 项测试保持可用，配置步骤留档。

### 15.1 代码位置

```
backend/
├── src/index.js           Worker 入口（/health、/api/feedback、/api/weights）
├── wrangler.toml.example  配置示例（复制为 wrangler.toml 填写）
├── package.json           仅 wrangler 开发/部署命令说明
├── test/index.test.js     后端测试（KV mock，不连真实 Cloudflare）
└── README.md              部署与密钥配置步骤
```

### 15.2 部署步骤（人工）

1. 安装 wrangler：`npm install -g wrangler`，然后 `npx wrangler login`。
2. 在 Cloudflare 控制台创建 **KV namespace**，记下 namespace id。
3. 复制 `backend/wrangler.toml.example` 为 `backend/wrangler.toml`，填入 `id` 和 `preview_id`。
4. 设置 Secret（**不写入任何文件**）：`npx wrangler secret put FEEDBACK_KEY`，输入一个随机长字符串。
5. `npx wrangler dev` 本地调试（`http://localhost:8787`）。
6. `npx wrangler deploy` 得到 Worker 地址。
7. 把 Worker 地址填入 `docs/assets/feedback-config.js` 的 `apiUrl`。
8. 各设备首次点击「加重/减轻」时输入反馈密钥（同第 4 步设置的值）。

### 15.3 轮换密钥

`npx wrangler secret put FEEDBACK_KEY` 重新输入即可覆盖。轮换后各设备下次提交会被 401 拒绝并提示重新输入。

### 15.4 后端 API 与安全（三个后端一致）

| 端点 | 鉴权 | 说明 |
|---|---|---|
| `GET /health` | 无 | 返回 `{ok, version}` |
| `POST /api/feedback` | `X-Feedback-Key` | 提交 `+1`/`-1`（`domain`/`delta`/`date`/`eventId`） |
| `GET /api/weights` | `X-Feedback-Key` | 返回各领域累计权重 |

- KV：`weight:<domain>` 存累计权重（`-10~+10`）+ `updatedAt`；`event:<eventId>` 幂等回执（TTL 30 天）。**不记录 IP/UA/Cookie/个人信息**。
- CORS 仅允许 `https://yth-beep.github.io` 和本地开发地址；请求体限制 4 KB。
- 密钥错误 401；参数错误 400；方法错误 405；未知路由 404；返回 JSON 不泄漏密钥或异常栈。

### 15.5 Worker 后端测试

```bash
cd backend
npm test        # node --test，内存 KV mock，不连真实 Cloudflare
```

覆盖鉴权、CORS、参数校验、+1/-1、幂等、权重 clamp 与 `GET /weights`。

### 15.6 环境变量如何由计划任务继承

`run_boot.py` / `run_nightly.py` 通过环境变量 `FEEDBACK_API_URL` 和 `FEEDBACK_KEY` 访问后端。计划任务（`scripts/install_tasks.ps1` 只提供示例、默认不注册）需要让子进程继承这两个变量，推荐做法（三选一，**密钥不写入任务脚本或仓库**）：

1. **用户级环境变量**（推荐）：在 Windows「系统属性 → 环境变量 → 用户变量」里设置 `FEEDBACK_API_URL` 和 `FEEDBACK_KEY`，之后登录会话里的计划任务自动继承。
2. **计划任务属性里单独设置**：任务计划程序 → 选中任务 → 属性 → 操作，把 Python 命令包进一个不含密钥的小脚本，或在该任务「条件/设置」里通过「启动于」指定的会话继承用户变量。
3. **用 `.env` + 本地加载**：把密钥放在仓库外的 `.env`（已被 `.gitignore` 排除），由启动脚本读入——但这属于后续可选增强，当前脚本直接读环境变量。

**后端未配置 / 不可用时的行为**：见第 12.4 节表格——未配置打印「后端尚未配置，使用本地权重」继续；网络失败/401 保留上次本地权重继续，均不阻断采集与发布。

**安全**：`FEEDBACK_KEY` 只能存在于 Cloudflare Secret 和本机环境变量，**不得**写入 `install_tasks.ps1`、任何脚本、`wrangler.toml` 或提交到仓库。
