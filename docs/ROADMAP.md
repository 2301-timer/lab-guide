# ROADMAP · lab-guide 四阶段

> 基线：lab-guide v0.1.0（2026-11-14）｜当前阶段：**A（已交付代码，待环境执行）**
> 总原则：**本工具链永不写 profile、永不装插件、永不写 `cordis.patch.yml`。** 一切「安装/卸载/升级」只由主对话执行（lab README §9.2）。
> 事故背景：一次 junction 安装 + 手写 client 产物把 web boot 打挂，patch 层又被应用自愈重写（事故记录不进仓，见仓库 issue 记录）。所以 A/B/C/D 全部按「只读优先、变更靠人」设计。

---

## A 阶段 · 只读对账器（当前）

**产出**：`tools/lab-drift.mjs`、`fixtures/*`、`docs/RULES.md`

**做什么**
1. 读 profile：`package.json` 的 `dependencies` + `dsh.profile.bundles` + `node_modules/<pkg>/package.json` 实测版本。
2. 读 lab：`installed.md` 表格（第一列反引号包名 / 第二列版本）+ `INDEX.md` PLG 表（第二列 `pkg@ver`），并集去重。
3. 输出四类差异 `UNREGISTERED / MISSING / VERSION_DRIFT / PERMISSION_TODO`，各带 `kind + pkg + evidence`。
4. 额外输出两类 info `ROSTER_ONLY / ORPHAN_IN_NM`，不计入 verdict。
5. 默认 md 给人看，`--json` 给机读；`--fail-on-drift` 供 CI；`--write-report` 是唯一写动作。

**验收（必须全部满足）**
| # | 验收项 | 通过标准 |
|---|---|---|
| A-1 | 夹具四类各命中一条 | `--profile fixtures/fake-profile --lab fixtures/fake-lab` → exactly 1×UNREGISTERED(epsilon) + 1×MISSING(delta) + 1×VERSION_DRIFT(alpha) + 1×PERMISSION_TODO(gamma)，`verdict: 4 drift(s)` |
| A-2 | 真实环境命中两条 UNREGISTERED | 不带参数跑 → 报出 `@txc2768651338/dsh-plugin-manager` 与 `dsh-purge-community` |
| A-3 | 只读 | 除 `--write-report` 外不产生任何文件；写目标在 profile/lab 内、或为 `cordis.patch.yml`、或含 `.dsh-market` → exit 1 |
| A-4 | 不猜 | 版本读不到 = `null` + evidence 原因 + warning；任何默认值都算不通过 |
| A-5 | 退出码 | 无差异 0；有差异默认 0；有差异 + `--fail-on-drift` = 2；异常 = 1 |
| A-6 | 零依赖 | 只有 `node:` 内置 import；ESM；无 package.json 依赖 |

**不做**：不判 G2/G3/G4 的人工结论、不判评分、不生成维护卡、不写 lab。

---

## B 阶段 · lab 文档只读 lint（下一阶段）

**目标**：把「条目写得合不合规」变成可机器检查的，而不是靠人肉复核。

**候选检查项**
1. **条目完备性**：每条命中 README §3 模板字段（类别 / 一句话 / 安装 / 权限 / 维护 / 评分 / 风险 / 检查日期 / 试用记录）。
2. **权限四项**：四格齐全、顺序正确、每格有内容或 `待补`（与 RULES §2 一致）。
3. **编号规约**：`PLG-###` 唯一、递增、不复用；`installed.md` 与 `INDEX.md` 的同一包版本一致（A 阶段只在 warnings 里报，B 阶段升级为一等差异）。
4. **交叉一致性**：`INDEX.md` 分类统计的数字 vs `recommended/` 实际条目数 vs `installed.md` 表格行数。
5. **基线行**：每个 md 首部是否有 `> 基线：lab-vX.Y.Z（YYYY-MM-DD）`。

**验收**：对 lab 现状跑出一份 lint 报告（全部只读、输出到 `out/`）；对已知问题（如 INDEX 分类统计与 recommended 条目数偏差）能给出精确定位（文件:行）。

**边界**：只读 lab；不修改、不「顺手修好」；发现问题只进报告与维护卡草稿。

---

## C 阶段 · 维护卡草稿生成（人工闸门）

**目标**：把 A/B 的差异转成**可直接交给主对话核验**的维护卡草稿（README §9.3 模板 v2）。

**产出**：`out/maintenance-card-YYYYMMDD-NN.md`，字段含：发起对话、基于版本（lab-vX.Y.Z + commit 短哈希）、类别、插件轨（新增/升级/卸载/仅评估）、包名@版本、证据、重叠声明、待主对话决议。

**硬约束**
1. 草稿里**不写任何安装命令的执行结果**，只写「建议」——安装永远由主对话执行。
2. 编号不自己占（`MC-YYYYMMDD-NN` 由主对话分配），草稿里用 `NN=待分配`。
3. 卡片不写个人信息/凭据；路径脱敏 `%USERPROFILE%`。
4. 禁止把卡直接写进 lab 目录（污染父仓 diff）。

**验收**：对 A 阶段的四类差异 + B 阶段的 lint 问题，能生成「一条差异 → 一条卡内证据」的映射；人拿卡就能核。

---

## D 阶段 · 回归巡检与冻结检测

**目标**：把「事故特征」变成可自动发现的信号，长期防复发。

**候选信号**
1. `cordis.patch.yml` 行数/体积相对快照骤降（本次事故：60217 B → 801 B）。
2. profile `package.json` 的 `dsh.profile.bundles` 数量相对上次巡检下降。
3. `dependencies` 里出现 junction/符号链接安装形态（本次事故的直接诱因）。
4. 有包在 `bundles` 但既不在 `dependencies` 也不在 `node_modules`（ROSTER_ONLY 且无实测版本）——可能是「花名册里塞了个装不上的包」。
5. A 阶段结论趋势：`UNREGISTERED` / `MISSING` 数量是否单调上升（基线失修）。

**验收**：定时或手动跑一次巡检，产出趋势记录 + 命中信号清单；自身变更须与 CHANGELOG 逐条对得上。

**边界**：巡检结果只报告，不自动修复；不对 profile 做任何写操作。

---

## 阶段依赖图

```
A（只读对账，已交付）
 └─> B（lab 文档 lint，复用 A 的解析器）
      └─> C（维护卡草稿，消费 A+B 结论）
           └─> D（回归巡检，定时跑 A+B 并盯事故特征）
```

> 跨阶段始终不变的约束：**只读、零依赖、不猜、变更靠人。**
