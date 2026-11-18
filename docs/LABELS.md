# LABELS · 9 轨分类表与关键词映射（C.1 静态分析器用）

> 定位：`tools/lab-analyze.mjs` 的**唯一分类依据**。`suggestedLabel` / `matchedTerms` / 同轨去重全部由本文推出；
> 代码里**不留关键词副本**（改分类只改本文，工具每次运行都重新读）。
> 基线：lab-guide C.1（2026-11-15）｜语义裁决定在 [`RULES.md`](RULES.md) §10.5。
> 上游只读源：lab 的类别视图 `<LAB_DIR>/INDEX.md` §4（base / productivity / ui-skins / search / memory / dev / fun / integration / language）。

---

## 1. 为什么是 9 轨

lab 的 `INDEX.md` §4 分类统计里落地的类别正好 9 个（`media` 是「预留、0 条目」，不进 9 轨）：

| # | key | 覆盖什么 | lab 里出现过的写法（别名） |
|---|---|---|---|
| 1 | `base` | 基础设施 / 市场 / 清单与管理入口 / 通用兜底 | `base`、`工具/市场` |
| 2 | `productivity` | 工作流与自动化、任务看板、挂件、远程访问、上下文/成本治理 | `productivity`、`productivity（任务看板）`、`productivity（远程访问）`、`productivity / board` |
| 3 | `ui-skins` | 外观 / 皮肤 / 主题 | `ui-skins` |
| 4 | `search` | 检索 / 抓取 / 搜索 provider | `search` |
| 5 | `memory` | 记忆 / 跨会话知识 | `memory` |
| 6 | `dev` | 开发调试 / IDE / 代码审查 / 回退 | `dev`、`dev（内置 IDE）`、`dev（对话回退）` |
| 7 | `fun` | 娱乐 / 宠物 / 表情 | `fun` |
| 8 | `integration` | 第三方服务集成（IM、webhook、外部 API） | `integration` |
| 9 | `language` | 翻译 / 润色 / 摘要 / 语音 | `language`、`language / translate` |

**不在 9 轨里的写法**一律**原样保留**、不做归类（`canonicalLabel` 返回小写原文）：例如 B 阶段夹具用的
`embedded` / `toolchain`——它们在 lab 里没有对应类别文件，硬归到某一轨才是污染。这类 label 参与同轨比较时
只能与同名 label 匹配，匹配不到就是「同轨无记录」。

---

## 2. 关键词表（机器可读，工具直接解析本节）

规则：标记块之间是 JSON；允许套一层 ```` ```json ```` 围栏（工具会剥掉）。`key` 必须是上表的 9 个之一；
`alias` 是「lab 写法 → 9 轨 key」的归一化映射（大小写不敏感，值必须存在于 `tracks`）。

<!-- LABELS:JSON:START -->
```json
{
  "tracks": [
    {
      "key": "base",
      "name": "基础/市场/通用兜底",
      "keywords": [
        "dshmarket",
        "plugin-manager",
        "skills manager",
        "技能管理",
        "插件管家",
        "插件市场",
        "插件管理",
        "market",
        "marketplace",
        "installer",
        "一键安装"
      ]
    },
    {
      "key": "productivity",
      "name": "工作流/自动化/看板/挂件/远程/上下文",
      "keywords": [
        "task board",
        "task-board",
        "看板",
        "cron",
        "定时任务",
        "挂件",
        "widget",
        "remote",
        "远程访问",
        "workflow",
        "工作流",
        "budget",
        "预算",
        "上下文压缩",
        "compact",
        "agent studio",
        "agent-studio",
        "智能体团队",
        "team",
        "github",
        "issue"
      ]
    },
    {
      "key": "ui-skins",
      "name": "外观/皮肤/主题",
      "keywords": ["skin", "theme", "themes", "皮肤", "主题", "外观"]
    },
    {
      "key": "search",
      "name": "检索/抓取",
      "keywords": ["search", "搜索", "抓取", "web search", "provider", "search provider"]
    },
    {
      "key": "memory",
      "name": "记忆/跨会话",
      "keywords": ["memory", "记忆", "sqlite", "recall", "跨会话", "mem0"]
    },
    {
      "key": "dev",
      "name": "开发调试/IDE/代码审查/回退",
      "keywords": [
        "vscode",
        "monaco",
        "editor",
        "编辑器",
        "ide",
        "lsp",
        "debug",
        "调试",
        "rewind",
        "回退",
        "code review",
        "代码审查",
        "diff",
        "terminal",
        "终端",
        "shell"
      ]
    },
    {
      "key": "fun",
      "name": "娱乐/宠物/表情",
      "keywords": ["game", "游戏", "pet", "宠物", "fun", "meme", "表情包", "娱乐"]
    },
    {
      "key": "integration",
      "name": "第三方服务集成",
      "keywords": [
        "integration",
        "集成",
        "connector",
        "webhook",
        "telegram",
        "slack",
        "feishu",
        "飞书",
        "wechat",
        "微信",
        "im bridge",
        "第三方服务"
      ]
    },
    {
      "key": "language",
      "name": "翻译/润色/摘要/语音",
      "keywords": ["translate", "translation", "翻译", "润色", "polish", "summary", "摘要", "voice", "语音", "speech", "tts", "stt", "语音输入"]
    }
  ],
  "alias": {
    "工具/市场": "base",
    "工具": "base",
    "市场": "base",
    "任务看板": "productivity",
    "远程访问": "productivity",
    "board": "productivity",
    "remote": "productivity",
    "translate": "language",
    "语音": "language",
    "皮肤": "ui-skins",
    "主题": "ui-skins",
    "检索": "search",
    "抓取": "search",
    "记忆": "memory",
    "开发": "dev",
    "调试": "dev",
    "娱乐": "fun",
    "集成": "integration"
  }
}
```
<!-- LABELS:JSON:END -->

---

## 3. 判定口径（classify 怎么算）

1. **匹配语料（只这三样，任务卡口径）**：`package.json` 的 `keywords[]` + 包名 + `description` 原文。
   ——README 全文、lab 的作用列、`dsh.client.inject`、依赖名**都不参与**：它们会把几乎所有插件算成同一轨。
2. **边界规则**：
   - 纯 ASCII 词按「字母/数字/下划线」边界匹配：`dev` 不命中 `device`；`plugin-manager` 能命中 `dsh-plugin-manager`（连字符算边界）。
   - 含中文/空格的词按子串匹配（`插件管家`、`skills manager`）。
   - 全部大小写不敏感。
3. **打分**：命中即计 1 分（同一词只算一次，不按出现次数加权）；**分高者胜**；平手时按 `key` 升序取第一个（与 locale 无关，可复现）。
4. **匹配不到 = `unclassified`**：不硬套到最近的轨、不按依赖猜、不按包名前缀猜。`unclassified` 时同轨对比按「无 label」处理。
5. **`matchedTerms` 就是命中的那批词**（原样返回，供人复核），`scores` 给出全部候选与分数——**结论可被读者自己复算**，这是本工具唯一允许的「推荐」依据。
6. **二级标签**（`productivity（任务看板）`、`language / translate`）先按 `alias` 整串查，再取首段（`（`、`(`、`[`、`|`、`/` 之前）查一次，最后退化为小写原文。

---

## 4. 与 lab 的实际映射示例（本机真实数据）

| 包（本机实测） | lab 写的类别 | 归一化 | 说明 |
|---|---|---|---|
| `dshmarket` | `工具/市场`（installed.md）／`base`（INDEX.md） | `base` | 别名把两种写法收到同一轨 |
| `@linxin666/dsh-client-ui-task-board` | `productivity（任务看板）` | `productivity` | 二级标签取首段 |
| `@anysearch/anysearch-dsh` | `search` | `search` | 一致 |
| `dsh-vscode-mode` | `dev（内置 IDE）` | `dev` | 二级标签取首段 |
| `meow-memory` | `memory` | `memory` | 一致 |
| `@smalltailqwq/dsh-client-ui-skin-maid-atelier` | `ui-skins` | `ui-skins` | 一致 |
| （B 阶段夹具）`lab-fixture-alpha` | `embedded`（lifecycle label） | `embedded`（原样） | 不在 9 轨：只与同名 label 比较 |

---

## 5. 已知限制（不猜的部分写在这里）

- **只做「像不像」，不做「好不好」**：分数高只代表词命中多，不代表推荐安装。结论里那句 `verdict` 才是判断，
  而且只基于 §3/§4 的本地静态证据（row 争用 + 权限四档 + 同轨重复），不含星数、下载量、更新时间。
- **关键词表是人写的**：新增一轨或改词必须同时改本文与 `RULES.md` §10.5 的口径说明；工具不内置任何词表副本，
  本文缺失或 JSON 块坏掉时 `suggestedLabel` 一律 `unclassified` 并在 warnings 写明原因（不猜）。
- **不读 README 做分类**：README 是营销文本，`description` 才是包作者声明的自我定位。
- **多轨同分只取一个**：`scores` 会列出并列候选，人可自行改判；工具不合并、不投票。
