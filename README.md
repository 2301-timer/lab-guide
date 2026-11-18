# lab-guide · DSH plugin audit & lifecycle CLI

> 面向使用者；开发与内部背景见 README-DEV.md
>
> 版本 v1.3（布局说明 + 夹具试跑入口；文档层去掉 `lab-guide/` 路径前缀）｜最后核实：commit 未取（建仓时补）｜状态：有效
>
> 本文件即发布版 README（建仓时由 `PUBLISH-README.md` 改名为 `README.md`，原技术长文改名为 `README-DEV.md`）。
> 技术长文里有逐条验收命令、期望输出与未执行项，属**证据层**，不在本文件复制。

> **布局说明**：本仓库根目录就是 `lab-guide` 目录；下文命令均在仓库根执行。

---

## 一句话

一组**只读的本地命令行**：把「你机器上装了什么插件」「市场与官方目录里有什么」「这个包要什么权限、会不会抢别人的配置行」
摆到一张表上，让你自己判断；**安装、卸载、升级永远由你在 DSH 里点**，这套工具不碰。

零依赖（只用 node 内置模块），跑完不留副作用：除了你显式要求写的一份报告，它不改任何文件。

---

## 它能替你做什么

| 能 | 怎么用 | 作者机器实测口径（非承诺） |
|---|---|---|
| 在 **11,183** 条的池子里按词找候选（registry 快照 10,974 ｜ 离线目录 195 ｜ 已装 14） | `--search <词>` | `--search 直播` 命中 **15** 条 |
| 用一句人话做「池内诊断」，结果分**强 / 弱 / 仅字面**三层展示 | `--goal "<一句目标>"` | 「我想学嵌入式，从连板子到画 PCB」→ 强 **0** ｜ 弱 **9** ｜ 仅字面 **45**（这是正常输出，不是故障） |
| 看一个**已装**包的权限四档（文件 / 网络 / 命令 / 凭据）与「会不会抢别人的行」 | `lab-analyze <pkg>`；全量矩阵 `--scan-all` | 抢宿主行判 `danger`，抢第三方行判 `warn` |
| 把「实际装了什么」和「文档里登记了什么」对一遍账（4 类差异 + 2 类 info） | `lab-drift` | 只报告，不修 |
| 把「这个包要不要留下」记成一本可审计的账（试用 → 采用 / 淘汰 / 休眠） | `lab-triage list / promote / due / note / sync` | 默认试用 14 天，采用后 30 天没核对就进「该复核」 |

---

## 它不能替你做什么

| 不能 | 为什么 |
|---|---|
| **判断这个方向该不该学** | 它只回答「池子里有没有字面命中」，不回答「值不值得学」。方向判断是你的，工具只给证据。 |
| **替你装、替你卸、替你升级** | 它不写 DSH 的 profile、不改 `cordis.patch.yml`、不碰 `.dsh-market`。安装永远走 DSH 的 `设置 → 插件`，或市场客户端（如 `dshmarket`）。 |
| **给未安装的包一个权限结论** | 本地没有代码就没有证据，四档一律固定写 `unknown（未安装，本地无代码）`，不推断。想要结论就先装／解包，再用 `--from-dir <目录>` 分析。 |
| **替你想出「市场里管它叫什么」** | `--goal` / `--search` **不做语义理解，只做字面匹配**。你说的词和市场用的词不重合 → 命中 0。报告里的 `## 词表诊断` 会告诉你哪个词在池里 0 条，但换词要靠你。 |
| **给兼容性下结论** | 没在本机真装过，兼容性只能是「未知」；`engines` 字段只算「声明」。 |

---

## 它怎么用（真实例）

下面全部来自作者本机的一次真实运行（DSH 宿主 + 市场快照），不是演示数据；换台机器，命中条数会变。

### ① 召回要拆词：整词搜 = 0 条

| 命令 | 结果 |
|---|---|
| `--search 直播` | 命中 **15** 条 |
| `--search 推流` | 命中 **4** 条 |
| `--search 直播推流` | 命中 **0** 条 |

同一样东西，市场条目里有的写「直播」、有的写「推流」，几乎没有哪条写完整的「直播推流」。
工具**不做语义理解，只做字面匹配**，所以正确用法是：**把它拆成两个词分别搜，再看两边结果的交集/并集**；
写成一个整词，就是 0 条——这不是工具坏了，是「字面没重合」。

### ② 15 条里真正对口的那一条

`--search 直播` 的 15 条里，只有一个包是真的做直播推流的：

| 包 | stars | 分发形态 | 上游标注的红线 |
|---|---|---|---|
| `Deiael/dsh-live-vibeCoding` | **37** | **GitHub-only**（市场条目里 `npm=null`，没有 npm 包） | **读凭据 + 能联网** |

请注意工具在这里给了你什么、没给什么：

- **给了**：「这条确实对口」+「它要凭据、要联网」+「它不是从 npm 装的」——三条都是硬证据；
- **没给**：「值不值得装」。`redLines` 是**上游自述**，工具不核实，也不会因为 37 颗星就替你排序。

装不装仍然由你决定；决定之后，把包名交给 `lab-analyze <pkg>` 看权限与 row 争用。

### ③ 对一遍账：本机实测 12 条差异

```bash
node tools/lab-drift.mjs
```

作者机器实测：**12 drift（3 UNREGISTERED / 9 VERSION_DRIFT）** —— 3 个是「装了但文档里没登记」，
9 个是「文档记的版本和实际装的版本对不上」。工具只报告，不改 profile、不改文档、不升级。

这就是这套工具存在的理由：这两类问题不会让 DSH 崩溃，但会让「已装基线」变成一本假账。

---

## 上手（三条命令 + 一次本地准备）

前提：Node（ESM）。零依赖，不需要 `npm install`。**在仓库根目录执行**（本仓库根目录就是 `lab-guide`，下文所有 `tools/…`、`data/…`、`fixtures/…` 都相对于它）。

### ⓪ 先在本机生成离线目录（`--search` 的前置）

```bash
node tools/_catalog.mjs --write
```

它从**本机插件管理器的构建产物**里抽出官方模块的中文名 / 描述 / 分类，落成 `data/catalog.json`。
**这个快照不进仓库**（来自第三方构建产物，再分发条款未核实），所以每台机器自己生成一次。

不生成也能用一部分功能：`lab-analyze <pkg>` / `--scan-all` / `--goal` 会跳过目录那一级并告警；
而 `--search` / `--unknown` 会**明确 exit 1** 并提示这句命令——它不会返回空列表冒充「搜索完成」。

> `data/host-rows.json`（官方 row 快照）同样不进仓，且**本仓不提供生成脚本**：它来自本机宿主 `app.asar` 的内部产物。
> 缺它不影响使用，只是 row 争用结论降级为 `unknown`、verdict 封顶「观察」。若你有自己的快照，用 `--host-rows <文件>` 指过去。

### ① 拓一次市场快照（唯一联网动作，且只连本机）

```bash
node tools/_registry.mjs --url http://127.0.0.1:<PORT>/dsh-market/registry --write
```

**`<PORT>` 怎么找**：就是你浏览器里 DSH 界面地址 `http://127.0.0.1:<PORT>/` 里的那个端口；也可以在 DSH 的「设置 / 关于」
里看本地服务端口。作者本机是 `54344`，**这只是示例，不是固定值**。

工具**不猜端口**：不给端口、给了非 loopback 主机、或用了 `https` → 直接 `exit 1` 并说明原因。

跑完会在 `data/registry.json` 落一份快照（**不进仓库**，每台机器自己抓）。没抓也能用：工具会照实写
「registry 不可用」，只用离线目录 + 已装包两个源。

### ② 搜

```bash
node tools/lab-analyze.mjs --search 直播
```

末行固定给池子构成，例如 `匹配 N 条 / 池 11183（registry 10974 ｜ catalog 195 ｜ 已装 14）`。
搜不到就写「池中无匹配」+「最接近的 3 条」，**不会硬凑候选**。

### ③ 取证

把第 ② 步命中的包名交给它：

```bash
node tools/lab-analyze.mjs <pkg>
```

输出五段：用途 → 权限四档 → row 争用 → 同轨重复 → 建议分类，最后一行是 `verdict: 装 / 观察 / 不装`。

### ④ 没有 DSH 也能试（跑夹具，不碰你本机）

```bash
node tools/lab-analyze.mjs --registry fixtures/registry-sample-v2.json --search 直播
```

样例池是合成的，只为让你看到输出长什么样，不代表真实市场。它不需要真 profile、不需要抓市场快照，
适合第一次打开仓库时确认「命令能跑、输出长这样」。

---

## lab 是什么？没有也能用吗？

先给结论：**lab 是可选的**。不建它，大部分功能照跑；只有「对账」和「同轨重复」这两段需要它。

### 1. lab 是什么

一个**你自己的本地目录**，里面放你写的插件评估记录（Markdown，至少一个 `installed.md`）。
工具把它当成「**已装基线**」用：

- `lab-drift` 拿它和 profile 里**实际装的**对一遍（4 类差异 + 2 类 info）；
- `lab-analyze` 的「同轨重复」段拿它的**类别列**判断「这个包是不是跟已有条目同轨」。

两个前提要说清：

- **它不是插件本体**：不参与加载，DSH 不读它；删掉不影响任何插件运行，代价只是「账没了」。
- **工具只读它、永不写它**：`--write-report` 指到 lab 目录内会被直接拒绝；想让 lab 变，只能你自己编辑。

**文件格式（按实现）**：一张 Markdown 表，行里要有「包名」「版本」两列；另需一列含「状态 / 基线 / 结论」
用来判定是否算已装基线；「权限」列可选（缺了就没有 `PERMISSION_TODO` 结论）；「类别」列供同轨判定。
包名**必须用反引号包住**（`` `pkg-name` ``），否则该行被跳过并告警。拿不准就照抄模板：`fixtures/fake-lab/installed.md`。

### 2. 没有 lab 也能用

| 入口 | 要 lab 吗 |
|---|---|
| `--search <词>` | 不要 |
| `--goal "<一句目标>"` | 不要 |
| `lab-analyze <pkg>`（取证） | 不要；只有报告里的「同轨重复」段会跳过 |
| `--scan-all`（全量矩阵） | 不要；同上 |
| `lab-triage list / add / promote / due / note / check` | 不要 |
| `lab-triage sync` | **要**（它得知道哪条已经在 lab 里） |
| `lab-drift` 的差异判定 | **要** |
| `lab-analyze` 的「同轨重复」段 | **要** |

缺 lab 时，上面这两处**跳过并给提示**，不拦整份报告，也不需要「先建 lab 才能看结果」——**按实现**；
降级逻辑正在合入，若你手上的版本仍提示 `--lab 不能为空`，先用夹具占位（见 §3 第三种给法）。

### 3. 三种给法（按推荐顺序）

**① 环境变量**：设一次，当前终端里所有命令都生效（推荐）

```powershell
$env:LAB_DIR = "D:\my-lab"     # PowerShell
```

```bash
set LAB_DIR=D:\my-lab          # cmd
export LAB_DIR=~/my-lab        # bash / zsh
```

**② 命令行**：只对这一次生效

```bash
node tools/lab-drift.mjs --lab <你的目录>
node tools/lab-analyze.mjs --lab <你的目录> <pkg>
```

**③ 先用夹具试**：不用准备任何东西，跑完就知道输出长什么样

```bash
node tools/lab-drift.mjs --profile fixtures/fake-profile --lab fixtures/fake-lab
```

`LAB_DIR` 与 `--lab` 都没给时，**默认就是「未指定」**（按实现），不会偷偷拿当前目录冒充你的 lab。

### 4. 想从零建一个：三步

1. **建目录**：`D:\my-lab`（Windows）或 `~/my-lab`；位置随你，别放进插件目录里。
2. **建 `installed.md`**，先只写表头，一行就够：

```markdown
| 包名 | 版本 | 类别 | 作用 | 权限（代码级） | 副作用/冲突 | 结论 |
|---|---|---|---|---|---|---|
```

3. **让它自己长**：先用 `lab-triage add` 记候选、评估完 `promote`，再跑
   `node tools/lab-triage.mjs sync --lab <你的目录>`——它把「账本里有、lab 没登记」的条目生成成 Markdown 片段，
   写到 `out/sync-suggestions.md`，**你复制进 `installed.md` 即可**（工具绝不代写 lab）。

格式拿不准就读 `fixtures/fake-lab/installed.md`：那是能直接跑通的模板，而且它故意**没有** `INDEX.md`，
用来证明「只有 `installed.md` 也能跑，只是少一侧判定并给告警」。

### 5. `--profile` 同理：默认只是常见约定，不是唯一

- 不传 `--profile` 时，按实现依次取：`DSH_PROFILE_DIR` → 绝对路径的 `DSH_PROFILE` →
  `<DSH_HOME>/profiles/<DSH_PROFILE，缺省 desktop>` → `~/.dsh/profiles/desktop`。
- **不是 DSH 用户**（或 profile 不在默认位置）：`--profile <任意目录>`，只要该目录里有 `package.json`；
  缺 `dependencies` / `dsh.profile.bundles` 时，对应结论不生成并给告警，工具不猜。
- `lab-triage promote <pkg> --to adopted` 额外需要 profile 的**实测版本**，读不到就拒绝迁移，不填默认值。
- 想先看看效果，两处都指到夹具：`node tools/lab-analyze.mjs --profile fixtures/fake-profile --lab fixtures/fake-lab <pkg>`。

---

## 数据来源与边界

| 数据源 | 在哪 | 谁读 | 联网 |
|---|---|---|---|
| 市场快照（10,974 条） | `data/registry.json`（**不进仓库**，你自己抓） | `lab-analyze` 只读 | 抓取那一刻连本机；此后不联网 |
| 离线目录（195 条中文名 / 描述 / 分类） | `data/catalog.json`（**不进仓库**；`node tools/_catalog.mjs --write` 从本机插件管家构建产物抽取） | `lab-analyze` 只读 | 不联网 |
| 已装包（作者机器 14 个） | 你的 DSH profile `node_modules/` | 三个 CLI 只读 | 不联网 |
| 官方 row id 快照 | `data/host-rows.json`（**不进仓库**，本仓不提供生成脚本；缺失时自动降级） | `lab-analyze` 只读 | 不联网 |
| 你的试用账本 | `data/lifecycle.json`（**不进仓库**） | `lab-triage` 读写 | 不联网 |

**硬边界**

- **只有 `_registry.mjs` 会联网，而且只连本机 loopback**：白名单 `127.0.0.1` / `localhost` / `[::1]`，协议只允许 `http:`，
  端口必须显式写，不跟随 3xx 重定向，`https` 直接拒绝。它不是通用 HTTP 客户端。
- 响应默认上限 64 MiB（`--max-bytes` 可覆盖）；超限**立即中止、不写半截快照**。
- 其余全部本地只读：不查 npm、不查远端 README、不判断「上游有没有发新版」。
- 不写 profile、不写 `cordis.patch.yml`、不写外部 lab 目录；唯一的写动作是 `--write-report <path>`（以及 `lab-triage` 写自己的账本）。
- 快照是**某个时刻的镜像**：市场增删插件后不会自动更新，报告头永远写抓取时间与来源。

---

## 目录结构

```
.
├─ README.md            # 本文件：面向使用者
├─ README-DEV.md        # 技术长文：逐条验收命令、期望输出、未执行项
├─ SKILL.md             # 给 agent 的入口说明（何时触发、四个入口、红线）
├─ KNOWN-LIMITS.md      # 已知限制（15 条，逐条给「现象 / 原因 / 怎么办 / 会不会修」）
├─ CHANGELOG.md
├─ PUBLISH-CHECKLIST.md # 进仓 / 不进仓 / 脱敏 / 建仓前 5 步
├─ LICENSE              # MIT（只覆盖代码；数据快照不进仓）
├─ tools/
│  ├─ _profile.mjs      # 解析内核：profile、package.json、lab 表格
│  ├─ _lifecycle.mjs    # 账本读写 + 原子写 + 路径守卫
│  ├─ _catalog.mjs      # 离线目录抽取 / 校验（本地生成 data/catalog.json）
│  ├─ _registry.mjs     # 市场快照抓取（唯一联网点，只连 loopback）/ 导入 / 校验
│  ├─ lab-drift.mjs     # 对账器
│  ├─ lab-triage.mjs    # 生命周期状态机
│  └─ lab-analyze.mjs   # 分析器：权限四档 / row 争用 / --search / --unknown / --goal / --scan-all
├─ data/
│  └─ schema.md         # 账本字段与状态机（权威）
├─ docs/
│  ├─ RULES.md          # 判定规则的唯一语义权威
│  ├─ LABELS.md         # 分类词表（工具运行时读它）
│  ├─ TRIGGERS.md       # 什么时候该触发、什么时候闭嘴
│  └─ ROADMAP.md        # 阶段规划
├─ fixtures/            # 全部合成夹具（fake-profile / fake-lab / fake-nm / catalog-profile）
└─ out/                 # 产物目录（.gitignore，不进仓库）
```

**不进仓库的四个文件**：`data/registry.json`（市场快照，十几 MB，可重抓）、`data/lifecycle.json`（你的使用记录）、
`data/catalog.json`（第三方构建产物 + 作者本机路径）、`data/host-rows.json`（宿主内部产物 + 作者本机路径）。
前两个「可重抓」，后两个「自己生成 / 缺失即降级」，见上手 ⓪。

---

## 已知限制

完整 15 条见 [`KNOWN-LIMITS.md`](KNOWN-LIMITS.md)。最短版本：

- **`--goal` 强匹配 0 是正常输出**，先看报告里的 `## 词表诊断`，换词再搜；召回请用 `--search`。
- **只做字面匹配**：不做语义理解，没有词向量、没有同义词表；换个说法就可能 0 命中，这是设计而不是缺陷。
- **权限四档是采样 + 关键字计数**：只扫 `.js` / `.mjs`，>2 MiB 单文件跳过，`.ts` / `.cjs` 只计数不扫；命中即报，注释里的 `token` 也会命中。
- **`--unknown` 的末行 0 不等于没有账要补**（末行只数 P1）。
- **未装的包权限永远是 `unknown`**。
- **`redLines` 是上游自述**，工具不核实。
- **快照会过期**（market / 官方 row / 目录三处都会）。

---

## English summary

lab-guide is a zero-dependency, read-only command-line toolkit for auditing DSH plugins and skills **on your own machine**.
It reconciles what is actually installed against a local registry of what is documented (`lab-drift`), records keep-or-drop
decisions as an auditable five-state lifecycle (`lab-triage`), and produces static evidence for a candidate package —
file / network / command / credential capability tiers, plus configuration-row contention against official rows
(`lab-analyze`). Candidate recall runs over three local sources (a market snapshot, an offline catalog, and installed packages)
with plain substring matching: it does **not** understand meaning, it does **not** rank by popularity, and it never installs,
uninstalls, upgrades, or rewrites your profile. Only one tool touches the network, only `http://` on loopback with an explicit
port, and only when you run it yourself. Permissions for packages that are not installed locally are always reported as
`unknown`. Known limits are listed in `KNOWN-LIMITS.md`.

Note: `data/catalog.json` and `data/host-rows.json` are **not** shipped in this repository — generate the first locally with
`node tools/_catalog.mjs --write`; the second has no generator here and degrades gracefully when absent.

---

## 分发方式

**不发布到 npm**：没有 `package.json`、没有 `bin`，克隆下来直接 `node tools/<cli>.mjs`。
这样「零依赖」不会被 npm 的依赖树破坏，也不会出现「装了但版本对不上」这类它自己要查的问题。

---

## 许可证

**MIT，只覆盖本仓库的代码**：`tools/`、`docs/`、`fixtures/`、`SKILL.md` 与各 `.md` 文本。建仓时随仓库放 `LICENSE`。

**不覆盖**：`data/catalog.json`、`data/host-rows.json`、`data/registry.json` —— 三者分别来自第三方插件的构建产物、
DSH 宿主内部产物与市场服务，**都不进仓**，各自的重分发条款未核实。需要就在本机自己生成，见「数据来源与边界」。
