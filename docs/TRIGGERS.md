# TRIGGERS · lab-guide 触发条件表（C 阶段：行为层）

> 版本 v1.2（文档层去掉 `lab-guide/` 路径前缀：发布仓根即 lab-guide 目录，命令一律相对仓库根）｜最后核实：SKILL.md v1.1「§自检 › 命令校对表」（按文件分列三张表：`tools/lab-drift.mjs` / `tools/lab-triage.mjs` / `tools/lab-analyze.mjs`，行号取自各文件的 USAGE 与参数解析器）｜状态：有效
> 上游：入口与卡模板见 [`../SKILL.md`](../SKILL.md)；判定语义见 [`RULES.md`](RULES.md)；状态机见 [`../data/schema.md`](../data/schema.md)
> 作用：把「用户说了什么」映射到「先跑哪条命令」，并规定**什么时候闭嘴**。本文只写触发与话术，不写判定规则。

---

## 0. 一页速查

| 用户话语模式 | 入口 | 先跑什么 | 期望输出 | 不满足时怎么办 |
|---|---|---|---|---|
| 「要不要装 X」「X 值不值得」「X 有什么坑」 | 评估 | `node tools/lab-triage.mjs list --json` | 评估卡（结论三选一 + 权限四项 + 兼容三档 + G1–G5） | 账里已有 adopted → 转复核；已有 rejected → 直接引用淘汰理由；读不到证据 → 写「待补/未验证」，结论给「观察」 |
| 「我装了 X」「刚装完」「装完有点问题」 | 登记 | `node tools/lab-drift.mjs` | 登记卡（真实安装事实 + 差异类型 + 账本动作） | 跑不了 node → 读 `package.json` + `node_modules/<pkg>/package.json` + lab 表格，标「未经脚本校验」 |
| 「到期了」「这批还用吗」「该清一清了吗」 | 复核 | `node tools/lab-triage.mjs due` | 复核卡（到期原因 + 事实核对 + 结案三选一） | 账本为空 / 无到期项 → 一句话说明「无到期项」，不展开 |
| 「有新版本了」「版本对不上」「升级怎么处理」 | 更新 | `node tools/lab-drift.mjs --json` | 更新卡（lab 登记 vs 实测 vs 声明 + 账本动作） | 不联网，无法确认上游是否真有新版 → 只写「用户告知」，不写「已确认」 |
| 「profile 和 lab 对不上」「核一下基线」 | 登记（对账支线） | `node tools/lab-drift.mjs` | 差异摘要（≤3 句）+ 指向四类差异 | 无差异 → 静默（见 §3） |
| 「市场里有没有做 X 的插件 / skill」「有没有现成的能…」 | 搜索（召回） | `node tools/lab-analyze.mjs --search <关键词>`（一句话目标可用 `--goal "<一句人话目标>"`，池内诊断：不做语义理解、只做字面匹配） | 三源命中表（source ｜ 已装 ｜ stars ｜ downloads ｜ redLines）+ 末行计数 | 池中无命中 → 只给「最接近 3 条」，不造候选；要取证就按包名转 `lab-analyze <pkg>` |
| 「这个包要什么权限」「会不会抢别人的行」 | 取证 | `node tools/lab-analyze.mjs <pkg>`（全景用 `--scan-all`） | 权限四项四档 + row 争用（`COLLIDES_WITH_HOST` danger / `COLLIDES_WITH_PLUGIN` warn / 覆盖官方行 info） | 未装 → 权限固定 `unknown（未安装，本地无代码）`；官方 row 读不到 → `COLLIDES_WITH_HOST` 记 unknown，不猜 |

> 统一前置：在仓库根目录（即 `lab-guide/`）执行；`--profile` 默认值由环境变量推导（`DSH_PROFILE_DIR` / `DSH_HOME` / `~/.dsh`），`--lab` 必须显式给或设 `LAB_DIR`（不给会 exit 1）；只有核夹具或换 profile 时才显式给 `--profile`。

---

## 1. 详细触发规则

### 1.1 评估入口

| 话语模式（中/英） | 动作 |
|---|---|
| 「要不要装 X」「X 好用吗」「帮我看看值不值得装」「X 有没有坑」 | 走评估 |
| 「有没有适合 Y 的插件」「有别的选择吗」「跟现在这个重复吗」 | 走评估 + 同轨去重（`list --state adopted` / `--state rejected`） |
| should I install X / is X worth it / any risk with X | 走评估 |
| 「X 装哪个版本好」（尚未安装） | 走评估；版本只写「待补」，不猜 |

先跑顺序固定三步，不许跳：
1. `node tools/lab-triage.mjs list --json`（防重复、防把候选当已装）
2. `node tools/lab-drift.mjs --explain <pkg>`（本机是否已在 `node_modules`）
3. 同轨去重：`node tools/lab-triage.mjs list --state adopted` 与 `--state rejected`

**不满足时怎么办**

- 第 1 步账本不存在 → `loadLifecycle` 会报错 exit 1；改用 `node tools/lab-triage.mjs add …` 的前提是先确认 `data/lifecycle.json` 存在（空种子 `{schemaVersion:1, updatedAt, items:[]}`）；仍不行 → 降级：直接读 `data/lifecycle.json` 文本。
- 第 2 步 exit 1（profile 读不到）→ 结论里写「profile 不可读，本机安装状态未知」，不要写「没装」。
- 评估不需要 `pull`/registry；用户要求「查一下市场有没有更好的」→ 明确告知这是 C.1（需单独授权），本阶段只做本地同轨去重。

### 1.2 登记入口

| 话语模式 | 动作 |
|---|---|
| 「我装了 X」「刚把 X 装上了」 | 走登记，先 `lab-drift` 确认是否真的 `UNREGISTERED` |
| 「装完报错了 / boot 挂了」 | 先 `lab-drift` 取证，再给登记卡；**不给修复命令**（修 profile 不是本技能职责） |
| 「X 需要登记吗」 | 走登记；结论二选一：已登记（给版本对照）／未登记（给 `add` + `promote` 建议） |

先跑：`node tools/lab-drift.mjs`（要机读加 `--json`；要留档才 `--write-report out/drift.md`）。

**不满足时怎么办**

- `UNREGISTERED` 里没有这个包，但它确实在 `node_modules` → 可能是传递依赖或孤儿：
  `node tools/lab-drift.mjs --explain <pkg>` 判定；`orphan: false` 且被别的包引用 → 属正常安装形态，不登记，说明一句即可。
- `add` 报 `pkg 已存在` → 不要重建；用 `promote` 或 `note` 承接（`list --json` 看现状态）。
- `promote --to adopted` 报「读不到 profile 实测版本」→ 停在 `trial`，写「版本读不到，待补」；**不许**手填版本号绕过。
- `--kind` 与 pkg 前缀不一致（如 `--pkg skill:foo --kind plugin`）→ exit 1；按 `data/schema.md` §2.1 改正前缀或 kind。

### 1.3 复核入口

| 话语模式 | 动作 |
|---|---|
| 「到期了」「该复核了」「这些装着的还有用吗」 | 走复核，先 `due` |
| 「trial 什么时候到期」 | `node tools/lab-triage.mjs list --state trial` |
| 「X 还要留吗」「能不能删」 | 走复核；结论落到 `note`（留）/ `dormant`（暂不用）/ `rejected`（淘汰） |
| 「清一下账」「rejected 有哪些」 | `node tools/lab-triage.mjs list --state rejected`，并指向 `out/rejected-<date>.md` |

先跑：`node tools/lab-triage.mjs due`，再 `node tools/lab-drift.mjs` 核对事实。

**不满足时怎么办**

- `due` 输出「（无）」→ 静默：不写卡，只回「无到期项」一句（见 §3）。
- 用户想删的东西是 `adopted` 但从未 `note` 过 → 先 `note --type usage` 记录判断依据，再 `promote`；不许直接给 `dormant`/`rejected` 而没有任何证据。
- `promote` 报「非法迁移」→ 按 `data/schema.md` §3.2 给合法路径（例如 `trial` 只能进 `adopted` / `rejected`；`adopted` 不能回 `trial`）；**不要**建议改账本文件绕过。
- `check` 报违反 → 先修不变式（补 `reason`/`evidence`/`trialUntil`/`watch`），不要在违反状态下继续迁移。
- `rejected` 想复活 → 只能 `add` 新条目（新 pkg 或新版本命名）；历史只增不改。

### 1.4 更新入口

| 话语模式 | 动作 |
|---|---|
| 「X 发新版了」「上游更新了」 | 走更新：`lab-drift --json` 看 `VERSION_DRIFT`，再 `note --type update` |
| 「lab 记的版本跟实际不一样」 | 走更新；只比实测值，不按 `^`/`~` 区间推断 |
| 「要不要升级 / 怎么升级」 | 给更新卡；**升级动作不由本技能执行**，只给「账本怎么记 + 建议怎么刷新」 |
| upgrade X / bump X | 同上；并说明本阶段不联网、不判版本新旧 |

先跑：`node tools/lab-drift.mjs --json`。

**不满足时怎么办**

- 没有 `VERSION_DRIFT` 但用户坚持说有新版 → 记「用户告知」，`note --type update` 里写清来源；不声称已验证。
- `note` 后 `verifiedVersion` 为 `null` → 卡上写「版本读不到（<原因>）」，不留空、不填 `0.0.0`。
- 仍在 `trial` 且要转 `adopted` 但读不到版本 → 保持 `trial`，等下一次核对；不许跳级或手改账本。

---

## 2. 不该触发的情况

命中以下任一，**不要**拉 `lab-drift` / `lab-triage`，也不要贴卡：

| 情形 | 例子 | 正确反应 |
|---|---|---|
| 闲聊 / 情绪表达 | 「今天好累」「这插件真难用啊」（无动作意图） | 正常对话；不查账 |
| 与本机 profile / lab 无关的技术问题 | 「React 的 useEffect 怎么用」 | 正常回答；不查账 |
| 用户明确说不用管 | 「先别核对了」「lab 的事我自己来」「不用查 profile」 | 尊重；一句话确认即可 |
| 纯文本内容工作 | 写文档、改代码、翻译 | 不查账（除非涉及"要不要装/装了没"） |
| 用户只要"结论不要流程" | 「你就说装不装」 | 给评估卡的结论行 + 一句理由；仍不省"未验证项" |
| 目标不是 DSH 插件/技能/MCP | 「装个 VS Code 插件」「装个 Python 包」 | 不当成本技能对象；如需记录，先问是否纳入 lab 轨 |
| 要求安装 / 卸载 / 改 profile / 写 lab | 「你直接帮我装上」「顺手把 lab 改了」 | 明确边界：本技能只对账与记账，动作由用户/主对话执行 |

---

## 3. 静默规则（少说话，说准话）

### 3.1 无差异不说话

- `lab-drift` 跑出 `verdict: 0 drift(s)` 且用户没问"有没有问题" → **不主动播报**，不贴 summary，不贴表。
- `due` 输出 `due: 0 trial(s) / 0 adopted(s)` → 只在用户明确要求复核时回一句「无到期项」，否则不提。
- `list` 为空账本 → 不主动提示"你还没记账"，除非用户正在问该包的登记/复核。

### 3.2 有差异才报，且最多 3 句

固定三句式（第 4 句起必须停）：

1. **结论句**：差异类型 + 数量 + 最该处理的那一条（例：`UNREGISTERED 2 条，最该先补的是 dsh-purge-community`）；
2. **证据句**：命令 + 关键字段（例：`node tools/lab-drift.mjs 报 dependencies 声明 0.3.1、node_modules 实测 0.3.1、lab 无条目`）；
3. **下一步句**：一条命令或一个决定（例：`要登记就 add + promote --to trial，要我出登记卡吗`）。

超过 3 句即视为噪音：细节进卡，不进口播。

### 3.3 例外（可以超 3 句）

只有三种：用户明确要求「详细说说」；结论是 `不装`/`淘汰`（必须给完整理由与证据）；安全红线相关（`PERMISSION_TODO` 涉及凭据/命令执行，必须逐格说清）。

### 3.4 不许静默的事

| 情形 | 必须说 |
|---|---|
| `PERMISSION_TODO` 命中（权限四项未结论） | 说清命中的字样与 `文件:行号` |
| 拒绝写入（`--write-report` 指到 profile/lab） | 说清被拒原因与 exit 1 |
| 读不到版本 / profile 不可读 | 说清"读不到 + 不猜" |
| 迁移被拒（非法迁移） | 说清 from → to 与合法替代路径 |
| 降级模式（未跑脚本） | 必须标「未经脚本校验」 |

---

## 4. 与 SKILL.md 的一致性

- 本表的每条命令必须与 [`../SKILL.md`](../SKILL.md) 的「工具命令表」逐字一致；改参数名要两处同时改。
- 表中所有"期望输出"对应 SKILL.md「输出卡模板」的四张卡；本表不重复卡面字段。
- 判定语义（四类差异、info、优先级）只引用 [`RULES.md`](RULES.md) §3、§4，不在本表复述。

## 5. 自检

- [ ] 每条触发都有"先跑什么"，且命令可在仓库根目录直接复制执行；
- [ ] 每个入口都有"不满足时怎么办"，且不含"猜一个值"的退路；
- [ ] 「不该触发」与「静默规则」互不矛盾（不该触发 = 完全不查；静默 = 查了但无差异不播报）；
- [ ] 3 句上限有例外条款，且例外不含"随便展开"；
- [ ] 没有夸大能力的表述（不宣称安装动作、兼容性、运行结果已验证）。
