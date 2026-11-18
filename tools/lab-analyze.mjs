#!/usr/bin/env node
/**
 * lab-guide / tools/lab-analyze.mjs — 本地静态分析器（只读、不联网、零依赖）
 * C.1 四问 + C.2 三处修补 + C.3 两处补齐（池子三源合并 + 目标入口）
 *
 * 四个老问题（C.1）：
 *   1) 这个东西是干什么的？        → 身份段（**C.2 起按三级数据源优先**，见下）
 *   2) 它要什么权限？              → 权限四项（按四类正则扫代码，不看 README 自述）
 *   3) 会不会抢别人的行？          → row 争用（cordis.patch.yml 的 insert id vs 官方行/其他已装包）
 *   4) 同轨有没有重复？            → 同轨重复（lab 类别列 + lifecycle 的 label）
 *
 * C.2 三个新能力（对照用户实测的三条问题）：
 *   ① 「它干什么」不再靠 README 题头：数据源**固定三级**
 *      `catalog`（离线目录命中，中文人话优先）→ `package-json`（description）→ `readme`（修好的正文提取）
 *      → 都没有就写 `unknown` + 「本机无任何可信描述」。报告里永远写明 `identity.source`。
 *   ② `--unknown [--only-installed]`：**反向筛选**——「我装了但这些我不知道它们是干什么的」。
 *   ③ `--search <关键词>`：**离线搜索**——评估没装的包时，先在离线目录里找（大小写不敏感、空格分词 AND）。
 *
 * C.3 两处补齐（用户：目录只覆盖官方模块，第三方 0 命中；没有「目标」入口）：
 *   ④ `--search` 扩为**三源合并**，优先级固定 `registry`（第三方市场快照）> `catalog`（官方模块目录）
 *      > 已装包 description；每条结果必带 `source` 与 `installed:true|false`。
 *   ⑤ `--unknown` 判定加一档：`registry 有描述` **或** `catalog 命中` **或** `description ≥15 字且非营销词`
 *      → 不算 unknown；registry 命中时把 registry 描述与本地 description 并列展示（不一致标 `descMismatch`）。
 *   ⑥ 新入口 `--goal <text>`（本轮核心）：一句人话目标 → 分词 → **可解释加权打分** → top 10 候选表
 *      （名称×3 / description×2 / keywords×2 / category×1，同分按包名升序）；无匹配时写「池中无匹配」
 *      + 最接近 3 条 + **池子总数**，绝不编候选。
 *
 * C.3.1 修补（用户实跑真实市场后暴露的第二个问题：`--goal "接抖音直播做预管理"` 返回 8 条候选，
 * 命中词全是「管理」，根本词「直播 / 抖音」零命中 —— 没有相关性下限；中文滑窗还产出「接抖」「音直」这类废词）：
 *   ⑦ **相关性门禁**（三条缺一即不入候选）：命中≥1 个长词（中文≥3 字 / 英文单词≥5）
 *      **或** 命中≥2 个不同词 **或** 总分≥6；三条全不满足 → 不进候选表，只进「最接近（**不是匹配**）」栏。
 *   ⑧ **通用词降权 + 停用**：`GENERIC_TERMS`（管理/设置/任务/服务/系统/配置/面板/工具/助手/插件/功能/
 *      支持/自定/接口/数据）命中权重 **×0.5 向下取整**，且**单独命中不足以成候选**（除非同时命中长词）。
 *   ⑨ **噪声词丢弃**：滑窗词若在整个池子的 `name+description+keywords` 里出现 0 次且长度 <4 → 丢弃，
 *      并在报告里列出「丢弃的噪声词」（原词保留在 `tokensDropped`，不是静默消失）。
 *   ⑩ 报告头部明写「本入口是『池内降噪』，不是语义搜索」（口径见 ../docs/RULES.md §12.3 首行 + §12.3.6）。
 *
 * C.3.2（本轮，用户 dump 出真实市场响应后）：按**真实字段**重写 registry 适配，数据源再升一级。
 *   ⑪ registry 快照换成 v2（`{registry:{plugins:[…]}, hostVersion}` 的真实形状，
 *      `tools/_registry.mjs` 负责认形状/归一化；本文件只读快照的 `entries[]`）。
 *   ⑫ **数据源优先级升一级**（RULES §12.1.7）：`registry`（中文描述 + capabilities + capabilityRedLines）
 *      **>** `catalog`（官方模块）**>** 已装包 `package.json` description **>** README 兜底。
 *      registry 命中且有描述时 `identity.source='registry'`，并给出 `descriptionZh` 原文
 *      （无 zh 则给 en 并标 `lang:'en'`）+ `capabilities` + `capabilityRedLines` + `capabilityCheckedAt`。
 *   ⑬ `--search` / `--goal` 同时匹配 `descriptionZh / descriptionEn / name(包名) / category[] / capabilities[]`；
 *      **`descriptionZh` 与 `capabilities` 命中权重 ×1.5 向上取整**（2 → 3），`descriptionEn` 权重 ×1（2）。
 *      C.3.1 的三条门槛（长词 / ≥2 个不同词 / ∑≥6）、通用词 ×0.5、噪声词丢弃**一字未改**。
 *   ⑭ 输出表增列 `stars / downloads / redLines(有/无)`；`--goal` 的无匹配分支与「未过门槛」栏保留。
 *   ⑮ **性能**：一次建**小写索引**（每条拼成小写串 + 预存 token 集 + 六个字段各自的小写串），
 *      之后所有匹配**单遍扫描**、按「长词优先」提前剪枝；报告里打 `elapsedMs`（目标 < 2000ms）。
 *      10974 条是市场真实规模：这个索引就是为了让「多次匹配」不重复造语料。
 *
 * C.3.3（本轮，用户实测：`--search` 已能在 10974 条真实池子里捞出内容，但 `--goal` 结果过小。
 *   根因**不是门槛太高，是词表对不齐**：`"我想学嵌入式，从连板子到画 PCB"` 切出的有效词只有
 *   `嵌入/入式/嵌入式/连板/板子/pcb`，其中只有 `嵌入式` 算长词；市场里同类条目写的是
 *   `PCB/EDA/单片机/STM32/固件`，一个都不重 → 只剩 1–2 条甚至 0 条。**不造同义词词典**，改三件事）：
 *   ⑯ **分层替代硬门槛**：命中按**覆盖率**（= 命中有效词数 / 有效词总数）分三层**全部展示** ——
 *      强匹配 ≥0.5 ｜ 弱匹配 0.2 ≤ c < 0.5 ｜ 仅字面命中 c < 0.2（折叠段，最多 10 条）。
 *      C.3.1 的「长词 / ≥2 个不同词 / Σ≥6」三条硬门槛**取消**（召回过窄的直接原因）；
 *      **保留**「只命中通用词不算匹配」的否决（否则「管理」会回来）—— 它把该条目强制压进「仅字面命中」。
 *   ⑰ **词表诊断**（本轮重点）：新增 `## 词表诊断` 段，逐词列出「本次有效词 + 池中命中条目数」
 *      （**一次算完**，不逐词全扫）；0 命中标 `未命中`，末尾给一句「换同义词再搜」。
 *      同义词提示只给 **4 组硬编码示例**（嵌入式类 / 直播推流类 / 翻译类 / 定时调度类），
 *      **不建表、不参与打分**，纯提示（写在 `SYNONYM_HINTS`）。
 *   ⑱ **稀有词加权（idf）**：命中词权重 `× idf`，
 *      `idf = clamp(ln(池总数 / (1 + 该词命中条目数)), 0.5, 3.0)`（保留两位小数）；
 *      与字段权重相乘（name×3 ｜ zh×3 ｜ en×2 ｜ capabilities×3 ｜ keywords×2 ｜ category×1），
 *      再乘 C.3.1 的通用词 ×0.5。命中词列显示 `词+权重（idf 1.42）`，可复算。
 *      idf **预计算一次**（单遍遍历索引统计词频），不逐条重扫（RULES §12.3.8）。
 *   ⑲ `--search` **行为不变**：不传 idfMap 时 `scoreCandidate` 走旧路径
 *      （整数权重 + 通用词 `⌊×0.5⌋`），排序（来源 → 得分 → 包名）与末行一字未改。
 *
 * README 提取（C.2 修正）：先按行过滤（空行/`>` 引用/徽章图片/多语言导航/标题/目录/HTML 标签/表格/短列表），
 * 再取「第一句句长 ≥ 20 字」起的连续 1–3 句。题头、徽章带、`Overview · Compatibility · …` 这类
 * 导航行不会再被当成「描述」。（口径见 ../docs/RULES.md §11.2）
 *
 * 只读契约（与 A/B/C.1 同源，禁止突破）：
 *   1) 默认不写任何文件；唯一写动作是显式 `--write-report <path>`；
 *   2) 永不写 profile、永不写 --lab 目录、永不写 cordis.patch.yml / .dsh-market、
 *      永不写 `data/catalog.json`（`_catalog.mjs --write` 的事）、**永不写 `data/registry.json`**
 *      （`_registry.mjs --write` 的事 —— 本工具对 registry 只读）；
 *      写目标守卫直接复用 `_lifecycle.mjs` 的 `assertSafeLifecyclePath`（同一套红线，不另写一份）；
 *   3) 读不到就写 null / unknown / unclassified，并在 warnings 写清原因，绝不填默认值、绝不猜。
 *
 * 不联网契约：不查 npm registry、不读远程 README、不连市场服务。本地拿不到就明写「本地无此包」；
 * 离线目录来自本机 `dsh-plugin-manager/lib/index.js` 的 CATALOG（见 `_catalog.mjs`）；
 * 市场快照 `data/registry.json` 由用户显式跑 `_registry.mjs --url <loopback> --write` 生成，
 * 本工具只读它（`--registry <path>` 可指到夹具），读不到就写「registry 不可用」，不猜内容。
 *
 * 零第三方依赖 / ESM / 只用 node: 内置。patch YAML **不引入 js-yaml**：
 * 本工具只认 `- insert:` 块里的 `- id:` / `name:`（行式解析子集），超出子集就报告、不猜
 * （口径见 ../docs/RULES.md §10.2）。
 *
 * 复用（不重写）：
 *   - profile / package.json / Node 顶层目录 / lab 表格解析 → `_profile.mjs`（A 阶段同一份实现）
 *   - 写目标守卫 + 原子写 + lifecycle 读取          → `_lifecycle.mjs`（B 阶段同一份实现）
 *   - 离线目录的抽取 / 快照 / 命中 / 分类中文名        → `_catalog.mjs`（C.2 同一份实现）
 *   - 市场快照的读取 / 归一化 / 包名命中              → `_registry.mjs`（C.3 同一份实现；
 *     三源合并的**匹配**用本文件的统一 `candidateHaystack`，因为三个来源必须逐字段同口径）
 *   - 分类关键词表                                → `docs/LABELS.md`（单一机器源，代码里不留副本）
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';

import {
  DEFAULT_LAB,
  DEFAULT_PROFILE,
  REPO_ROOT,
  CliError,
  cmp,
  describeFsError,
  extractBacktick,
  findCol,
  loadProfile,
  mdCell,
  normalizePkgArg,
  parseTables,
  readJson,
  readText,
} from './_profile.mjs';

// 写目标守卫 / 原子写 / 账本读取：与 B 阶段同一套实现（RULES §10.1 复用清单）
import { assertSafeLifecyclePath, loadLifecycle, writeAtomic } from './_lifecycle.mjs';

// 离线目录（C.2）：抽取/快照/命中/分类中文名全部走同一份实现（RULES §11.1）
import {
  DEFAULT_CATALOG_SNAPSHOT,
  DEFAULT_CATALOG_SOURCE,
  categoryLabelOf,
  loadCatalog,
  lookupEntry,
} from './_catalog.mjs';

// 第三方市场快照（C.3）：读取/归一化/命中全部走同一份实现（RULES §12.1）
import { DEFAULT_REGISTRY_SNAPSHOT, loadRegistry, lookupRegistry } from './_registry.mjs';

// ────────────────────────────────────────────────────────────── 路径与常量

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = REPO_ROOT; // 仓库根（开发仓是 plugin-helper 下的子目录；发布仓就是仓库根本身），不依赖 cwd
const DEFAULT_LABELS = path.join(ROOT, 'docs', 'LABELS.md');
const DEFAULT_HOST_ROWS = path.join(ROOT, 'data', 'host-rows.json');
const DEFAULT_LIFECYCLE = path.join(ROOT, 'data', 'lifecycle.json');
const DEFAULT_CATALOG = DEFAULT_CATALOG_SNAPSHOT;
const DEFAULT_CATALOG_SRC = DEFAULT_CATALOG_SOURCE;
const DEFAULT_REGISTRY = DEFAULT_REGISTRY_SNAPSHOT;

/** 权限四项正则（与任务卡逐字一致；命中即报，不推断意图）。 */
const PERMISSION_RULES = [
  {
    key: 'fileWrite',
    label: '文件写',
    re: /writeFile|appendFile|createWriteStream|mkdir|rename|rmSync|unlink|copyFile|writeFileSync/g,
  },
  {
    key: 'exec',
    label: '命令执行',
    re: /child_process|execSync|execFile|spawn/g,
  },
  {
    key: 'network',
    label: '网络',
    re: /fetch\(|https?\.request|undici|WebSocket|require\('net'\)|from 'node:net'/g,
  },
  {
    key: 'credentials',
    label: '凭据',
    re: /credential|api[_-]?key|API_KEY|\.credentials|secret|token/gi,
  },
];

/** 每类最多留 3 处 `文件:行`（任务卡要求「前 3 处」）。 */
const PERMISSION_SITES = 3;
/** 单个包最多扫多少个源码文件（防病态目录）。 */
const MAX_SCAN_FILES = 2000;
/** 单个文件超过这个大小不扫（记 warning，不猜）。 */
const MAX_FILE_BYTES = 2 * 1024 * 1024;
/** 递归深度上限（防符号链接/超深目录）。 */
const MAX_SCAN_DEPTH = 8;
/** 只扫这两类扩展名（任务卡口径；.cjs/.ts 不扫 → 见 RULES §10.3 已知限制）。 */
const SCAN_EXTS = ['.js', '.mjs'];
/** 同属代码但不在扫描口径内的扩展名：单独计数并告警，避免把 .json/.png 也算成「未扫代码」。 */
const OTHER_CODE_EXTS = ['.cjs', '.ts', '.tsx', '.jsx', '.mts', '.cts'];
/** 默认跳过的测试目录（--include-tests 可打开）。 */
const TEST_DIRS = new Set(['test', 'tests', '__tests__', '__test__', 'spec', 'specs']);
const TEST_FILE_RE = /\.(test|spec)\.[cm]?js$/i;

const README_CANDIDATES = ['README.md', 'README.zh-CN.md', 'README.en.md', 'readme.md', 'README.markdown'];

/** 官方包作用域：profile 的 bundles 里以它开头的包 = 官方（任务卡口径）。 */
const OFFICIAL_SCOPE = '@deepseek-ai/';

/** 严重度排序（md / json 都用它）。 */
const SEVERITY_ORDER = { danger: 0, warn: 1, info: 2, ok: 3 };

const PERMISSION_LEVELS = ['无', '只读', '写入', '全量（含命令或凭据）'];

// ── C.2：README 正文提取阈值（口径见 RULES §11.2）
/** 句长 ≥ 20 字才算「正文描述句」：起点不能是 `**Problem.**` 这种碎片。 */
const README_MIN_SENTENCE = 20;
/** 句长 < 12 字的碎片直接丢（`Problem.` / `MIT` / `Web` 之类）。 */
const README_MIN_FRAGMENT = 12;
/** 一句话最多给几段（任务卡口径：连续 1–3 句）。 */
const README_MAX_SENTENCES = 3;
/** 多语言导航行的分隔符（同一行 ≥ 3 段短串 = 导航，不是描述）。 */
const NAV_SEPARATOR = '·';
/** 导航段的最大长度（「Install / Uninstall」19 字仍在导航里）。 */
const NAV_SEGMENT_MAX = 28;

// ── C.2：--unknown 的「说不清」判定（口径见 RULES §11.3）
/** description 少于这个字数 = 说了等于没说。 */
const DESC_MIN_CHARS = 15;
/** 营销词 / 空话词：命中即视为「没有可信描述」（大小写不敏感）。 */
const MARKETING_WORDS = ['a plugin', 'awesome', 'powerful', 'plugin for'];
/** 中文判定（用于区分「有外文描述」与「有中文人话」）。 */
const CJK_RE = /[\u4e00-\u9fff]/;

// ── C.3：--goal 分词与打分（口径见 RULES §12.3）
/** 中文滑窗长度：2–4 字（任务卡口径）。 */
const GOAL_WINDOW_MIN = 2;
const GOAL_WINDOW_MAX = 4;
/** 目标词的词数上限（防病态长句把打分表撑爆）。 */
const MAX_GOAL_TOKENS = 64;
/** 单个目标最多给多少个候选（任务卡：top 10）。 */
const GOAL_TOP_N = 10;
/** `--search` 的 md 表格最多列多少条（真实池子 11k 条时「直播」这类词可能命中上百条；json 仍是全量）。 */
const SEARCH_TABLE_MAX = 50;
/** 无匹配时列「最接近」的条数（任务卡：3 条）。 */
const GOAL_CLOSEST_N = 3;
/**
 * 中文停用字（单字）：窗口里**含任意一个**就丢。
 * 取舍：宁严不宽 —— 让「我想/一个/怎么/需要」这类壳词不参与打分，
 * 但不像「的」这种字落在真词里（例：`目的`/`标的`）时，宁可漏也不给噪音分。
 */
const ZH_STOPCHARS = new Set(
  [...'的了着过是我你您他她它们想需要能会可怎吗呢吧啊和与及或把被给对从向到在就都也还很太多个一请帮找没有这那些其之于为以而且但如所谁啥哪做让使得'],
);
/** 英文停用词（大小写不敏感，整词匹配）。 */
const EN_STOPWORDS = new Set([
  'the', 'a', 'an', 'to', 'for', 'of', 'and', 'or', 'with', 'without', 'i', 'me', 'my', 'we', 'you',
  'want', 'need', 'learn', 'learning', 'how', 'do', 'does', 'is', 'are', 'be', 'by', 'on', 'in', 'at',
  'it', 'this', 'that', 'from', 'into', 'about', 'some', 'something', 'please', 'help',
]);
/**
 * 打分权重（C.3.2 定版，可手工复算）：
 *   名称（显示名 ∪ 包名）×3 ｜ descriptionEn ×2 ｜ keywords ×2 ｜ category ×1
 *   **descriptionZh ×1.5 向上取整 → 3** ｜ **capabilities ×1.5 向上取整 → 3**
 * （`×1.5` 只作用于「中文描述」与「能力清单」：这两栏是真实市场里信息量最大、也最贴用户意图的两处；
 *   `descriptionEn` 保持 ×1，避免同一段中英双语描述被算两遍高分。）
 */
const GOAL_WEIGHTS = {
  name: 3,
  descriptionEn: 2,
  descriptionZh: 3, // ⌈2 × 1.5⌉
  capabilities: 3, // ⌈2 × 1.5⌉
  keywords: 2,
  category: 1,
};
/** 参与打分的字段（顺序固定：报告里的命中词按这个顺序列） */
const SCORE_FIELDS = ['name', 'descriptionZh', 'descriptionEn', 'capabilities', 'keywords', 'category'];
/** `×1.5 向上取整` 的作用面（写在这里是为了让 RULES 与代码同一份事实） */
const WEIGHT_LANG_FACTOR = { descriptionZh: 1.5, capabilities: 1.5 };
/** 打分字段的权重基数（未乘 ×1.5 之前；报告里要能看出 3 是怎么来的） */
const GOAL_BASE_WEIGHTS = { name: 3, descriptionZh: 2, descriptionEn: 2, capabilities: 2, keywords: 2, category: 1 };

// ── C.3.1：相关性门禁 / 通用词降权 / 噪声词过滤（口径见 RULES §12.3.6）
/**
 * 通用词表（任务卡逐字）：这些词在插件池里几乎无处不在，命中它们**不能**证明相关性。
 * 规则：①命中权重 ×0.5 **向下取整**；②**单独命中不足以成候选**（除非同时命中一个长词）。
 *
 * 注：本表里的词全部是 2 字（中文）→ 按下面 `isLongToken` 的定义永远算不上「长词」，
 * 所以「只命中通用词 = 没有长词」这条判定不会自相矛盾。
 */
const GENERIC_TERMS = new Set([
  '管理', '设置', '任务', '服务', '系统', '配置', '面板', '工具',
  '助手', '插件', '功能', '支持', '自定', '接口', '数据',
]);
/** 通用词命中权重系数（×0.5，向下取整）。 */
const GENERIC_WEIGHT_FACTOR = 0.5;
/** 「长词」判定：中文 ≥3 字，或英文单词长度 ≥5。 */
const GOAL_LONG_ZH = 3;
const GOAL_LONG_EN = 5;
/** 门禁第二条：命中 ≥2 个不同词。 */
const GOAL_MIN_DISTINCT = 2;
/** 门禁第三条：总分 ≥6。 */
const GOAL_MIN_SCORE = 6;
/** 噪声词丢弃阈值：池内出现 0 次 **且** 长度 < 4 才丢（≥4 字的词即使池内没有也保留，因为它是有信息量的词）。 */
const NOISE_MIN_LEN = 4;

// ── C.3.3：命中分层 / 词表诊断 / idf（口径见 RULES §12.3.8）
/**
 * 分层阈值（按**覆盖率** = 命中有效词数 / 有效词总数）：
 *   强匹配 `c ≥ 0.5` ｜ 弱匹配 `0.2 ≤ c < 0.5` ｜ 仅字面命中 `c < 0.2`。
 * 三条全部**展示**（不是在候选表上砍一刀 —— C.3.1 的硬门槛才是召回过窄的原因）。
 */
const GOAL_TIER_STRONG = 0.5;
const GOAL_TIER_WEAK = 0.2;
/** 「仅字面命中」折叠段最多列几条（任务卡硬要求：10）。 */
const GOAL_TIER_LITERAL_CAP = 10;
/**
 * 强 / 弱两层的**表格显示上限**：`counts` 是全量条数，md/json 每层最多物化这么多行，
 * 差额写进 `tiers.notListed` 与表尾「本层共 N 条，表内列前 M 条」（明写，不静默丢）。
 */
const GOAL_TIER_MAX = 20;
/** 层名（md 小标题与 json 键共用同一份字面，别两处各写一个）。 */
const GOAL_TIER_LABEL = { strong: '强匹配', weak: '弱匹配', literal: '仅字面命中' };
/** 层判定理由（报告里「为何不算匹配」那栏直接用）。 */
const GOAL_TIER_REASON = {
  literalCoverage: `覆盖率 < ${GOAL_TIER_WEAK}（命中有效词数 / 有效词总数）→ 只是字面重合，**不是匹配**`,
  genericOnly: '只命中通用词（C.3.1 否决仍然生效）→ 不算匹配，压进「仅字面命中」',
};

/**
 * 稀有词加权（idf）夹取区间：`clamp(ln(池总数 / (1 + 该词命中条目数)), 0.5, 3.0)`，保留两位小数。
 * 出现得越少 → 越接近 3.0（稀有词更值钱）；越普遍 → 越接近 0.5。
 */
const IDF_MIN = 0.5;
const IDF_MAX = 3.0;
/** idf 的小数位（报告里显示两位，得分也按两位累加，保证可复算）。 */
const IDF_DECIMALS = 2;

/**
 * **同义词提示**（C.3.3，纯提示：**不建表、不参与打分**，也不进任何匹配路径）。
 * 只给几组通用示例，用来回答「为什么 0 命中」——「你用的词，市场里叫别的名字」。
 * 组内词只用于**指出哪一组跟你的词相关**，不会被当成目标词去搜（那是词典，本工具不做）。
 */
const SYNONYM_HINTS = [
  { label: '嵌入式类', terms: ['嵌入', '嵌入式', '单片机', 'stm32', 'pcb', 'eda', '固件', '开发板', 'mcu'] },
  { label: '直播推流类', terms: ['直播', '推流', '弹幕', 'obs', 'rtmp', '开播', '抖音'] },
  { label: '翻译类', terms: ['翻译', 'translate', '译文', '多语言', 'i18n', '本地化'] },
  { label: '定时调度类', terms: ['定时', 'cron', '调度', 'timer', '队列', '轮询'] },
];
/** 提示句模板里用的示例（任务卡逐字给的那句）。 */
const SYNONYM_EXAMPLE = '嵌入式 → PCB / 单片机 / EDA / 固件';
/**
 * 报告头部的口径声明（任务卡逐字要求「防后续误解」）。md 与 json 都带，别只写在一处。
 */
const GOAL_NOTICE =
  '**本入口是「池内降噪」，不是语义搜索**：它不具备世界知识，只能匹配字面；召回候选请配合模型搜索/市场目录，把候选名交给本工具做取证与打分。';

const USAGE = `lab-analyze — 本地静态分析器（只读、不联网、零依赖）

用法：
  node tools/lab-analyze.mjs <pkg> [选项]              分析 profile 里已装的一个包
  node tools/lab-analyze.mjs --from-dir <dir> [选项]   分析一个已解包的目录（离线包）
  node tools/lab-analyze.mjs --scan-all [选项]         对已装全部第三方包跑 row 争用矩阵
  node tools/lab-analyze.mjs --search <关键词> [选项]  三源搜索（registry > 目录 > 已装）：有没有适合 X 的插件
  node tools/lab-analyze.mjs --unknown [选项]          反向筛选：已装但本机说不清它是干什么的包
  node tools/lab-analyze.mjs --goal "<一句人话目标>" [选项]  目标入口：从池子里挑适合做 X 的插件（top 10）

选项：
  --profile <dir>      profile 目录（默认：DSH_PROFILE_DIR 或 ~/.dsh/profiles/desktop）
  --lab <dir>          lab 目录（只读；默认：未设置 —— 需 --lab 或 LAB_DIR；未设置时：对账/同轨段会跳过，其余功能正常）
  --from-dir <dir>     从该目录读包（package.json 必须存在）
  --scan-all           输出 row 争用矩阵（row id ｜ 声明它的包 ｜ 是否官方 ｜ 严重度）
  --search <kw>        三源搜索：匹配 包名/中文名/描述/keywords/分类，大小写不敏感，空格分词 AND
  --unknown            列出「描述不可信」的包（按严重度排序），末行给计数
  --goal <text>        目标入口：分词 → idf 加权打分 → **三层（强/弱/仅字面）全展示** + 词表诊断 + 候选 top 10
  --only-installed     --unknown 只扫 profile 已装第三方包（**默认就是这个**，显式写也不报错）
  --with-catalog       --unknown 连同离线目录全量比对（默认关闭）
  --host-rows <path>   官方 row id 数据（默认：data/host-rows.json 本地快照）
  --labels <path>      分类关键词表（默认：docs/LABELS.md）
  --lifecycle <path>   生命周期账本（只读；默认：data/lifecycle.json）
  --catalog <path>     离线目录快照（默认：data/catalog.json；缺了会现场解析源）
  --catalog-source <path> 离线目录源（默认：<profile>/node_modules/@txc2768651338/dsh-plugin-manager/lib/index.js）
  --registry <path>    市场快照 v2（只读；默认：data/registry.json；指到 v1 旧夹具会被判「不可用」——那是负例）
  --include-tests      权限扫描包含 test/ 与 *.test.js（默认跳过）
  --json               输出 JSON（与 md 同构；默认 md）
  --md                 输出 Markdown（默认）
  --write-report <path> 额外把报告写到此路径（唯一允许的写文件动作）
  --help, -h           显示本帮助

五段输出（md 与 --json 同构）：
  1. 它是什么         identity.source（registry/catalog/package-json/readme/unknown）+ 描述语言 + 一句人话
                      + name/version/license/description/README 正文前 3 句/repository/依赖数/engines.dsh
  2. 权限四项（代码级）文件写/命令执行/网络/凭据 → 总数 + 前 3 处 文件:行 → 四档结论
  3. row 争用        SELF_ID / COLLIDES_WITH_HOST(danger) / COLLIDES_WITH_PLUGIN(warn) / 覆盖官方行(info)
  4. 同轨重复        lab 类别列 + lifecycle label 归一化后的同 label 条目（已装/adopted/rejected）
  5. 建议分类+结论    suggestedLabel + matchedTerms（匹配不到 = unclassified，不硬套）+ verdict

数据源优先级（C.3.2 起固定四级，报告里必写 identity.source）：
  1) registry      第三方市场快照命中且有描述 → **中文描述原文**（无 zh 则用 en 并标 lang:en）
                   + capabilities + capabilityRedLines + capabilityCheckedAt（**信息量最大的一级**）
  2) catalog       离线目录命中 → 中文名 + 一句话描述 + 分类
  3) package-json  前两者都空但有 description → 用原文
  4) readme        前三者都空 → 修好的 README 正文提取（不再抓题头/导航/徽章）
  5) unknown       都没有 → 明写「本机无任何可信描述」，不猜

--unknown 的判定（RULES §11.3 + §12.2）：
  「不可信」= **registry 没有描述**（未命中，或命中但 descriptionZh / descriptionEn 皆空）**且** CATALOG 未命中 **且**
  package.json description 缺失 / < ${DESC_MIN_CHARS} 字 / 含营销词
  （${MARKETING_WORDS.map((w) => `「${w}」`).join('、')}）。
  严重度：P1 说不清（计入末行计数）｜P2 池外·只有外文描述｜P3 池外·中文描述可用｜— 已被 registry/目录覆盖。
  registry 命中且有描述时，把 registry 描述与本地 description **并列**展示；两者不一致标 descMismatch。

--search 的语义（RULES §11.4 + §12.2）：
  **三源合并，优先级固定**：registry（第三方市场快照）> catalog（官方模块目录）> 已装包 description。
  匹配面含 descriptionZh / descriptionEn / name(包名) / category[] / capabilities[]；权重 ×1.5 向上取整见上。
  每条结果带 source / installed / stars / downloads / redLines；无命中写「池中无匹配」+ 最接近 3 条，**不造假候选**。

--goal 的语义（RULES §12.3，本轮核心入口）：
  ⚠️ ${GOAL_NOTICE}
  1) 分词：中文按 2–4 字滑窗、英文按空白/连字符切，去停用词（的/了/我/想/要/一个/能/怎么/learn/the/a/for/to …），
     保留原有词与拆分词；
  2) 噪声词丢弃（C.3.1，C.3.2 起含 capabilities）：滑窗词若在**整个池子**的「显示名+中英描述+capabilities+keywords」
     里命中 0 条且长度 < ${NOISE_MIN_LEN} → 从分词表里丢弃（原词仍列在报告的「丢弃的噪声词」里，不静默消失）；
  3) 打分（可解释，不黑盒）：名称命中 ×${GOAL_WEIGHTS.name}、**中文描述 ×${GOAL_WEIGHTS.descriptionZh}（=⌈2×1.5⌉）**、
     英文描述 ×${GOAL_WEIGHTS.descriptionEn}、**capabilities ×${GOAL_WEIGHTS.capabilities}（=⌈2×1.5⌉）**、
     keywords ×${GOAL_WEIGHTS.keywords}、category ×${GOAL_WEIGHTS.category}；
     **每个命中词再 × idf**（C.3.3：「clamp(ln(池总数/(1+该词命中条目数)), ${IDF_MIN}, ${IDF_MAX})」，两位小数；
     报告里每个命中词都显示「词+权重（idf x.xx）」，可复算）；**通用词**
     （${[...GENERIC_TERMS].slice(0, 5).join('/')} … 共 ${GENERIC_TERMS.size} 个）再 ×${GENERIC_WEIGHT_FACTOR}；同分按包名升序；
  4) **分层取代硬门槛**（C.3.3，C.3.1 的「长词 / ≥${GOAL_MIN_DISTINCT} 词 / Σ≥${GOAL_MIN_SCORE}」已取消）：
     覆盖率 = 命中有效词数 / 有效词总数 → **强匹配 ≥${GOAL_TIER_STRONG}** ｜ **弱匹配 ${GOAL_TIER_WEAK}–${GOAL_TIER_STRONG}** ｜
     **仅字面命中 <${GOAL_TIER_WEAK}**（折叠段，最多 ${GOAL_TIER_LITERAL_CAP} 条），**三层全部展示**；
     唯一的否决保留：**只命中通用词不算匹配** → 强制归入「仅字面命中」；
  5) **词表诊断**（C.3.3）：逐词给「池中命中条目数 + idf」，0 命中标「未命中」并提示换同义词
     （同义词只给 ${SYNONYM_HINTS.length} 组硬编码示例，不建表、不参与打分）；
  6) 输出：三层表 + 候选 top ${GOAL_TOP_N}（包名 ｜ 层 ｜ 覆盖率 ｜ 名称 ｜ 来源 ｜ 命中词 ｜ stars ｜ downloads ｜
     redLines ｜ 已装 ｜ 同轨已有 ｜ 权限 ｜ 下一步）；**未装包的权限固定写 unknown（未安装，本地无代码）**，不推断；
  7) 末行：goal: N 候选 / 池 M（registry A ｜ catalog B ｜ 已装 C）｜ 分层：强 a ｜ 弱 b ｜ 仅字面 c；
     无匹配时正文写「池中无匹配」+ 最近 3 条；
  8) 性能：一次建小写索引（小写串 + token 集 + 六字段小写串）+ idf 词频**预计算一次**（单遍），
     之后单遍扫描 + 长词优先剪枝；报告头打 elapsedMs（目标 < 2000ms）。

不联网承诺：
  本工具不查 npm registry、不读远程 README/仓库、不连市场服务；本地没有这个包就写 localData: false 并提示
  用 --from-dir 分析已解包目录。离线目录来自本机 dsh-plugin-manager 的构建产物；
  市场快照 data/registry.json 由用户跑「_registry.mjs --url http://127.0.0.1:<port>/… --write」生成（loopback only），
  本工具只读它，读不到就写「registry 不可用」，不猜内容。

只读承诺：
  不装、不卸、不升级、不写 profile、不写 lab、不写 cordis.patch.yml / .dsh-market、不写 data/catalog.json、
  不写 data/registry.json（那是 _registry.mjs --write 的事）；
  --write-report 指向 profile / lab 目录内会被直接拒绝（exit 1）。

退出码：
  0  跑通（含 localData: false、含发现冲突 —— 发现冲突不是失败；含 --search / --goal 无匹配）
  1  参数错误 / 读取失败 / 拒绝写入 / 三源（registry / catalog / 已装）全不可用（--search / --unknown / --goal）`;

// ────────────────────────────────────────────────────────────── 参数解析

function parseArgs(argv) {
  const opts = {
    pkg: null,
    profile: DEFAULT_PROFILE,
    lab: DEFAULT_LAB,
    fromDir: null,
    scanAll: false,
    search: null,
    unknown: false,
    goal: null,
    onlyInstalled: true,
    withCatalog: false,
    catalog: DEFAULT_CATALOG,
    catalogSource: DEFAULT_CATALOG_SRC,
    registry: DEFAULT_REGISTRY,
    hostRows: DEFAULT_HOST_ROWS,
    hostRowsExplicit: false,
    labels: DEFAULT_LABELS,
    lifecycle: DEFAULT_LIFECYCLE,
    includeTests: false,
    format: 'md',
    writeReport: null,
    help: false,
  };
  const formatFlags = new Set();
  const positionals = [];

  for (let i = 0; i < argv.length; i += 1) {
    const raw = argv[i];
    if (typeof raw !== 'string' || raw === '') throw new CliError(`空参数（第 ${i + 1} 个），见 --help`);

    let key = raw;
    let inline = null;
    if (raw.startsWith('--')) {
      const eq = raw.indexOf('=');
      if (eq > 2) {
        key = raw.slice(0, eq);
        inline = raw.slice(eq + 1);
      }
    }

    const takeValue = (name) => {
      if (inline !== null) {
        if (inline === '') throw new CliError(`参数 ${name} 缺少取值`);
        return inline;
      }
      const next = argv[i + 1];
      if (next === undefined || (typeof next === 'string' && next.startsWith('--'))) {
        throw new CliError(`参数 ${name} 缺少取值`);
      }
      i += 1;
      return next;
    };

    const rejectInline = (name) => {
      if (inline !== null) throw new CliError(`参数 ${name} 不接受取值（收到「${inline}」）`);
    };

    switch (key) {
      case '--help':
      case '-h':
        rejectInline(key);
        opts.help = true;
        break;
      case '--profile':
        opts.profile = takeValue('--profile');
        break;
      case '--lab':
        opts.lab = takeValue('--lab');
        break;
      case '--from-dir':
        opts.fromDir = takeValue('--from-dir');
        break;
      case '--scan-all':
        rejectInline('--scan-all');
        opts.scanAll = true;
        break;
      case '--search':
        opts.search = takeValue('--search');
        break;
      case '--unknown':
        rejectInline('--unknown');
        opts.unknown = true;
        break;
      case '--goal':
        opts.goal = takeValue('--goal');
        break;
      case '--only-installed':
        rejectInline('--only-installed');
        opts.onlyInstalled = true;
        break;
      case '--with-catalog':
        rejectInline('--with-catalog');
        opts.withCatalog = true;
        break;
      case '--catalog':
        opts.catalog = takeValue('--catalog');
        break;
      case '--catalog-source':
        opts.catalogSource = takeValue('--catalog-source');
        break;
      case '--registry':
        opts.registry = takeValue('--registry');
        break;
      case '--host-rows':
        opts.hostRows = takeValue('--host-rows');
        opts.hostRowsExplicit = true;
        break;
      case '--labels':
        opts.labels = takeValue('--labels');
        break;
      case '--lifecycle':
        opts.lifecycle = takeValue('--lifecycle');
        break;
      case '--include-tests':
        rejectInline('--include-tests');
        opts.includeTests = true;
        break;
      case '--json':
        rejectInline('--json');
        formatFlags.add('json');
        opts.format = 'json';
        break;
      case '--md':
        rejectInline('--md');
        formatFlags.add('md');
        opts.format = 'md';
        break;
      case '--write-report':
        opts.writeReport = takeValue('--write-report');
        break;
      default:
        if (raw.startsWith('-')) throw new CliError(`未知参数：${raw}（见 --help）`);
        positionals.push(raw);
        break;
    }
  }

  if (formatFlags.size > 1) throw new CliError('--json 与 --md 不能同时使用');
  if (opts.search !== null && !String(opts.search).trim()) throw new CliError('--search 需要关键词（不能为空）');
  if (opts.goal !== null && !String(opts.goal).trim()) throw new CliError('--goal 需要一句目标（不能为空）');
  if (!opts.help) {
    if (!opts.profile) throw new CliError('--profile 不能为空');
    // NOLAB：lab 为空不再报错（第 4 段「同轨重复」跳过，其余五段与 --search/--goal/<pkg>/--scan-all 照常）
    if (positionals.length > 1) throw new CliError(`只接受一个包名（收到 ${positionals.length} 个：${positionals.join(' / ')}）`);
    if (positionals.length === 1) {
      const pkg = normalizePkgArg(positionals[0]);
      if (!pkg) throw new CliError('包名不能为空（不要传空白参数）');
      opts.pkg = pkg;
    }
    if (opts.pkg && opts.fromDir) throw new CliError('包名与 --from-dir 不能同时给（--from-dir 的包名从 package.json 读）');
    if (opts.scanAll && (opts.pkg || opts.fromDir)) throw new CliError('--scan-all 不与包名 / --from-dir 同时使用');

    const modes = [
      opts.pkg || opts.fromDir ? 'pkg' : null,
      opts.scanAll ? 'scan-all' : null,
      opts.search !== null ? 'search' : null,
      opts.unknown ? 'unknown' : null,
      opts.goal !== null ? 'goal' : null,
    ].filter(Boolean);
    if (modes.length > 1) {
      throw new CliError(`--search / --unknown / --goal / --scan-all / 包名 / --from-dir 一次只能用一种（收到 ${modes.join(' + ')}）`);
    }
    if (modes.length === 0) {
      throw new CliError(
        '缺少目标：给一个包名，或用 --from-dir <dir>，或用 --scan-all，或用 --search <关键词>，或用 --unknown，或用 --goal "<一句目标>"（见 --help）',
      );
    }
    if (opts.withCatalog && !opts.unknown) throw new CliError('--with-catalog 只与 --unknown 一起使用');
  }

  return opts;
}

// ────────────────────────────────────────────────────────────── 小工具

function toPosix(p) {
  return String(p).split(path.sep).join('/');
}

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function asStringList(v) {
  if (!Array.isArray(v)) return [];
  const out = [];
  for (const item of v) {
    if (typeof item !== 'string') continue;
    const s = item.trim();
    if (s && !out.includes(s)) out.push(s);
  }
  return out;
}

function firstN(list, n) {
  return list.slice(0, n);
}

/** 保留两位小数（idf / 覆盖率 / 权重 / 总分共用：报告里的数必须能手工复算到同一位）。 */
function round2(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return 0;
  return Math.round(v * 10 ** IDF_DECIMALS) / 10 ** IDF_DECIMALS;
}

/** 数字显示：整数不带小数点，非整数固定两位（`Σ15` / `Σ12.34`）。 */
function fmtNum(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '0';
  return Number.isInteger(v) ? String(v) : v.toFixed(IDF_DECIMALS);
}

function relTo(base, abs) {
  const r = path.relative(base, abs);
  return toPosix(r === '' ? '.' : r);
}

function stripScalar(raw) {
  let s = String(raw === null || raw === undefined ? '' : raw).trim();
  if (!s) return '';
  // 去掉引号外、前面有空白的行尾注释
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i];
    if (ch === "'" && !inDouble) inSingle = !inSingle;
    else if (ch === '"' && !inSingle) inDouble = !inDouble;
    else if (ch === '#' && !inSingle && !inDouble && i > 0 && /\s/.test(s[i - 1])) {
      s = s.slice(0, i).trim();
      break;
    }
  }
  s = s.replace(/^['"]+/, '').replace(/['"]+$/, '').trim();
  return s;
}

function indentOf(line) {
  let n = 0;
  for (const ch of String(line)) {
    if (ch === ' ') n += 1;
    else if (ch === '\t') n += 2;
    else break;
  }
  return n;
}

// ────────────────────────────────────────────────────────────── cordis.patch.yml 子集解析
//
// 只认两种键：`- insert:` 块下的 `- id:` 与 `name:`，以及顶层的 `- id:`（= 覆盖，不自插）。
// groups / alias / !!js / 流式写法一律「读不懂就报告」，绝不猜（RULES §10.2）。

function parsePatchText(text, filePath, warnings) {
  const lines = String(text).split(/\r?\n/);
  const rows = [];
  const overrides = [];
  const unsupported = []; // 会影响 row 判定的读不懂（进 warnings）
  const ignoredKeys = []; // 值型键（config/disabled…）：不进子集，但不影响 id 判定
  let insertIndent = -1;
  let current = null;

  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i];
    const lineNo = i + 1;
    const trimmed = raw.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith('#')) continue;
    const indent = indentOf(raw);

    const mInsert = /^-\s*insert\s*:\s*(.*)$/.exec(trimmed);
    if (mInsert) {
      const tail = mInsert[1].trim();
      if (tail && !tail.startsWith('#')) {
        unsupported.push({ line: lineNo, text: trimmed.slice(0, 160), reason: 'insert 是流式/内联写法，只支持块写法' });
        insertIndent = -1;
        current = null;
        continue;
      }
      insertIndent = indent;
      current = null;
      continue;
    }

    // 读不懂的结构：!!js 标签、group(s)/alias 键、模板串、以 [ { 开头的流式写法
    if (/!!js/.test(trimmed) || /^(groups?|alias|aliases|when|if|extends)\s*:/.test(trimmed) || /^[\[{]/.test(trimmed)) {
      unsupported.push({ line: lineNo, text: trimmed.slice(0, 160), reason: '超出 patch 子集（group/alias/!!js/流式写法）' });
      current = null;
      continue;
    }

    const mId = /^-\s*id\s*:\s*(.*)$/.exec(trimmed);
    if (mId) {
      const id = stripScalar(mId[1]);
      if (!id) {
        unsupported.push({ line: lineNo, text: trimmed.slice(0, 160), reason: 'id 取值为空' });
        current = null;
        continue;
      }
      if (insertIndent >= 0 && indent > insertIndent) {
        current = { id, name: null, line: lineNo };
        rows.push(current);
      } else {
        // 顶层 `- id:` = 覆盖已有行（不自插）
        insertIndent = -1;
        current = null;
        overrides.push({ id, line: lineNo });
      }
      continue;
    }

    const mName = /^name\s*:\s*(.*)$/.exec(trimmed);
    if (mName) {
      const name = stripScalar(mName[1]);
      if (current) current.name = name || null;
      else if (insertIndent >= 0) {
        unsupported.push({ line: lineNo, text: trimmed.slice(0, 160), reason: 'insert 块里出现没有 - id 的 name' });
      }
      continue;
    }

    if (insertIndent >= 0 && indent <= insertIndent) {
      insertIndent = -1;
      current = null;
    }

    if (insertIndent >= 0) {
      const mKey = /^([A-Za-z_][\w-]*)\s*:/.exec(trimmed);
      if (mKey) ignoredKeys.push({ line: lineNo, key: mKey[1] });
    }
  }

  const seen = new Set();
  for (const row of rows) {
    if (seen.has(row.id)) warnings.push(`${relToPath(filePath)}:${row.line} insert id「${row.id}」在同一文件里重复出现（照实记录，不去重）`);
    seen.add(row.id);
  }
  for (const row of rows) {
    if (!row.name) warnings.push(`${relToPath(filePath)}:${row.line} insert id「${row.id}」没有 name（照实记录 name=null，不猜模块名）`);
  }
  if (unsupported.length > 0) {
    const sample = unsupported
      .slice(0, 3)
      .map((u) => `第 ${u.line} 行「${u.text}」(${u.reason})`)
      .join('；');
    warnings.push(
      `patch 子集解析：${relToPath(filePath)} 有 ${unsupported.length} 处读不懂 → ${sample}${unsupported.length > 3 ? ' 等' : ''}；这些位置可能藏着行声明，本工具不猜`,
    );
  }

  return { rows, overrides, unsupported, ignoredKeys };
}

function relToPath(p) {
  // warnings 里只留 lab-guide 相对/文件名，避免刷屏长绝对路径
  const base = path.basename(String(p));
  return base || String(p);
}

function resolvePatchFiles(pkgDir, warnings, pkgLabel) {
  const pj = readJson(path.join(pkgDir, 'package.json'));
  const files = [];
  if (pj.ok && isPlainObject(pj.value)) {
    const bundle = pj.value.dsh && pj.value.dsh.bundle ? pj.value.dsh.bundle : null;
    const raw = bundle ? bundle.patch : undefined;
    if (typeof raw === 'string' && raw.trim()) files.push(raw.trim());
    else if (Array.isArray(raw)) {
      for (const item of raw) {
        if (typeof item === 'string' && item.trim()) files.push(item.trim());
      }
    }
  } else if (!pj.ok) {
    warnings.push(`${pkgLabel}: 读不到 package.json（${pj.reason}）→ patch 路径按默认 cordis.patch.yml 尝试`);
  }
  if (files.length === 0) {
    const fallback = path.join(pkgDir, 'cordis.patch.yml');
    if (fs.existsSync(fallback)) files.push('cordis.patch.yml');
  }
  return { packageJson: pj, patchFiles: files };
}

function loadPatchOfPackage(pkgDir, pkgLabel, warnings) {
  const { packageJson, patchFiles } = resolvePatchFiles(pkgDir, warnings, pkgLabel);
  const rows = [];
  const overrides = [];
  const unsupported = [];
  const usedFiles = [];
  for (const rel of patchFiles) {
    const abs = path.resolve(pkgDir, rel);
    const r = readText(abs);
    if (!r.ok) {
      warnings.push(`${pkgLabel}: 读不到 patch 文件 ${relTo(pkgDir, abs)}（${r.reason}）→ 该文件不产生任何 row 结论`);
      continue;
    }
    usedFiles.push(relTo(pkgDir, abs));
    const parsed = parsePatchText(r.text, abs, warnings);
    for (const row of parsed.rows) rows.push({ ...row, file: relTo(pkgDir, abs) });
    for (const o of parsed.overrides) overrides.push({ ...o, file: relTo(pkgDir, abs) });
    for (const u of parsed.unsupported) unsupported.push({ ...u, file: relTo(pkgDir, abs) });
  }
  return { packageJson, patchFiles: usedFiles, rows, overrides, unsupported };
}

// ────────────────────────────────────────────────────────────── §1 身份

function stripInlineMarkdown(raw) {
  let s = String(raw === null || raw === undefined ? '' : raw);
  s = s.replace(/<!--[\s\S]*?-->/g, ' ');
  s = s.replace(/!\[[^\]]*\]\([^)]*\)/g, ' '); // 图片
  s = s.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1'); // 链接留文字
  s = s.replace(/<[^>]*>/g, ' '); // HTML 标签
  s = s.replace(/`([^`]*)`/g, '$1'); // 行内代码
  s = s.replace(/\*\*([^*]*)\*\*/g, '$1'); // 粗体
  s = s.replace(/__([^_]*)__/g, '$1');
  s = s.replace(/~~([^~]*)~~/g, '$1');
  s = s.replace(/[ \t]+/g, ' ');
  return s.trim();
}

/** 多语言导航 / 目录导航行：同一行 ≥ 3 段 `·` 分隔的短串。 */
function isNavLine(raw) {
  const parts = String(raw)
    .split(NAV_SEPARATOR)
    .map((x) => stripInlineMarkdown(x).trim())
    .filter(Boolean);
  if (parts.length < 3) return false;
  return parts.every((p) => p.length > 0 && p.length <= NAV_SEGMENT_MAX);
}

/** 纯链接行（`[更新日志](...) · [开源协议](...)` 这种没有正文的行）。 */
function isLinkOnlyLine(raw) {
  const s = String(raw);
  if (!/\[[^\]]*\]\([^)]*\)/.test(s)) return false;
  const rest = s.replace(/\[[^\]]*\]\([^)]*\)/g, ' ');
  return /^[\s·|,，、/\\\-–—•*+]*$/.test(rest);
}

/** HTML 行（`<div align="center">` / `<br>` / `</p>` / `<!-- … -->` / `<img …>`）。 */
function isHtmlLine(raw) {
  const t = String(raw).trim();
  if (/^<!--/.test(t)) return true;
  return /^<\/?[a-zA-Z!][^>]*>?/.test(t);
}

/**
 * README → 段落（已按 C.2 规则过滤）。空行是段落分隔。
 *
 * 跳过的行（RULES §11.2）：
 *   ① 空行、`>` 引用行；② 徽章/图片行（`![` / `<img` / `shields.io`）；
 *   ③ 多语言导航行（≥3 段 `·` 短串）与纯链接行；④ 纯标题行（`#`）与目录行（`- [` / 列表项）；
 *   ⑤ HTML 标签行；另外沿用 C.1 的表头/分隔线/元信息行（那些都不是「描述」）。
 */
function readmeParagraphs(text) {
  const lines = String(text).split(/\r?\n/);
  const paragraphs = [];
  let current = [];

  const flush = () => {
    if (current.length > 0) paragraphs.push(current);
    current = [];
  };

  for (const raw of lines) {
    const t = raw.trim();
    const skip =
      !t ||
      t.startsWith('>') ||
      t.startsWith('#') ||
      t.startsWith('|') ||
      /^[-=_*]{3,}$/.test(t) ||
      /!\[/.test(t) ||
      /<img/i.test(t) ||
      /shields\.io/i.test(t) ||
      isHtmlLine(t) ||
      isNavLine(t) ||
      isLinkOnlyLine(t) ||
      /^[-*+]\s/.test(t) || // 列表项 / 目录
      /^\d+[.)]\s/.test(t) ||
      (/^[a-z0-9_-]+:\s/i.test(t) && t.length < 40); // 元信息行（Version: 0.1.0）

    if (skip) {
      flush();
      continue;
    }
    current.push(t);
  }
  flush();
  return paragraphs;
}

/** 句子切分：中文句末标点后切；英文只在「句点 + 空格 + 大写/数字」处切（`0.2.0` 不切）。 */
function splitSentences(text) {
  const body = String(text).replace(/[ \t]+/g, ' ').trim();
  if (!body) return [];
  return body
    .split(/(?<=[。！？!?])|(?<=\.)\s+(?=[A-Z0-9])/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * README 正文提取（C.2 修正版）：
 *   先过滤行 → 拼段 → 句切 → 丢掉 < 12 字的碎片 → 从**第一句句长 ≥ 20 字**起取连续 1–3 句。
 *
 * 为什么这么改：旧实现先把全文拼成一句再切，README 的题头（`**Every plugin finally speaks for itself**`）、
 * 徽章带、`Overview · Compatibility · Install / Uninstall · …` 这类导航行会被当成「首段」，
 * 于是「它干什么」这一格抓到的是导航而不是描述（C.1 用户实测问题 1）。
 */
function extractReadmeSentences(text, max = README_MAX_SENTENCES) {
  const flat = [];
  for (const para of readmeParagraphs(text)) {
    for (const s of splitSentences(stripInlineMarkdown(para.join(' ')))) {
      if ([...s].length < README_MIN_FRAGMENT) continue; // `Problem.` / `MIT` 这类碎片不进候选
      flat.push(s);
    }
  }
  const start = flat.findIndex((s) => [...s].length >= README_MIN_SENTENCE);
  if (start < 0) return [];
  return flat.slice(start, start + max);
}

function readReadme(pkgDir, warnings) {
  for (const name of README_CANDIDATES) {
    const abs = path.join(pkgDir, name);
    if (!fs.existsSync(abs)) continue;
    const r = readText(abs);
    if (!r.ok) {
      warnings.push(`读不到 ${name}（${r.reason}）→ README 正文记空，不猜`);
      return { file: name, sentences: [], reason: 'read-failed' };
    }
    const sentences = extractReadmeSentences(r.text, README_MAX_SENTENCES);
    return {
      file: name,
      sentences,
      reason: sentences.length === 0 ? 'no-body-sentence（过滤题头/导航/徽章后没有 ≥20 字的正文句子）' : null,
    };
  }
  return { file: null, sentences: [], reason: 'no-readme' };
}

function normalizeRepository(raw) {
  let repoRaw = null;
  if (typeof raw === 'string') repoRaw = raw;
  else if (isPlainObject(raw) && typeof raw.url === 'string') repoRaw = raw.url;
  if (!repoRaw) return { repository: null, repositoryRaw: null };
  let url = repoRaw.trim();
  url = url.replace(/^git\+/, '');
  url = url.replace(/\.git$/, '');
  return { repository: url, repositoryRaw: repoRaw };
}

function licenseOf(pj) {
  if (!isPlainObject(pj)) return null;
  if (typeof pj.license === 'string' && pj.license.trim()) return pj.license.trim();
  if (isPlainObject(pj.license) && typeof pj.license.type === 'string' && pj.license.type.trim()) return pj.license.type.trim();
  if (Array.isArray(pj.licenses)) {
    const list = pj.licenses
      .map((x) => (isPlainObject(x) && typeof x.type === 'string' ? x.type.trim() : typeof x === 'string' ? x.trim() : ''))
      .filter(Boolean);
    if (list.length > 0) return list.join(' / ');
  }
  return null;
}

function buildIdentity({ pkg, pkgDir, localData, lookupSource, lookupNote, packageJson, catalog, registry, warnings }) {
  const pj = isPlainObject(packageJson) ? packageJson : {};
  const readme = localData && pkgDir ? readReadme(pkgDir, warnings) : { file: null, sentences: [], reason: 'local-data-missing' };
  const repo = normalizeRepository(pj.repository);
  const deps = isPlainObject(pj.dependencies) ? Object.keys(pj.dependencies).length : 0;
  const peers = isPlainObject(pj.peerDependencies) ? Object.keys(pj.peerDependencies).length : 0;
  const engines = isPlainObject(pj.engines) ? pj.engines : {};
  const keywords = asStringList(pj.keywords);
  const description = typeof pj.description === 'string' && pj.description.trim() ? pj.description.trim() : null;

  // ── 离线目录命中（C.2 数据源第 2 级）
  const catAvailable = catalog ? catalog.available === true : false;
  const hit = catAvailable ? lookupEntry(catalog.entries, pkg) : { hit: false, match: null, key: null, entry: null, candidates: [], reason: null };
  const catalogInfo = {
    available: catAvailable,
    origin: catalog ? catalog.origin : 'none',
    snapshotPath: catalog ? catalog.path : null,
    count: catalog && catalog.count ? catalog.count : 0,
    hit: hit.hit === true,
    match: hit.match,
    key: hit.key,
    name: hit.hit ? hit.entry.name : null,
    desc: hit.hit ? hit.entry.desc : null,
    category: hit.hit ? hit.entry.category : null,
    categoryLabel: hit.hit ? categoryLabelOf(catalog, hit.entry.category) : null,
    candidates: hit.candidates || [],
    reason: hit.reason || (catAvailable ? null : catalog ? catalog.reason : '未加载离线目录'),
  };

  // ── 第三方市场命中（C.3.2 数据源第 1 级：中文描述 + capabilities + redLines）
  const regAvailable = registry ? registry.available === true : false;
  const regHit = regAvailable ? lookupRegistry(registry, pkg) : { hit: false, match: null, key: null, entry: null, candidates: [], reason: null };
  const regEntry = regHit.hit && regHit.entry ? regHit.entry : null;
  const registryInfo = {
    available: regAvailable,
    origin: registry ? registry.origin : 'none',
    snapshotPath: registry ? registry.path : null,
    count: registry && registry.available ? registry.count : 0,
    hit: regHit.hit === true,
    match: regHit.match,
    key: regHit.key,
    name: regEntry ? regEntry.name : null,
    owner: regEntry ? regEntry.owner : null,
    npm: regEntry ? regEntry.npm : null,
    descriptionZh: regEntry ? regEntry.descriptionZh : null,
    descriptionEn: regEntry ? regEntry.descriptionEn : null,
    capabilities: regEntry && Array.isArray(regEntry.capabilities) ? regEntry.capabilities : [],
    capabilityRedLines: regEntry && Array.isArray(regEntry.capabilityRedLines) ? regEntry.capabilityRedLines : [],
    capabilityCheckedAt: regEntry ? regEntry.capabilityCheckedAt : null,
    stars: regEntry ? regEntry.stars : null,
    downloads: regEntry ? regEntry.downloads : null,
    category: regEntry && Array.isArray(regEntry.category) ? regEntry.category : [],
    install: regEntry ? regEntry.install : null,
    page: regEntry ? regEntry.page : null,
    url: regEntry ? regEntry.url : null,
    added: regEntry ? regEntry.added : null,
    candidates: regHit.candidates || [],
    reason: regHit.reason || (regAvailable ? null : registry ? registry.reason : '未加载 registry'),
  };

  // ── 四级优先（C.3.2，顺序固定，先命中先返回；都没有就是 unknown，不猜）
  //     registry > catalog > 已装 package.json description > README 兜底
  let source = 'unknown';
  let displayName = null;
  let summaryText = null;
  let summaryNote = null;
  let summaryLang = null;

  const registryDescription = registryInfo.descriptionZh || registryInfo.descriptionEn;
  const registryLang = registryInfo.descriptionZh ? 'zh' : registryInfo.descriptionEn ? 'en' : null;

  if (registryInfo.hit && registryDescription) {
    source = 'registry';
    displayName = registryInfo.descriptionZh ? null : registryInfo.name; // 中文描述在，就不需要「中文名」补偿
    summaryText = registryDescription;
    summaryLang = registryLang;
    if (registryLang === 'en') {
      summaryNote = 'registry 命中但**没有中文描述**（description.zh 缺失）→ 给英文原文并标 lang:en，不做机器翻译';
    } else if (registryInfo.match === 'basename') {
      summaryNote = `registry 命中方式=basename（同名不同 scope）：命中的键是 ${registryInfo.key}；描述以上游条目为准`;
    } else if (registryInfo.match === 'key') {
      summaryNote = `registry 命中方式=key（该条目是 GitHub-only，npm 名为空）：命中的键是 ${registryInfo.key}；描述来自该条目自身`;
    }
  } else if (registryInfo.hit && !registryDescription) {
    // registry 有条目但没有描述 → 不算「说得清」，但事实要留下（与 --unknown 的口径一致）
    summaryNote = `registry 有该条目（${registryInfo.key}）但**没有 description（zh/en 皆空）**→ 不拿它当「它是什么」的答案，继续往下找`;
    warnings.push(`${pkg}: ${summaryNote}`);
  }

  if (source === 'unknown' && catalogInfo.hit) {
    source = 'catalog';
    displayName = catalogInfo.name;
    summaryText = catalogInfo.desc ? `${catalogInfo.name}：${catalogInfo.desc}` : catalogInfo.name;
    summaryLang = catalogInfo.desc ? (CJK_RE.test(String(catalogInfo.desc)) ? 'zh' : 'en') : null;
    if (catalogInfo.match === 'basename') {
      summaryNote = `目录命中方式=basename（同名不同 scope）：命中的目录键是 ${catalogInfo.key}；中文名/描述取自该目录项，含义以上游实际行为为准`;
    }
  } else if (source === 'unknown' && description) {
    source = 'package-json';
    summaryText = description;
    summaryLang = CJK_RE.test(description) ? 'zh' : 'en';
  } else if (source === 'unknown' && readme.sentences.length > 0) {
    source = 'readme';
    summaryText = readme.sentences.join(' ');
    summaryLang = CJK_RE.test(summaryText) ? 'zh' : 'en';
  }

  if (source === 'unknown') {
    summaryNote = '本机无任何可信描述（registry 未命中或无描述、CATALOG 未命中、package.json 无 description、README 也提不出一句正文）→ 不猜';
    warnings.push(`${pkg}: ${summaryNote}`);
  }
  if (catAvailable && !catalogInfo.hit && catalogInfo.reason && source !== 'catalog') {
    warnings.push(`${pkg}: 离线目录未命中（${catalogInfo.reason}）`);
  }
  if (regAvailable && !registryInfo.hit && registryInfo.reason) {
    warnings.push(`${pkg}: registry 未命中（${registryInfo.reason}）`);
  }

  return {
    pkg,
    name: typeof pj.name === 'string' && pj.name.trim() ? pj.name.trim() : null,
    version: typeof pj.version === 'string' && pj.version.trim() ? pj.version.trim() : null,
    license: licenseOf(pj),
    description,
    // C.2/C.3.2：这一格才是「它干什么」的答案，source 必须写在报告里
    source,
    summaryLang,
    displayName,
    summaryText,
    summaryNote,
    registry: registryInfo,
    catalog: catalogInfo,
    readme: { file: readme.file, sentences: readme.sentences, reason: readme.reason },
    repository: repo.repository,
    repositoryRaw: repo.repositoryRaw,
    dependencyCount: deps,
    peerDependencyCount: peers,
    engines: {
      dsh: typeof engines.dsh === 'string' && engines.dsh.trim() ? engines.dsh.trim() : null,
      node: typeof engines.node === 'string' && engines.node.trim() ? engines.node.trim() : null,
    },
    keywords,
    localData: localData === true,
    lookup: { source: lookupSource, note: lookupNote, dir: pkgDir ? path.resolve(pkgDir) : null, packageJson: pkgDir ? path.resolve(pkgDir, 'package.json') : null },
  };
}

// ────────────────────────────────────────────────────────────── §2 权限四项

function emptyPermissionBucket() {
  return { total: 0, sites: [] };
}

function scanPermissions(pkgDir, opts, warnings) {
  const counts = {};
  for (const rule of PERMISSION_RULES) counts[rule.key] = emptyPermissionBucket();
  const skipped = { nodeModules: 0, tests: 0, ext: 0, otherCode: 0, symlink: 0, oversize: 0 };
  const seenFiles = new Set();
  let scannedFiles = 0;

  const collect = (abs) => {
    if (scannedFiles >= MAX_SCAN_FILES) return;
    const rel = relTo(pkgDir, abs);
    let st;
    try {
      st = fs.statSync(abs);
    } catch (err) {
      warnings.push(`权限扫描：读不到 ${rel} 的文件信息（${describeFsError(err)}）`);
      return;
    }
    if (st.size > MAX_FILE_BYTES) {
      skipped.oversize += 1;
      warnings.push(`权限扫描：${rel} 有 ${st.size} 字节（> ${MAX_FILE_BYTES}），未扫描`);
      return;
    }
    const r = readText(abs);
    if (!r.ok) {
      warnings.push(`权限扫描：读不到 ${rel}（${r.reason}）`);
      return;
    }
    scannedFiles += 1;
    const lines = r.text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      for (const rule of PERMISSION_RULES) {
        // 全局正则用 match 不会污染 lastIndex（String#match 内部重置），可复用同一个 RegExp 对象
        const hits = line.match(rule.re);
        if (!hits || hits.length === 0) continue;
        const bucket = counts[rule.key];
        bucket.total += hits.length;
        if (!bucket.files_set) bucket.files_set = new Set();
        bucket.files_set.add(rel);
        if (bucket.sites.length < PERMISSION_SITES) bucket.sites.push({ file: rel, line: i + 1 });
      }
    }
  };

  const walk = (dir, depth) => {
    if (depth > MAX_SCAN_DEPTH) return;
    if (scannedFiles >= MAX_SCAN_FILES) return;
    let dirents;
    try {
      dirents = fs.readdirSync(dir, { withFileTypes: true });
    } catch (err) {
      warnings.push(`权限扫描：读不到目录 ${relTo(pkgDir, dir)}（${describeFsError(err)}）`);
      return;
    }
    for (const d of dirents) {
      const name = d.name;
      if (!name || name.startsWith('.')) continue;
      const full = path.join(dir, name);
      if (d.isSymbolicLink && d.isSymbolicLink()) {
        skipped.symlink += 1;
        continue;
      }
      if (d.isDirectory()) {
        if (name === 'node_modules') {
          skipped.nodeModules += 1;
          continue;
        }
        if (!opts.includeTests && TEST_DIRS.has(name)) {
          skipped.tests += 1;
          continue;
        }
        walk(full, depth + 1);
        continue;
      }
      if (!d.isFile()) continue;
      const ext = path.extname(name).toLowerCase();
      if (!SCAN_EXTS.includes(ext)) {
        if (OTHER_CODE_EXTS.includes(ext)) skipped.otherCode += 1;
        else skipped.ext += 1;
        continue;
      }
      if (!opts.includeTests && TEST_FILE_RE.test(name)) {
        skipped.tests += 1;
        continue;
      }
      if (seenFiles.has(full)) continue;
      seenFiles.add(full);
      collect(full);
    }
  };

  if (!pkgDir) {
    return { scanned: false, reason: '本地无此包（不联网、未安装实测，没有代码可扫）', scannedFiles: 0, skipped, rules: [], conclusion: null };
  }
  walk(pkgDir, 0);

  const rules = PERMISSION_RULES.map((rule) => {
    const bucket = counts[rule.key];
    const fileCount = bucket.files_set ? bucket.files_set.size : 0;
    return {
      key: rule.key,
      label: rule.label,
      pattern: String(rule.re),
      total: bucket.total,
      fileCount,
      sites: firstN(bucket.sites, PERMISSION_SITES),
    };
  });

  const exec = counts.exec.total;
  const cred = counts.credentials.total;
  const write = counts.fileWrite.total;
  const net = counts.network.total;
  let conclusion;
  if (exec > 0 || cred > 0) conclusion = PERMISSION_LEVELS[3];
  else if (write > 0) conclusion = PERMISSION_LEVELS[2];
  else if (net > 0) conclusion = PERMISSION_LEVELS[1];
  else conclusion = PERMISSION_LEVELS[0];

  if (scannedFiles >= MAX_SCAN_FILES) {
    warnings.push(`权限扫描：已到文件数上限 ${MAX_SCAN_FILES}，后面的文件没扫 → 计数可能偏小（明写不猜）`);
  }
  if (skipped.otherCode > 0) {
    warnings.push(
      `权限扫描：${skipped.otherCode} 个 .cjs/.ts/.tsx/.jsx/.mts/.cts 文件未扫（本工具只扫 .js/.mjs，其余代码里的能力不在统计内）`,
    );
  }

  return {
    scanned: true,
    reason: null,
    scannedFiles,
    skipped,
    rules,
    conclusion,
  };
}

// ────────────────────────────────────────────────────────────── §3 row 争用

function loadHostRows(filePath, explicit, warnings) {
  const abs = path.resolve(filePath);
  const r = readJson(abs);
  const empty = {
    available: false,
    source: explicit ? 'explicit-missing' : 'snapshot-missing',
    path: abs,
    hostVersion: null,
    byPkg: new Map(),
    ids: new Set(),
    rowCount: 0,
    packageCount: 0,
    confidence: 'unknown',
    note: null,
  };

  if (!r.ok) {
    warnings.push(
      `官方 row 数据读不到：${abs}（${r.reason}）→ 本次无法判定「抢宿主行」，COLLIDES_WITH_HOST 记 unknown，不猜`,
    );
    return empty;
  }
  const v = isPlainObject(r.value) ? r.value : {};
  const byPkg = new Map();
  const ids = new Set();
  const rowsObj = isPlainObject(v.rows) ? v.rows : null;
  const flatList = Array.isArray(v.rowIds) ? v.rowIds : null;

  if (rowsObj) {
    for (const pkgName of Object.keys(rowsObj)) {
      const list = rowsObj[pkgName];
      if (!Array.isArray(list)) {
        warnings.push(`host-rows: ${pkgName} 的 row 列表不是数组，已跳过`);
        continue;
      }
      const clean = [];
      for (const item of list) {
        if (typeof item !== 'string') continue;
        const id = item.trim();
        if (!id) continue;
        if (!clean.includes(id)) clean.push(id);
        ids.add(id);
      }
      if (clean.length > 0) byPkg.set(pkgName, clean.sort(cmp));
    }
  } else if (flatList) {
    for (const item of flatList) {
      if (typeof item !== 'string') continue;
      const id = item.trim();
      if (id) ids.add(id);
    }
  } else {
    warnings.push(`host-rows: ${abs} 既没有 rows 对象也没有 rowIds 数组 → 视为无数据（不猜）`);
    return empty;
  }

  if (ids.size === 0) {
    warnings.push(`host-rows: ${abs} 解析出的 row id 为 0 条 → 视为无数据（不猜）`);
    return {
      ...empty,
      path: abs,
      source: explicit ? 'explicit-empty' : 'snapshot-empty',
      hostVersion: typeof v.hostVersion === 'string' ? v.hostVersion : null,
    };
  }

  return {
    available: true,
    source: explicit ? 'explicit' : 'snapshot',
    path: abs,
    hostVersion: typeof v.hostVersion === 'string' && v.hostVersion.trim() ? v.hostVersion.trim() : null,
    byPkg,
    ids,
    rowCount: ids.size,
    packageCount: byPkg.size,
    // 快照是「某次本地 asar 抽取」的时间点数据：证据强度标 likely；--host-rows 显式给的标 confirmed。
    confidence: explicit ? 'confirmed' : 'likely',
    note: typeof v.note === 'string' ? v.note : null,
  };
}

function isOfficialPkg(pkg) {
  return typeof pkg === 'string' && pkg.startsWith(OFFICIAL_SCOPE);
}

/**
 * 已装包（profile dependencies ∪ bundles）的 patch 行声明。
 * 只读 profile 的 node_modules：官方 bundle 随应用发布、不在 profile 内 → 由 host-rows 快照补。
 */
function collectInstalledPatches(profile, warnings) {
  const installed = new Map();
  if (!profile) return installed;

  const names = new Set([...profile.depNames, ...profile.bundles]);
  for (const pkg of [...names].sort(cmp)) {
    const dir = path.join(profile.nmDir, ...pkg.split('/'));
    let exists = false;
    try {
      exists = fs.statSync(dir).isDirectory();
    } catch {
      exists = false;
    }
    if (!exists) {
      if (isOfficialPkg(pkg)) {
        warnings.push(
          `${pkg}: 官方 bundle 的目录不在 profile 内（随应用发布）→ 它声明的行只能来自 host-rows 快照（data/host-rows.json）`,
        );
      }
      continue;
    }
    const patch = loadPatchOfPackage(dir, pkg, warnings);
    const pj = isPlainObject(patch.packageJson.value) ? patch.packageJson.value : {};
    installed.set(pkg, {
      pkg,
      dir,
      official: isOfficialPkg(pkg),
      inDependencies: Object.prototype.hasOwnProperty.call(profile.dependencies, pkg),
      inBundles: profile.bundleSet.has(pkg),
      version: typeof pj.version === 'string' && pj.version.trim() ? pj.version.trim() : null,
      patchFiles: patch.patchFiles,
      rows: patch.rows,
      overrides: patch.overrides,
      unsupported: patch.unsupported,
    });
  }
  return installed;
}

function buildRowTable(installed, hostRows) {
  const table = new Map();
  const add = (id, entry) => {
    if (!id) return;
    let list = table.get(id);
    if (!list) {
      list = [];
      table.set(id, list);
    }
    list.push(entry);
  };

  for (const rec of installed.values()) {
    for (const row of rec.rows) {
      add(row.id, { pkg: rec.pkg, official: rec.official === true, kind: 'insert', file: `${rec.pkg}/${row.file}`, line: row.line, name: row.name });
    }
    for (const o of rec.overrides) {
      add(o.id, { pkg: rec.pkg, official: rec.official === true, kind: 'override', file: `${rec.pkg}/${o.file}`, line: o.line, name: null });
    }
  }
  if (hostRows && hostRows.available) {
    for (const [pkgName, ids] of hostRows.byPkg) {
      for (const id of ids) {
        add(id, {
          pkg: pkgName,
          official: true,
          kind: 'insert',
          file: relTo(ROOT, hostRows.path),
          line: null,
          name: null,
          fromHostRows: true,
        });
      }
    }
  }
  return table;
}

function severityOfRow(tableEntryList) {
  const inserts = tableEntryList.filter((e) => e.kind === 'insert');
  const officialInserts = inserts.filter((e) => e.official);
  const thirdInsertPkgs = [];
  for (const e of inserts) {
    if (e.official) continue;
    if (!thirdInsertPkgs.includes(e.pkg)) thirdInsertPkgs.push(e.pkg);
  }
  const overrides = tableEntryList.filter((e) => e.kind === 'override');
  const thirdOverridePkgs = [];
  for (const e of overrides) {
    if (e.official) continue;
    if (!thirdOverridePkgs.includes(e.pkg)) thirdOverridePkgs.push(e.pkg);
  }

  let severity = 'ok';
  if (officialInserts.length > 0 && thirdInsertPkgs.length > 0) severity = 'danger';
  else if (thirdInsertPkgs.length > 1) severity = 'warn';
  else if (thirdInsertPkgs.length === 0 && thirdOverridePkgs.length > 0) severity = 'info';
  else severity = 'ok';

  return {
    severity,
    isOfficial: officialInserts.length > 0,
    officialPkgs: [...new Set(officialInserts.map((e) => e.pkg))],
    thirdInsertPkgs,
    thirdOverridePkgs,
  };
}

function buildRowContention({ target, installed, table, hostRows, warnings }) {
  const selfRows = target && target.rows ? target.rows : [];
  const selfOverrides = target && target.overrides ? target.overrides : [];
  const selfPkg = target ? target.pkg : null;

  const selfIds = selfRows.map((row) => ({
    id: row.id,
    name: row.name,
    file: target ? `${target.pkg}/${row.file}` : row.file,
    line: row.line,
  }));

  const collidesWithHost = [];
  const collidesWithPlugin = [];
  const touchesHostOverride = [];
  const touchesPluginOverride = [];

  for (const row of selfRows) {
    const list = table.get(row.id) || [];
    if (hostRows.available && hostRows.ids.has(row.id)) {
      const officialPkgs = hostRows.byPkg
        ? [...hostRows.byPkg].filter(([, ids]) => ids.includes(row.id)).map(([p]) => p).sort(cmp)
        : [];
      const liveOfficial = list.filter((e) => e.kind === 'insert' && e.official && e.pkg !== selfPkg).map((e) => e.pkg);
      const official = [...new Set([...officialPkgs, ...liveOfficial])].sort(cmp);
      collidesWithHost.push({
        id: row.id,
        severity: 'danger',
        confidence: hostRows.confidence,
        officialPkgs: official,
        declaredAt: `${selfPkg}/${row.file}:${row.line}`,
        officialSource: relTo(ROOT, hostRows.path),
        note: `insert id「${row.id}」与官方行同名：Loader 每个 id 只保留一个 entry，后声明的层胜出 → 官方那一行会被顶掉`,
      });
    }
    const others = [];
    for (const e of list) {
      if (e.kind !== 'insert') continue;
      if (e.pkg === selfPkg) continue;
      if (e.official) continue; // 官方已在 COLLIDES_WITH_HOST 里说清，不重复报
      if (!others.includes(e.pkg)) others.push(e.pkg);
    }
    if (others.length > 0) {
      collidesWithPlugin.push({
        id: row.id,
        severity: 'warn',
        pkgs: [selfPkg, ...others.sort(cmp)],
        declaredAt: `${selfPkg}/${row.file}:${row.line}`,
        note: `同一个 row id 被 ${others.length + 1} 个第三方包各自 insert（本包 + ${others.join('、')}）`,
      });
    }
  }

  for (const o of selfOverrides) {
    const list = table.get(o.id) || [];
    const ownerInsert = list.filter((e) => e.kind === 'insert');
    const where = `${selfPkg}/${o.file}:${o.line}`;
    if (ownerInsert.length === 0) {
      if (hostRows.available && hostRows.ids.has(o.id)) {
        touchesHostOverride.push({
          id: o.id,
          severity: 'info',
          declaredAt: where,
          note: 'patch 顶层 `- id:` 改写了官方行的配置（只覆盖、不自插）——不改模块名，但会改变官方行的行为',
        });
      } else if (!hostRows.available) {
        // 官方 row 数据读不到：无法判定这行是不是官方行 → 不猜，也不当成悬空（上面已有缺数据告警）
        warnings.push(
          `${selfPkg}: patch 里 - id: ${o.id}（${o.file}:${o.line}）是覆盖项；官方 row 数据读不到，无法判定它覆盖的是官方行还是别人声明的行`,
        );
      } else {
        warnings.push(`${selfPkg}: patch 里 - id: ${o.id}（${o.file}:${o.line}）是覆盖项，但没有任何已装包/官方行声明该 id → 悬空覆盖（静默无效果）`);
      }
    } else {
      const owners = [...new Set(ownerInsert.map((e) => e.pkg))].sort(cmp);
      const byOther = owners.filter((p) => p !== selfPkg);
      if (byOther.length > 0) {
        touchesPluginOverride.push({
          id: o.id,
          severity: 'info',
          declaredAt: where,
          owners,
          note: `改写了他人（${byOther.join('、')}）声明的行配置（只覆盖、不自插）`,
        });
      }
    }
  }

  let severity = 'ok';
  if (collidesWithHost.length > 0) severity = 'danger';
  else if (collidesWithPlugin.length > 0) severity = 'warn';

  return {
    selfIds,
    selfOverrides: selfOverrides.map((o) => ({ id: o.id, file: `${selfPkg}/${o.file}`, line: o.line })),
    collidesWithHost,
    collidesWithPlugin,
    touchesHostOverride,
    touchesPluginOverride,
    severity,
    officialRowIds: hostRows.available ? hostRows.rowCount : null,
    officialSource: hostRows.available ? relTo(ROOT, hostRows.path) : null,
    officialConfidence: hostRows.available ? hostRows.confidence : 'unknown',
    scannedPackages: installed ? installed.size : 0,
    unparsed: target && target.unsupported ? target.unsupported.slice(0, 10) : [],
  };
}

function buildScanAll({ installed, table, hostRows, warnings }) {
  const rows = [];
  let officialOnly = 0;
  let thirdInsertIds = 0;
  const thirdPkgs = [];

  for (const [id, list] of table) {
    const info = severityOfRow(list);
    if (info.severity === 'ok' && !info.isOfficial && info.thirdInsertPkgs.length === 0 && info.thirdOverridePkgs.length === 0) continue;
    if (info.thirdInsertPkgs.length === 0 && info.thirdOverridePkgs.length === 0) {
      officialOnly += 1;
      continue;
    }
    if (info.thirdInsertPkgs.length > 0) thirdInsertIds += 1;
    for (const p of info.thirdInsertPkgs) if (!thirdPkgs.includes(p)) thirdPkgs.push(p);
    for (const p of info.thirdOverridePkgs) if (!thirdPkgs.includes(p)) thirdPkgs.push(p);

    const declaredBy = [];
    const seenPkg = new Set();
    for (const e of list) {
      const key = `${e.pkg}|${e.official ? 'official' : 'third'}|${e.kind}`;
      if (seenPkg.has(key)) continue;
      seenPkg.add(key);
      declaredBy.push({
        pkg: e.pkg,
        official: e.official === true,
        kind: e.kind,
        file: e.file,
        line: e.line,
        fromHostRows: e.fromHostRows === true,
      });
    }
    declaredBy.sort((a, b) => {
      if (a.official !== b.official) return a.official ? -1 : 1;
      if (a.kind !== b.kind) return a.kind === 'insert' ? -1 : 1;
      return cmp(a.pkg, b.pkg);
    });

    rows.push({
      id,
      declaredBy,
      official: info.isOfficial,
      severity: info.severity,
      // 只有「覆盖」、没有任何包 insert 该 id → 悬空覆盖（静默无效果），要让人看得见
      dangling: list.filter((e) => e.kind === 'insert').length === 0,
      thirdPartyInsertPkgs: info.thirdInsertPkgs,
      thirdPartyOverridePkgs: info.thirdOverridePkgs,
    });
  }

  rows.sort((a, b) => {
    const d = (SEVERITY_ORDER[a.severity] === undefined ? 9 : SEVERITY_ORDER[a.severity]) - (SEVERITY_ORDER[b.severity] === undefined ? 9 : SEVERITY_ORDER[b.severity]);
    return d !== 0 ? d : cmp(a.id, b.id);
  });

  const counts = { danger: 0, warn: 0, info: 0, ok: 0 };
  for (const row of rows) counts[row.severity] = (counts[row.severity] || 0) + 1;

  if (counts.danger + counts.warn === 0) {
    warnings.push(
      `--scan-all：未发现 row 争用（矩阵 ${rows.length} 行；官方 row ${hostRows.available ? hostRows.rowCount : 'unknown'} 条；第三方 insert ${thirdInsertIds} 条）——是真无冲突还是解析没读到，请看这两个数：第三方 insert 为 0 就说明 patch 没读进来`,
    );
  }

  return {
    rows,
    summary: {
      matrixRows: rows.length,
      danger: counts.danger || 0,
      warn: counts.warn || 0,
      info: counts.info || 0,
      ok: counts.ok || 0,
      officialOnlyRows: officialOnly,
      thirdPartyInsertIds: thirdInsertIds,
      thirdPartyPackages: thirdPkgs.length,
      scannedPackages: installed ? installed.size : 0,
      officialRowIds: hostRows.available ? hostRows.rowCount : null,
      officialPackages: hostRows.available ? hostRows.packageCount : null,
      officialSource: hostRows.available ? relTo(ROOT, hostRows.path) : null,
      officialConfidence: hostRows.available ? hostRows.confidence : 'unknown',
    },
  };
}

// ────────────────────────────────────────────────────────────── §4 同轨重复

function loadLabCategories(labDir, warnings) {
  const registry = new Map();
  let stat = null;
  try {
    stat = fs.statSync(labDir);
  } catch (err) {
    if (!labDir) { return { path: '（未提供 --lab / LAB_DIR）', registry, readable: false, skipped: true }; } warnings.push(`读不到 lab 目录 ${path.resolve(labDir)}（${describeFsError(err)}）→ 同轨重复记「同轨无记录」`);
    return { path: path.resolve(labDir), registry, readable: false };
  }
  if (!stat.isDirectory()) {
    warnings.push(`--lab 不是目录：${path.resolve(labDir)} → 同轨重复记「同轨无记录」`);
    return { path: path.resolve(labDir), registry, readable: false };
  }

  for (const source of ['installed.md', 'INDEX.md']) {
    const abs = path.join(labDir, source);
    const r = readText(abs);
    if (!r.ok) {
      warnings.push(`lab: 读不到 ${source}（${r.reason}）→ 该文件的类别列不参与同轨判定`);
      continue;
    }
    for (const table of parseTables(r.text)) {
      const comboCol = findCol(table.header, (h) => h.includes('包名@版本') || (h.includes('包名') && h.includes('@')));
      const pkgCol = findCol(table.header, (h) => h.includes('包名') && !h.includes('@'));
      const catCol = findCol(table.header, (h) => h.includes('类别') || h.includes('分类'));
      const statusCol = findCol(table.header, (h) => h.includes('状态'));
      if (comboCol < 0 && pkgCol < 0) continue;
      if (catCol < 0) continue;

      for (const row of table.rows) {
        let pkg = null;
        if (comboCol >= 0) {
          const inner = extractBacktick(row.cells[comboCol] === undefined ? '' : row.cells[comboCol]);
          if (inner) {
            const at = inner.lastIndexOf('@');
            if (at > 0) pkg = inner.slice(0, at).trim();
          }
        }
        if (!pkg && pkgCol >= 0) pkg = extractBacktick(row.cells[pkgCol] === undefined ? '' : row.cells[pkgCol]);
        if (!pkg) continue;
        const category = String(row.cells[catCol] === undefined ? '' : row.cells[catCol]).trim();
        if (!category) continue;
        const statusText = statusCol >= 0 ? String(row.cells[statusCol] === undefined ? '' : row.cells[statusCol]).trim() : '';

        const entry = registry.get(pkg) || { pkg, category: null, cite: null, statusText: null, sources: [] };
        if (!entry.category) {
          entry.category = category;
          entry.cite = `${source}:${row.lineNo}`;
        }
        if (!entry.statusText && statusText) entry.statusText = statusText;
        if (!entry.sources.includes(source)) entry.sources.push(source);
        registry.set(pkg, entry);
      }
    }
  }
  return { path: path.resolve(labDir), registry, readable: true };
}

function loadLedger(filePath, warnings) {
  const abs = path.resolve(filePath);
  if (!fs.existsSync(abs)) {
    warnings.push(`读不到 lifecycle 账本 ${abs}（文件不存在）→ 同轨的 adopted / rejected 记无记录`);
    return { path: abs, items: [], readable: false };
  }
  try {
    const loaded = loadLifecycle(abs);
    const items = Array.isArray(loaded.data.items) ? loaded.data.items.filter((x) => isPlainObject(x)) : [];
    if (!Array.isArray(loaded.data.items)) warnings.push(`lifecycle 的 items 不是数组（${abs}）→ 视为空账本`);
    return { path: abs, items, readable: true };
  } catch (err) {
    const msg = err && err.message ? err.message : String(err);
    warnings.push(`读不到 lifecycle 账本 ${abs}（${msg}）→ 同轨的 adopted / rejected 记无记录`);
    return { path: abs, items: [], readable: false };
  }
}

// ────────────────────────────────────────────────────────────── 分类表（docs/LABELS.md）

const JSON_BLOCK_RE = /<!--\s*LABELS:JSON:START\s*-->([\s\S]*?)<!--\s*LABELS:JSON:END\s*-->/;

function loadLabelTable(labelsPath, warnings) {
  const abs = path.resolve(labelsPath);
  const r = readText(abs);
  if (!r.ok) {
    warnings.push(`读不到分类关键词表 ${abs}（${r.reason}）→ suggestedLabel 一律记 unclassified（不硬套）`);
    return { path: abs, ok: false, tracks: [], alias: new Map() };
  }
  const m = JSON_BLOCK_RE.exec(r.text);
  if (!m) {
    warnings.push(`分类关键词表 ${abs} 里找不到 LABELS:JSON 标记块 → suggestedLabel 一律记 unclassified（不硬套）`);
    return { path: abs, ok: false, tracks: [], alias: new Map() };
  }
  let data;
  try {
    // 允许标记块里套一层 ```json 围栏（文档更好看），解析前剥掉
    const body = m[1]
      .trim()
      .replace(/^```[a-zA-Z]*\s*\r?\n/, '')
      .replace(/\r?\n```\s*$/, '')
      .trim();
    data = JSON.parse(body);
  } catch (err) {
    warnings.push(`分类关键词表的 JSON 块解析失败（${err && err.message ? err.message : String(err)}）→ unclassified`);
    return { path: abs, ok: false, tracks: [], alias: new Map() };
  }
  const rawTracks = Array.isArray(data && data.tracks) ? data.tracks : [];
  const tracks = [];
  for (const t of rawTracks) {
    if (!isPlainObject(t)) continue;
    const key = typeof t.key === 'string' ? t.key.trim() : '';
    if (!key) continue;
    tracks.push({
      key,
      name: typeof t.name === 'string' ? t.name.trim() : key,
      keywords: asStringList(t.keywords),
    });
  }
  if (tracks.length === 0) {
    warnings.push(`分类关键词表 ${abs} 里没有任何 track → unclassified`);
    return { path: abs, ok: false, tracks: [], alias: new Map() };
  }
  const alias = new Map();
  const rawAlias = isPlainObject(data.alias) ? data.alias : {};
  for (const [from, to] of Object.entries(rawAlias)) {
    if (typeof from === 'string' && typeof to === 'string' && from.trim() && to.trim()) alias.set(from.trim().toLowerCase(), to.trim());
  }
  for (const t of tracks) alias.set(t.key.toLowerCase(), t.key);
  return { path: abs, ok: true, tracks, alias };
}

const TERM_CACHE = new Map();

function termToRegex(term) {
  const cached = TERM_CACHE.get(term);
  if (cached) return cached;
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // 纯 ASCII 词要求「字母数字下划线」边界：`dev` 不命中 `device`，但 `plugin-manager` 能命中 `dsh-plugin-manager`
  const ascii = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(term);
  const re = ascii
    ? new RegExp(`(?<![A-Za-z0-9_])${escaped}(?![A-Za-z0-9_])`, 'i')
    : new RegExp(escaped, 'i');
  TERM_CACHE.set(term, re);
  return re;
}

function classify(identity, labelTable) {
  // 语料：包名 + 描述（package.json 原文优先；没有就用 C.2 的可信来源：catalog / README 正文）+ keywords
  const haystack = [identity.pkg || '', identity.description || identity.summaryText || '', (identity.keywords || []).join(' ')].join('\n');
  const scores = [];

  for (const track of labelTable.tracks) {
    const terms = [];
    for (const term of track.keywords) {
      if (termToRegex(term).test(haystack)) terms.push(term);
    }
    if (terms.length === 0) continue;
    scores.push({ label: track.key, score: terms.length, terms });
  }
  scores.sort((a, b) => (b.score - a.score) || cmp(a.label, b.label));

  if (scores.length === 0) {
    return { suggestedLabel: 'unclassified', matchedTerms: [], scores: [], note: '关键词表一条都没命中 → 不硬套' };
  }
  return {
    suggestedLabel: scores[0].label,
    matchedTerms: scores[0].terms,
    scores,
    note: null,
  };
}

function canonicalLabel(raw, labelTable) {
  const s = String(raw === null || raw === undefined ? '' : raw).trim();
  if (!s) return '';
  const lower = s.toLowerCase();
  if (labelTable && labelTable.alias && labelTable.alias.has(lower)) return labelTable.alias.get(lower);
  // 二级标签：`productivity（任务看板）` / `language / translate` / `dev（内置 IDE）` → 取首段
  const head = s.split(/[（(\[\|｜\/]/)[0].trim();
  if (head && labelTable && labelTable.alias && labelTable.alias.has(head.toLowerCase())) {
    return labelTable.alias.get(head.toLowerCase());
  }
  if (labelTable && labelTable.ok) {
    const hit = labelTable.tracks.find((t) => lower.includes(t.key.toLowerCase()) || t.name.toLowerCase() === lower);
    if (hit) return hit.key;
  }
  return lower;
}

function buildSameTrack(label, lab, ledger, labelTable, warnings, profile) {
  const canonical = canonicalLabel(label, labelTable);
  const installed = [];
  const adopted = [];
  const rejected = [];

  const inProfile = (pkg) => {
    if (!profile || !pkg) return false;
    if (Object.prototype.hasOwnProperty.call(profile.dependencies, pkg)) return true;
    return profile.nmNames.has(pkg);
  };

  if (canonical && canonical !== 'unclassified') {
    for (const entry of lab.registry.values()) {
      const cat = canonicalLabel(entry.category, labelTable);
      if (cat !== canonical) continue;
      installed.push({
        pkg: entry.pkg,
        category: entry.category,
        statusText: entry.statusText,
        cite: entry.cite,
        inProfile: inProfile(entry.pkg),
      });
    }
    installed.sort((a, b) => cmp(a.pkg, b.pkg));

    for (const item of ledger.items) {
      const pkgLabel = canonicalLabel(item.label, labelTable);
      if (pkgLabel !== canonical) continue;
      if (item.state === 'adopted') {
        adopted.push({
          pkg: typeof item.pkg === 'string' ? item.pkg : null,
          label: typeof item.label === 'string' ? item.label : null,
          since: typeof item.since === 'string' ? item.since : null,
          verifiedVersion: typeof item.verifiedVersion === 'string' ? item.verifiedVersion : null,
          reason: typeof item.reason === 'string' ? item.reason : null,
        });
      } else if (item.state === 'rejected') {
        const firstEvidence = Array.isArray(item.evidence) && item.evidence.length > 0 && isPlainObject(item.evidence[0]) ? item.evidence[0].ref : null;
        rejected.push({
          pkg: typeof item.pkg === 'string' ? item.pkg : null,
          label: typeof item.label === 'string' ? item.label : null,
          reason: typeof item.reason === 'string' ? item.reason : null,
          evidenceRef: typeof firstEvidence === 'string' ? firstEvidence : null,
        });
      }
    }
    adopted.sort((a, b) => cmp(String(a.pkg), String(b.pkg)));
    rejected.sort((a, b) => cmp(String(a.pkg), String(b.pkg)));
  } else if (canonical === 'unclassified') {
    warnings.push('建议分类为 unclassified → 同轨重复按「无 label」处理，不给同 label 对比（不硬套）');
  }

  const empty = installed.length === 0 && adopted.length === 0 && rejected.length === 0;
  return {
    label: canonical || 'unclassified',
    installed,
    adopted,
    rejected,
    note: lab.skipped ? '未提供 lab' : (empty ? '同轨无记录' : null),
    labPath: lab.path,
    lifecyclePath: ledger.path,
  };
}

// ────────────────────────────────────────────────────────────── §5 结论草稿

function buildVerdict({ identity, permissions, rowContention, sameTrack }) {
  const bits = [];
  let verdict = '观察';

  const hostHit = rowContention.collidesWithHost.length > 0;
  const pluginHit = rowContention.collidesWithPlugin.length > 0;
  // 官方 row 数据读不到 → 「抢宿主行」无法排除，只能到「观察」，不能给「装」
  const hostUnknown = rowContention.officialRowIds === null;
  const fullPerm = permissions.conclusion === PERMISSION_LEVELS[3];
  const writePerm = permissions.conclusion === PERMISSION_LEVELS[2];
  const otherAdopted = sameTrack.adopted.filter((x) => x.pkg !== identity.pkg);

  if (!identity.localData) {
    verdict = '观察';
    bits.push('本地无此包的证据（未联网、未安装实测）');
  } else if (hostHit) {
    verdict = '不装';
    bits.push(
      `抢宿主行 ${rowContention.collidesWithHost[0].id}（官方 ${rowContention.collidesWithHost[0].officialPkgs.join('、') || '行'} 已声明同 id，后写覆盖会让官方行失效）`,
    );
  } else if (pluginHit) {
    verdict = '观察';
    bits.push(`与已装包抢同一 row id ${rowContention.collidesWithPlugin[0].id}（${rowContention.collidesWithPlugin[0].pkgs.join(' / ')}）`);
  } else if (hostUnknown) {
    verdict = '观察';
    bits.push('官方 row 数据读不到，抢宿主行无法排除');
  } else if (fullPerm) {
    verdict = '观察';
    bits.push(`权限档为「${permissions.conclusion}」，需人工核对命令/凭据用途`);
  } else if (writePerm) {
    verdict = '观察';
    bits.push(`权限档为「${permissions.conclusion}」，会写本地文件`);
  } else if (otherAdopted.length > 0) {
    verdict = '观察';
    bits.push(`同轨已有 adopted：${otherAdopted.map((x) => x.pkg).join('、')}`);
  } else {
    verdict = '装';
    bits.push(`无 row 争用、权限档「${permissions.conclusion}」、同轨无 adopted 重复`);
  }

  const reason = bits.join('；');
  return {
    verdict,
    reason: reason.length > 80 ? `${reason.slice(0, 78)}…` : reason,
    disclaimer: '本结论仅基于本地静态证据，未联网、未安装实测',
    basis: {
      rowContention: rowContention.severity,
      permissionLevel: permissions.conclusion,
      sameTrackAdopted: otherAdopted.length,
      officialRowsKnown: !hostUnknown,
      localData: identity.localData,
    },
  };
}

// ────────────────────────────────────────────────────────────── 目标包定位

function locateTarget(opts, profile, warnings) {
  if (opts.fromDir) {
    const dir = path.resolve(opts.fromDir);
    let stat = null;
    try {
      stat = fs.statSync(dir);
    } catch (err) {
      throw new CliError(`--from-dir 目录读不到：${dir}（${describeFsError(err)}）`);
    }
    if (!stat.isDirectory()) throw new CliError(`--from-dir 不是目录：${dir}`);
    const pj = readJson(path.join(dir, 'package.json'));
    if (!pj.ok) throw new CliError(`--from-dir 目录里没有可读的 package.json：${dir}（${pj.reason}）`);
    const pjv = isPlainObject(pj.value) ? pj.value : {};
    const pkg = typeof pjv.name === 'string' && pjv.name.trim() ? pjv.name.trim() : path.basename(dir);
    const patch = loadPatchOfPackage(dir, pkg, warnings);
    return {
      pkg,
      dir,
      localData: true,
      lookupSource: 'from-dir',
      lookupNote: `从 --from-dir 目录读取（不联网、不安装）：${dir}`,
      packageJson: pjv,
      rows: patch.rows,
      overrides: patch.overrides,
      unsupported: patch.unsupported,
      patchFiles: patch.patchFiles,
    };
  }

  const pkg = opts.pkg;
  const dir = profile ? path.join(profile.nmDir, ...pkg.split('/')) : null;
  let exists = false;
  if (dir) {
    try {
      exists = fs.statSync(dir).isDirectory();
    } catch {
      exists = false;
    }
  }
  if (!exists) {
    warnings.push(
      `本地无此包：${pkg} 不在 ${profile ? profile.nmDir : '(无 profile)'} 顶层。本工具不联网；先用 dshmarket 安装，或用 --from-dir <已解包目录> 分析解包产物`,
    );
    return {
      pkg,
      dir: null,
      localData: false,
      lookupSource: 'profile-node-modules',
      lookupNote: '本地无此包（不在 profile 的 node_modules 顶层）；未联网，未安装实测',
      packageJson: {},
      rows: [],
      overrides: [],
      unsupported: [],
      patchFiles: [],
    };
  }
  const patch = loadPatchOfPackage(dir, pkg, warnings);
  const pjv = isPlainObject(patch.packageJson.value) ? patch.packageJson.value : {};
  return {
    pkg,
    dir,
    localData: true,
    lookupSource: 'profile-node-modules',
    lookupNote: `从 profile 实测读取：${dir}`,
    packageJson: pjv,
    rows: patch.rows,
    overrides: patch.overrides,
    unsupported: patch.unsupported,
    patchFiles: patch.patchFiles,
  };
}

// ────────────────────────────────────────────────────────────── 组装报告

function safeLoadProfile(profileDir, warnings) {
  try {
    return loadProfile(profileDir, warnings);
  } catch (err) {
    const msg = err && err.message ? err.message : String(err);
    warnings.push(`读不到 profile（${msg}）→ 本次只分析目标包本身，不做跨包 row 对比、不同轨对比`);
    return null;
  }
}

function buildSingleReport(opts) {
  const warnings = [];
  const profile = safeLoadProfile(opts.profile, warnings);
  const lab = loadLabCategories(opts.lab, warnings);
  const ledger = loadLedger(opts.lifecycle, warnings);
  const labelTable = loadLabelTable(opts.labels, warnings);
  const hostRows = loadHostRows(opts.hostRows, opts.hostRowsExplicit, warnings);
  const catalog = loadCatalog({ snapshotPath: opts.catalog, sourcePath: opts.catalogSource });
  for (const w of catalog.warnings || []) warnings.push(w);
  if (!catalog.available) {
    warnings.push(`离线目录不可用（${catalog.reason}）→ identity.source 只能落在 registry / package-json / readme / unknown，catalog 那一级跳过`);
  }
  // C.3.2：registry 是 identity 的第 1 级数据源（只读快照，不联网）
  const registry = loadRegistry({ snapshotPath: opts.registry });
  for (const w of registry.warnings || []) warnings.push(w);
  if (!registry.available) {
    warnings.push(`registry 不可用（${registry.reason}）→ identity.source 的第 1 级跳过（依次退到 catalog / package-json / readme）`);
  }

  const target = locateTarget(opts, profile, warnings);
  const identity = buildIdentity({
    pkg: target.pkg,
    pkgDir: target.dir,
    localData: target.localData,
    lookupSource: target.lookupSource,
    lookupNote: target.lookupNote,
    packageJson: target.packageJson,
    catalog,
    registry,
    warnings,
  });
  const permissions = scanPermissions(target.dir, opts, warnings);
  const installed = collectInstalledPatches(profile, warnings);
  const table = buildRowTable(installed, hostRows);
  const rowContention = buildRowContention({ target, installed, table, hostRows, warnings });
  const suggestion = classify(identity, labelTable);
  const sameTrack = buildSameTrack(suggestion.suggestedLabel, lab, ledger, labelTable, warnings, profile);
  const verdict = buildVerdict({ identity, permissions, rowContention, sameTrack });

  return {
    generatedAt: new Date().toISOString(),
    mode: 'single',
    profile: profile ? profile.path : path.resolve(opts.profile),
    lab: lab.path,
    labels: { path: labelTable.path, ok: labelTable.ok, tracks: labelTable.tracks.length },
    registry: registryMetaBlock(registry),
    catalog: {
      path: catalog.path,
      origin: catalog.origin,
      available: catalog.available,
      count: catalog.count,
      package: catalog.meta ? catalog.meta.package : null,
      version: catalog.meta ? catalog.meta.version : null,
      extractedAt: catalog.meta ? catalog.meta.extractedAt : null,
      reason: catalog.reason,
    },
    hostRows: {
      path: relTo(ROOT, hostRows.path),
      available: hostRows.available,
      source: hostRows.source,
      confidence: hostRows.confidence,
      hostVersion: hostRows.hostVersion,
      rowIds: hostRows.rowCount,
      packages: hostRows.packageCount,
      note: hostRows.note,
    },
    identity,
    permissions,
    rowContention,
    sameTrack,
    suggestion: {
      suggestedLabel: suggestion.suggestedLabel,
      matchedTerms: suggestion.matchedTerms,
      scores: suggestion.scores,
      note: suggestion.note,
      labelsPath: labelTable.path,
    },
    verdict,
    warnings,
  };
}

function buildScanAllReport(opts) {
  const warnings = [];
  const profile = loadProfile(opts.profile, warnings); // --scan-all 必需 profile：读不到直接抛 CliError
  const hostRows = loadHostRows(opts.hostRows, opts.hostRowsExplicit, warnings);
  const installed = collectInstalledPatches(profile, warnings);
  const table = buildRowTable(installed, hostRows);
  const scanAll = buildScanAll({ installed, table, hostRows, warnings });

  return {
    generatedAt: new Date().toISOString(),
    mode: 'scan-all',
    profile: profile.path,
    hostRows: {
      path: relTo(ROOT, hostRows.path),
      available: hostRows.available,
      source: hostRows.source,
      confidence: hostRows.confidence,
      hostVersion: hostRows.hostVersion,
      rowIds: hostRows.rowCount,
      packages: hostRows.packageCount,
      note: hostRows.note,
    },
    scanAll,
    warnings,
  };
}

// ────────────────────────────────────────────────────────────── 组装报告：--unknown / --search（C.2）

/** 读一个已装包的 description（读不到 → null + 原因，不猜）。 */
function readPackageDescription(pkgDir) {
  const r = readJson(path.join(pkgDir, 'package.json'));
  if (!r.ok) return { description: null, reason: `package.json 读不到（${r.reason}）` };
  if (!isPlainObject(r.value)) return { description: null, reason: 'package.json 不是 JSON 对象' };
  const d = typeof r.value.description === 'string' && r.value.description.trim() ? r.value.description.trim() : null;
  return { description: d, reason: d === null ? 'package.json 没有 description' : null };
}

/** description 质量判定（RULES §11.3：缺失 / < 15 字 / 含营销词 = 说了等于没说）。 */
function judgeDescription(description) {
  if (description === null) {
    return { verdict: 'missing', reasons: ['description 缺失'], chars: 0, hasCjk: false };
  }
  const chars = [...description].length;
  const lower = description.toLowerCase();
  const hits = MARKETING_WORDS.filter((w) => lower.includes(w));
  const reasons = [];
  if (chars < DESC_MIN_CHARS) reasons.push(`只有 ${chars} 字（< ${DESC_MIN_CHARS}）`);
  if (hits.length > 0) reasons.push(`含营销词 ${hits.map((h) => `「${h}」`).join('、')}`);
  return { verdict: reasons.length > 0 ? 'weak' : 'ok', reasons, chars, hasCjk: CJK_RE.test(description) };
}

const UNKNOWN_ORDER = { P1: 0, P2: 1, P3: 2, '—': 3 };

/** profile 里「已装第三方包」= (dependencies ∪ bundles) 去掉官方 scope。不掺 node_modules 里的传递依赖。 */
function installedThirdParty(profile) {
  const declared = new Set([...profile.depNames, ...profile.bundles]);
  return [...declared].filter((p) => !isOfficialPkg(p)).sort(cmp);
}

function packageDirOf(profile, pkg) {
  return path.join(profile.nmDir, ...String(pkg).split('/'));
}

function dirExists(p) {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function requireCatalog(opts) {
  const catalog = loadCatalog({ snapshotPath: opts.catalog, sourcePath: opts.catalogSource });
  if (!catalog.available) {
    throw new CliError(
      `离线目录不可用：${catalog.reason} → 这个模式必须靠目录判定（不输出空结果冒充成功）；先跑 node tools/_catalog.mjs --write`,
    );
  }
  return catalog;
}

// ────────────────────────────────────────────────────────────── 三源池（C.3）
//
// 三源优先级**固定**（任务卡逐字）：registry（第三方市场）> catalog（官方模块）> 已装包 description。
// 同一条目出现在多源 → 保留高优先源，低优先源记进 alsoIn（信息不丢，也不重复计分）。

/** 读已装包的 description + keywords（goal 打分要 keywords；读不到给 null/[]，不猜）。 */
function readPackageIdentity(pkgDir) {
  const r = readJson(path.join(pkgDir, 'package.json'));
  if (!r.ok) return { description: null, keywords: [], reason: `package.json 读不到（${r.reason}）` };
  if (!isPlainObject(r.value)) return { description: null, keywords: [], reason: 'package.json 不是 JSON 对象' };
  const d = typeof r.value.description === 'string' && r.value.description.trim() ? r.value.description.trim() : null;
  const keywords = asStringList(r.value.keywords);
  return { description: d, keywords, reason: d === null ? 'package.json 没有 description' : null };
}

/** 已装判定：profile 声明（dependencies ∪ bundles）**且** 目录存在。不猜。 */
function isInstalledPkg(profile, pkg) {
  if (!profile || !pkg) return false;
  const declared = Object.prototype.hasOwnProperty.call(profile.dependencies, pkg) || profile.bundleSet.has(pkg);
  if (!declared) return false;
  return dirExists(packageDirOf(profile, pkg));
}

/** registry 段元信息（报告头用；不可用时必须把原因写出来）。 */
function registryMetaBlock(registry) {
  const meta = registry && registry.meta ? registry.meta : null;
  return {
    path: registry ? registry.path : null,
    available: registry ? registry.available === true : false,
    origin: registry ? registry.origin : 'none',
    count: registry && registry.available ? registry.count : 0,
    malformed: registry && Array.isArray(registry.malformed) ? registry.malformed.length : 0,
    unknownFields: registry && Array.isArray(registry.unknownFields) ? registry.unknownFields : [],
    // C.3.2：真实形状的证据 —— 数组键（plugins）/ 容器键（registry）/ hostVersion 都要能自证
    hostVersion: meta && typeof meta.hostVersion === 'string' ? meta.hostVersion : null,
    arrayKey: meta && typeof meta.arrayKey === 'string' ? meta.arrayKey : null,
    containerKey: meta && typeof meta.containerKey === 'string' ? meta.containerKey : null,
    shape: meta && typeof meta.shape === 'string' ? meta.shape : null,
    declaredCount: meta && meta.registry && typeof meta.registry.declaredCount === 'number' ? meta.registry.declaredCount : null,
    source: meta,
    reason: registry ? registry.reason : '未加载 registry',
  };
}

/** 描述按语言落位（catalog / 已装包只有一段文本：含中文进 zh，否则进 en，不编造另一种语言）。 */
function splitDescription(text) {
  if (text === null || text === undefined) return { zh: null, en: null };
  const s = String(text).trim();
  if (!s) return { zh: null, en: null };
  return CJK_RE.test(s) ? { zh: s, en: null } : { zh: null, en: s };
}

/** registry 条目的分类：数组（真实形状）或字符串都能吃；两种形态都留着（数组语义别在 join 里丢）。 */
function categoryOf(item) {
  if (Array.isArray(item.categoryList) && item.categoryList.length > 0) return item.categoryList.join(' ');
  if (Array.isArray(item.category)) return item.category.join(' ');
  if (item.category === null || item.category === undefined) return '';
  return String(item.category);
}

/**
 * 三源池。`counts` 是**各源条数**（末行「池 M（registry A ｜ catalog B ｜ 已装 C）」用），
 * `items` 是按包名去重后的候选池（高优先源胜出）。
 *
 * C.3.2：registry 条目携带真实字段（中英描述 / capabilities / capabilityRedLines / stars / downloads /
 * install / page / capabilityCheckedAt），**全部带进池子**——打分、报告、优先级都要用它们。
 */
function buildPool({ registry, catalog, profile, warnings }) {
  const merged = new Map();
  const counts = { registry: 0, catalog: 0, installed: 0 };

  const add = (item, source) => {
    counts[source] += 1;
    const existing = merged.get(item.pkg);
    if (existing) {
      if (!existing.alsoIn.includes(source)) existing.alsoIn.push(source);
      if (source === 'installed') existing.installed = true;
      return;
    }
    merged.set(item.pkg, { ...item, source, alsoIn: [] });
  };

  if (registry && registry.available) {
    for (const p of registry.entries) {
      // 身份键：npm > owner/name（真实数据里大量条目没有 npm，只有显示名时不同 owner 会撞名）> 显示名
      const pkg = p.npm || (p.owner && p.name ? `${p.owner}/${p.name}` : p.name);
      if (!pkg) continue;
      add(
        {
          pkg,
          name: p.name,
          owner: p.owner,
          npm: p.npm,
          descriptionZh: p.descriptionZh,
          descriptionEn: p.descriptionEn,
          capabilities: Array.isArray(p.capabilities) ? p.capabilities : [],
          redLines: Array.isArray(p.capabilityRedLines) ? p.capabilityRedLines : [],
          capabilityCheckedAt: p.capabilityCheckedAt,
          keywords: [],
          category: categoryOf(p),
          categoryList: Array.isArray(p.category) ? p.category : [],
          stars: typeof p.stars === 'number' ? p.stars : null,
          downloads: typeof p.downloads === 'number' ? p.downloads : null,
          install: p.install === undefined ? null : p.install,
          page: p.page === null || p.page === undefined ? null : p.page,
          installed: false,
          installedKnown: typeof p.npm === 'string' && p.npm !== '',
          sourceDetail: p.npm ? null : 'registry 条目没有 npm 包名（身份键用 owner/name）→ 无法判定是否已装',
          registryKey: p.key || null,
        },
        'registry',
      );
    }
  }

  if (catalog && catalog.available) {
    for (const key of Object.keys(catalog.entries).sort(cmp)) {
      const e = catalog.entries[key];
      const label = categoryLabelOf(catalog, e.category);
      const desc = splitDescription(e.desc);
      add(
        {
          pkg: key,
          name: e.name,
          owner: null,
          npm: key,
          descriptionZh: desc.zh,
          descriptionEn: desc.en,
          capabilities: [],
          redLines: [],
          capabilityCheckedAt: null,
          keywords: [],
          category: [e.category, label === null ? '' : label].filter(Boolean).join(' '),
          categoryList: e.category ? [e.category] : [],
          stars: null,
          downloads: null,
          install: null,
          page: null,
          installed: false,
          installedKnown: true,
          sourceDetail: null,
        },
        'catalog',
      );
    }
  }

  if (profile) {
    for (const pkg of installedThirdParty(profile)) {
      const dir = packageDirOf(profile, pkg);
      if (!dirExists(dir)) {
        warnings.push(`${pkg}: profile 声明了它，但 ${dir} 不存在 → 不计入「已装」池（描述也不猜）`);
        continue;
      }
      const id = readPackageIdentity(dir);
      if (id.description === null) warnings.push(`${pkg}: ${id.reason} → 已装池里它的 description=null（不猜）`);
      const desc = splitDescription(id.description);
      add(
        {
          pkg,
          name: null,
          owner: null,
          npm: pkg,
          descriptionZh: desc.zh,
          descriptionEn: desc.en,
          capabilities: [],
          redLines: [],
          capabilityCheckedAt: null,
          keywords: id.keywords,
          category: null,
          categoryList: [],
          stars: null,
          downloads: null,
          install: null,
          page: null,
          installed: true,
          installedKnown: true,
          sourceDetail: null,
        },
        'installed',
      );
    }
  }

  // registry / 目录条目若与本机已装包同名 → 已装状态以 profile 实测为准（没有 npm 的条目无法判定，不猜）
  for (const item of merged.values()) {
    if (item.installed) continue;
    if (item.installedKnown === false) continue;
    if (isInstalledPkg(profile, item.pkg)) item.installed = true;
  }

  const items = [...merged.values()].sort((a, b) => cmp(a.pkg, b.pkg));
  return { items, counts, total: items.length, poolTotal: counts.registry + counts.catalog + counts.installed };
}

const SOURCE_ORDER = { registry: 0, catalog: 1, installed: 2 };

function sourceRank(source) {
  return SOURCE_ORDER[source] === undefined ? 9 : SOURCE_ORDER[source];
}

/**
 * 单个候选的**分字段小写文本**（C.3.2：匹配面 = 包名/显示名 + 中文描述 + 英文描述 + capabilities + keywords + 分类）。
 * 只算一次、存进索引 —— 10974 条 × 多次匹配时，重复拼串是纯浪费。
 */
function fieldTexts(item) {
  const nameParts = [item.name === null || item.name === undefined ? '' : item.name, item.pkg];
  if (typeof item.npm === 'string' && item.npm !== item.pkg) nameParts.push(item.npm);
  return {
    name: nameParts.join('\n').toLowerCase(),
    descriptionZh: String(item.descriptionZh === null || item.descriptionZh === undefined ? '' : item.descriptionZh).toLowerCase(),
    descriptionEn: String(item.descriptionEn === null || item.descriptionEn === undefined ? '' : item.descriptionEn).toLowerCase(),
    capabilities: (Array.isArray(item.capabilities) ? item.capabilities.join('\n') : '').toLowerCase(),
    keywords: (Array.isArray(item.keywords) ? item.keywords.join('\n') : '').toLowerCase(),
    category: categoryOf(item).toLowerCase(),
  };
}

/** 候选的可比对文本（小写全量）：六个字段拼成一段；三源同口径，不另写一份。 */
function candidateHaystack(item, f = fieldTexts(item)) {
  return SCORE_FIELDS.map((k) => f[k]).join('\n');
}

/** 小写串的 token 集（空白/标点切分）：ASCII 词的「整词」快判用，中文段整段也进集合。 */
function tokenSetOf(text) {
  const set = new Set();
  for (const w of String(text).split(/[^0-9a-z\u4e00-\u9fff]+/)) {
    if (w) set.add(w);
  }
  return set;
}

/**
 * **小写索引**（C.3.2 硬要求）：启动时一次性把每条拼成小写串 + 预存 token 集 + 六个字段各自的小写串。
 * 之后 `--search` / `--goal` 的所有匹配都在这份索引上**单遍扫描**，不再重复造语料。
 *
 * 返回 `buildMs` 单独计量：报告里能看出「建索引」与「匹配」各花多少。
 */
function buildSearchIndex(items) {
  const t0 = performance.now();
  const index = [];
  for (const item of items) {
    const f = fieldTexts(item);
    const hay = candidateHaystack(item, f);
    // noiseHay：规则 D 的判定语料（不含包名/分类，见 goalCorpusText 的注释）
    const noiseHay = goalCorpusText(item);
    index.push({ item, f, hay, noiseHay, tokens: tokenSetOf(hay) });
  }
  return { index, buildMs: performance.now() - t0 };
}

/** 某词是否落在该条目的**任一**匹配字段里（`--search` 的 AND 判定用）。 */
function entryIncludes(entry, token) {
  for (const field of SCORE_FIELDS) {
    if (entry.f[field].includes(token)) return true;
  }
  return false;
}

/**
 * 目标词分词（口径见 RULES §12.3）：
 *   中文按 2–4 字滑窗切（含停用字的窗口直接丢）、英文按空白/连字符切；
 *   去停用词；**保留原有词与拆分词**（整体词也进候选，除非它含停用字/是停用词）。
 */
function tokenizeGoal(text) {
  const tokens = [];
  const seen = new Set();
  const push = (raw) => {
    const t = String(raw === null || raw === undefined ? '' : raw).trim().toLowerCase();
    if (!t) return;
    if (seen.has(t)) return;
    if (tokens.length >= MAX_GOAL_TOKENS) return;
    seen.add(t);
    tokens.push(t);
  };

  const runs = [];
  let cur = '';
  let curType = null;
  const flush = () => {
    if (cur) runs.push({ type: curType, text: cur });
    cur = '';
    curType = null;
  };
  for (const ch of String(text === null || text === undefined ? '' : text).toLowerCase()) {
    const type = CJK_RE.test(ch) ? 'zh' : /[a-z0-9]/.test(ch) ? 'en' : 'sep';
    if (type === 'sep') {
      flush();
      continue;
    }
    if (curType !== null && curType !== type) flush();
    curType = type;
    cur += ch;
  }
  flush();

  for (const run of runs) {
    if (run.type === 'en') {
      // 空白在分词阶段已被切掉，这里再按连字符/下划线拆（`dsh-market` → dsh + market）
      for (const part of run.text.split(/[-_]+/)) {
        if (!part) continue;
        if (EN_STOPWORDS.has(part)) continue;
        push(part);
      }
      continue;
    }
    const chars = [...run.text];
    if (!chars.some((c) => ZH_STOPCHARS.has(c))) push(run.text); // 原有词
    for (let len = GOAL_WINDOW_MIN; len <= GOAL_WINDOW_MAX; len += 1) {
      for (let i = 0; i + len <= chars.length; i += 1) {
        const win = chars.slice(i, i + len).join('');
        if ([...win].some((c) => ZH_STOPCHARS.has(c))) continue;
        push(win);
      }
    }
  }
  return tokens;
}

/** 词长度（按字符算，中文一个字算 1）。 */
function tokenLength(token) {
  return [...String(token === null || token === undefined ? '' : token)].length;
}

/**
 * 「长词」判定（C.3.1 门禁第一条）：中文 ≥3 字，或英文单词长度 ≥5。
 * 中英混排的窗口（本工具不产出这种词）按「含中文即按中文口径」处理，不猜。
 */
function isLongToken(token) {
  const t = String(token === null || token === undefined ? '' : token);
  if (!t) return false;
  return CJK_RE.test(t) ? tokenLength(t) >= GOAL_LONG_ZH : tokenLength(t) >= GOAL_LONG_EN;
}

/**
 * 池子的「噪声判定语料」（规则 D）：**显示名 + 中英描述 + capabilities + keywords**。
 * **不含**包名与 category —— 包名里的 `dsh`/`plugin` 会让任何滑窗词看起来都「出现过」。
 * C.3.2 起把 `capabilities` 也计入（能力清单是真实市场里的大段文本，词在它里面出现就算「池里有这个词」）。
 */
function goalCorpusText(item) {
  const name = item && item.name !== null && item.name !== undefined ? String(item.name) : '';
  const zh = item && item.descriptionZh !== null && item.descriptionZh !== undefined ? String(item.descriptionZh) : '';
  const en = item && item.descriptionEn !== null && item.descriptionEn !== undefined ? String(item.descriptionEn) : '';
  const caps = item && Array.isArray(item.capabilities) ? item.capabilities.join('\n') : '';
  const kw = item && Array.isArray(item.keywords) ? item.keywords.join('\n') : '';
  return [name, zh, en, caps, kw].join('\n').toLowerCase();
}

/** 命中字段的中文名（报告里「能力+3 / 中文描述+3」要能一眼读懂）。 */
const FIELD_LABEL = {
  name: '名称',
  descriptionZh: '中文描述',
  descriptionEn: '英文描述',
  capabilities: '能力',
  keywords: '关键词',
  category: '分类',
};

/**
 * 噪声词过滤（C.3.1 规则 D，C.3.2 走索引）：
 *   滑窗产生的词，若在整个池子的「显示名 + 中英描述 + capabilities + keywords」里**一条都没命中** **且** 长度 < 4 → 丢弃。
 * 为什么要有它：中文滑窗会把「接抖音直播做预管理」切出「接抖」「接抖音」这类池里根本不存在的碎片。
 * 为什么保留 ≥4 字的词：长度够的词即使池里没有，也是用户真正说出来的概念（例 `接抖音直`）。
 *
 * @param {string[]} tokens
 * @param {{noiseHay: string}[]} index 小写索引（单遍扫描，不再重复拼串）
 * @returns {{tokens: string[], dropped: {token: string, entries: number, length: number, reason: string}[]}}
 */
export function filterNoiseTokens(tokens, index) {
  const list = Array.isArray(index) ? index : [];
  const kept = [];
  const dropped = [];
  for (const token of tokens) {
    let entries = 0;
    for (const entry of list) {
      if (entry.noiseHay.includes(token)) {
        entries += 1;
        break; // 只判「有没有」：0 与非 0 是唯一分界，没必要数全量
      }
    }
    const length = tokenLength(token);
    if (entries === 0 && length < NOISE_MIN_LEN) {
      dropped.push({
        token,
        entries,
        length,
        reason: `池内 name+描述+capabilities+keywords 命中 0 条且长度 ${length} < ${NOISE_MIN_LEN}（滑窗碎片）`,
      });
      continue;
    }
    kept.push(token);
  }
  return { tokens: kept, dropped };
}

/**
 * 单条候选打分（可解释，不黑盒）。C.3.2 口径：
 *   逐词判断落在哪些字段（子串命中、大小写不敏感），**同一词在同一字段里只计一次**：
 *   名称（显示名 ∪ 包名）×3 ｜ **中文描述 ×3（= ⌈2 × 1.5⌉）** ｜ 英文描述 ×2 ｜
 *   **capabilities ×3（= ⌈2 × 1.5⌉）** ｜ keywords ×2 ｜ 分类 ×1；
 *   通用词（`GENERIC_TERMS`）命中权重 = ⌊原始权重 × 0.5⌋（向下取整），并标 `generic`。
 *
 * C.3.3 增补（只对 `--goal` 生效）：第 3 个参数 `idfMap` 给出时，**每个命中词先乘 idf**
 *   `weight = 字段权重和 × idf`（两位小数），通用词再 ×0.5（两位小数）。
 *   `idfMap` 省略（`--search` 走这条）→ **一字不变的旧路径**：整数权重 + ⌊×0.5⌋，
 *   保证「不改 --search 行为」这条硬约束在代码层就成立（不是靠调用方自觉）。
 *
 * @param {{item: object, f: Record<string,string>}} entry 索引条目
 * @param {string[]} tokens 目标词
 * @param {Map<string, number>|null} [idfMap] 词 → idf（C.3.3；省略 = 不加权）
 */
function scoreCandidate(entry, tokens, idfMap = null) {
  const breakdown = { name: 0, descriptionZh: 0, descriptionEn: 0, capabilities: 0, keywords: 0, category: 0 };
  const matched = [];
  const weighted = idfMap instanceof Map;
  let score = 0;
  let rawScore = 0;
  for (const token of tokens) {
    const fields = [];
    let rawWeight = 0;
    for (const field of SCORE_FIELDS) {
      if (!entry.f[field].includes(token)) continue;
      fields.push(field);
      rawWeight += GOAL_WEIGHTS[field];
    }
    if (fields.length === 0) continue;
    const generic = GENERIC_TERMS.has(token);
    // 表里查不到（理论上不会发生：表是按同一批 tokens 建的）→ 用中性 1，不偷偷加权
    const idf = weighted ? (idfMap.has(token) ? idfMap.get(token) : 1) : 1;
    // 旧路径（--search）：整数权重，通用词 ⌊×0.5⌋；新路径（--goal）：× idf 后两位小数，通用词再 ×0.5
    const afterIdf = weighted ? round2(rawWeight * idf) : rawWeight;
    const weight = generic ? (weighted ? round2(afterIdf * GENERIC_WEIGHT_FACTOR) : Math.floor(afterIdf * GENERIC_WEIGHT_FACTOR)) : afterIdf;
    for (const field of fields) breakdown[field] += 1;
    score += weight;
    rawScore += rawWeight;
    const hit = {
      token,
      fields,
      fieldLabels: fields.map((f) => FIELD_LABEL[f]),
      weight,
      rawWeight,
      generic,
      long: isLongToken(token),
    };
    // idf 只在加权路径里**存在**（--goal）；`--search` 的行里连这个键都不出现 ——
    // 「不改 --search 行为」包括「不多一个 null 字段」，否则下游按字段集合比对的验收会红。
    if (weighted) hit.idf = round2(idf);
    matched.push(hit);
  }
  return { score: weighted ? round2(score) : score, rawScore, matched, breakdown };
}

/**
 * 相关性门禁（C.3.1）：三条**缺一即不入候选**
 *   ① 命中至少 1 个长词（中文 ≥3 字 / 英文单词 ≥5）；或
 *   ② 命中 ≥2 个不同词；或
 *   ③ 总分 ≥6。
 * 外加一条硬否决：**全部命中都是通用词**（管理/设置/任务…）→ 不算命中（除非同时命中了长词）。
 *
 * ⚠️ **C.3.3 起本函数不再用作 `--goal` 的门禁**（三条硬门槛就是召回过窄的直接原因，见文件头 ⑯），
 *    现行判定看 `classifyTier`（分层 + 通用词否决）。保留本函数只为：①外部引用不断链；
 *    ②`fixtures/goal-expected.json` 的 C.3.1 历史口径仍可对照；③报告里 `rule.legacyGate` 如实写出旧口径。
 *
 * @returns {{pass: boolean, byLong: boolean, byDistinct: boolean, byScore: boolean, genericOnly: boolean,
 *            longHits: string[], distinct: number, score: number, reasons: string[]}}
 */
export function judgeRelevance(matched, score) {
  const list = Array.isArray(matched) ? matched : [];
  const distinct = list.length;
  const longHits = list.filter((m) => m.long && !m.generic).map((m) => m.token);
  const genericOnly = distinct > 0 && list.every((m) => m.generic);
  const byLong = longHits.length > 0;
  const byDistinct = distinct >= GOAL_MIN_DISTINCT;
  const byScore = score >= GOAL_MIN_SCORE;

  // 三条任一条满足即过门；但「全部命中都是通用词」是硬否决（除非命中长词 —— 通用词都是 2 字，实际不可能同时成立）
  const pass = byLong || (!genericOnly && (byDistinct || byScore));

  const reasons = [];
  if (!byLong) reasons.push(`未命中长词（中文≥${GOAL_LONG_ZH}字 / 英文≥${GOAL_LONG_EN}）`);
  if (!byDistinct) reasons.push(`不同词 ${distinct} 个 < ${GOAL_MIN_DISTINCT}`);
  if (!byScore) reasons.push(`总分 ${score} < ${GOAL_MIN_SCORE}`);
  if (genericOnly) reasons.push(`只命中通用词（已 ×${GENERIC_WEIGHT_FACTOR} 降权：${list.map((m) => m.token).join('、')}）→ 单独命中不足以成候选`);

  return { pass: pass === true, byLong, byDistinct, byScore, genericOnly, longHits, distinct, score, reasons };
}

/**
 * **词表诊断 + idf 预计算**（C.3.3，一次算完，不逐词重扫）：
 * 单遍遍历索引，对每个词数「命中条目数」（同一词在同一字段里只算一次；命中任一字段即算该条目命中），
 * 再按 `idf = clamp(ln(池总数 / (1 + 命中条目数)), 0.5, 3.0)` 算出权重（两位小数）。
 *
 * 复杂度：O(条目数 × 词数 × 字段数) 的 `includes`，与打分那一遍同量级 —— 两遍扫描，仍然不含重拼语料。
 *
 * @param {{item: object, f: Record<string,string>}[]} index 小写索引
 * @param {string[]} tokens 有效词（噪声过滤后）
 * @param {number} poolTotal 池子总数（= 三源条数之和，idf 的「池总数」用它）
 * @returns {{tokens: {token: string, hits: number, idf: number, missing: boolean}[],
 *            idfMap: Map<string, number>, missing: string[], poolTotal: number}}
 */
export function computeTokenStats(index, tokens, poolTotal) {
  const list = Array.isArray(index) ? index : [];
  const words = Array.isArray(tokens) ? tokens : [];
  const hits = new Map(words.map((t) => [t, 0]));
  for (const entry of list) {
    // 快路径：`hay` 就是六字段按 `\n` 拼起来的小写串（见 fieldTexts / candidateHaystack），
    // 而词里不可能含 `\n` → 「hay.includes(词)」与「六个字段任一 contains 词」完全等价，
    // 一次扫描替代六次 includes（10974 条 × 词数时这是这一遍快不快的关键）。
    const hay = typeof entry.hay === 'string' ? entry.hay : null;
    for (const token of words) {
      if (hits.get(token) === list.length) continue; // 已数到上限（= 全池命中），不必再判
      const hit = hay === null ? entryIncludes(entry, token) : hay.includes(token);
      if (hit) hits.set(token, hits.get(token) + 1);
    }
  }
  const total = Math.max(1, Number(poolTotal) || list.length || 1);
  const idfMap = new Map();
  const rows = [];
  const missing = [];
  for (const token of words) {
    const n = hits.get(token) || 0;
    // 夹取：稀有词趋近 3.0，普遍词趋近 0.5（夹取端点写进报告，可复算）
    const raw = Math.log(total / (1 + n));
    const idf = round2(Math.min(IDF_MAX, Math.max(IDF_MIN, raw)));
    idfMap.set(token, idf);
    rows.push({ token, hits: n, idf, missing: n === 0 });
    if (n === 0) missing.push(token);
  }
  return { tokens: rows, idfMap, missing, poolTotal: total };
}

/**
 * **命中分层**（C.3.3，替代 C.3.1 的三条硬门槛）：
 *   覆盖率 `coverage = 命中有效词数 / 有效词总数`；
 *   强匹配 `≥0.5` ｜ 弱匹配 `0.2 ≤ c < 0.5` ｜ 仅字面命中 `c < 0.2`。
 * **保留**「只命中通用词 = 不算匹配」的否决：这类条目一律强制归入「仅字面命中」
 * （否则 `--goal "接抖音直播做预管理"` 里「管理-only」会靠覆盖率混进弱匹配）。
 *
 * @param {{matched: object[], score: number}} scored `scoreCandidate` 的返回值
 * @param {number} tokenCount 有效词总数（分母；0 时覆盖率记 0，不除零）
 * @returns {{tier: 'strong'|'weak'|'literal', coverage: number, genericOnly: boolean,
 *            distinct: number, score: number, reasons: string[]}}
 */
export function classifyTier(scored, tokenCount) {
  const matched = scored && Array.isArray(scored.matched) ? scored.matched : [];
  const score = scored && typeof scored.score === 'number' ? scored.score : 0;
  const denominator = Number(tokenCount) > 0 ? Number(tokenCount) : 0;
  const distinct = matched.length;
  const coverage = denominator === 0 ? 0 : round2(distinct / denominator);
  const genericOnly = distinct > 0 && matched.every((m) => m.generic);

  let tier;
  const reasons = [];
  if (genericOnly) {
    tier = 'literal';
    reasons.push(GOAL_TIER_REASON.genericOnly);
  } else if (coverage >= GOAL_TIER_STRONG) {
    tier = 'strong';
  } else if (coverage >= GOAL_TIER_WEAK) {
    tier = 'weak';
  } else {
    tier = 'literal';
    reasons.push(`${GOAL_TIER_REASON.literalCoverage}（${distinct}/${denominator} = ${coverage}）`);
  }

  return { tier, coverage, genericOnly, distinct, score, reasons };
}

/** 词的 2 字片段（无匹配时用它算「最接近」，比「随便挑 3 条」诚实）。 */
function bigramsOf(token) {
  const chars = [...String(token)];
  if (chars.length <= 1) return chars;
  const out = [];
  for (let i = 0; i + 1 < chars.length; i += 1) out.push(chars[i] + chars[i + 1]);
  return out;
}

/**
 * 无匹配时的「最接近 N 条」：按**2 字片段部分重合度**排序（不是匹配、不是推荐）。
 * 一条都没有片段重合 → 返回空数组，正文写「不硬凑候选」。
 *
 * @param {{item: object, hay: string}[]} index 小写索引
 */
function closestCandidates(index, tokens, n = GOAL_CLOSEST_N) {
  const list = Array.isArray(index) ? index : [];
  const scored = [];
  for (const entry of list) {
    const hits = [];
    for (const token of tokens) {
      for (const bg of bigramsOf(token)) {
        if (entry.hay.includes(bg) && !hits.includes(bg)) hits.push(bg);
      }
    }
    if (hits.length === 0) continue;
    scored.push({ item: entry.item, hits });
  }
  scored.sort((a, b) => b.hits.length - a.hits.length || cmp(a.item.pkg, b.item.pkg));
  return scored.slice(0, n);
}

function buildUnknownReport(opts) {
  const warnings = [];
  // C.4：catalog / profile 都不是硬前置 —— 三源（registry / catalog / 已装）任一可用就继续；全不可用才 exit 1
  let profile = null;
  try {
    profile = loadProfile(opts.profile, warnings);
  } catch (err) {
    const msg = err && err.message ? err.message : String(err);
    warnings.push(`读不到 profile（${msg}）→ 已装这一源计 0 条（--unknown 只审 profile 里的已装第三方包）`);
  }
  const catalog = loadCatalog({ snapshotPath: opts.catalog, sourcePath: opts.catalogSource });
  for (const w of catalog.warnings || []) warnings.push(w);
  if (!catalog.available) {
    warnings.push(`catalog 缺失：本模式下“说不清”的判定会偏保守（更多包落 P1）｜原因：${catalog.reason}`);
  }
  const registry = loadRegistry({ snapshotPath: opts.registry });
  for (const w of registry.warnings || []) warnings.push(w);
  if (!registry.available) {
    warnings.push(
      `registry 不可用（${registry.reason}）→ 本次「说不清」只按 CATALOG + description 判定；这不代表市场里也没有它`,
    );
  }

  const installed = profile ? installedThirdParty(profile) : [];
  if (!registry.available && !catalog.available && installed.length === 0) {
    throw new CliError(
      '三源均不可用（registry / catalog / 已装）：至少给一个——\n' +
        '  --registry <v2 快照> 或 node tools/_registry.mjs --url http://127.0.0.1:<port>/dsh-market/registry --write\n' +
        '  或 --catalog <快照> 或 node tools/_catalog.mjs --write\n' +
        '  或用 --profile 指向一个含 package.json 的目录（夹具：fixtures/fake-profile）',
    );
  }
  const rows = [];

  for (const pkg of installed) {
    const dir = packageDirOf(profile, pkg);
    const exists = dirExists(dir);
    const meta = profile.actual.get(pkg) || { version: null };
    const descRead = exists ? readPackageDescription(dir) : { description: null, reason: '目录不存在（profile 声明了但没装）' };
    const judge = judgeDescription(descRead.description);
    const hit = lookupEntry(catalog.entries, pkg);
    const reg = lookupRegistry(registry, pkg);
    const regEntry = reg.hit && reg.entry ? reg.entry : null;
    // C.3.2：真实 registry 的 description 是 {en,zh} 对象 → 归一化后分列 descriptionZh / descriptionEn
    const regDesc = regEntry ? regEntry.descriptionZh || regEntry.descriptionEn || null : null;
    const regDescLang = regEntry ? (regEntry.descriptionZh ? 'zh' : regEntry.descriptionEn ? 'en' : null) : null;
    const normalizedLocal = descRead.description === null ? null : descRead.description.replace(/\s+/g, ' ').trim();
    const normalizedReg = regDesc === null ? null : regDesc.replace(/\s+/g, ' ').trim();
    // 不一致才标：两边都有描述且去空白后不同（不是「意思不同」，是「字面不同」，照实说）
    const descMismatch = normalizedLocal !== null && normalizedReg !== null && normalizedLocal !== normalizedReg;
    const perms = scanPermissions(exists ? dir : null, opts, warnings);

    let severity;
    let action;
    if (regDesc !== null) {
      severity = '—';
      action = `registry 已覆盖（${reg.key}${reg.match === 'basename' ? '，match=basename' : ''}）${descMismatch ? '；本地描述与 registry 不一致，见 descMismatch' : '，无需补描述'}`;
    } else if (hit.hit) {
      severity = '—';
      action = `目录已覆盖（${hit.key}${hit.match === 'basename' ? '，match=basename' : ''}），无需补描述`;
    } else if (judge.verdict !== 'ok') {
      severity = 'P1';
      action = `先 \`--from-dir ${toPosix(dir)}\` 看图 1/2/3 段，手写一句中文用途补进 lab 条目；并向上游提「补 description」（registry ${reg.hit ? '有条目但无描述' : '也没有它'}）`;
    } else if (!judge.hasCjk) {
      severity = 'P2';
      action = '只有外文描述：按 README 正文与代码入口翻成一句中文写进 lab 条目（不要直接抄英文）';
    } else {
      severity = 'P3';
      action = '中文描述可用：登记进 lab 时直接引用，注意版本漂移';
    }

    if (!exists) warnings.push(`${pkg}: profile 声明了它，但 ${dir} 不存在 → 版本/描述记 null（不猜）`);
    if (descRead.reason && descRead.description === null && exists) {
      warnings.push(`${pkg}: ${descRead.reason} → description 记 null`);
    }

    rows.push({
      pkg,
      version: meta.version === null || meta.version === undefined ? null : meta.version,
      installed: exists,
      catalogHit: hit.hit === true,
      catalogMatch: hit.match,
      catalogKey: hit.key,
      catalogNote: hit.reason,
      registryHit: reg.hit === true,
      registryMatch: reg.match,
      registryKey: reg.key,
      registryName: regEntry ? regEntry.name : null,
      registryDescription: regDesc,
      registryDescriptionLang: regDescLang,
      registryCapabilities: regEntry && Array.isArray(regEntry.capabilities) ? regEntry.capabilities : [],
      registryRedLines: regEntry && Array.isArray(regEntry.capabilityRedLines) ? regEntry.capabilityRedLines : [],
      registryNote: reg.reason,
      descMismatch,
      description: descRead.description,
      descriptionChars: judge.chars,
      descriptionHasCjk: judge.hasCjk,
      descriptionVerdict: judge.verdict,
      descriptionReasons: judge.reasons,
      permissionLevel: perms.conclusion,
      permissionScanned: perms.scanned === true,
      severity,
      action,
    });
  }

  rows.sort((a, b) => {
    const d = UNKNOWN_ORDER[a.severity] - UNKNOWN_ORDER[b.severity];
    return d !== 0 ? d : cmp(a.pkg, b.pkg);
  });

  const summary = { p1: 0, p2: 0, p3: 0, trusted: 0, installedTotal: installed.length, registryCovered: 0, descMismatch: 0 };
  for (const row of rows) {
    if (row.severity === 'P1') summary.p1 += 1;
    else if (row.severity === 'P2') summary.p2 += 1;
    else if (row.severity === 'P3') summary.p3 += 1;
    else summary.trusted += 1;
    if (row.severity === '—' && row.registryHit && row.registryDescription !== null) summary.registryCovered += 1;
    if (row.descMismatch) summary.descMismatch += 1;
  }

  // --with-catalog：连同目录全量比对（目录项自带 name+desc，缺的才是问题）
  let catalogCoverage = null;
  if (opts.withCatalog) {
    const keys = Object.keys(catalog.entries).sort(cmp);
    const missingName = [];
    const missingDesc = [];
    for (const key of keys) {
      const e = catalog.entries[key];
      if (!e.name || !String(e.name).trim()) missingName.push(key);
      if (!e.desc || !String(e.desc).trim()) missingDesc.push(key);
    }
    catalogCoverage = {
      total: keys.length,
      described: keys.length - missingDesc.length,
      missingName,
      missingDesc,
      notInstalled: keys.filter((k) => !installed.includes(k)).length,
    };
    if (missingDesc.length > 0 || missingName.length > 0) {
      warnings.push(
        `--with-catalog：目录自身有 ${missingName.length} 条缺中文名、${missingDesc.length} 条缺描述 → 它们同样「说不清」，但那是上游目录的问题`,
      );
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    mode: 'unknown',
    profile: profile ? profile.path : path.resolve(opts.profile),
    scope: opts.withCatalog ? 'installed+catalog' : 'installed',
    catalog: {
      path: catalog.path,
      origin: catalog.origin,
      available: catalog.available,
      count: catalog.count,
      reason: catalog.reason,
      package: catalog.meta ? catalog.meta.package : null,
      version: catalog.meta ? catalog.meta.version : null,
      extractedAt: catalog.meta ? catalog.meta.extractedAt : null,
    },
    registry: registryMetaBlock(registry),
    rule: {
      untrusted: `registry 无描述 且 CATALOG 未命中 且（description 缺失 / < ${DESC_MIN_CHARS} 字 / 含营销词）`,
      coveredBy: 'registry 有描述 或 CATALOG 命中 → 不算 unknown（严重度 —）',
      marketingWords: MARKETING_WORDS,
      descMinChars: DESC_MIN_CHARS,
      p1Counts: 'P1 计入末行计数；P2/P3 只列出，不计入',
    },
    rows,
    summary,
    catalogCoverage,
    warnings,
  };
}

function buildSearchReport(opts) {
  const startedAt = performance.now();
  const warnings = [];
  // C.4：catalog 不再是硬前置 —— 三源（registry / catalog / 已装）任一可用就继续；全不可用才 exit 1
  const catalog = loadCatalog({ snapshotPath: opts.catalog, sourcePath: opts.catalogSource });
  for (const w of catalog.warnings || []) warnings.push(w);
  if (!catalog.available) {
    warnings.push(`catalog: 不可用（${catalog.reason}）→ 本模式仍可用 registry/已装 判定`);
  }
  const registry = loadRegistry({ snapshotPath: opts.registry });
  for (const w of registry.warnings || []) warnings.push(w);
  if (!registry.available) {
    warnings.push(`registry 不可用（${registry.reason}）→ 三源里的「第三方市场」缺位；这不代表市场里没有该插件`);
  }

  const tokens = String(opts.search)
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => t.toLowerCase());
  if (tokens.length === 0) throw new CliError('--search 需要关键词（空格分词，全部命中才算匹配）');
  // 长词优先：先测信息量最大的词，没中就立刻 break（10974 条时这一步就是剪枝）
  const orderedTokens = [...tokens].sort((a, b) => tokenLength(b) - tokenLength(a) || cmp(a, b));

  const profile = safeLoadProfile(opts.profile, warnings);
  const pool = buildPool({ registry, catalog, profile, warnings });
  if (!registry.available && !catalog.available && pool.counts.installed === 0) {
    throw new CliError(
      '三源均不可用（registry / catalog / 已装）：至少给一个——\n' +
        '  --registry <v2 快照> 或 node tools/_registry.mjs --url http://127.0.0.1:<port>/dsh-market/registry --write\n' +
        '  或 --catalog <快照> 或 node tools/_catalog.mjs --write\n' +
        '  或用 --profile 指向一个含 package.json 的目录（夹具：fixtures/fake-profile）',
    );
  }
  const built = buildSearchIndex(pool.items);

  const scanStart = performance.now();
  const matched = [];
  for (const entry of built.index) {
    let all = true;
    for (const token of orderedTokens) {
      if (!entryIncludes(entry, token)) {
        all = false;
        break;
      }
    }
    if (!all) continue;
    matched.push({ entry, ...scoreCandidate(entry, tokens) });
  }
  matched.sort((a, b) => sourceRank(a.entry.item.source) - sourceRank(b.entry.item.source) || b.score - a.score || cmp(a.entry.item.pkg, b.entry.item.pkg));
  const scanMs = performance.now() - scanStart;

  const results = matched.map(({ entry, score, rawScore, matched: hits, breakdown }) => {
    const item = entry.item;
    return {
      pkg: item.pkg,
      name: item.name,
      owner: item.owner,
      source: item.source,
      alsoIn: item.alsoIn,
      description: item.descriptionZh || item.descriptionEn,
      descriptionZh: item.descriptionZh,
      descriptionEn: item.descriptionEn,
      descriptionLang: item.descriptionZh ? 'zh' : item.descriptionEn ? 'en' : null,
      capabilities: Array.isArray(item.capabilities) ? item.capabilities : [],
      capabilityRedLines: Array.isArray(item.redLines) ? item.redLines : [],
      redLines: Array.isArray(item.redLines) ? item.redLines.length > 0 : false,
      redLinesCount: Array.isArray(item.redLines) ? item.redLines.length : 0,
      capabilityCheckedAt: item.capabilityCheckedAt === undefined ? null : item.capabilityCheckedAt,
      category: item.category,
      categoryList: Array.isArray(item.categoryList) ? item.categoryList : [],
      stars: item.stars === undefined ? null : item.stars,
      downloads: item.downloads === undefined ? null : item.downloads,
      install: item.install === undefined ? null : item.install,
      page: item.page === undefined ? null : item.page,
      score,
      rawScore,
      breakdown,
      matchedTokens: hits.map((m) => m.token),
      matched: hits,
      installed: item.installed === true,
      installedKnown: item.installedKnown !== false,
      sourceDetail: item.sourceDetail === undefined ? null : item.sourceDetail,
    };
  });

  const bySource = { registry: 0, catalog: 0, installed: 0 };
  for (const r of results) bySource[r.source] = (bySource[r.source] || 0) + 1;

  const closest = results.length === 0 ? closestCandidates(built.index, tokens, GOAL_CLOSEST_N) : [];
  const elapsedMs = Math.round((performance.now() - startedAt) * 10) / 10;

  return {
    generatedAt: new Date().toISOString(),
    mode: 'search',
    query: String(opts.search),
    tokens,
    profile: profile ? profile.path : null,
    registry: registryMetaBlock(registry),
    catalog: {
      path: catalog.path,
      origin: catalog.origin,
      available: catalog.available,
      count: catalog.count,
      reason: catalog.reason,
      package: catalog.meta ? catalog.meta.package : null,
      version: catalog.meta ? catalog.meta.version : null,
      extractedAt: catalog.meta ? catalog.meta.extractedAt : null,
    },
    pool: {
      registry: pool.counts.registry,
      catalog: pool.counts.catalog,
      installed: pool.counts.installed,
      total: pool.poolTotal,
      mergedUnique: pool.total,
    },
    weights: {
      base: GOAL_BASE_WEIGHTS,
      applied: GOAL_WEIGHTS,
      langFactor: WEIGHT_LANG_FACTOR,
      note: 'descriptionZh / capabilities 命中权重 ×1.5 向上取整（2 → 3）；descriptionEn ×1（2）；通用词再 ×0.5 向下取整',
    },
    elapsedMs,
    performance: {
      indexedEntries: built.index.length,
      indexBuildMs: Math.round(built.buildMs * 10) / 10,
      scanMs: Math.round(scanMs * 10) / 10,
      elapsedMs,
      budgetMs: 2000,
      note: '索引一次性建好（小写串 + token 集 + 六字段小写串），匹配单遍扫描、长词优先剪枝',
    },
    rule: {
      matchFields: SCORE_FIELDS,
      weights: GOAL_WEIGHTS,
      langFactor: WEIGHT_LANG_FACTOR,
      and: '关键词按空白分词，全部命中（AND）才算匹配',
      scoring: '命中字段加权求和（中文描述 / capabilities ×1.5 向上取整），排序：来源优先级 → 得分降序 → 包名升序',
      stats: 'stars / downloads 只展示，不参与打分（不联网核实）',
    },
    results,
    // 每个来源各命中多少（末行/表格要能自证「三源都搜过了」）
    matchBySource: bySource,
    // 历史字段（C.2 断言仍在用）：catalogTotal = 目录条数
    catalogMatchCount: bySource.catalog || 0,
    catalogTotal: catalog.count,
    registryMatchCount: bySource.registry || 0,
    installedMatchCount: bySource.installed || 0,
    closest: closest.map((c) => ({ pkg: c.item.pkg, name: c.item.name, source: c.item.source, installed: c.item.installed === true, hits: c.hits })),
    warnings,
  };
}

// ────────────────────────────────────────────────────────────── 组装报告：--goal（C.3）

/**
 * `--goal <text>`：从三源池里挑「适合做 X」的插件。
 * 打分可解释（RULES §12.3 + §12.3.7）：名称×3 / 中文描述×3（⌈2×1.5⌉）/ 英文描述×2 / 能力×3（⌈2×1.5⌉）/
 * keywords×2 / 分类×1，同分按包名升序。未装包的权限**固定 unknown（未安装，本地无代码）**——不推断、不按同类包猜。
 */
function buildGoalReport(opts) {
  const startedAt = performance.now();
  const warnings = [];
  const catalog = loadCatalog({ snapshotPath: opts.catalog, sourcePath: opts.catalogSource });
  for (const w of catalog.warnings || []) warnings.push(w);
  if (!catalog.available) warnings.push(`离线目录不可用（${catalog.reason}）→ catalog 这一源计 0 条；本模式仍按 registry/已装 继续跑`);

  const registry = loadRegistry({ snapshotPath: opts.registry });
  for (const w of registry.warnings || []) warnings.push(w);
  if (!registry.available) {
    warnings.push(`registry 不可用（${registry.reason}）→ 第三方市场这一源计 0 条；这不代表市场里没有该插件`);
  }

  const profile = safeLoadProfile(opts.profile, warnings);
  const pool = buildPool({ registry, catalog, profile, warnings });

  if (!registry.available && !catalog.available && pool.counts.installed === 0) {
    throw new CliError(
      '三源均不可用（registry / catalog / 已装）：至少给一个——\n' +
        '  --registry <v2 快照> 或 node tools/_registry.mjs --url http://127.0.0.1:<port>/dsh-market/registry --write\n' +
        '  或 --catalog <快照> 或 node tools/_catalog.mjs --write\n' +
        '  或用 --profile 指向一个含 package.json 的目录（夹具：fixtures/fake-profile）',
    );
  }

  const rawTokens = tokenizeGoal(opts.goal);
  if (rawTokens.length === 0) throw new CliError('--goal 分词后没有可用词（全是停用词？）→ 换一句带实词的目标');

  // 小写索引只建一次：噪声词过滤、打分、最接近 3 条全部复用它（C.3.2 性能硬要求）
  const built = buildSearchIndex(pool.items);

  // C.3.1 D：噪声词过滤（滑窗碎片；池内 0 命中且长度 <4 的丢掉，原词记进 tokensDropped）
  const noiseFiltered = filterNoiseTokens(rawTokens, built.index);
  const tokens = noiseFiltered.tokens;
  const tokensDropped = noiseFiltered.dropped;
  if (tokens.length === 0) {
    throw new CliError(
      `--goal 分词后没有可用词：${rawTokens.length} 个滑窗词全部是噪声（池内 name+描述+capabilities+keywords 命中 0 条且长度 < ${NOISE_MIN_LEN}）→ 换一句带实词的目标（丢弃：${rawTokens.join('、')}）`,
    );
  }
  // 长词优先：打分时先测信息量最大的词（对 --goal 的「提前剪枝」同样适用：第一个词不中就不再算后面）
  const orderedTokens = [...tokens].sort((a, b) => tokenLength(b) - tokenLength(a) || cmp(a, b));

  // C.3.3 ⑰⑱：词表诊断 + idf **一次算完**（单遍遍历索引），之后才进打分循环 —— 不逐条重扫
  const statsStart = performance.now();
  const tokenStats = computeTokenStats(built.index, tokens, pool.poolTotal);
  const tokenStatsMs = performance.now() - statsStart;
  const idfMap = tokenStats.idfMap;
  const missingTokens = tokenStats.missing;

  const lab = loadLabCategories(opts.lab, warnings);
  const ledger = loadLedger(opts.lifecycle, warnings);
  const labelTable = loadLabelTable(opts.labels, warnings);
  const trackWarnings = [];

  // C.3.3 ⑯：打分 → **分层**（强 / 弱 / 仅字面），三层全部展示；
  //   C.3.1 的「长词 / ≥2 个不同词 / Σ≥6」硬门槛**取消**（召回过窄的直接原因），只留「通用词否决」。
  //   剪枝：先按「长词优先」做一次「有没有任意一个词命中」的预判，没命中（绝大多数条目）直接跳过，
  //        不进 scoreCandidate 的六字段循环。
  const scanStart = performance.now();
  const strong = [];
  const weak = [];
  const literal = [];
  let prunedByPrecheck = 0;
  for (const entry of built.index) {
    let anyHit = false;
    for (const token of orderedTokens) {
      if (entryIncludes(entry, token)) {
        anyHit = true;
        break;
      }
    }
    if (!anyHit) {
      prunedByPrecheck += 1;
      continue;
    }
    const s = scoreCandidate(entry, tokens, idfMap); // 命中词权重 × idf（idfMap 只在本入口传）
    if (s.matched.length === 0) continue; // 兜底（理论上预判通过就至少有 1 个词命中）
    const tierInfo = classifyTier(s, tokens.length);
    const rec = { entry, item: entry.item, ...s, ...tierInfo };
    if (tierInfo.tier === 'strong') strong.push(rec);
    else if (tierInfo.tier === 'weak') weak.push(rec);
    else literal.push(rec);
  }
  const scanMs = performance.now() - scanStart;
  const byRank = (a, b) => b.score - a.score || cmp(a.item.pkg, b.item.pkg);
  strong.sort(byRank);
  weak.sort(byRank);
  literal.sort(byRank);
  // 「候选」= 强 + 弱（真匹配），仍按 Σ 降序取 top 10；「仅字面命中」永不进候选表
  const matchedRecs = [...strong, ...weak].sort(byRank);
  const top = matchedRecs.slice(0, GOAL_TOP_N);

  // 行构造函数：候选表与三层表共用同一份实现；按包名缓存，避免同一包把权限/同轨算两遍
  const rowCache = new Map();
  const makeRow = (cand) => {
    if (rowCache.has(cand.item.pkg)) return rowCache.get(cand.item.pkg);
    const item = cand.item;
    const installed = item.installed === true;
    const installedKnown = item.installedKnown !== false;

    // 权限：已装 → 代码级四档；未装 → 固定 unknown（不推断）
    let permission;
    let permissionKnown;
    if (installed && profile) {
      const perms = scanPermissions(packageDirOf(profile, item.pkg), opts, trackWarnings);
      permission = perms.scanned ? perms.conclusion : 'unknown（已装但读不到包目录，本地无代码）';
      permissionKnown = perms.scanned === true;
    } else if (!installedKnown) {
      permission = 'unknown（registry 条目没有包名，无法判定是否已装）';
      permissionKnown = false;
    } else {
      permission = 'unknown（未安装，本地无代码）';
      permissionKnown = false;
    }

    // 同轨：用 classify 得到轨，再看 lab 类别列 + lifecycle 里有没有同轨条目（排除自己）
    const summary = item.descriptionZh || item.descriptionEn;
    const identityLike = {
      pkg: item.pkg,
      description: summary,
      summaryText: summary,
      keywords: [...(Array.isArray(item.keywords) ? item.keywords : []), ...(Array.isArray(item.capabilities) ? item.capabilities : [])],
    };
    const suggestion = classify(identityLike, labelTable);
    const sameTrack = buildSameTrack(suggestion.suggestedLabel, lab, ledger, labelTable, trackWarnings, profile);
    const others = [
      ...sameTrack.installed.filter((x) => x.pkg !== item.pkg).map((x) => `${x.pkg}（${x.inProfile ? '已装' : 'lab 登记'}）`),
      ...sameTrack.adopted.filter((x) => x.pkg !== item.pkg).map((x) => `${x.pkg}（adopted）`),
      ...sameTrack.rejected.filter((x) => x.pkg !== item.pkg).map((x) => `${x.pkg}（rejected）`),
    ];

    const row = {
      pkg: item.pkg,
      name: item.name,
      owner: item.owner,
      source: item.source,
      alsoIn: item.alsoIn,
      installed,
      installedKnown,
      description: summary,
      descriptionZh: item.descriptionZh,
      descriptionEn: item.descriptionEn,
      descriptionLang: item.descriptionZh ? 'zh' : item.descriptionEn ? 'en' : null,
      capabilities: Array.isArray(item.capabilities) ? item.capabilities : [],
      capabilityRedLines: Array.isArray(item.redLines) ? item.redLines : [],
      redLines: Array.isArray(item.redLines) ? item.redLines.length > 0 : false,
      redLinesCount: Array.isArray(item.redLines) ? item.redLines.length : 0,
      capabilityCheckedAt: item.capabilityCheckedAt === undefined ? null : item.capabilityCheckedAt,
      category: item.category,
      categoryList: Array.isArray(item.categoryList) ? item.categoryList : [],
      stars: item.stars === undefined ? null : item.stars,
      downloads: item.downloads === undefined ? null : item.downloads,
      install: item.install === undefined ? null : item.install,
      page: item.page === undefined ? null : item.page,
      score: cand.score,
      rawScore: cand.rawScore,
      matched: cand.matched,
      matchedTokens: cand.matched.map((m) => m.token),
      breakdown: cand.breakdown,
      // C.3.3：分层信息随行 —— 覆盖率可复算（命中词数 / 有效词数）
      tier: cand.tier,
      tierLabel: GOAL_TIER_LABEL[cand.tier],
      coverage: cand.coverage,
      coverageBasis: `${cand.distinct}/${tokens.length}`,
      genericOnly: cand.genericOnly === true,
      matchReasons: Array.isArray(cand.reasons) ? cand.reasons : [],
      label: suggestion.suggestedLabel,
      sameTrack: {
        label: sameTrack.label,
        others: others.slice(0, 3),
        total: others.length,
      },
      permission,
      permissionKnown,
      nextStep: installed ? '用 lab-drift/--explain 复核' : '装前请人工确认权限，本工具不联网',
    };
    rowCache.set(item.pkg, row);
    return row;
  };
  const candidates = top.map(makeRow);

  // 同轨计算会为每个候选产生重复告警 → 去重后并入
  for (const w of trackWarnings) {
    if (!warnings.includes(w)) warnings.push(w);
  }

  /**
   * C.3.3 三层全部展示（任务卡 A）：
   *   强匹配（覆盖率 ≥0.5）｜弱匹配（0.2 ≤ c < 0.5）｜仅字面命中（c < 0.2，折叠段最多 10 条）。
   * **不砍候选**（门槛已取消，条数是全部算出来的）：`counts` 恒为真实条数；
   * 每层只**物化前若干行**（md/json 同一个上限），超出的条数写在 `notListed` 里 ——
   * 明写而不是静默截断（10974 条池子里「弱匹配」可能有上千条，全量物化成 JSON 行会把报告撑爆）。
   */
  const tiers = {
    strong: strong.slice(0, GOAL_TIER_MAX).map(makeRow),
    weak: weak.slice(0, GOAL_TIER_MAX).map(makeRow),
    literal: literal.slice(0, GOAL_TIER_LITERAL_CAP).map(makeRow),
    counts: { strong: strong.length, weak: weak.length, literal: literal.length },
    notListed: {
      strong: Math.max(0, strong.length - GOAL_TIER_MAX),
      weak: Math.max(0, weak.length - GOAL_TIER_MAX),
      literal: Math.max(0, literal.length - GOAL_TIER_LITERAL_CAP),
    },
    thresholds: {
      strong: GOAL_TIER_STRONG,
      weak: GOAL_TIER_WEAK,
      literalCap: GOAL_TIER_LITERAL_CAP,
      tableCap: GOAL_TIER_MAX,
    },
    coverageBasis: `覆盖率 = 命中有效词数 / 有效词总数（本次分母 ${tokens.length} 个有效词）`,
  };

  /**
   * 「仅字面命中」的前 3 条同时保留在 `belowThreshold`（C.3.1 起的字段名不变，口径改成「仅字面命中」），
   * 这样旧断言（管理-only 必须落 belowThreshold 且 isMatch=false）继续成立。
   */
  const belowThreshold = tiers.literal.slice(0, GOAL_CLOSEST_N).map((row) => ({
    pkg: row.pkg,
    name: row.name,
    source: row.source,
    installed: row.installed,
    description: row.description,
    category: row.category,
    stars: row.stars,
    downloads: row.downloads,
    redLines: row.redLines,
    redLinesCount: row.redLinesCount,
    score: row.score,
    coverage: row.coverage,
    coverageBasis: row.coverageBasis,
    matchedTokens: row.matchedTokens,
    matched: row.matched,
    rejectReasons: row.matchReasons.length > 0 ? row.matchReasons : [GOAL_TIER_REASON.literalCoverage],
    isMatch: false,
  }));

  /**
   * 最接近（只在 0 候选时给）：
   *   ① 优先用「有词命中但没过门槛」的那几条（有分数、有命中词，最诚实）；
   *   ② 一条都没有 → 退回 2 字片段重合度（连词都没命中，只能给片段，标明不是匹配）。
   */
  const closest = candidates.length > 0
    ? []
    : belowThreshold.length > 0
      ? belowThreshold.map((b) => ({ ...b, hits: [] }))
      : closestCandidates(built.index, tokens, GOAL_CLOSEST_N).map((c) => ({
          pkg: c.item.pkg,
          name: c.item.name,
          source: c.item.source,
          installed: c.item.installed === true,
          description: c.item.descriptionZh || c.item.descriptionEn,
          category: c.item.category,
          stars: c.item.stars === undefined ? null : c.item.stars,
          downloads: c.item.downloads === undefined ? null : c.item.downloads,
          redLines: Array.isArray(c.item.redLines) && c.item.redLines.length > 0,
          redLinesCount: Array.isArray(c.item.redLines) ? c.item.redLines.length : 0,
          score: null,
          matchedTokens: [],
          matched: [],
          rejectReasons: ['无词命中（仅 2 字片段重合，不是匹配）'],
          hits: c.hits,
          isMatch: false,
        }));

  // C.3.3：核心词提示改为「词表诊断」的摘要 —— 长词不再当门禁，只用来提示「你可能用了市场里不存在的词」
  const coreNote =
    matchedRecs.length > 0 && missingTokens.length === 0
      ? null
      : matchedRecs.length === 0
        ? `强/弱匹配均为空：池里没有条目命中足够多的目标词${missingTokens.length > 0 ? `（其中 ${missingTokens.join('、')} 在池中 0 命中）` : ''} → 下面「仅字面命中」只是字面重合，**不是匹配**；见「词表诊断」换同义词再搜`
        : `未命中：${missingTokens.join('、')}（池中 0 条）→ 见「词表诊断」；强/弱匹配按已命中的词给出`;

  return {
    generatedAt: new Date().toISOString(),
    mode: 'goal',
    goal: String(opts.goal),
    // C.3.1 E：口径声明放在报告头部（md 与 json 都带）
    notice: GOAL_NOTICE,
    tokens,
    tokensDropped,
    coreNote,
    // C.3.3 ⑰：词表诊断（逐词命中条目数 + 未命中标记 + idf），全部来自那一次预计算
    diagnostics: {
      tokens: tokenStats.tokens,
      missing: missingTokens,
      poolTotal: tokenStats.poolTotal,
      missingNote:
        missingTokens.length === 0
          ? null
          : `这些词在本地的 ${tokenStats.poolTotal} 条目录里没有出现；试换同义词再搜（如 ${SYNONYM_EXAMPLE}）`,
      synonymHints: SYNONYM_HINTS.map((g) => ({ label: g.label, terms: g.terms })),
      hintRelated: SYNONYM_HINTS.filter((g) => missingTokens.some((t) => g.terms.some((x) => t.includes(x) || x.includes(t)))).map((g) => g.label),
      note: '同义词提示是**硬编码的 4 组示例**，不建表、不参与打分、也不参与匹配；它只回答「为什么 0 命中」',
    },
    profile: profile ? profile.path : null,
    registry: registryMetaBlock(registry),
    catalog: {
      path: catalog.path,
      origin: catalog.origin,
      available: catalog.available,
      count: catalog.count,
      reason: catalog.reason,
      package: catalog.meta ? catalog.meta.package : null,
      version: catalog.meta ? catalog.meta.version : null,
    },
    pool: {
      registry: pool.counts.registry,
      catalog: pool.counts.catalog,
      installed: pool.counts.installed,
      total: pool.poolTotal,
      mergedUnique: pool.total,
    },
    weights: {
      base: GOAL_BASE_WEIGHTS,
      applied: GOAL_WEIGHTS,
      langFactor: WEIGHT_LANG_FACTOR,
      note: 'descriptionZh / capabilities 命中权重 ×1.5 向上取整（2 → 3）；descriptionEn ×1（2）；命中词再 ×idf；通用词再 ×0.5',
      idf: {
        formula: 'clamp(ln(池总数 / (1 + 该词命中条目数)), 0.5, 3.0)，保留两位小数',
        min: IDF_MIN,
        max: IDF_MAX,
        decimals: IDF_DECIMALS,
        poolTotal: tokenStats.poolTotal,
        applied:
          '每个命中词：weight = round2(字段权重和 × idf)；通用词再 round2(×0.5)；总分 = Σ weight（两位小数）。出现越少的词越重，越普遍的词越轻',
      },
    },
    elapsedMs: Math.round((performance.now() - startedAt) * 10) / 10,
    performance: {
      indexedEntries: built.index.length,
      indexBuildMs: Math.round(built.buildMs * 10) / 10,
      tokenStatsMs: Math.round(tokenStatsMs * 10) / 10,
      scanMs: Math.round(scanMs * 10) / 10,
      prunedByPrecheck,
      elapsedMs: Math.round((performance.now() - startedAt) * 10) / 10,
      budgetMs: 2000,
      note: '索引一次性建好（小写串 + token 集 + 六字段小写串）；idf 词频预计算一次（单遍）；匹配单遍扫描，长词优先预判剪枝',
    },
    // 候选 = 强 + 弱（真匹配）的条目数（表只列 top 10）；gatedOutTotal = 「仅字面命中」条数
    matchedTotal: matchedRecs.length,
    gatedOutTotal: literal.length,
    tiers,
    candidates,
    belowThreshold,
    closest,
    rule: {
      tokenize: `中文 ${GOAL_WINDOW_MIN}–${GOAL_WINDOW_MAX} 字滑窗 + 英文按空白/连字符切；去停用词；保留原有词与拆分词`,
      noiseDrop: `滑窗词在池内「显示名+中英描述+capabilities+keywords」命中 0 条且长度 < ${NOISE_MIN_LEN} → 丢弃（原词列在 tokensDropped）`,
      score: `名称×${GOAL_WEIGHTS.name} / 中文描述×${GOAL_WEIGHTS.descriptionZh}（=⌈2×1.5⌉）/ 英文描述×${GOAL_WEIGHTS.descriptionEn} / 能力×${GOAL_WEIGHTS.capabilities}（=⌈2×1.5⌉）/ keywords×${GOAL_WEIGHTS.keywords} / 分类×${GOAL_WEIGHTS.category}；每个命中词再 ×idf；通用词再 ×${GENERIC_WEIGHT_FACTOR}；同分按包名升序`,
      matchFields: SCORE_FIELDS,
      langFactor: WEIGHT_LANG_FACTOR,
      // C.3.3：分层取代硬门槛（旧三条保留在 legacyGate 里，只作对照，不再参与判定）
      tiers: `按覆盖率（命中有效词数 / 有效词总数）分层：强匹配 ≥${GOAL_TIER_STRONG} ｜ 弱匹配 ${GOAL_TIER_WEAK} ≤ c < ${GOAL_TIER_STRONG} ｜ 仅字面命中 c < ${GOAL_TIER_WEAK}（折叠段最多 ${GOAL_TIER_LITERAL_CAP} 条）；三层全部展示`,
      genericVeto: `只命中通用词（${[...GENERIC_TERMS].slice(0, 5).join('/')} … 共 ${GENERIC_TERMS.size} 个）一律不算匹配 → 强制归入「仅字面命中」`,
      legacyGate: `C.3.1 的硬门槛（长词 / ≥${GOAL_MIN_DISTINCT} 词 / 总分≥${GOAL_MIN_SCORE}）**C.3.3 起取消**：不再参与判定，只保留在 rule 里作历史对照`,
      idf: `idf = clamp(ln(池总数 / (1 + 该词命中条目数)), ${IDF_MIN}, ${IDF_MAX})（${IDF_DECIMALS} 位小数）；预计算一次，不逐条重扫`,
      thresholdNote: '旧字段 minDistinctTokens / minScore 保留但**已不生效**（C.3.1 历史口径）',
      genericTerms: [...GENERIC_TERMS],
      genericWeightFactor: GENERIC_WEIGHT_FACTOR,
      longToken: { zh: GOAL_LONG_ZH, en: GOAL_LONG_EN },
      minDistinctTokens: GOAL_MIN_DISTINCT,
      minScore: GOAL_MIN_SCORE,
      notice: GOAL_NOTICE,
      permissionUninstalled: 'unknown（未安装，本地无代码）',
      nextStep: { installed: '用 lab-drift/--explain 复核', notInstalled: '装前请人工确认权限，本工具不联网' },
    },
    warnings,
  };
}

// ────────────────────────────────────────────────────────────── 渲染：--unknown / --search

function descriptionCell(row) {
  if (row.description === null) return `**缺失**（${row.descriptionReasons.join('；') || '无' }）`;
  const tag = row.descriptionVerdict === 'weak' ? `**不可信**（${row.descriptionReasons.join('；')}）` : `${row.descriptionChars} 字${row.descriptionHasCjk ? '·含中文' : '·无中文'}`;
  const text = row.description.length > 60 ? `${row.description.slice(0, 58)}…` : row.description;
  return `${tag} ｜ ${text}`;
}

function renderUnknownMd(report) {
  const out = [];
  out.push('# --unknown · 本机「说不清它是干什么的」的包（只读、不联网）');
  out.push('');
  out.push(`- generatedAt: ${report.generatedAt}`);
  out.push(`- profile: \`${report.profile}\``);
  out.push(
    `- 离线目录: \`${report.catalog.path}\`（origin=${report.catalog.origin} ｜ ${report.catalog.count} 条 ｜ 来源包 ${report.catalog.package === null ? 'unknown' : `${report.catalog.package}@${report.catalog.version === null ? 'null' : report.catalog.version}`}）`,
  );
  if (report.catalog.available !== true) {
    out.push(`- catalog 缺失：本模式下“说不清”的判定会偏保守（更多包落 P1）｜原因：${report.catalog.reason}`);
  }
  out.push(
    `- registry（第三方市场快照）: ${report.registry.available ? `\`${report.registry.path}\`（origin=${report.registry.origin} ｜ ${report.registry.count} 条 ｜ 未知字段 ${report.registry.unknownFields.length} 个）` : `**不可用**：${report.registry.reason}`}`,
  );
  out.push(`- 扫描范围: ${report.scope === 'installed+catalog' ? 'profile 已装第三方包 + 离线目录全量' : 'profile 已装第三方包（官方 @deepseek-ai/* 不计）'}`);
  out.push(`- 判定规则（RULES §11.3 + §12.2）: ${report.rule.untrusted}；${report.rule.coveredBy}；${report.rule.p1Counts}`);
  out.push('');
  out.push('| 严重度 | pkg | 版本 | registry（名称/描述） | catalog 有无 | description 有无 | 权限档 | 建议动作 |');
  out.push('|---|---|---|---|---|---|---|---|');
  for (const row of report.rows) {
    const ver = row.version === null ? 'null（读不到）' : row.version;
    const cat = row.catalogHit
      ? `有（${row.catalogKey}${row.catalogMatch === 'basename' ? '，basename' : ''}）`
      : `无${row.catalogNote ? `（${row.catalogNote}）` : ''}`;
    let regCell;
    if (!row.registryHit) regCell = `无${row.registryNote ? `（${row.registryNote}）` : ''}`;
    else if (row.registryDescription === null) regCell = `有（${row.registryKey}）但**无描述**`;
    else {
      const nameText = row.registryName === null ? '' : `${row.registryName}：`;
      const mismatch = row.descMismatch ? ' ｜ **descMismatch**' : '';
      regCell = `有（${row.registryKey}${row.registryMatch === 'basename' ? '，basename' : ''}）${nameText}${row.registryDescription}${mismatch}`;
    }
    const perm = row.permissionScanned ? row.permissionLevel : '未扫描（无本地代码）';
    out.push(
      `| **${row.severity}** | \`${mdCell(row.pkg)}\` | ${mdCell(ver)} | ${mdCell(regCell)} | ${mdCell(cat)} | ${mdCell(descriptionCell(row))} | ${mdCell(perm)} | ${mdCell(row.action)} |`,
    );
  }
  out.push('');
  if (report.catalogCoverage) {
    out.push(
      `- 目录全量比对：${report.catalogCoverage.total} 条里 ${report.catalogCoverage.described} 条自带描述；缺中文名 ${report.catalogCoverage.missingName.length} 条、缺描述 ${report.catalogCoverage.missingDesc.length} 条；其中未装在本机 ${report.catalogCoverage.notInstalled} 条`,
    );
  }
  out.push(
    `- 分档：P1 说不清 **${report.summary.p1}** ｜ P2 池外·仅外文 ${report.summary.p2} ｜ P3 池外·中文可用 ${report.summary.p3} ｜ registry/目录已覆盖 ${report.summary.trusted}（其中 registry 有描述 **${report.summary.registryCovered}**）｜ descMismatch ${report.summary.descMismatch} 条（已装第三方包共 ${report.summary.installedTotal} 个）`,
  );
  out.push('');
  if (report.warnings.length > 0) {
    out.push(`## 告警（读不到 / 不猜测）— ${report.warnings.length} 条`);
    out.push('');
    for (const w of report.warnings) out.push(`- ${w}`);
    out.push('');
  }
  out.push(`unknown: ${report.summary.p1} 个包本机说不清它是干什么的`);
  return out.join('\n');
}

function renderUnknownJson(report) {
  const ordered = {
    generatedAt: report.generatedAt,
    mode: report.mode,
    profile: report.profile,
    scope: report.scope,
    registry: report.registry,
    catalog: report.catalog,
    rule: report.rule,
    summary: report.summary,
    catalogCoverage: report.catalogCoverage,
    rows: report.rows,
    warnings: report.warnings,
  };
  return JSON.stringify(ordered, null, 2);
}

function renderSearchMd(report) {
  const out = [];
  out.push(`# --search · 三源搜索：「${report.query}」`);
  out.push('');
  out.push(`- generatedAt: ${report.generatedAt}`);
  out.push(
    `- 数据源优先级: registry（第三方市场：中文描述 + capabilities + redLines）> catalog（官方模块）> 已装包 description > README 兜底；同一条目只保留高优先源（低优先源记在「alsoIn」）`,
  );
  out.push(
    `- registry: ${report.registry.available ? `\`${report.registry.path}\`（origin=${report.registry.origin} ｜ ${report.registry.count} 条 ｜ 形状 ${report.registry.shape === null ? 'unknown' : report.registry.shape} ｜ 数组键 ${report.registry.arrayKey === null ? 'unknown' : report.registry.arrayKey} ｜ hostVersion ${report.registry.hostVersion === null ? 'null' : report.registry.hostVersion}）` : `**不可用**：${report.registry.reason}`}`,
  );
  out.push(
    `- 离线目录: \`${report.catalog.path}\`（origin=${report.catalog.origin} ｜ 共 ${report.catalog.count} 条 ｜ 来源包 ${report.catalog.package === null ? 'unknown' : `${report.catalog.package}@${report.catalog.version === null ? 'null' : report.catalog.version}`}）`,
  );
  if (report.catalog.available !== true) {
    out.push(`- catalog: 不可用（${report.catalog.reason}）→ 本模式仍可用 registry/已装 判定`);
  }
  out.push(`- 分词: ${report.tokens.map((t) => `\`${t}\``).join(' + ')}（全部命中才算匹配，大小写不敏感）`);
  out.push(`- 匹配面: ${report.rule ? report.rule.matchFields.join(' / ') : SCORE_FIELDS.join(' / ')}（名称含包名；中文描述与 capabilities 命中权重 ×1.5 向上取整）`);
  out.push(
    `- 池: registry ${report.pool.registry} ｜ catalog ${report.pool.catalog} ｜ 已装 ${report.pool.installed}（去重后 ${report.pool.mergedUnique} 条）`,
  );
  out.push(
    `- elapsedMs: ${report.elapsedMs}（目标 < ${report.performance.budgetMs} ms ｜ 索引 ${report.performance.indexedEntries} 条 ｜ 建索引 ${report.performance.indexBuildMs} ms ｜ 单遍扫描 ${report.performance.scanMs} ms）`,
  );
  out.push('');
  out.push(`## 命中 — ${report.results.length} 条（registry ${report.matchBySource.registry || 0} ｜ catalog ${report.matchBySource.catalog || 0} ｜ 已装 ${report.matchBySource.installed || 0}）`);
  out.push('');
  if (report.results.length === 0) {
    out.push('池中无匹配');
  } else {
    out.push('| 包名 | 名称 | 来源 | stars | downloads | redLines | 得分 | 描述 | 已装 |');
    out.push('|---|---|---|---|---|---|---|---|---|');
    for (const m of report.results.slice(0, SEARCH_TABLE_MAX)) {
      const also = m.alsoIn.length > 0 ? `（${m.alsoIn.join('/')} 亦有）` : '';
      const installedCell = m.installedKnown === false ? 'unknown（registry 条目没有包名）' : m.installed ? '是' : '否';
      out.push(
        `| \`${mdCell(m.pkg)}\` | ${mdCell(m.name === null || m.name === undefined ? '—' : m.name)} | ${mdCell(`${m.source}${also}`)} | ${m.stars === null ? 'null' : m.stars} | ${m.downloads === null ? 'null' : m.downloads} | ${mdCell(redLinesCell(m))} | Σ${m.score} | ${mdCell(m.description === null || m.description === undefined ? '（无描述）' : m.description)} | ${mdCell(installedCell)} |`,
      );
    }
    if (report.results.length > SEARCH_TABLE_MAX) {
      out.push('');
      out.push(`> 命中 ${report.results.length} 条，表格只列前 ${SEARCH_TABLE_MAX} 条（按来源 → 得分排序）；要全量请加 \`--json\`。`);
    }
    out.push('');
    out.push(`> stars / downloads 是市场给的数字（null = 上游没给），**不参与打分**；redLines 有值表示上游标注了「这个插件有能力红线」。`);
  }
  out.push('');

  if (report.results.length === 0) {
    out.push(`### 最接近的 ${GOAL_CLOSEST_N} 条（按 2 字片段重合度，不是匹配）`);
    out.push('');
    if (report.closest.length === 0) {
      out.push('无 —— 池里没有任何条目与关键词有 2 字片段重合，不硬凑候选。');
    } else {
      out.push('| 包名 | 名称 | 来源 | 部分命中片段 | 已装 |');
      out.push('|---|---|---|---|---|');
      for (const c of report.closest) {
        out.push(
          `| \`${mdCell(c.pkg)}\` | ${mdCell(c.name === null || c.name === undefined ? '—' : c.name)} | ${mdCell(c.source)} | ${mdCell(c.hits.join('、'))} | ${c.installed ? '是' : '否'} |`,
        );
      }
    }
    out.push('');
  }

  if (report.warnings.length > 0) {
    out.push(`## 告警 — ${report.warnings.length} 条`);
    out.push('');
    for (const w of report.warnings) out.push(`- ${w}`);
    out.push('');
  }

  if (report.results.length === 0) out.push(`池中无匹配（目录共 ${report.catalogTotal} 条；registry ${report.pool.registry} 条）`);
  out.push(
    `匹配 ${report.results.length} 条 / 池 ${report.pool.total}（registry ${report.pool.registry} ｜ catalog ${report.pool.catalog} ｜ 已装 ${report.pool.installed}）`,
  );
  return out.join('\n');
}

function renderSearchJson(report) {
  const ordered = {
    generatedAt: report.generatedAt,
    mode: report.mode,
    query: report.query,
    tokens: report.tokens,
    profile: report.profile,
    registry: report.registry,
    catalog: report.catalog,
    pool: report.pool,
    weights: report.weights,
    rule: report.rule,
    elapsedMs: report.elapsedMs,
    performance: report.performance,
    results: report.results,
    matchBySource: report.matchBySource,
    catalogMatchCount: report.catalogMatchCount,
    catalogTotal: report.catalogTotal,
    registryMatchCount: report.registryMatchCount,
    installedMatchCount: report.installedMatchCount,
    closest: report.closest,
    warnings: report.warnings,
  };
  return JSON.stringify(ordered, null, 2);
}

// ────────────────────────────────────────────────────────────── 渲染：公共单元格（C.3.2 增列）

/**
 * 命中词单元格：`嵌入+7.86（idf 2.62）（名称/中文描述）｜ Σ15.72`（词级权重 + idf + 命中字段，可复算）。
 * C.3.3：每个命中词都带 `idf x.xx`（`--search` 不加权 → 行里没有 `idf` 键 → 这一栏不出现，旧表格不变）。
 */
function matchedCell(row) {
  if (!Array.isArray(row.matched) || row.matched.length === 0) return '（无）';
  const parts = row.matched
    .slice(0, 6)
    .map((m) => {
      const fields = Array.isArray(m.fieldLabels) && m.fieldLabels.length > 0 ? `（${m.fieldLabels.join('/')}）` : '';
      const idf = m.idf === null || m.idf === undefined ? '' : `（idf ${Number(m.idf).toFixed(2)}）`;
      return `${m.token}+${fmtNum(m.weight)}${idf}${m.generic ? '（通用）' : ''}${fields}`;
    });
  const more = row.matched.length > 6 ? `…（另 ${row.matched.length - 6} 个）` : '';
  return `${parts.join('、')}${more} ｜ Σ${fmtNum(row.score)}`;
}

/** redLines 单元格：有/无 + 条数。 */
function redLinesCell(row) {
  if (row.redLines === true) return `有（${row.redLinesCount === undefined ? '?' : row.redLinesCount}）`;
  return '无';
}

function sourceCell(row) {
  const also = Array.isArray(row.alsoIn) && row.alsoIn.length > 0 ? `（${row.alsoIn.join('/')} 亦有）` : '';
  return `${row.source}${also}`;
}

/** 「不是匹配」那几栏的命中词单元格（C.3.1 起；C.3.3 加 idf，与 matchedCell 同一口径）。 */
function rejectMatchedCell(row) {
  if (!Array.isArray(row.matched) || row.matched.length === 0) {
    const bigrams = Array.isArray(row.hits) && row.hits.length > 0 ? `仅 2 字片段：${row.hits.join('、')}` : '—';
    return bigrams;
  }
  return row.matched
    .slice(0, 5)
    .map((m) => {
      const idf = m.idf === null || m.idf === undefined ? '' : `（idf ${Number(m.idf).toFixed(2)}）`;
      return `${m.token}+${fmtNum(m.weight)}${idf}${m.generic ? '（通用）' : ''}`;
    })
    .join('、');
}

function rejectReasonCell(row) {
  const reasons = Array.isArray(row.rejectReasons) && row.rejectReasons.length > 0 ? row.rejectReasons : ['未过门槛'];
  return reasons.join('；');
}

function renderGoalMd(report) {
  const out = [];
  out.push(`# --goal · 挑适合做「${report.goal}」的插件（只读、不联网、可解释打分）`);
  out.push('');
  // C.3.1 E：口径声明放在报告头部（防后续误解：这不是语义搜索）
  out.push(`> ${report.notice}`);
  out.push('');
  out.push(`- generatedAt: ${report.generatedAt}`);
  out.push(`- 分词（${report.tokens.length} 个）: ${report.tokens.map((t) => `\`${t}\``).join(' ')}`);
  if (report.tokensDropped.length > 0) {
    out.push(
      `- 丢弃的噪声词（${report.tokensDropped.length} 个；池内「显示名+中英描述+capabilities+keywords」命中 0 条且长度 < ${NOISE_MIN_LEN} → 不参与打分）: ${report.tokensDropped.map((d) => `\`${d.token}\``).join(' ')}`,
    );
  } else {
    out.push('- 丢弃的噪声词: 无');
  }
  out.push(`- 打分规则: ${report.rule.score}`);
  out.push(
    `- 匹配面: ${report.rule.matchFields.join(' / ')}（名称含包名）；**中文描述 / capabilities 命中 ×1.5 向上取整**（2 → 3），英文描述 ×1（2）`,
  );
  out.push(
    `- 权重表: 名称 ${report.weights.applied.name} ｜ 中文描述 ${report.weights.applied.descriptionZh} ｜ 英文描述 ${report.weights.applied.descriptionEn} ｜ 能力 ${report.weights.applied.capabilities} ｜ 关键词 ${report.weights.applied.keywords} ｜ 分类 ${report.weights.applied.category}`,
  );
  out.push(`- 通用词（命中 ×${report.rule.genericWeightFactor}；**只命中它们不算匹配** → 强制归入「仅字面命中」）: ${report.rule.genericTerms.join('、')}`);
  // C.3.3：分层取代 C.3.1 的三条硬门槛；idf 加权口径写在头部（可复算）
  out.push(`- 分层（用覆盖率取代硬门槛，三层全部展示）: ${report.rule.tiers}`);
  out.push(`- idf 加权: ${report.rule.idf}（池总数 ${report.weights.idf.poolTotal}；加权方式：${report.weights.idf.applied}）`);
  out.push(`- 已取消的门槛: ${report.rule.legacyGate}`);
  out.push(
    `- elapsedMs: ${report.elapsedMs}（目标 < ${report.performance.budgetMs} ms ｜ 索引 ${report.performance.indexedEntries} 条 ｜ 建索引 ${report.performance.indexBuildMs} ms ｜ idf 词频预计算 ${report.performance.tokenStatsMs} ms ｜ 单遍扫描 ${report.performance.scanMs} ms ｜ 预判剪枝 ${report.performance.prunedByPrecheck} 条）`,
  );
  out.push(
    `- registry: ${report.registry.available ? `\`${report.registry.path}\`（origin=${report.registry.origin} ｜ ${report.registry.count} 条 ｜ 形状 ${report.registry.shape === null ? 'unknown' : report.registry.shape} ｜ 数组键 ${report.registry.arrayKey === null ? 'unknown' : report.registry.arrayKey} ｜ hostVersion ${report.registry.hostVersion === null ? 'null' : report.registry.hostVersion}）` : `**不可用**：${report.registry.reason}`}`,
  );
  out.push(
    `- 离线目录: \`${report.catalog.path}\`（${report.catalog.available ? `${report.catalog.count} 条` : `**不可用**：${report.catalog.reason}`}）`,
  );
  if (report.catalog.available !== true) {
    out.push(
      `- 池语料缺 catalog（${report.pool.catalog} 条；原因：${report.catalog.reason}）→ 噪声词过滤与 idf 只按现有 ${report.pool.total} 条池子算；0 命中 ≠ 市场里没有，别只看强匹配`,
    );
  }
  out.push(`- 池: registry ${report.pool.registry} ｜ catalog ${report.pool.catalog} ｜ 已装 ${report.pool.installed}（去重后 ${report.pool.mergedUnique} 条）`);
  out.push('');

  const allHitCount = report.matchedTotal + report.gatedOutTotal;

  if (allHitCount === 0) {
    out.push(`## 池中无匹配`);
    out.push('');
    out.push(`池里没有任何条目命中这批目标词（池 ${report.pool.total} 条：registry ${report.pool.registry} ｜ catalog ${report.pool.catalog} ｜ 已装 ${report.pool.installed}）。`);
    out.push('');
    if (report.coreNote) {
      out.push(`- ${report.coreNote}`);
      out.push('');
    }
    out.push(`### 最接近的 ${GOAL_CLOSEST_N} 条（**不是匹配**）`);
    out.push('');
    if (report.closest.length === 0) {
      out.push('无 —— 池里没有任何条目与目标词有 2 字片段重合，不硬凑候选。');
    } else {
      out.push('| 包名 | 名称 | 来源 | 得分 | 命中词 | 为何不算匹配 | 已装 |');
      out.push('|---|---|---|---|---|---|---|');
      for (const c of report.closest) {
        const scoreCell = c.score === null || c.score === undefined ? '—（无词命中）' : `Σ${fmtNum(c.score)}`;
        out.push(
          `| \`${mdCell(c.pkg)}\` | ${mdCell(c.name === null || c.name === undefined ? '—' : c.name)} | ${mdCell(c.source)} | ${mdCell(scoreCell)} | ${mdCell(rejectMatchedCell(c))} | ${mdCell(rejectReasonCell(c))} | ${c.installed ? '是' : '否'} |`,
        );
      }
    }
    out.push('');
  } else {
    if (report.coreNote) {
      out.push(`> ${report.coreNote}`);
      out.push('');
    }
    // ── C.3.3 ⑯：三层全部展示（强 / 弱 / 仅字面）。候选表仍是「强+弱」的前 10 条。
    out.push(`## 强匹配（覆盖率 ≥ ${GOAL_TIER_STRONG}）— ${report.tiers.counts.strong} 条`);
    out.push('');
    out.push(...tierSection(report.tiers.strong, report.tiers.counts.strong));
    out.push('');
    out.push(`## 弱匹配（${GOAL_TIER_WEAK} ≤ 覆盖率 < ${GOAL_TIER_STRONG}）— ${report.tiers.counts.weak} 条`);
    out.push('');
    out.push(...tierSection(report.tiers.weak, report.tiers.counts.weak));
    out.push('');
    // 仅字面命中：折叠段，最多 10 条（任务卡 A 的硬要求）
    out.push(
      `## 仅字面命中（覆盖率 < ${GOAL_TIER_WEAK} 或只命中通用词；**不是匹配**）— 共 ${report.tiers.counts.literal} 条，列前 ${report.tiers.literal.length} 条`,
    );
    out.push('');
    if (report.tiers.counts.literal === 0) {
      out.push('无 —— 没有「只碰了一两个词」的条目。');
      out.push('');
    } else {
      out.push('<details>');
      out.push(`<summary>展开「仅字面命中」${report.tiers.literal.length} 条（折叠；旧称「未过门槛」，C.3.3 起不再按门槛砍，只按覆盖率归层）</summary>`);
      out.push('');
      out.push(...tierSection(report.tiers.literal, report.tiers.counts.literal, { reasons: true }));
      out.push('');
      out.push('</details>');
      out.push('');
    }
    // ── 候选表（强 + 弱 top 10）：保留 C.3 起的列（stars / downloads / redLines / 同轨 / 权限 / 下一步）
    out.push(`## 候选（top ${report.candidates.length} / 强+弱命中 ${report.matchedTotal}）`);
    out.push('');
    out.push('| 包名 | 层 | 覆盖率 | 名称 | 来源 | 命中词 | stars | downloads | redLines | 已装 | 同轨已有 | 权限 | 下一步 |');
    out.push('|---|---|---|---|---|---|---|---|---|---|---|---|---|');
    for (const row of report.candidates) {
      const nameText = row.name === null || row.name === undefined ? '—' : row.name;
      const installedCell = row.installedKnown === false ? 'unknown（registry 条目没有包名）' : row.installed ? 'true' : 'false';
      const trackText =
        row.sameTrack.others.length === 0
          ? `无（轨=${row.label}）`
          : `${row.label}：${row.sameTrack.others.join('、')}${row.sameTrack.total > row.sameTrack.others.length ? ` 等 ${row.sameTrack.total} 条` : ''}`;
      out.push(
        `| \`${mdCell(row.pkg)}\` | ${mdCell(row.tierLabel)} | ${mdCell(`${row.coverage}（${row.coverageBasis}）`)} | ${mdCell(nameText)} | ${mdCell(sourceCell(row))} | ${mdCell(matchedCell(row))} | ${row.stars === null ? 'null' : row.stars} | ${row.downloads === null ? 'null' : row.downloads} | ${mdCell(redLinesCell(row))} | ${mdCell(installedCell)} | ${mdCell(trackText)} | ${mdCell(row.permission)} | ${mdCell(row.nextStep)} |`,
      );
    }
    out.push('');
    out.push('> stars / downloads 来自市场快照，**不参与打分**（本工具不联网核实）；redLines=有 表示上游给了 `capabilityRedLines`，装前务必逐条读。');
    out.push('');
  }

  // ── C.3.3 ⑰：词表诊断（本轮重点：告诉用户「哪个词在池里根本不存在」）
  out.push('## 词表诊断');
  out.push('');
  out.push(
    `> 口径：每个**有效词**（噪声过滤之后，共 ${report.tokens.length} 个）在池（${report.diagnostics.poolTotal} 条）里的**命中条目数**（一次算完，不逐词全扫）；idf 由同一个计数推出。`,
  );
  out.push('');
  out.push('| 有效词 | 池中命中条目数 | idf | 状态 |');
  out.push('|---|---|---|---|');
  for (const s of report.diagnostics.tokens) {
    out.push(
      `| \`${mdCell(s.token)}\` | ${s.hits} | ${Number(s.idf).toFixed(IDF_DECIMALS)} | ${s.missing ? '**未命中**（池中 0 条）' : `命中 ${((s.hits / Math.max(1, report.diagnostics.poolTotal)) * 100).toFixed(1)}% 的条目`} |`,
    );
  }
  out.push('');
  if (report.diagnostics.missing.length > 0) {
    out.push(`- 未命中词（${report.diagnostics.missing.length} 个）: ${report.diagnostics.missing.map((t) => `\`${t}\``).join('、')}`);
    out.push(`- ${report.diagnostics.missingNote}`);
  } else {
    out.push('- 未命中词: 无（本次每个有效词在池里都有命中）');
  }
  out.push(
    `- 同义词提示（**硬编码 ${report.diagnostics.synonymHints.length} 组示例，不建表、不参与打分、不参与匹配**；只用来回答「为什么 0 命中」）:`,
  );
  for (const g of report.diagnostics.synonymHints) {
    const related = report.diagnostics.hintRelated.includes(g.label) ? ' ← 与本次未命中词相关' : '';
    out.push(`  - ${g.label}: ${g.terms.join(' / ')}${related}`);
  }
  out.push('');

  if (report.warnings.length > 0) {
    out.push(`## 告警（读不到 / 不猜测）— ${report.warnings.length} 条`);
    out.push('');
    for (const w of report.warnings) out.push(`- ${w}`);
    out.push('');
  }

  out.push(
    `goal: ${report.matchedTotal} 候选 / 池 ${report.pool.total}（registry ${report.pool.registry} ｜ catalog ${report.pool.catalog} ｜ 已装 ${report.pool.installed}）｜ 分层：强 ${report.tiers.counts.strong} ｜ 弱 ${report.tiers.counts.weak} ｜ 仅字面 ${report.tiers.counts.literal}`,
  );
  return out.join('\n');
}

/**
 * 一层的表格（C.3.3）：包名 ｜ 名称 ｜ 来源 ｜ 覆盖率 ｜ 得分 ｜ 命中词 ｜ stars ｜ downloads ｜ redLines ｜ 已装 ｜ 权限。
 * 条数以 `counts` 为准（门槛已取消，`total` 是真实条数）；表格只列已物化的前若干行，
 * 超出部分**明写**「本层共 N 条，表内列前 M 条」（json 的 `tiers.notListed` 同步给差额）。
 */
function tierSection(rows, total, opts = {}) {
  const out = [];
  if (!Array.isArray(rows) || rows.length === 0) {
    out.push('无。');
    return out;
  }
  const shown = rows.slice(0, GOAL_TIER_MAX);
  out.push('| 包名 | 名称 | 来源 | 覆盖率 | 得分 | 命中词 | stars | downloads | redLines | 已装 | 权限 |');
  out.push('|---|---|---|---|---|---|---|---|---|---|---|');
  for (const row of shown) {
    const nameText = row.name === null || row.name === undefined ? '—' : row.name;
    const installedCell = row.installedKnown === false ? 'unknown（registry 条目没有包名）' : row.installed ? 'true' : 'false';
    out.push(
      `| \`${mdCell(row.pkg)}\` | ${mdCell(nameText)} | ${mdCell(sourceCell(row))} | ${mdCell(`${row.coverage}（${row.coverageBasis}）`)} | Σ${fmtNum(row.score)} | ${mdCell(matchedCell(row))} | ${row.stars === null ? 'null' : row.stars} | ${row.downloads === null ? 'null' : row.downloads} | ${mdCell(redLinesCell(row))} | ${mdCell(installedCell)} | ${mdCell(row.permission)} |`,
    );
  }
  if (total > shown.length) {
    out.push('');
    out.push(`（本层共 ${total} 条，表内列前 ${shown.length} 条，按 Σ 降序；差额 ${total - shown.length} 条只计数不物化，见 \`--json\` 的 \`tiers.notListed\`）`);
  }
  if (opts.reasons) {
    const withReasons = shown.filter((r) => Array.isArray(r.matchReasons) && r.matchReasons.length > 0);
    if (withReasons.length > 0) {
      out.push('');
      out.push(`- 归层理由（为什么不是匹配）: ${withReasons.map((r) => `\`${r.pkg}\` → ${r.matchReasons.join('；')}`).join(' ｜ ')}`);
    }
  }
  return out;
}

function renderGoalJson(report) {
  const ordered = {
    generatedAt: report.generatedAt,
    mode: report.mode,
    goal: report.goal,
    notice: report.notice,
    tokens: report.tokens,
    tokensDropped: report.tokensDropped,
    coreNote: report.coreNote,
    // C.3.3：词表诊断（逐词命中条目数 / idf / 未命中 + 4 组硬编码同义词提示）
    diagnostics: report.diagnostics,
    profile: report.profile,
    registry: report.registry,
    catalog: report.catalog,
    pool: report.pool,
    weights: report.weights,
    elapsedMs: report.elapsedMs,
    performance: report.performance,
    matchedTotal: report.matchedTotal,
    gatedOutTotal: report.gatedOutTotal,
    // C.3.3：三层（json 不截断）+ 阈值；candidates = 强+弱 top10（旧字段不变）
    tiers: report.tiers,
    candidates: report.candidates,
    belowThreshold: report.belowThreshold,
    closest: report.closest,
    rule: report.rule,
    warnings: report.warnings,
  };
  return JSON.stringify(ordered, null, 2);
}

// ────────────────────────────────────────────────────────────── 渲染：单包

function permissionSites(rule) {
  return rule.sites.length === 0 ? '（无）' : rule.sites.map((s) => `${s.file}:${s.line}`).join('、');
}

/** catalog 命中一行话：命中/未命中都要能自证（键、match 方式、分类、候选）。 */
function renderCatalogHit(info) {
  if (!info) return 'unknown（未加载离线目录）';
  if (!info.available) return `—（离线目录不可用：${info.reason === null ? 'unknown' : info.reason}）`;
  if (info.hit) {
    const where = info.match === 'basename' ? `match=basename（同名不同 scope，命中的目录键是 ${info.key}）` : 'match=exact';
    return `是 ｜ ${info.key} ｜ ${where} ｜ 分类 ${info.category === null ? 'null' : info.category}${info.categoryLabel === null ? '' : `（${info.categoryLabel}）`}`;
  }
  const cand = info.candidates && info.candidates.length > 0 ? `候选：${info.candidates.join('、')}` : '无同名候选';
  return `否（目录 ${info.count} 条里没有它；${cand}）${info.reason ? ` —— ${info.reason}` : ''}`;
}

/** registry 命中一行话（C.3.2）：命中/未命中都要能自证（键、match 方式、描述语言、能力/红线条数）。 */
function renderRegistryHit(info) {
  if (!info) return 'unknown（未加载 registry）';
  if (!info.available) return `—（registry 不可用：${info.reason === null ? 'unknown' : info.reason}）`;
  if (!info.hit) {
    const cand = info.candidates && info.candidates.length > 0 ? `候选：${info.candidates.join('、')}` : '无同名候选';
    return `否（registry ${info.count} 条里没有它；${cand}）${info.reason ? ` —— ${info.reason}` : ''}`;
  }
  const lang = info.descriptionZh ? 'zh' : info.descriptionEn ? 'en' : '无描述';
  const where =
    info.match === 'basename'
      ? `match=basename（命中的键是 ${info.key}）`
      : info.match === 'key'
        ? `match=key（GitHub-only 条目，npm 名为空；命中的键是 ${info.key}）`
        : 'match=exact';
  return `是 ｜ ${info.key} ｜ ${where} ｜ 描述语言 ${lang} ｜ capability ${info.capabilities.length} 条 ｜ redLines ${info.capabilityRedLines.length} 条`;
}

function renderSingleMd(report) {
  const out = [];
  const id = report.identity;
  const p = report.permissions;
  const rc = report.rowContention;
  const st = report.sameTrack;

  out.push(`# 插件静态分析：\`${id.pkg}\``);
  out.push('');
  out.push(`- generatedAt: ${report.generatedAt}`);
  out.push(`- profile: \`${report.profile}\``);
  out.push(`- lab: \`${report.lab}\`（只读）`);
  out.push(
    `- registry（第三方市场快照，identity 第 1 级数据源）: ${report.registry.available ? `\`${report.registry.path}\`（origin=${report.registry.origin} ｜ ${report.registry.count} 条 ｜ 形状 ${report.registry.shape === null ? 'unknown' : report.registry.shape} ｜ 数组键 ${report.registry.arrayKey === null ? 'unknown' : report.registry.arrayKey} ｜ hostVersion ${report.registry.hostVersion === null ? 'null' : report.registry.hostVersion}）` : `**不可用**：${report.registry.reason}`}`,
  );
  out.push(
    `- 离线目录（identity 第 2 级数据源）: \`${report.catalog.path}\`（origin=${report.catalog.origin} ｜ ${report.catalog.count} 条 ｜ 来源包 ${report.catalog.package === null ? 'unknown' : `${report.catalog.package}@${report.catalog.version === null ? 'null' : report.catalog.version}`}）${report.catalog.available ? '' : ` ｜ **不可用**：${report.catalog.reason}`}`,
  );
  out.push(
    `- 官方 row 数据: \`${report.hostRows.path}\`（source=${report.hostRows.source} ｜ confidence=${report.hostRows.confidence} ｜ hostVersion=${report.hostRows.hostVersion === null ? 'null' : report.hostRows.hostVersion} ｜ ${report.hostRows.rowIds} 条 / ${report.hostRows.packages} 个包）`,
  );
  out.push(
    `- 本地数据: ${id.localData ? '有' : '**无**'} ｜ 来源: ${id.lookup.source} ｜ 扫描文件: ${p.scanned ? `${p.scannedFiles} 个 .js/.mjs` : '未扫描'}`,
  );
  out.push('');

  // 1
  out.push('## 1. 它是什么');
  out.push('');
  if (!id.localData) {
    out.push('> **本地无此包，本工具不联网。** 先用 dshmarket 安装，或用 `--from-dir <已解包目录>` 分析已解包产物。');
    out.push('');
  }
  out.push('| 字段 | 值 |');
  out.push('|---|---|');
  out.push(
    `| 用途（source = **${id.source}**） | ${mdCell(
      id.summaryText === null
        ? 'null —— 本机无任何可信描述（CATALOG 未命中、package.json 无 description、README 提不出正文句）'
        : id.summaryText,
    )} |`,
  );
  if (id.displayName !== null) out.push(`| 中文名（catalog） | ${mdCell(id.displayName)} |`);
  out.push(`| 描述语言 | ${mdCell(id.summaryLang === null ? 'unknown' : id.summaryLang)} |`);
  out.push(`| registry 命中（第 1 级数据源） | ${mdCell(renderRegistryHit(id.registry))} |`);
  if (id.registry && id.registry.hit === true) {
    out.push(
      `| capabilities（能力清单） | ${mdCell(id.registry.capabilities.length === 0 ? '（该条 registry 没有 capabilities）' : id.registry.capabilities.join('；'))} |`,
    );
    out.push(
      `| capabilityRedLines（红线） | ${mdCell(id.registry.capabilityRedLines.length === 0 ? '无（该条没有 capabilityRedLines）' : id.registry.capabilityRedLines.join('；'))} |`,
    );
    out.push(`| capabilityCheckedAt | ${mdCell(id.registry.capabilityCheckedAt === null ? 'null（上游未给）' : id.registry.capabilityCheckedAt)} |`);
    out.push(
      `| stars / downloads | ${mdCell(`${id.registry.stars === null ? 'null' : id.registry.stars} / ${id.registry.downloads === null ? 'null' : id.registry.downloads}`)} |`,
    );
    out.push(`| registry category | ${mdCell(id.registry.category.length === 0 ? 'null' : id.registry.category.join(' '))} |`);
    out.push(`| registry page | ${mdCell(id.registry.page === null ? 'null' : id.registry.page)} |`);
  }
  out.push(`| catalog 命中（第 2 级数据源） | ${mdCell(renderCatalogHit(id.catalog))} |`);
  out.push(`| name | ${mdCell(id.name === null ? 'null（读不到，不猜）' : id.name)} |`);
  out.push(`| version | ${mdCell(id.version === null ? 'null（读不到，不猜）' : id.version)} |`);
  out.push(`| license | ${mdCell(id.license === null ? 'null（package.json 未声明）' : id.license)} |`);
  out.push(`| description（原文） | ${mdCell(id.description === null ? 'null（未声明）' : id.description)} |`);
  out.push(`| repository | ${mdCell(id.repository === null ? 'null（未声明）' : id.repository)} |`);
  out.push(`| dependencies 数 | ${id.dependencyCount} |`);
  out.push(`| peerDependencies 数 | ${id.peerDependencyCount} |`);
  out.push(`| engines.dsh | ${mdCell(id.engines.dsh === null ? 'null（未声明）' : id.engines.dsh)} |`);
  out.push('| localData | ' + (id.localData ? 'true' : 'false') + ' |');
  out.push('');
  if (id.summaryNote !== null) {
    out.push(`> ${id.summaryNote}`);
    out.push('');
  }
  out.push(`**README 正文前 3 句**（${id.readme.file === null ? `无 README（${id.readme.reason}）` : id.readme.file}；已按 RULES §11.2 过滤题头/导航/徽章/HTML 行）：`);
  out.push('');
  if (id.readme.sentences.length === 0) {
    out.push(`- （读不到可用的正文句子：${id.readme.reason === null ? '过滤后没有 ≥20 字的正文句' : id.readme.reason}）`);
  } else {
    for (const s of id.readme.sentences) out.push(`- ${s}`);
  }
  out.push('');

  // 2
  out.push('## 2. 权限四项（代码级扫描，不看 README 自述）');
  out.push('');
  if (!p.scanned) {
    out.push(`- 未扫描：${p.reason === null ? '未扫描' : p.reason}`);
    out.push('');
  } else {
    out.push('| 类别 | 命中数 | 前 3 处 文件:行 |');
    out.push('|---|---|---|');
    for (const rule of p.rules) out.push(`| ${rule.label} | ${rule.total} | ${permissionSites(rule)} |`);
    out.push('');
    out.push(
      `- 扫描范围：${p.scannedFiles} 个 .js/.mjs；跳过 node_modules ${p.skipped.nodeModules} 个、测试目录/文件 ${p.skipped.tests} 个、其他代码扩展名 ${p.skipped.otherCode} 个、非代码文件 ${p.skipped.ext} 个、符号链接 ${p.skipped.symlink} 个、超大文件 ${p.skipped.oversize} 个`,
    );
    out.push(`- **结论：${p.conclusion}**（四档：无 → 只读 → 写入 → 全量（含命令或凭据）；命中即报，不推断意图）`);
    out.push('');
  }

  // 3
  out.push('## 3. row 争用（本工具最重要的功能）');
  out.push('');
  out.push(
    `- 本包 insert 的 id：${rc.selfIds.length === 0 ? '（无 —— 没有 cordis.patch.yml 或没有 insert 行）' : rc.selfIds.map((x) => `\`${x.id}\``).join('、')}`,
  );
  if (rc.selfOverrides.length > 0) {
    out.push(`- 本包覆盖的 id（顶层 \`- id:\`，不自插）：${rc.selfOverrides.map((x) => `\`${x.id}\``).join('、')}`);
  }
  out.push(
    `- 对比对象：已装包 ${rc.scannedPackages} 个的 patch + 官方 row ${rc.officialRowIds === null ? 'unknown（数据读不到，不猜）' : `${rc.officialRowIds} 条`}（来源 \`${rc.officialSource === null ? '无' : rc.officialSource}\`，confidence=${rc.officialConfidence}）`,
  );
  out.push('');

  out.push(`### 3.1 COLLIDES_WITH_HOST（抢宿主行，danger）— ${rc.collidesWithHost.length} 条`);
  out.push('');
  if (rc.collidesWithHost.length === 0) out.push('（无）');
  else {
    out.push('| id | 官方声明者 | 严重度 | evidence |');
    out.push('|---|---|---|---|');
    for (const c of rc.collidesWithHost) {
      out.push(
        `| \`${mdCell(c.id)}\` | ${mdCell(c.officialPkgs.join('、') || 'unknown')} | **${c.severity}**（confidence=${c.confidence}） | ${mdCell(`${c.declaredAt}；${c.note}`)} |`,
      );
    }
  }
  out.push('');

  out.push(`### 3.2 COLLIDES_WITH_PLUGIN（抢其他插件行，warn）— ${rc.collidesWithPlugin.length} 条`);
  out.push('');
  if (rc.collidesWithPlugin.length === 0) out.push('（无）');
  else {
    out.push('| id | 冲突双方 | 严重度 | evidence |');
    out.push('|---|---|---|---|');
    for (const c of rc.collidesWithPlugin) {
      out.push(`| \`${mdCell(c.id)}\` | ${mdCell(c.pkgs.join(' / '))} | **${c.severity}** | ${mdCell(`${c.declaredAt}；${c.note}`)} |`);
    }
  }
  out.push('');

  if (rc.touchesHostOverride.length > 0 || rc.touchesPluginOverride.length > 0) {
    out.push(`### 3.3 覆盖（只改配置、不自插，info）— ${rc.touchesHostOverride.length + rc.touchesPluginOverride.length} 条`);
    out.push('');
    out.push('| id | 类型 | evidence |');
    out.push('|---|---|---|');
    for (const c of rc.touchesHostOverride) out.push(`| \`${mdCell(c.id)}\` | 覆盖官方行 | ${mdCell(`${c.declaredAt}；${c.note}`)} |`);
    for (const c of rc.touchesPluginOverride) {
      out.push(`| \`${mdCell(c.id)}\` | 覆盖他人行（${mdCell(c.owners.join('、'))}） | ${mdCell(`${c.declaredAt}；${c.note}`)} |`);
    }
    out.push('');
  }

  out.push(`**row 争用总体严重度：${rc.severity}**（抢宿主行 = danger ｜ 抢其他插件行 = warn ｜ 无冲突 = ok）`);
  if (rc.unparsed.length > 0) {
    out.push('');
    out.push('> patch 子集解析读不懂的位置（不猜）：');
    for (const u of rc.unparsed) out.push(`> - 第 ${u.line} 行「${u.text}」→ ${u.reason}`);
  }
  out.push('');

  // 4
  out.push('## 4. 同轨重复');
  out.push('');
  if (st.note === '同轨无记录' || st.note === '未提供 lab') {
    out.push(st.note === '未提供 lab' ? '同轨重复：未提供 lab（--lab 或 LAB_DIR），跳过。自建 lab：mkdir <目录> 后在 README 里看「lab 是什么」；或设 LAB_DIR 环境变量' : `同轨无记录（label=\`${st.label}\`；lab 类别列与 lifecycle label 归一化后都没有同轨条目）。`);
  } else {
    out.push(`label=\`${st.label}\`（lab 类别列 + lifecycle 的 label，按 docs/LABELS.md 的别名归一化）`);
    out.push('');
    out.push('| 类型 | pkg | 细节 |');
    out.push('|---|---|---|');
    for (const x of st.installed) {
      const kind = x.inProfile === true ? '已装（profile 实测）' : 'lab 登记（未在 profile）';
      out.push(`| ${kind} | \`${mdCell(x.pkg)}\` | 类别=${mdCell(x.category)} ｜ 状态=${mdCell(x.statusText === null ? '（无状态列）' : x.statusText)} ｜ ${mdCell(x.cite)} |`);
    }
    for (const x of st.adopted) {
      out.push(`| adopted | \`${mdCell(x.pkg === null ? 'null' : x.pkg)}\` | since=${mdCell(x.since === null ? 'null' : x.since)} ｜ verifiedVersion=${mdCell(x.verifiedVersion === null ? 'null' : x.verifiedVersion)} ｜ reason=${mdCell(x.reason === null ? 'null' : x.reason)} |`);
    }
    for (const x of st.rejected) {
      out.push(`| rejected | \`${mdCell(x.pkg === null ? 'null' : x.pkg)}\` | reason=${mdCell(x.reason === null ? 'null' : x.reason)} ｜ evidence=${mdCell(x.evidenceRef === null ? 'null' : x.evidenceRef)} |`);
    }
  }
  out.push('');

  // 5
  out.push('## 5. 建议分类 + 结论草稿');
  out.push('');
  out.push(`- suggestedLabel: **${report.suggestion.suggestedLabel}**`);
  out.push(`- matchedTerms: ${report.suggestion.matchedTerms.length === 0 ? '（无命中）' : report.suggestion.matchedTerms.map((t) => `\`${t}\``).join('、')}`);
  if (report.suggestion.scores.length > 1) {
    out.push(`- 其他候选: ${report.suggestion.scores.slice(1, 4).map((s) => `${s.label}(${s.score})`).join('、')}`);
  }
  if (report.suggestion.note) out.push(`- 说明：${report.suggestion.note}`);
  out.push(`- 关键词表: \`${report.suggestion.labelsPath}\``);
  out.push('');
  out.push(`- **verdict: ${report.verdict.verdict}** —— ${report.verdict.reason}`);
  out.push(`- ${report.verdict.disclaimer}`);
  out.push('');

  if (report.warnings.length > 0) {
    out.push(`## 告警（读不到 / 不猜测 / 子集外）— ${report.warnings.length} 条`);
    out.push('');
    for (const w of report.warnings) out.push(`- ${w}`);
    out.push('');
  }

  out.push(
    `verdict: ${report.verdict.verdict} ｜ severity=${rc.severity} ｜ permissions=${p.conclusion === null ? 'unknown' : p.conclusion} ｜ localData=${id.localData ? 'true' : 'false'} ｜ officialSource=${report.hostRows.source}`,
  );
  return out.join('\n');
}

// ────────────────────────────────────────────────────────────── 渲染：--scan-all

function renderScanAllMd(report) {
  const out = [];
  const s = report.scanAll.summary;

  out.push('# --scan-all · row 争用矩阵（只读）');
  out.push('');
  out.push(`- generatedAt: ${report.generatedAt}`);
  out.push(`- profile: \`${report.profile}\``);
  out.push(
    `- 官方 row 数据: \`${report.hostRows.path}\`（source=${report.hostRows.source} ｜ confidence=${report.hostRows.confidence} ｜ hostVersion=${report.hostRows.hostVersion === null ? 'null' : report.hostRows.hostVersion}）`,
  );
  out.push(
    `- 扫描：已装/已声明包 ${s.scannedPackages} 个 → 第三方 insert id ${s.thirdPartyInsertIds} 条（${s.thirdPartyPackages} 个包）｜官方 row ${s.officialRowIds === null ? 'unknown' : `${s.officialRowIds} 条`}（${s.officialPackages === null ? 'unknown' : `${s.officialPackages} 个包`}）`,
  );
  out.push('');
  out.push(
    `summary: 矩阵 **${s.matrixRows}** 行 ｜ danger ${s.danger} ｜ warn ${s.warn} ｜ info ${s.info} ｜ ok ${s.ok} ｜ 官方独有 ${s.officialOnlyRows} 行（不列出）`,
  );
  out.push('');

  if (s.danger + s.warn === 0) {
    out.push(
      `> **未发现 row 争用**——这不是伪造的空结果，但也不能当成「真无冲突」：请对照上面两个数（第三方 insert ${s.thirdPartyInsertIds} 条 / 官方 row ${s.officialRowIds === null ? 'unknown' : s.officialRowIds} 条）。若 insert 为 0，说明 patch 没解析进来（看告警），不是没有冲突。`,
    );
    out.push('');
  }

  if (report.scanAll.rows.length === 0) {
    out.push('（矩阵为空）');
    out.push('');
  } else {
    out.push('| row id | 声明它的包（可能多个） | 是否官方 | 严重度 |');
    out.push('|---|---|---|---|');
    for (const row of report.scanAll.rows) {
      const who = row.declaredBy
        .map((d) => {
          const tag = d.official ? '官方' : '第三方';
          const kind = d.kind === 'override' ? '仅覆盖' : 'insert';
          const where = d.line === null ? d.file : `${d.file}:${d.line}`;
          return `${d.pkg}(${tag}/${kind} @ ${where})`;
        })
        .join('<br>');
      out.push(
        `| \`${mdCell(row.id)}\` | ${mdCell(who)} | ${row.official ? '是' : '否'} | **${row.severity}**${row.dangling ? '（悬空：无任何 insert 声明者）' : ''} |`,
      );
    }
    out.push('');
  }

  if (report.warnings.length > 0) {
    out.push(`## 告警（读不到 / 不猜测 / 子集外）— ${report.warnings.length} 条`);
    out.push('');
    for (const w of report.warnings) out.push(`- ${w}`);
    out.push('');
  }

  out.push(`scan-all: ${s.matrixRows} row(s) ｜ danger ${s.danger} ｜ warn ${s.warn} ｜ info ${s.info} ｜ officialSource=${report.hostRows.source}`);
  return out.join('\n');
}

// ────────────────────────────────────────────────────────────── 渲染：json（字段序固定）

function renderSingleJson(report) {
  const ordered = {
    generatedAt: report.generatedAt,
    mode: report.mode,
    profile: report.profile,
    lab: report.lab,
    labels: report.labels,
    registry: report.registry,
    catalog: report.catalog,
    hostRows: report.hostRows,
    identity: report.identity,
    permissions: report.permissions,
    rowContention: report.rowContention,
    sameTrack: report.sameTrack,
    suggestion: report.suggestion,
    verdict: report.verdict,
    warnings: report.warnings,
  };
  return JSON.stringify(ordered, null, 2);
}

function renderScanAllJson(report) {
  const ordered = {
    generatedAt: report.generatedAt,
    mode: report.mode,
    profile: report.profile,
    hostRows: report.hostRows,
    scanAll: report.scanAll,
    warnings: report.warnings,
  };
  return JSON.stringify(ordered, null, 2);
}

// ────────────────────────────────────────────────────────────── 入口

function run() {
  const opts = parseArgs(process.argv.slice(2));

  if (opts.help) {
    process.stdout.write(`${USAGE}\n`);
    return;
  }

  let report;
  let text;
  if (opts.goal !== null) {
    report = buildGoalReport(opts);
    text = opts.format === 'json' ? renderGoalJson(report) : renderGoalMd(report);
  } else if (opts.search !== null) {
    report = buildSearchReport(opts);
    text = opts.format === 'json' ? renderSearchJson(report) : renderSearchMd(report);
  } else if (opts.unknown) {
    report = buildUnknownReport(opts);
    text = opts.format === 'json' ? renderUnknownJson(report) : renderUnknownMd(report);
  } else if (opts.scanAll) {
    report = buildScanAllReport(opts);
    text = opts.format === 'json' ? renderScanAllJson(report) : renderScanAllMd(report);
  } else {
    report = buildSingleReport(opts);
    text = opts.format === 'json' ? renderSingleJson(report) : renderSingleMd(report);
  }

  const out = text.endsWith('\n') ? text : `${text}\n`;
  process.stdout.write(out);

  if (opts.writeReport) {
    // 写目标守卫复用 B 阶段同一实现（拒绝 profile / lab / cordis.patch.yml / .dsh-market）
    const targetAbs = assertSafeLifecyclePath(opts.writeReport, { profileDir: opts.profile, labDir: opts.lab });
    writeAtomic(targetAbs, out);
    // 提示走 stderr：保证 stdout 纯净（md 最后一行必须是 verdict / scan-all / 匹配 / goal 行；json 必须可解析）
    process.stderr.write(`lab-analyze: report written -> ${targetAbs}\n`);
  }

  process.exitCode = 0;
}

try {
  run();
} catch (err) {
  const msg = err && err.message ? err.message : String(err);
  process.stderr.write(`lab-analyze: ${msg}\n`);
  process.exitCode = 1;
}
// ============================================================================
// 学习注记：这个文件为什么写成这样
// ----------------------------------------------------------------------------
// 一、它解决的真实问题
//    一句话：在**不装、不联网、不跑别人的代码**的前提下，回答「这东西是干什么的、
//    要什么权限、会不会抢别人的行、同轨有没有重复」，并把池内召回（--search / --goal /
//    --unknown）也放在同一份实现里。
//    真实例子：`--goal "我想学嵌入式，从连板子到画 PCB"` 在 11,183 条池子里得到
//    强 0 ｜ 弱 9 ｜ 仅字面 45 —— 这个「强 0」是**正常输出**，不是故障：市场那端把同类东西
//    写成 PCB / EDA / 单片机 / STM32 / 固件，与「嵌入式」一个字都不重。
//
// 二、关键设计取舍
//    1) 权限四档是「关键字正则命中即报」，不推断意图。选了 A（扫文本）而不是 B（做数据流分析），
//       因为静态分析器要能对未装的包也给结论，而数据流分析必须能安全执行/建模别人的代码。
//       代价是会误报：注释里写「烧 token」、同源相对路由 `fetch("/meow-memory/x")`
//       都会把结论顶到「全量（含命令或凭据）」——所以四档只当「代码里出现过这类能力」。
//    2) identity 用四级优先级（registry > catalog > package.json description > README 兜底），
//       而不是「哪个有就用哪个」。因为四级的信息质量差得很远：市场中文描述 > 官方目录中文名 >
//       包自带一句英文 > README 正文；顺序固定才能复现，报告里必须写 `identity.source`。
//    3) row 争用按「谁和谁撞」分三档：与官方行同 id = danger（Loader 每个 id 只留一个 entry，
//       后声明者胜出 → 官方那一行被顶掉）；多个第三方各 insert 同一 id = warn；
//       只覆盖不改模块名 = info。因为严重度应该由后果决定，不由「有没有出现 id」决定。
//    4) --goal 是**词表诊断**，不是语义搜索：分层（强 / 弱 / 仅字面）+ 通用词否决 + 噪声词丢弃 +
//       idf 加权，全部可复算。因为「不可解释的排名」比「没有排名」更糟；同义词词典会腐烂，不建。
//    5) 未装的包权限固定 `unknown`，不按 registry 的能力字段去猜。因为「市场说它能干什么」
//       和「它的代码里出现了什么」是两件事。
//    6) 一次建小写索引、单遍扫描、长词优先预判剪枝。因为 10,974 条 × 多词 × 六字段的
//       `includes` 如果重复拼语料，延迟会直接不可用（报告里打 elapsedMs，预算 2000ms）。
//
// 三、主要函数导读（按调用顺序）
//    PERMISSION_RULES / scanPermissions — 四条正则 + 目录遍历（跳过 node_modules、隐藏目录、
//        符号链接、>2 MiB 单文件、默认跳过测试）— 注意「前 3 处 文件:行」与各 skip 计数
//    buildIdentity      — 四级数据源优先，先命中先返回 — source 必须写进报告
//    loadHostRows / collectInstalledPatches / severityOfRow / buildRowContention
//                       — row 争用：官方行快照 + 各包 cordis.patch.yml 的 insert id
//    buildPool          — 三源合并（registry / catalog / 已装），按包名去重并记 source
//    buildSearchIndex / tokenizeGoal / filterNoiseTokens / scoreCandidate / classifyTier
//                       — 召回内核：索引 → 分词 → 去噪 → 打分（×idf）→ 分层
//    computeTokenStats  — 词表诊断 + idf 预计算（一次单遍）
//    buildGoalReport    — 串起上面几步，输出 tiers / candidates / diagnostics / performance
//    renderGoalMd       — 报告渲染：候选表、三层表、词表诊断、池子构成
//
// 四、踩过的坑
//    1) 权限误报（KNOWN-LIMITS §3）：meow-memory 的注释里写了 token、又有 `fetch("/meow-memory/x")`
//       这种同源相对路由，结论被顶到「全量」。修法不是改判定，而是把「命中行」交给逐条复核。
//    2) C.3.1 的硬门槛（长词 / ≥2 词 / Σ≥6）把召回卡死：`--goal` 只剩 1–2 条甚至 0 条。
//       C.3.3 改成「按覆盖率分层、三层都展示」，只保留「只命中通用词不算匹配」这条否决——
//       否则「管理」会靠覆盖率重新涌回候选。
//    3) 覆盖率的分母是**噪声过滤后的有效词数**：同一句目标写长一点，覆盖率就掉。
//       所以层别只能在同一句目标内比较，报告里给 `coverageBasis`（形如 3/9）让人复算。
//    4) `--search` 与 `--goal` 共用 scoreCandidate，但 `--search` 不能变：不传 idfMap 就走旧路径
//       （整数权重 + ⌊×0.5⌋），连 `idf` 这个键都不出现在行里——「不改行为」包括「不多一个 null 字段」。
//
// 五、读代码的建议顺序
//    文件头 C.1→C.3.3 的演进摘要（这一段就是需求史）→ PERMISSION_RULES + scanPermissions
//    → buildIdentity → severityOfRow / buildRowContention → buildPool → buildSearchIndex
//    → scoreCandidate（旧/新两条路径的 if）→ classifyTier → buildGoalReport → renderGoalMd。
// ============================================================================
