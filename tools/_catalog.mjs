#!/usr/bin/env node
/**
 * lab-guide / tools/_catalog.mjs — 离线目录（CATALOG）抽取器 + 目录查询内核（C.2）
 *
 * 解决的问题（C.1 用户实测暴露的第 3 个问题）：评估一个**未装**的包时，C.1 只能写
 * `localData: false` 就完事，回答不了「有没有适合学嵌入式的插件」。
 * 本机其实已经有一份**离线目录**：`@txc2768651338/dsh-plugin-manager` 的
 * `lib/index.js` 里内置了约 190 条「模块名 → 中文名 / 一句话描述 / 分类」。
 * 本模块把它抽成结构化快照（`data/catalog.json`），供 `lab-analyze` 的
 * ①数据源优先级、`--search`、`--unknown` 三个新能力共用。
 *
 * 三条硬约束：
 *   1. **绝不 `import()` 那个源文件**：它 `import` 了 cordis / typert 等 peer 依赖，
 *      本机用纯 node 跑会直接炸。所以用**行式正则**解析它（见 §解析子集）。
 *   2. **解析不到任何条目就报错退出**，绝不输出空目录冒充成功（R-2 的延伸）。
 *      部分条目解析失败 → 记进 `unparsed`，照样出现在统计里。
 *   3. 只读源文件；唯一写动作是显式 `--write`（写 `data/catalog.json`）。
 *
 * 解析子集（超出子集就报告，不猜）：
 *
 *   const CATALOG = {
 *     ["<模块名>"]: {
 *       name: "<中文名>",
 *       desc: "<一句话描述>",
 *       category: "<分类键>"
 *     },
 *     ...
 *   };
 *
 *   - 键行：`["x"]: {`、`"x": {`、`['x']: {` 都认；
 *   - 字段行：`name:` / `desc:` / `category:` 各一行，单/双引号都认，字符串里的 `\"` 会还原；
 *   - 顺序不限、允许缩进（tab/空格）与行尾逗号；缺字段 → 整条进 `unparsed`（不进 entries）。
 *
 * 顺带也抽 `CATEGORY_LABELS`（分类键 → 中文分类名），这样「分类中文名」只有**一份**来源，
 * 工具里不留第二份词表（与 RULES §10.1「拒绝第二份真相」同一条纪律）。
 *
 * 零第三方依赖 / ESM / 只用 node: 内置。
 *
 * 用法：
 *   node tools/_catalog.mjs                 只打印统计（默认，不写文件）
 *   node tools/_catalog.mjs --write         抽出来后写 data/catalog.json
 *   node tools/_catalog.mjs --check         比对快照与源，不一致 exit 1
 *   node tools/_catalog.mjs --catalog-source <path>  换源（默认见 DEFAULT_CATALOG_SOURCE）
 *   node tools/_catalog.mjs --out <path>    配合 --write 换输出路径
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { CliError, DEFAULT_PROFILE, REPO_ROOT, cmp, describeFsError, readJson, readText } from './_profile.mjs';

// ────────────────────────────────────────────────────────────── 常量与默认路径

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = REPO_ROOT; // 仓库根（开发仓是 plugin-helper 下的子目录；发布仓就是仓库根本身），不依赖 cwd

/** 快照格式版本：改了字段含义就升版（读旧快照时据此判断能不能用）。 */
export const CATALOG_SCHEMA_VERSION = 1;

/** 默认目录源：本机 profile 里那支插件管家的构建产物（只读）。 */
export const DEFAULT_CATALOG_SOURCE = path.join(
  DEFAULT_PROFILE,
  'node_modules',
  '@txc2768651338',
  'dsh-plugin-manager',
  'lib',
  'index.js',
);

/** 默认快照：抽出来的离线目录缓存。 */
export const DEFAULT_CATALOG_SNAPSHOT = path.join(ROOT, 'data', 'catalog.json');

/** 默认宿主版本来源（与官方 row 快照同一份，见 RULES §10.7）。 */
export const DEFAULT_HOST_ROWS = path.join(ROOT, 'data', 'host-rows.json');

/** 源文件的包名（package.json 读不到时的兜底标识；不是猜版本，只是标注来源）。 */
const FALLBACK_SOURCE_PACKAGE = '@txc2768651338/dsh-plugin-manager';

// ────────────────────────────────────────────────────────────── 行式解析

/** 键行：`["pkg"]: {` / `"pkg": {` / `['pkg']: {`（行尾只有 `{`）。 */
const KEY_LINE_RE = /^\s*\[?\s*(["'])((?:\\.|(?!\1)[\s\S])*?)\1\s*\]?\s*:\s*\{\s*$/;
/** 字段行：`name: "值",` / `desc: '值'` / `category: "core"`（行尾逗号可有可无）。 */
const FIELD_LINE_RE = /^\s*(name|desc|category)\s*:\s*(["'])((?:\\.|(?!\2)[\s\S])*?)\2\s*,?\s*$/;
/** 对象结束行：`},` 或 `}`。 */
const OBJECT_END_RE = /^\s*\}\s*,?\s*$/;
/** 分类标签块里的键值行：`\tcore: "核心服务",`。 */
const LABEL_LINE_RE = /^\s*([A-Za-z_][\w-]*)\s*:\s*(["'])((?:\\.|(?!\2)[\s\S])*?)\2\s*,?\s*$/;

const CATALOG_OPEN_RE = /^\s*(?:export\s+)?const\s+CATALOG\s*=\s*\{/;
const LABELS_OPEN_RE = /^\s*(?:export\s+)?const\s+CATEGORY_LABELS\s*=\s*\{/;

/** 还原 JS 字符串字面量里的转义（`\"` `\'` `\\` `\n` `\t` `\uXXXX`；未知转义取原字符）。 */
export function unescapeJsString(raw) {
  const s = String(raw === null || raw === undefined ? '' : raw);
  let out = '';
  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i];
    if (ch !== '\\') {
      out += ch;
      continue;
    }
    const nx = s[i + 1];
    if (nx === undefined) {
      out += '\\';
      break;
    }
    i += 1;
    if (nx === 'n') out += '\n';
    else if (nx === 't') out += '\t';
    else if (nx === 'r') out += '\r';
    else if (nx === 'u') {
      const hex = s.slice(i + 1, i + 5);
      if (/^[0-9a-fA-F]{4}$/.test(hex)) {
        out += String.fromCharCode(parseInt(hex, 16));
        i += 4;
      } else {
        out += 'u';
      }
    } else out += nx;
  }
  return out;
}

/** 找到 `const X = {` 的起始行；找不到 → -1。 */
function findBlockStart(lines, openRe) {
  for (let i = 0; i < lines.length; i += 1) {
    if (openRe.test(lines[i])) return i;
  }
  return -1;
}

/** 从 start 之后找块结尾：单独一行 `};` 或 `}`；找不到 → -1。 */
function findBlockEnd(lines, start) {
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^\s*\};?\s*$/.test(lines[i])) return i;
  }
  return -1;
}

/**
 * 解析源码文本 → { ok, entries, categories, unparsed, reason, range }。
 * 纯函数，不碰文件系统（方便夹具与 --check 复用）。
 */
export function parseCatalogText(text) {
  const lines = String(text === null || text === undefined ? '' : text).split(/\r?\n/);
  const entries = Object.create(null);
  const categories = Object.create(null);
  const unparsed = [];

  // ── 分类标签块（可选；读不到就 categories 为空，不影响目录本身）
  const labelsStart = findBlockStart(lines, LABELS_OPEN_RE);
  if (labelsStart >= 0) {
    const labelsEnd = findBlockEnd(lines, labelsStart);
    if (labelsEnd > labelsStart) {
      for (let i = labelsStart + 1; i < labelsEnd; i += 1) {
        const m = LABEL_LINE_RE.exec(lines[i]);
        if (!m) continue;
        categories[m[1]] = unescapeJsString(m[3]).trim();
      }
    }
  }

  // ── 目录块
  const start = findBlockStart(lines, CATALOG_OPEN_RE);
  if (start < 0) {
    return {
      ok: false,
      entries,
      categories,
      unparsed,
      reason: '源码里找不到 `const CATALOG = {` 声明（源文件不是预期结构，不猜）',
      range: null,
    };
  }
  const end = findBlockEnd(lines, start);
  if (end < 0) {
    return {
      ok: false,
      entries,
      categories,
      unparsed,
      reason: `CATALOG 块（第 ${start + 1} 行起）没有闭合行（找不到单独一行 \`};\`），不猜`,
      range: null,
    };
  }

  for (let i = start + 1; i < end; i += 1) {
    const lineNo = i + 1;
    const keyMatch = KEY_LINE_RE.exec(lines[i]);
    if (!keyMatch) continue;

    const key = unescapeJsString(keyMatch[2]).trim();
    const fields = { name: null, desc: null, category: null };
    let j = i + 1;
    for (; j < end; j += 1) {
      if (OBJECT_END_RE.test(lines[j])) break;
      const fm = FIELD_LINE_RE.exec(lines[j]);
      if (!fm) continue;
      if (fields[fm[1]] !== null) {
        // 同一条里同字段出现两次：照实记问题，后值覆盖前值（并进 unparsed）
        unparsed.push({ line: j + 1, key, reason: `字段「${fm[1]}」重复出现（取后值）` });
      }
      fields[fm[1]] = unescapeJsString(fm[3]);
    }

    if (!key) {
      unparsed.push({ line: lineNo, key: null, reason: '键为空字符串' });
    } else {
      const missing = ['name', 'desc', 'category'].filter((k) => !fields[k] || !String(fields[k]).trim());
      if (missing.length > 0) {
        unparsed.push({ line: lineNo, key, reason: `缺字段 ${missing.join('/')}（整条不进 entries）` });
      } else if (Object.prototype.hasOwnProperty.call(entries, key)) {
        unparsed.push({ line: lineNo, key, reason: '键重复（后值覆盖前值）' });
        entries[key] = { name: fields.name.trim(), desc: fields.desc.trim(), category: fields.category.trim() };
      } else {
        entries[key] = { name: fields.name.trim(), desc: fields.desc.trim(), category: fields.category.trim() };
      }
    }

    i = j; // 跳过已消费的字段与结束行
  }

  const count = Object.keys(entries).length;
  if (count === 0) {
    return {
      ok: false,
      entries,
      categories,
      unparsed,
      reason: `CATALOG 块（第 ${start + 1}–${end + 1} 行）里一条完整条目都没解析出来`,
      range: { startLine: start + 1, endLine: end + 1 },
    };
  }

  return {
    ok: true,
    entries,
    categories,
    unparsed,
    reason: null,
    range: { startLine: start + 1, endLine: end + 1 },
  };
}

// ────────────────────────────────────────────────────────────── 抽取（含源信息）

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/** 宿主版本：与官方 row 快照同一份文件（读不到就是 null，不猜）。 */
export function readHostVersion(hostRowsPath = DEFAULT_HOST_ROWS) {
  const r = readJson(path.resolve(hostRowsPath));
  if (!r.ok || !isPlainObject(r.value)) return null;
  const v = r.value;
  return typeof v.hostVersion === 'string' && v.hostVersion.trim() ? v.hostVersion.trim() : null;
}

/** 源包的 package.json（版本号从实测读，不从文件名猜）。 */
function readSourcePackageMeta(sourcePath) {
  const sourceAbs = path.resolve(sourcePath);
  const libDir = path.dirname(sourceAbs);
  const candidates = [path.join(libDir, '..', 'package.json'), path.join(libDir, 'package.json')];
  for (const p of candidates) {
    const r = readJson(p);
    if (!r.ok || !isPlainObject(r.value)) continue;
    const v = r.value;
    return {
      package: typeof v.name === 'string' && v.name.trim() ? v.name.trim() : FALLBACK_SOURCE_PACKAGE,
      version: typeof v.version === 'string' && v.version.trim() ? v.version.trim() : null,
      packageJson: path.resolve(p),
    };
  }
  return { package: FALLBACK_SOURCE_PACKAGE, version: null, packageJson: null };
}

/**
 * 抽取一次目录（读源文件 → 结构化）。**解析不到条目直接抛 CliError**，绝不返回空目录。
 *
 * @param {{sourcePath?: string, hostVersion?: string|null, extractedAt?: string}} [opts]
 */
export function extractCatalog(opts = {}) {
  const sourcePath = path.resolve(opts.sourcePath || DEFAULT_CATALOG_SOURCE);
  const read = readText(sourcePath);
  if (!read.ok) {
    throw new CliError(
      `读不到目录源：${sourcePath}（${read.reason}）。本工具不联网；请用 --catalog-source <path> 指向本机的 dsh-plugin-manager/lib/index.js`,
    );
  }
  const parsed = parseCatalogText(read.text);
  if (!parsed.ok) {
    throw new CliError(`目录源解析失败：${sourcePath} → ${parsed.reason}`);
  }

  const meta = readSourcePackageMeta(sourcePath);
  const entries = parsed.entries;
  const count = Object.keys(entries).length;

  return {
    schemaVersion: CATALOG_SCHEMA_VERSION,
    source: {
      package: meta.package,
      version: meta.version,
      path: sourcePath,
      extractedAt: opts.extractedAt || new Date().toISOString(),
      hostVersion: opts.hostVersion === undefined ? readHostVersion() : opts.hostVersion,
    },
    count,
    entries,
    categories: parsed.categories,
    unparsed: parsed.unparsed,
    // 统计用（不进快照 JSON 之外的地方也无需重新解析）
    stats: {
      blockRange: parsed.range,
      categoryCount: Object.keys(parsed.categories).length,
      unparsedCount: parsed.unparsed.length,
      packageJson: meta.packageJson,
    },
  };
}

// ────────────────────────────────────────────────────────────── 快照读写

/** 写快照：显式 `--write` 才走这里（唯一写动作）。 */
export function writeSnapshot(filePath, catalog) {
  const abs = path.resolve(filePath);
  const payload = {
    schemaVersion: catalog.schemaVersion,
    source: catalog.source,
    count: catalog.count,
    entries: catalog.entries,
    categories: catalog.categories || {},
    unparsed: catalog.unparsed || [],
  };
  try {
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  } catch (err) {
    throw new CliError(`写快照失败：${abs}（${describeFsError(err)}）`);
  }
  return abs;
}

/** 读快照；坏掉/为空都返回 ok:false + 原因（不抛，调用方决定降级还是报错）。 */
export function loadSnapshot(snapshotPath = DEFAULT_CATALOG_SNAPSHOT) {
  const abs = path.resolve(snapshotPath);
  const r = readJson(abs);
  if (!r.ok) return { ok: false, path: abs, value: null, reason: r.reason };
  const v = r.value;
  if (!isPlainObject(v)) return { ok: false, path: abs, value: null, reason: '快照不是 JSON 对象' };
  if (v.schemaVersion !== CATALOG_SCHEMA_VERSION) {
    return {
      ok: false,
      path: abs,
      value: null,
      reason: `快照 schemaVersion=${JSON.stringify(v.schemaVersion)}，本工具只认 ${CATALOG_SCHEMA_VERSION}（重跑 --write）`,
    };
  }
  if (!isPlainObject(v.entries)) return { ok: false, path: abs, value: null, reason: '快照缺少 entries 对象' };
  const count = Object.keys(v.entries).length;
  if (count === 0) return { ok: false, path: abs, value: null, reason: '快照 entries 为空（不拿空目录冒充结果）' };
  return { ok: true, path: abs, value: v, reason: null };
}

/**
 * 统一入口：优先用快照（快），快照缺失/坏掉 → 现场从源解析（真数据，不是猜），
 * 两者都不行 → `available:false` + 原因。调用方据此决定「降级」还是「报错退出」。
 */
export function loadCatalog(opts = {}) {
  const warnings = [];
  const snap = loadSnapshot(opts.snapshotPath || DEFAULT_CATALOG_SNAPSHOT);
  if (snap.ok) {
    const v = snap.value;
    return {
      available: true,
      origin: 'snapshot',
      path: snap.path,
      meta: {
        package: v.source && v.source.package ? v.source.package : null,
        version: v.source && v.source.version ? v.source.version : null,
        extractedAt: v.source && v.source.extractedAt ? v.source.extractedAt : null,
        hostVersion: v.source && v.source.hostVersion ? v.source.hostVersion : null,
        sourcePath: v.source && v.source.path ? v.source.path : null,
      },
      entries: v.entries,
      categories: isPlainObject(v.categories) ? v.categories : {},
      unparsed: Array.isArray(v.unparsed) ? v.unparsed : [],
      count: Object.keys(v.entries).length,
      reason: null,
      warnings,
    };
  }

  // 快照不可用 → 现场解析源（只在显式给了源路径、或默认源存在时才尝试）
  const sourcePath = path.resolve(opts.sourcePath || DEFAULT_CATALOG_SOURCE);
  if (!fs.existsSync(sourcePath)) {
    return {
      available: false,
      origin: 'none',
      path: snap.path,
      meta: null,
      entries: Object.create(null),
      categories: {},
      unparsed: [],
      count: 0,
      reason: `快照不可用（${snap.reason}）且目录源不存在（${sourcePath}）`,
      warnings,
    };
  }
  try {
    const live = extractCatalog({ sourcePath });
    warnings.push(
      `目录快照不可用（${snap.reason}）→ 本次现场解析源文件 ${sourcePath}（数据是真的，建议跑 node tools/_catalog.mjs --write 落快照）`,
    );
    return {
      available: true,
      origin: 'live',
      path: live.source.path,
      meta: {
        package: live.source.package,
        version: live.source.version,
        extractedAt: live.source.extractedAt,
        hostVersion: live.source.hostVersion,
        sourcePath: live.source.path,
      },
      entries: live.entries,
      categories: live.categories || {},
      unparsed: live.unparsed,
      count: live.count,
      reason: null,
      warnings,
    };
  } catch (err) {
    const msg = err && err.message ? err.message : String(err);
    return {
      available: false,
      origin: 'none',
      path: snap.path,
      meta: null,
      entries: Object.create(null),
      categories: {},
      unparsed: [],
      count: 0,
      reason: `快照不可用（${snap.reason}）；现场解析也失败（${msg}）`,
      warnings,
    };
  }
}

// ────────────────────────────────────────────────────────────── 查询

export function categoryLabelOf(catalog, category) {
  if (!category) return null;
  if (catalog && isPlainObject(catalog.categories) && typeof catalog.categories[category] === 'string') {
    return catalog.categories[category];
  }
  return null;
}

/**
 * 包名 → 目录条目。
 *
 * 命中顺序（**不猜**：多个候选就不命中，只记 candidates）：
 *   1. `exact`     包名 === 目录键（模块名）；
 *   2. `basename`  去掉 scope 后的短名唯一命中（例：第三方 fork `@x/dsh-plugin-manager`
 *                  → 官方模块 `@deepseek-ai/dsh-plugin-manager`）。报告里必须显示
 *                  `match=basename` 与命中的键，不许把同名当同名。
 */
export function lookupEntry(entries, pkg) {
  const empty = { hit: false, match: null, key: null, entry: null, candidates: [], reason: null };
  if (!entries || !pkg) return empty;
  const name = String(pkg).trim();
  if (!name) return empty;
  if (Object.prototype.hasOwnProperty.call(entries, name)) {
    return { hit: true, match: 'exact', key: name, entry: entries[name], candidates: [name], reason: null };
  }
  const base = name.split('/').pop();
  if (!base) return empty;
  const candidates = Object.keys(entries)
    .filter((k) => k.split('/').pop() === base)
    .sort(cmp);
  if (candidates.length === 1) {
    return { hit: true, match: 'basename', key: candidates[0], entry: entries[candidates[0]], candidates, reason: null };
  }
  return {
    hit: false,
    match: null,
    key: null,
    entry: null,
    candidates,
    reason: candidates.length > 1 ? `短名「${base}」命中 ${candidates.length} 个目录键 → 不猜` : null,
  };
}

/** 查询分词：按空白切，全部小写；空查询返回 []。 */
export function tokenizeQuery(query) {
  return String(query === null || query === undefined ? '' : query)
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => t.toLowerCase());
}

/** 统一的「可比对文本」：键 / 中文名 / 描述 / 分类键 / 分类中文名，全部小写。 */
export function entryHaystack(key, entry, categories) {
  const label = categoryLabelOf({ categories: categories || {} }, entry.category);
  return [key, entry.name, entry.desc, entry.category, label === null ? '' : label].join('\n').toLowerCase();
}

/**
 * 目录内搜索：中文名 / 描述 / 分类键 / 分类中文名 / 模块名，大小写不敏感，多词 AND。
 * 返回 { query, tokens, matches, total }；`total` 是**目录总条数**（无匹配时也要能报出来）。
 */
export function searchCatalog(entries, query, categories = {}) {
  const tokens = tokenizeQuery(query);
  const total = entries ? Object.keys(entries).length : 0;
  if (tokens.length === 0) return { query: String(query || ''), tokens, matches: [], total };
  const matches = [];
  for (const key of Object.keys(entries || {}).sort(cmp)) {
    const entry = entries[key];
    const hay = entryHaystack(key, entry, categories);
    if (!tokens.every((t) => hay.includes(t))) continue;
    matches.push({
      key,
      name: entry.name,
      desc: entry.desc,
      category: entry.category,
      categoryLabel: categoryLabelOf({ categories }, entry.category),
      source: 'catalog',
    });
  }
  return { query: String(query || ''), tokens, matches, total };
}

// ────────────────────────────────────────────────────────────── CLI

const USAGE = `_catalog — 离线目录（CATALOG）抽取器（只读源、零依赖、不联网）

用法：
  node tools/_catalog.mjs                 只打印统计（默认，不写任何文件）
  node tools/_catalog.mjs --write         抽取并写快照 data/catalog.json
  node tools/_catalog.mjs --check         比对「快照」与「源」，不一致 exit 1
  node tools/_catalog.mjs --json          统计以 JSON 输出（给 CI/断言）

选项：
  --catalog-source <path>  目录源（默认：${DEFAULT_CATALOG_SOURCE}）
  --out <path>             快照路径（默认：${DEFAULT_CATALOG_SNAPSHOT}；配合 --write / --check）
  --host-rows <path>       宿主版本来源（默认：data/host-rows.json）
  --help, -h               显示本帮助

退出码：
  0  跑通（含 --check 通过；含「部分条目进 unparsed」——那要看统计，不是失败）
  1  参数错误 / 源读不到 / 解析不到任何条目 / --check 不一致 / 写盘失败
`;

function takeValue(argv, i, name) {
  const next = argv[i + 1];
  if (next === undefined || (typeof next === 'string' && next.startsWith('--'))) {
    throw new CliError(`参数 ${name} 缺少取值`);
  }
  return next;
}

function main(argv) {
  const opts = {
    write: false,
    check: false,
    json: false,
    help: false,
    sourcePath: DEFAULT_CATALOG_SOURCE,
    outPath: DEFAULT_CATALOG_SNAPSHOT,
    hostRows: DEFAULT_HOST_ROWS,
  };

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
    const value = (name) => {
      if (inline !== null) {
        if (inline === '') throw new CliError(`参数 ${name} 缺少取值`);
        return inline;
      }
      const v = takeValue(argv, i, name);
      i += 1;
      return v;
    };

    switch (key) {
      case '--help':
      case '-h':
        opts.help = true;
        break;
      case '--write':
        opts.write = true;
        break;
      case '--check':
        opts.check = true;
        break;
      case '--json':
        opts.json = true;
        break;
      case '--catalog-source':
        opts.sourcePath = value('--catalog-source');
        break;
      case '--out':
        opts.outPath = value('--out');
        break;
      case '--host-rows':
        opts.hostRows = value('--host-rows');
        break;
      default:
        throw new CliError(`未知参数：${raw}（见 --help）`);
    }
  }

  if (opts.help) {
    process.stdout.write(`${USAGE}\n`);
    return;
  }
  if (opts.write && opts.check) throw new CliError('--write 与 --check 不能同时使用（--check 只比对，不写）');

  const hostVersion = readHostVersion(opts.hostRows);
  const catalog = extractCatalog({ sourcePath: opts.sourcePath, hostVersion });
  const categoryCount = Object.keys(catalog.categories).length;
  const stats = {
    sourcePath: catalog.source.path,
    package: catalog.source.package,
    version: catalog.source.version,
    hostVersion: catalog.source.hostVersion,
    blockRange: catalog.stats.blockRange,
    count: catalog.count,
    categoryCount,
    unparsedCount: catalog.stats.unparsedCount,
    unparsed: catalog.unparsed,
    snapshotPath: path.resolve(opts.outPath),
    wrote: false,
    check: null,
  };

  if (opts.write) {
    stats.snapshotPath = writeSnapshot(opts.outPath, catalog);
    stats.wrote = true;
  }

  if (opts.check) {
    const snap = loadSnapshot(opts.outPath);
    if (!snap.ok) {
      stats.check = { ok: false, reason: snap.reason, diffs: [] };
    } else {
      const diffs = [];
      const liveKeys = Object.keys(catalog.entries);
      const snapKeys = Object.keys(snap.value.entries);
      for (const key of liveKeys) {
        const a = catalog.entries[key];
        const b = snap.value.entries[key];
        if (!b) {
          diffs.push({ key, field: '(missing)', source: `${a.name} / ${a.desc} / ${a.category}`, snapshot: null });
          continue;
        }
        for (const field of ['name', 'desc', 'category']) {
          if (String(a[field]) !== String(b[field])) {
            diffs.push({ key, field, source: a[field], snapshot: b[field] });
          }
        }
      }
      for (const key of snapKeys) {
        if (!Object.prototype.hasOwnProperty.call(catalog.entries, key)) {
          diffs.push({ key, field: '(extra)', source: null, snapshot: `${snap.value.entries[key].name}` });
        }
      }
      stats.check = {
        ok: diffs.length === 0,
        reason: diffs.length === 0 ? null : `快照与源不一致（${diffs.length} 处）`,
        snapshotCount: snapKeys.length,
        sourceCount: liveKeys.length,
        diffs: diffs.slice(0, 20),
        diffTotal: diffs.length,
      };
    }
  }

  if (opts.json) {
    process.stdout.write(`${JSON.stringify(stats, null, 2)}\n`);
  } else {
    const out = [];
    out.push(`目录源: ${stats.sourcePath}`);
    out.push(`来源包: ${stats.package}@${stats.version === null ? 'null（读不到 package.json 版本，不猜）' : stats.version}`);
    out.push(`宿主版本: ${stats.hostVersion === null ? 'null（data/host-rows.json 没有 hostVersion）' : stats.hostVersion}`);
    out.push(
      `CATALOG 块: 第 ${stats.blockRange ? `${stats.blockRange.startLine}–${stats.blockRange.endLine}` : '?'} 行 ｜ 分类标签 ${stats.categoryCount} 个`,
    );
    out.push(`entries: ${stats.count} 条 ｜ unparsed: ${stats.unparsedCount} 条`);
    if (stats.unparsedCount > 0) {
      for (const u of stats.unparsed.slice(0, 10)) {
        out.push(`  - 第 ${u.line} 行「${u.key === null ? '(空键)' : u.key}」→ ${u.reason}`);
      }
      if (stats.unparsedCount > 10) out.push(`  - …另有 ${stats.unparsedCount - 10} 条`);
    }
    if (stats.wrote) out.push(`已写快照: ${stats.snapshotPath}`);
    else out.push(`快照: ${stats.snapshotPath}（未写；要写请加 --write）`);
    if (stats.check) {
      if (stats.check.ok) {
        out.push(`check: OK —— 快照与源逐条一致（${stats.check.sourceCount} 条）`);
      } else {
        out.push(`check: ${stats.check.reason}`);
        for (const d of stats.check.diffs) {
          out.push(`  - ${d.key} ｜ ${d.field} ｜ 源=${JSON.stringify(d.source)} ｜ 快照=${JSON.stringify(d.snapshot)}`);
        }
      }
    }
    out.push(`catalog: ${stats.count} 条 ｜ unparsed ${stats.unparsedCount} ｜ hostVersion=${stats.hostVersion === null ? 'null' : stats.hostVersion}`);
    process.stdout.write(`${out.join('\n')}\n`);
  }

  if (stats.check && !stats.check.ok) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  try {
    main(process.argv.slice(2));
  } catch (err) {
    const msg = err && err.message ? err.message : String(err);
    process.stderr.write(`_catalog: ${msg}\n`);
    process.exitCode = 1;
  }
}
// ============================================================================
// 学习注记：这个文件为什么写成这样
// ----------------------------------------------------------------------------
// 一、它解决的真实问题
//    一句话：评估一个**没装**的包时，本机唯一能问「这东西是干什么的」的离线语料，
//    是插件管家构建产物里那张内置目录表；这个文件把它抽成 data/catalog.json（实测 195 条：
//    中文名 / 一句话描述 / 分类键 + 分类中文名）。
//    真实例子：没有它，`--search 直播` 这类召回只能靠已装包，第三方 0 命中；
//    有了它，C.2 之后「官方模块」这一源才成立，并成为三源池（registry 10,974 ｜ catalog 195 ｜
//    已装 14 = 11,183）里的第二源。
//
// 二、关键设计取舍
//    1) **绝不 import() 源文件**，改用行式正则解析。因为那支 lib/index.js 会 import cordis、
//       typert 等 peer 依赖，本机用纯 node 跑会直接炸；「读文本」比「执行别人的模块」安全且可复现。
//    2) 只解析一个**明确子集**（`["key"]: {` / `"key": {` 行 + `name:` / `desc:` / `category:` 行），
//       超出子集就记 unparsed 并报告，不猜。因为源是构建产物，格式会变；猜格式等于制造假数据。
//    3) 一条都解析不到就抛 CliError，不输出空目录冒充成功。因为「空目录」会被下游读成
//       「本机没有这类插件」，这是最坏的一种错——它看起来像正常结果。
//    4) 分类中文名（CATEGORY_LABELS）也一起抽。因为分类中文名只能有一份来源，
//       代码里再留第二份词表就是第二个真相。
//    5) 快照优先、现场解析兜底，两条路都不可用才 available:false + 原因。
//       因为快照快、可 diff；而快照坏了的时候，现场解析给的仍然是真数据，不是猜。
//
// 三、主要函数导读（按调用顺序）
//    unescapeJsString     — 还原 JS 字符串字面量里的转义（\" \\ \n \t \uXXXX）
//    findBlockStart / findBlockEnd — 定位 `const CATALOG = {` 与它单独的 `};` 收尾行
//    parseCatalogText     — 纯函数：源码文本 → entries / categories / unparsed / range
//    extractCatalog       — 读源文件 + 解析 + 读源包 package.json 版本 — 解析不到就抛错
//    writeSnapshot        — 唯一写动作（显式 --write 才走）
//    loadSnapshot         — 读快照：坏/空/版本不符都返回 ok:false + 原因（不抛，交调用方决定）
//    loadCatalog          — 统一入口：快照 → 现场解析 → available:false
//    lookupEntry / searchCatalog — 包名命中（exact → basename 唯一）与多词 AND 搜索
//    main                 — CLI：默认只打印统计；--write 落盘；--check 比对快照与源
//
// 四、踩过的坑
//   1) `import()` 源文件会炸在 peer 依赖上：这不是「环境没装好」，而是解析策略选错了。
//      行式解析虽然笨，但它是唯一能在纯 node 下跑通的办法。
//   2) 字段必须与键在同一行语法范围内：跨行字符串、模板串拼出来的 name 都会落进 unparsed。
//      这就是「只认子集、其余报告」的代价，也是为什么统计里要永远显示 unparsed 条数。
//   3) 快照会过期：源包升级后 lib/index.js 变了而 data/catalog.json 没变，搜索结果就会
//      悄悄停在旧世界。--check 逐条比对 name/desc/category 并 exit 1，就是为了让这件事
//      在 CI 里红，而不是等人发现。
//   4) basename 命中是「不得已的相似」：`@x/dsh-plugin-manager` 与官方 `@deepseek-ai/...`
//      短名相同，命中时必须标 match=basename 并写出命中的键，不能当成同名同物。
//
// 五、读代码的建议顺序
//    文件头的「解析子集」→ parseCatalogText（核心，140 行左右）→ extractCatalog（怎么落成快照）
//    → loadCatalog（降级链）→ main 的 --check 分支（快照与源怎么比）→ lookupEntry / searchCatalog。
// ============================================================================
