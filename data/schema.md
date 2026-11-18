# data · lifecycle 条目 schema v1

> 定位：`data/lifecycle.json` 的**字段与状态机权威**。`tools/_lifecycle.mjs` 是它的实现，
> `tools/lab-triage.mjs` 是它的 CLI。语义裁决（为什么这么定）写在
> [`../docs/RULES.md`](../docs/RULES.md) §9；本文只写「是什么 / 允许什么 / 违反会怎样」。
>
> 基线：lab-guide B 阶段（2026-11-14）｜schemaVersion **1**（字段名冻结，改字段名即升版本）
> 边界：本文件与 `lifecycle.json` 都在 `lab-guide/` 内；**lab 目录只读**，同步建议只落到 `../out/`。

---

## 1. 文件与顶层结构

- 账本文件：`data/lifecycle.json`（可用 `--lifecycle <path>` 指向副本/夹具）。
- 空种子（交付初值）：

```json
{ "schemaVersion": 1, "updatedAt": "2026-11-14T14:28:23Z", "items": [] }
```

| 顶层字段 | 类型 | 约束 |
|---|---|---|
| `schemaVersion` | number | 必须 `=== 1`；不等 → 违反（`SCHEMA_VERSION`），`check` exit 1，写入被拒 |
| `updatedAt` | string | ISO `YYYY-MM-DDTHH:mm:ssZ`；**每次写盘自动刷新**为当次 `--now`（未给则真实时钟，秒级截断） |
| `items` | array | 条目数组；pkg 全局唯一 |

- 未知顶层字段与条目内未知字段：**保留原样**（不静默丢弃），只是不参与校验。

---

## 2. 条目字段（v1，字段名固定）

```json
{
  "pkg": "@scope/name",
  "kind": "plugin",
  "label": "embedded",
  "state": "candidate",
  "since": "2026-11-10",
  "trialUntil": null,
  "watch": false,
  "lastVerified": null,
  "verifiedVersion": null,
  "reason": "一句话结论（≤80 字，不得为空）",
  "evidence": []
}
```

| 字段 | 类型 | 含义 | 约束 / 违反码 |
|---|---|---|---|
| `pkg` | string | **主键**。插件用包名；非插件用前缀：`skill:xxx` / `mcp:xxx` / `app:xxx` | 非空（`PKG_EMPTY`）；全局唯一（`PKG_DUPLICATE`） |
| `kind` | enum | `plugin` / `skill` / `mcp` / `app` | 枚举外 → `KIND_INVALID` |
| `label` | string | 分类轨，与 lab 类别同名（如 `embedded`、`toolchain`） | 非空（`LABEL_EMPTY`） |
| `state` | enum | 见 §3 | 枚举外 → `STATE_INVALID` |
| `since` | string | **进入当前状态的日期**（`YYYY-MM-DD`）；迁移时刷新 | 格式错 → `SINCE_INVALID` |
| `trialUntil` | string \| null | trial 到期日（`YYYY-MM-DD`）；非 trial 一律 `null` | 格式错 → `TRIAL_UNTIL_INVALID`；trial 为空 → 不变式 `INV_TRIAL_NO_TRIAL_UNTIL` |
| `watch` | boolean | 是否继续盯版本更新 | 非布尔 → `WATCH_NOT_BOOLEAN`；adopted 为 false → `INV_ADOPTED_NO_WATCH` |
| `lastVerified` | string \| null | 最近一次**核对**时间（ISO，秒级 `Z`）；由 `note` 刷新 | 格式错 → `LAST_VERIFIED_INVALID` |
| `verifiedVersion` | string \| null | 最近一次核对到的**实测版本**（取 profile `node_modules/<pkg>/package.json`） | 空串 → `VERIFIED_VERSION_INVALID`；adopted 为空 → `INV_ADOPTED_NO_VERSION` |
| `reason` | string | 一句话结论（当前状态的理由） | 空 → `REASON_EMPTY`；> 80 字（按码点）→ `REASON_TOO_LONG` |
| `evidence` | array | 证据链，见 §5 | 非数组 / 元素结构错 → `EVIDENCE_INVALID`；rejected 为空 → `INV_REJECTED_NO_EVIDENCE` |

### 2.1 `kind` 与 `pkg` 前缀一致性（硬约束）

| kind | pkg 形态 | 反例 |
|---|---|---|
| `plugin` | 直接是包名：`dsh-purge-community`、`@scope/name` | `skill:foo` → `KIND_PREFIX_MISMATCH` |
| `skill` | `skill:` 前缀开头 | `foo` / `mcp:foo` → `KIND_PREFIX_MISMATCH` |
| `mcp` | `mcp:` 前缀开头 | 同上 |
| `app` | `app:` 前缀开头 | 同上 |

> 前缀比较不区分大小写（`Skill:` 也认）；写入时按用户给的原文保存，只做 trim。

### 2.2 `since` 为什么是「状态起点」而不是「发现日期」

- 状态机需要回答「这次试用从哪天开始」，`trialUntil` 才有解释力；发现日期丢了不影响判断。
- 历史不会丢：每次 `promote` 都会追加一条 `note` 证据，`ref` 写 `lab-triage: <from>→<to>（reason）`，
  `at` 是迁移时刻。想知道「第一次登记是哪天」，翻 `evidence` 最早一条即可。
- `lastVerified` 为空时，`due` 用 `since` 兜底算 adopted 静默天数（见 §4）。

---

## 3. 状态机

### 3.1 状态

| state | 含义 | 额外必填 |
|---|---|---|
| `candidate` | 候选（记下来了，还没试） | — |
| `trial` | 试用中 | `trialUntil` |
| `adopted` | 已采用 | `watch: true` + `verifiedVersion` |
| `rejected` | 已否掉 | `reason` + ≥1 条 `evidence` |
| `dormant` | 休眠（曾采用，现在不用，保留观察） | — |

### 3.2 合法迁移（其余一律拒绝，exit 1，不写文件）

| from → to | 允许 | 迁移副作用 |
|---|---|---|
| `candidate → trial` | ✅ | `trialUntil = now + trialDays`（`--trial-days`，默认 **14**） |
| `candidate → rejected` | ✅ | `watch=false`、`trialUntil=null`、追加迁移证据 |
| `trial → adopted` | ✅ | `watch=true`、`trialUntil=null`、`verifiedVersion` = profile 实测（读不到则**拒绝迁移**） |
| `trial → rejected` | ✅ | `watch=false`、`trialUntil=null`、追加迁移证据 + 归档建议 |
| `adopted → rejected` | ✅ | 同上（采用后发现问题，收回） |
| `adopted → dormant` | ✅ | `watch` **保持**（休眠但仍值得盯更新）、`trialUntil=null` |
| `dormant → rejected` | ✅ | `watch=false`、追加迁移证据 + 归档建议 |
| `dormant → trial` | ✅ | 重新试：`trialUntil = now + trialDays` |
| 其余组合（含 `x → x`、`rejected → *`） | ❌ | `非法迁移 from → to（拒绝执行，文件未改动）`，exit 1 |

**拒绝的额外说明**：

- `rejected` 是**终结态**：否掉的条目不能再复活。真要重来，`add` 一条新 `pkg` 或换个版本号命名，
  历史保持只增不改（`pkg` 唯一性由这条规则兜底）。
- `candidate` 不能直接 `adopted`：没有试用期就没有到期复核，`due` 也就永远看不见它。
- `adopted` 不能回到 `trial`：降级只有两条路——`dormant`（暂不用）或 `rejected`（否掉）。

### 3.3 每次迁移都会做的事

1. `state` 改为目标状态，`since` 改为 `now`（状态起点）。
2. `reason` 替换为本次迁移的理由（条目只保留**当前**结论，历史在证据里）。
3. 追加一条 `evidence`：`{ type: "note", ref: "lab-triage: <from>→<to>（<reason>）", at: now }`。
   —— 这条就是 `rejected` 不变式的兜底证据，所以 `--to rejected` 不传 `--evidence` 也不会违反不变式。
4. `--evidence <text>` 若给了，再追加第二条（`type: note`，`ref` 为用户原文）。
5. `updatedAt` 刷新；**先校验再原子写**（见 §6）。

### 3.4 不变式总表（`check` 与写入前各跑一次；违反 → exit 1 且不写文件）

| # | 不变式 | 违反码 | 为什么这么定 |
|---|---|---|---|
| I-1 | `rejected` 必须有非空 `reason` | `INV_REJECTED_NO_REASON` | 否掉的理由必须写清，否则半年后没人知道为什么 |
| I-2 | `rejected` 至少有 1 条 `evidence` | `INV_REJECTED_NO_EVIDENCE` | 结论要能复核；`promote --to rejected` 会自动补迁移证据，所以这条不会误伤 |
| I-3 | `trial` 必须有 `trialUntil` | `INV_TRIAL_NO_TRIAL_UNTIL` | 没有到期日 = 无限试用，`due` 永远看不见它 |
| I-4 | `adopted` 必须 `watch: true` 且 `verifiedVersion` 非空 | `INV_ADOPTED_NO_WATCH` / `INV_ADOPTED_NO_VERSION` | 采用的前提是盯得住版本漂移，且版本必须是**实测值** |
| I-5 | `pkg` 全局唯一 | `PKG_DUPLICATE` | 主键重复 = 状态机有两套解释 |
| I-6 | `kind` 与 `pkg` 前缀一致（`skill:` / `mcp:` / `app:`） | `KIND_PREFIX_MISMATCH` | 非插件条目没有包名可当主键，前缀就是身份 |

> 前四条是任务卡点名的硬约束；I-5 / I-6 是「主键与身份」的机械约束，同样是硬失败（不是警告）。

---

## 4. `due` 口径（到期与失活）

| 类别 | 判定 | 输出 |
|---|---|---|
| 过期 trial | `trialUntil <= now`（含当天；`now` 取 `--now` 的日期部分） | `pkg / trialUntil / 逾期天数` |
| 失活 adopted | 最近活动距今 `>= 30` 天 | `pkg / 最近活动 / 静默天数 / lastVerified / 备注` |

「最近活动」= `lastVerified`、最后一条 `evidence.at`、`since` 三者取**最大值**；三者都取不到 → 记「从未核对」。

> 为什么不用「创建时间」：账本是 append-mostly 的，`note` 会刷 `lastVerified`，用最近活动才反映「还盯不盯得住」。
> 30 天是**阈值常量**（`ADOPTED_STALE_DAYS`），改阈值要同时改本文与代码。

---

## 5. `evidence` 规范

```json
{ "type": "drift", "ref": "docs/RULES.md:84 或 命令输出摘要", "at": "2026-11-14T09:00:00Z" }
```

| 字段 | 约束 |
|---|---|
| `type` | 枚举，固定五种：`drift`（版本/基线漂移）、`conflict`（与其它插件冲突）、`usage`（实际使用记录）、`note`（人工结论/迁移记录）、`update`（上游更新） |
| `ref` | 非空字符串；写「文件:行」或「命令输出摘要」。**不写凭据原文**（lab 安全红线） |
| `at` | ISO `YYYY-MM-DDTHH:mm:ssZ`（秒级）；由写入方给，不由读取方猜 |

- 证据**只增不改**：没有「删除证据」的子命令。要纠正结论就追加新证据 + 改 `state`。
- `rejected` 至少 1 条；其余状态可为空数组。

---

## 6. 读写契约（`_lifecycle.mjs`）

| 环节 | 规则 |
|---|---|
| 读 | 文件不存在/非法 JSON/顶层非对象 → `CliError` → CLI exit 1 并给提示；不存在时只有 `add` 会当作空账本（`loadLifecycleOrEmpty`）。字段级问题不在读取阶段报，交给 `check` |
| 校验 | `validateItem` / `validateLifecycle` → `[{ code, pkg, field, detail }]`；`check` 打印全部并 exit 1 |
| 写 | **先校验再写**：任一违反 → 抛错、**文件保持原样** |
| 原子性 | 同目录写 `<file>.tmp-<pid>-<ts>` → `rename`；失败清理 tmp，不留半截文件 |
| 字段序 | 落盘按固定字段序（`pkg…evidence`），便于 git diff；未知字段附在末尾 |
| 路径守卫 | 拒绝写：lab 目录内、profile 目录内、`cordis.patch.yml`、路径含 `.dsh-market`。lab 只读，建议只写 `out/` |
| 时间 | `--now` 支持 `YYYY-MM-DD`（补 `T00:00:00Z`）与 `YYYY-MM-DDTHH:mm:ssZ`；不传用真实时钟 |

**`sync` 的建议口径**（为什么不把 candidate/rejected 写进 lab 已装表）：

| state | 是否进 `out/sync-suggestions.md` | 理由 |
|---|---|---|
| `candidate` | ❌ | 还在评估，lab 已装基线不该被「候选」污染 |
| `trial` / `adopted` / `dormant` | ✅ | 已经装上或在用/用过，lab 该有登记 |
| `rejected` | ❌ | 归 `out/rejected-<date>.md`（建议进 lab 的 `rejected.md`），不进已装表 |

---

## 7. 与 A 阶段的关系（红线继承）

| A 阶段红线 | 在 B 阶段怎么落地 |
|---|---|
| R-1 只读 profile/lab | 本工具只写 `data/lifecycle.json` 与 `out/*.md`；写 lab / profile 路径被 `assertSafeLifecyclePath` 拒绝（exit 1） |
| R-2 不猜（读不到写 null） | `verifiedVersion` 只取 profile 实测；读不到 → 写 `null`（`note`）或**拒绝迁移**（`promote --to adopted`）。不填 `"unknown"`、不填 `"0.0.0"` |
| R-3 权限栏读不到写「待补」 | `sync` 的建议片段里权限四项固定写 `待补｜待补｜待补｜待补` |
| 零依赖 / ESM / `node:` 内置 | `_lifecycle.mjs`、`lab-triage.mjs`、`_profile.mjs` 全部遵守 |

复用：解析口径（profile / `package.json` / lab 表格）来自 `../tools/_profile.mjs`（A 阶段同一份实现，
逐行搬运、零行为变更），裁决见 `../docs/RULES.md` §9.5。

---

## 8. 已知限制

- **不联网**：不查 npm registry、不判版本新旧；`verifiedVersion` 只反映本地实测。
- **不做「活跃度」判断**：`due` 只看日期，不判断「这个包还有没有在维护」（那是 lab G3 的人工项）。
- **不加锁**：同一账本并发写可能后写覆盖先写（tmp+rename 只保证不出现半截文件）。单人使用场景够用；
  要并发必须外部串行化。
- **`pkg` 唯一性包含 kind 前缀**：`foo` 与 `skill:foo` 是两条不同条目（一个是插件、一个是技能）。
- **迁移不可逆**：`rejected` 终结；`since` 只记当前状态起点。历史靠 `evidence` 追，不靠回滚。
