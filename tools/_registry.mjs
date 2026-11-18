#!/usr/bin/env node
/**
 * lab-guide / tools/_registry.mjs — 第三方市场快照（registry）抓取 / 导入 / 校验（C.3 → C.3.2）
 *
 * 解决的问题（用户原话）：目录只覆盖官方模块，第三方 0 命中。
 * `data/catalog.json` 是 `@txc2768651338/dsh-plugin-manager` 内置的**官方模块**目录（195 条），
 * 第三方市场（本机 dsh-market 服务）里的插件它一条都不认识。C.3 补一个**市场快照**：
 * 由用户显式跑一次本工具，把本机市场服务返回的 registry 落成 `data/registry.json`，
 * `lab-analyze` 只读这份快照（**它自己不联网**）。
 *
 * 三条硬约束（任务卡逐字）：
 *   1. **除 loopback 外不联网**：只允许 GET `http://127.0.0.1:<port>` / `localhost` / `[::1]`；
 *      其他 host 一律 `error: 仅允许 loopback` + exit 1。**这不是通用 HTTP 客户端**：
 *      - 只认 `http:`（https / file / ftp 一律拒绝）；
 *      - 不带用户名口令；端口必须显式给出（**工具不猜端口**）；
 *      - **不跟随重定向**（3xx 直接拒绝：重定向可能把我们带出 loopback）；
 *      - 响应体有上限（`DEFAULT_MAX_BYTES` = 64 MiB，可用 `--max-bytes` 显式覆盖），
 *        流式累加、超了立即中止，不写半截快照。
 *   2. **不装/不卸插件、不写 profile、不写外部 lab**：写动作只有 `--write` → `data/registry.json`，
 *      且写目标先过 `_lifecycle.assertSafeLifecyclePath`（拒绝 profile / lab 目录内、`cordis.patch.yml`、`.dsh-market`）。
 *   3. **绝不写空快照冒充成功**：解析出 0 条 → 抛错 exit 1；部分条目字段不合法 → 进 `malformed`，
 *      字段不认识 → **原样保留**（`extra`）并列进 `unknownFields`，不丢。
 *
 * ────────────────────────────────────────────────────────────────────────────────
 * C.3.2（本轮）—— 用户 dump 出**真实响应**后按真实字段重写适配。真实数据已 dump，不再猜：
 *   `out/registry-raw.json`：**13,837,168 字节**（HTTP 200）。
 *   真实形状（本文件实读确认，不是假定）：
 *
 *     { "registry": { "name":"awesome-dsh-plugin", "url":…, "source":…, "updated":"2026-11-13",
 *                     "count":10974, "categories":{ "<key>":{en,zh} × 23 },
 *                     "plugins":[ <条目> … **10,974 条** ] },
 *       "hostVersion": "<版本>" }
 *
 *   → 数组键 = **`plugins`**（不是 entries / items / list；C.3.1 的探测脚本里 `r.plugins ?? …`
 *     命中的就是它）。但**代码里不写死**：运行时按 `ARRAY_KEY_CANDIDATES` 依次探测，
 *     再退化为「容器对象里任意第一个数组值」，并把实际命中的键写进 `source.arrayKey`。
 *   → 单条真实字段（用户贴出 + 本文件实读）：`name, owner, url, page, category[], description{en,zh},
 *     npm, version, stars, starsCheckedAt, downloads, downloadsStart, downloadsEnd, downloadsCheckedAt,
 *     capabilities, capabilityRedLines, capabilityCheckedAt, install, added, icon, screenshots`。
 *     其中 `description` 是**对象**（不是字符串）—— 这是 C.3.1 归一化最致命的一处假设错误。
 *
 *   v2 归一化字段（进快照 `entries[]`）：
 *     `key / name / owner / npm / version / category[] / descriptionZh / descriptionEn /
 *      capabilities[] / capabilityRedLines[] / capabilityCheckedAt / stars / downloads /
 *      install / page / url / added` + 兼容字段 `description`（= zh ?? en，给老调用点用）+
 *     `unknownFields` + `extra`。
 *   `starsCheckedAt / downloadsStart / downloadsEnd / downloadsCheckedAt / icon / screenshots`
 *   不在任务卡的规范字段表里 → **原样进 `extra`** 并列进 `unknownFields`（不认识的字段不丢、也不算分）。
 *
 *   快照 schema 随之升到 **v2**：`{schemaVersion:2, source:{url,fetchedAt,httpStatus,bytes,hostVersion},
 *   count, entries:[…], malformed, unknownFields}`。**10974 条全量保留**（不截断、不抽样）。
 *   v1 快照（含旧夹具 `fixtures/registry-sample.json`）→ **拒绝**：它按字符串 `description` 归一化，
 *   在真实数据上会静默丢字段。它就是本轮保留下来的**负例**（`--check` 必须红）。
 *
 * C.3.1 修补（保留不动）：默认上限 8 MiB → **64 MiB**、响应体**流式累加**、`--max-bytes <n>`、
 *   >8 MiB 时额外打印「大响应: <bytes> 字节 ｜ 解析出 count <n> 条」并把上限记进 `source.maxBytes`。
 *
 * 用法：
 *   node tools/_registry.mjs --url http://127.0.0.1:<port>/dsh-market/registry --write
 *   node tools/_registry.mjs --from-file out/registry-raw.json --write
 *   node tools/_registry.mjs --from-file out/registry-raw.json --json
 *   node tools/_registry.mjs --check [--snapshot <path>]
 *   node tools/_registry.mjs --help
 */

import http from 'node:http';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { CliError, DEFAULT_LAB, DEFAULT_PROFILE, REPO_ROOT, cmp, describeFsError, readJson, readText } from './_profile.mjs';
import { assertSafeLifecyclePath, writeAtomic } from './_lifecycle.mjs';

// ────────────────────────────────────────────────────────────── 常量与默认路径

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = REPO_ROOT; // 仓库根（开发仓是 plugin-helper 下的子目录；发布仓就是仓库根本身），不依赖 cwd

/** 快照格式版本：字段含义变了就升版（读旧快照时据此判断能不能用）。C.3.2：1 → 2。 */
export const REGISTRY_SCHEMA_VERSION = 2;

/** 唯一允许写入的快照路径（任务卡：写盘只允许 data/registry.json）。 */
export const DEFAULT_REGISTRY_SNAPSHOT = path.join(ROOT, 'data', 'registry.json');

/** 默认市场地址的**形态**。端口必须由用户传入 —— 本工具不猜端口（猜就是伪造数据源）。 */
export const DEFAULT_REGISTRY_URL_PATTERN = 'http://127.0.0.1:<port>/dsh-market/registry';

/** loopback 白名单（只有这三个；大小写不敏感）。 */
export const LOOPBACK_HOSTS = ['127.0.0.1', 'localhost', '[::1]'];

/** 响应体上限（C.3.1：8 MiB → 64 MiB）。**超限仍然中止，不写半截快照。** */
export const DEFAULT_MAX_BYTES = 64 * 1024 * 1024;
/** 「大响应」阈值（8 MiB）：超过它要在输出里额外打印 bytes + count。 */
export const LARGE_RESPONSE_BYTES = 8 * 1024 * 1024;
/** 内部默认值（= DEFAULT_MAX_BYTES，保留短名以免各处引用变长）。 */
const MAX_BYTES = DEFAULT_MAX_BYTES;
/** 单次请求超时（市场进程没起时不要挂死）。 */
const HTTP_TIMEOUT_MS = 10000;
/** 非 200 响应体只回显这么多字节，够定位问题即可。 */
const ERROR_BODY_ECHO = 200;

/**
 * 数组键探测顺序（**运行时探测，不写死**）。
 * 真实数据命中的是第一个 `plugins`；后面几个是历史/将来形状的兜底。
 */
export const ARRAY_KEY_CANDIDATES = ['plugins', 'entries', 'items', 'list', 'packages', 'results'];

/** 容器键探测顺序：真实数据是 `{registry:{…,plugins:[…]}}`，所以 registry 排第一。 */
export const CONTAINER_KEY_CANDIDATES = ['registry', 'data', 'result', 'payload', 'market'];

/** `--check` 抽样校验前多少条必须有 `name`（任务卡：前 20 条）。 */
export const CHECK_NAME_SAMPLE = 20;

/** 条目数超过这个值就以**紧凑 JSON** 落盘（10974 条 × 2 空格缩进 = 几十 MB，没人读得动，还占仓库）。 */
export const PRETTY_MAX_ENTRIES = 500;

/** 归一化字段 → 允许的源键名（第一个是快照里用的规范名）。 */
export const FIELD_ALIASES = {
  name: ['name', 'displayName', 'title', 'label'],
  owner: ['owner', 'author', 'publisher', 'maintainer'],
  npm: ['npm', 'package', 'packageName', 'pkg', 'module'],
  version: ['version'],
  url: ['url', 'repo', 'repository'],
  page: ['page', 'details', 'homepage', 'link', 'site'],
  description: ['description', 'desc', 'summary', 'intro'],
  category: ['category', 'categories', 'group', 'kind'],
  capabilities: ['capabilities', 'capability', 'features'],
  capabilityRedLines: ['capabilityRedLines', 'redLines', 'redlines', 'capabilityRisks'],
  capabilityCheckedAt: ['capabilityCheckedAt'],
  stars: ['stars', 'star', 'starsCount'],
  downloads: ['downloads', 'downloadCount', 'installs'],
  install: ['install', 'installCmd', 'installCommand'],
  added: ['added', 'addedAt', 'createdAt', 'publishedAt'],
};

/** v2 规范字段全集（`--check` 用它判断「条目里有没有放不认识的键」）。 */
export const CANONICAL_KEYS = [
  'key',
  'name',
  'owner',
  'npm',
  'version',
  'category',
  'descriptionZh',
  'descriptionEn',
  'description', // 兼容字段 = descriptionZh ?? descriptionEn（老调用点不读 zh/en 也能用）
  'capabilities',
  'capabilityRedLines',
  'capabilityCheckedAt',
  'stars',
  'downloads',
  'install',
  'page',
  'url',
  'added',
];

/** 别名全集：判断「这个原始键认不认识」用（含 v2 规范名，保证再归一化幂等）。 */
const KNOWN_KEYS = new Set([...Object.values(FIELD_ALIASES).flat(), ...CANONICAL_KEYS]);

/** 已有规范字段之外、快照自身用来装「不认识的键」的两个键（再归一化时必须原样带过去，不许套娃）。 */
const PASSTHROUGH_KEYS = new Set(['extra', 'unknownFields']);

/** 快照 `source` 里**必须存在**的五个键（任务卡逐字；值可以是 null，但键不能缺）。 */
export const SOURCE_REQUIRED_KEYS = ['url', 'fetchedAt', 'httpStatus', 'bytes', 'hostVersion'];

const USAGE = `_registry — 第三方市场快照：抓取 / 导入 / 校验（只连 loopback、零依赖）

用法：
  node tools/_registry.mjs --url <url> [--write]        从本机市场服务抓取（仅 loopback）
  node tools/_registry.mjs --from-file <path> [--write] 导入原始响应 / v2 快照
  node tools/_registry.mjs --check [--snapshot <path>]  校验现有快照结构（v2）
  node tools/_registry.mjs --help

选项：
  --url <url>        市场 registry 地址。**只允许** http://127.0.0.1:<port> / localhost / [::1]，
                     端口必须显式给出。默认形态：${DEFAULT_REGISTRY_URL_PATTERN}
  --max-bytes <n>    响应体上限（默认 ${DEFAULT_MAX_BYTES} = 64 MiB）。纯字节数，或带 k/m/g 后缀
                     （例：67108864 / 64MiB / 128m）。超限立即中止，不写半截快照。
  --from-file <path> 导入已保存的 JSON（**原始市场响应**或本工具写的 v2 快照，两种都能吃）
  --write            写入快照 ${DEFAULT_REGISTRY_SNAPSHOT}（唯一写动作；没有它只打印统计）
  --check            校验现有快照结构（不合规 exit 1）
  --snapshot <path>  配合 --check 校验别的文件（只读；不改变 --write 的目标）
  --json             统计以 JSON 输出（给 CI/断言）
  --help, -h         显示本帮助

响应形状（**运行时探测数组键，不写死**）：
  { "registry": { "<数组键>": [ … ] }, "hostVersion": "…" }   ← 真实市场形状（数组键 = plugins）
  { "<数组键>": [ … ] }  ｜  [ … ]  ｜  { "entries": [ … ] }
  数组键依次试 ${ARRAY_KEY_CANDIDATES.join(' / ')}，再退化为「容器对象里任意第一个数组值」；
  容器键依次试 ${CONTAINER_KEY_CANDIDATES.join(' / ')}。都不认 → 报错并列键名（不猜）。

归一化字段（v2）：key / name / owner / npm / version / category[] / descriptionZh / descriptionEn /
  capabilities[] / capabilityRedLines[] / capabilityCheckedAt / stars / downloads / install / page / url / added
  （description 是**对象** {en,zh} 时分别落到 descriptionEn / descriptionZh）
  认不出的键**原样保留**在条目 extra 里，并在 unknownFields 列出（不丢数据）。

退出码：
  0  跑通（含「部分条目进 malformed」——那要看统计，不是失败）
  1  参数错误 / 非 loopback / 请求失败 / 响应形状不认识 / 解析出 0 条 / 快照校验不通过 / 写盘失败

安全边界（硬约束，不许放宽）：
  · 只认 http + loopback 三主机；不跟随 3xx 重定向；不读 cookies/代理环境；不写入 loopback 之外
  · 写目标只有 data/registry.json（--snapshot 仅用于 --check 只读校验）`;

// ────────────────────────────────────────────────────────────── 小工具

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function isNonEmptyString(v) {
  return typeof v === 'string' && v.trim() !== '';
}

function hasOwn(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

function asStringArray(v) {
  if (Array.isArray(v)) {
    const out = [];
    for (const item of v) {
      if (typeof item !== 'string') continue;
      const s = item.trim();
      if (s && !out.includes(s)) out.push(s);
    }
    return out;
  }
  if (typeof v === 'string') {
    return v
      .split(/[,，;；\s]+/)
      .map((s) => s.trim())
      .filter(Boolean)
      .filter((s, i, arr) => arr.indexOf(s) === i);
  }
  return [];
}

/**
 * 文本归一：字符串/number 直接取；`{zh,en}` 之类的本地化对象取第一个可用值。
 * 真实数据里 `owner` 偶尔是对象 → 也走这里（不猜语义，只取它自己写明的名字）。
 */
function textOf(v) {
  if (isNonEmptyString(v)) return v.trim();
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  if (isPlainObject(v)) {
    for (const key of ['zh', 'en', 'name', 'title', 'label', 'login', 'id', 'text']) {
      if (isNonEmptyString(v[key])) return v[key].trim();
    }
  }
  return null;
}

/** 从 raw 里按别名取第一个可用字符串（不猜、不拼）。 */
function pickString(raw, aliases) {
  for (const key of aliases) {
    if (!hasOwn(raw, key)) continue;
    const s = textOf(raw[key]);
    if (s) return s;
  }
  return null;
}

/** 数字字段：number 直接用；数字字符串转；其余 null（不猜）。 */
function pickNumber(raw, aliases) {
  for (const key of aliases) {
    if (!hasOwn(raw, key)) continue;
    const v = raw[key];
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  }
  return null;
}

/** 字符串数组字段：数组（字符串或 `{name}` 这类对象）/逗号分隔字符串 都能吃。 */
function pickList(raw, aliases) {
  for (const key of aliases) {
    if (!hasOwn(raw, key)) continue;
    const v = raw[key];
    if (Array.isArray(v)) {
      const out = [];
      for (const item of v) {
        const s = textOf(item);
        if (s && !out.includes(s)) out.push(s);
      }
      if (out.length > 0) return out;
      continue;
    }
    const s = textOf(v);
    if (s) {
      const list = asStringArray(s);
      if (list.length > 0) return list;
    }
  }
  return [];
}

/** 本地化描述 → `{zh, en}`。字符串形态按「含中文 → zh，否则 en」落位（不编造另一种语言）。 */
function pickDescription(raw, aliases) {
  for (const key of aliases) {
    if (!hasOwn(raw, key)) continue;
    const v = raw[key];
    if (isPlainObject(v)) {
      const zh = textOf(v.zh);
      const en = textOf(v.en);
      if (zh || en) return { zh, en };
      continue;
    }
    const s = textOf(v);
    if (s) {
      const hasCjk = /[\u4e00-\u9fff]/.test(s);
      return { zh: hasCjk ? s : null, en: hasCjk ? null : s };
    }
  }
  return { zh: null, en: null };
}

/** `install` 原样保留（可能是字符串命令，也可能是 `{command,…}` 对象）：只做「空值 → null」。 */
function pickInstall(raw, aliases) {
  for (const key of aliases) {
    if (!hasOwn(raw, key)) continue;
    const v = raw[key];
    if (v === null || v === undefined) continue;
    if (typeof v === 'string' && v.trim() === '') continue;
    return v;
  }
  return null;
}

// ────────────────────────────────────────────────────────────── loopback 白名单

/**
 * 校验 URL 是否在 loopback 白名单内。**不合格就抛 CliError（exit 1）**，绝不「降级成通用 HTTP 客户端」。
 *
 * @param {string} raw
 * @returns {URL}
 */
export function assertLoopbackUrl(raw) {
  const text = String(raw === null || raw === undefined ? '' : raw).trim();
  if (!text) {
    throw new CliError(`缺少 --url：默认形态是 ${DEFAULT_REGISTRY_URL_PATTERN}，端口必须由你传入（本工具不猜端口）`);
  }
  let u;
  try {
    u = new URL(text);
  } catch {
    throw new CliError(`--url 不是合法 URL：${text}（形如 ${DEFAULT_REGISTRY_URL_PATTERN}）`);
  }
  if (u.protocol !== 'http:') {
    throw new CliError(`仅允许 loopback：协议必须是 http:（收到 ${u.protocol}）—— 本工具只取本机市场的 http 地址`);
  }
  if (u.username || u.password) {
    throw new CliError('仅允许 loopback：URL 不允许带用户名/口令（本工具不保存任何凭据）');
  }
  const host = u.hostname.toLowerCase();
  const normalized = host === '::1' ? '[::1]' : host;
  if (!LOOPBACK_HOSTS.includes(normalized)) {
    throw new CliError(
      `仅允许 loopback：收到主机「${u.hostname}」，白名单只有 ${LOOPBACK_HOSTS.join(' / ')}（本工具不是通用 HTTP 客户端）`,
    );
  }
  if (!u.port) {
    throw new CliError(`仅允许 loopback 且端口必须显式给出（例 ${DEFAULT_REGISTRY_URL_PATTERN}）—— 本工具不猜端口`);
  }
  return u;
}

// ────────────────────────────────────────────────────────────── 形状识别

/** 在一个对象里找「装着条目数组」的键：先按候选顺序，再退化为任意第一个数组值。 */
function probeArrayKey(obj) {
  for (const key of ARRAY_KEY_CANDIDATES) {
    if (Array.isArray(obj[key])) return key;
  }
  for (const key of Object.keys(obj)) {
    if (Array.isArray(obj[key])) return key;
  }
  return null;
}

function pickHostVersion(payload, holder) {
  const direct = textOf(payload && payload.hostVersion);
  if (direct) return direct;
  return textOf(holder && holder.hostVersion);
}

/** 容器对象自带的元信息（真实数据里有 name/url/source/updated/count/categories）。 */
function registryInfoOf(holder) {
  if (!isPlainObject(holder)) return null;
  const info = {
    name: textOf(holder.name),
    url: textOf(holder.url),
    source: textOf(holder.source),
    updated: textOf(holder.updated),
    declaredCount: pickNumber(holder, ['count']),
    categoryCount: isPlainObject(holder.categories) ? Object.keys(holder.categories).length : null,
  };
  if (Object.values(info).every((v) => v === null)) return null;
  return info;
}

/**
 * 识别响应形状。**顺序**：裸数组 → 顶层数组键（候选顺序 + 任意数组值）→ 容器对象里的数组键。
 * 都不认 → 抛错（连同顶层键、容器键一起报，方便定位），不猜。
 *
 * @returns {{shape: string, items: unknown[], arrayKey: string|null, containerKey: string|null,
 *            hostVersion: string|null, registryInfo: object|null}}
 */
export function detectShape(payload) {
  if (Array.isArray(payload)) {
    return { shape: 'bare-array', items: payload, arrayKey: null, containerKey: null, hostVersion: null, registryInfo: null };
  }
  if (!isPlainObject(payload)) {
    throw new CliError(
      `响应形状不认识（顶层是 ${payload === null ? 'null' : typeof payload}）—— 只认 {registry:{<数组键>:[…]}} / {<数组键>:[…]} / […]`,
    );
  }

  // ① 顶层直接就是数组键（老的 {plugins:[…]} / {entries:[…]}）
  const topKey = probeArrayKey(payload);
  if (topKey) {
    return {
      shape: `${topKey}-array`,
      items: payload[topKey],
      arrayKey: topKey,
      containerKey: null,
      hostVersion: pickHostVersion(payload, null),
      registryInfo: null,
    };
  }

  // ② 容器对象（真实数据：{registry:{…, plugins:[…]}, hostVersion}）
  const containerKeys = [];
  for (const key of CONTAINER_KEY_CANDIDATES) {
    if (isPlainObject(payload[key]) && !containerKeys.includes(key)) containerKeys.push(key);
  }
  for (const key of Object.keys(payload)) {
    if (isPlainObject(payload[key]) && !containerKeys.includes(key)) containerKeys.push(key);
  }
  for (const containerKey of containerKeys) {
    const holder = payload[containerKey];
    const holderArrayKey = probeArrayKey(holder);
    if (!holderArrayKey) continue;
    return {
      shape: `${containerKey}>${holderArrayKey}`,
      items: holder[holderArrayKey],
      arrayKey: holderArrayKey,
      containerKey,
      hostVersion: pickHostVersion(payload, holder),
      registryInfo: registryInfoOf(holder),
    };
  }

  const topKeys = Object.keys(payload);
  const containerHint = containerKeys.length > 0 ? `容器键 ${containerKeys.slice(0, 6).join('、')} 里也没有数组` : '没有可识别的容器对象';
  throw new CliError(
    `响应形状不认识（顶层键：${topKeys.length === 0 ? '无' : topKeys.slice(0, 8).join('、')}；${containerHint}）—— 数组键只认 ${ARRAY_KEY_CANDIDATES.join(' / ')} 或任意第一个数组值，不猜`,
  );
}

// ────────────────────────────────────────────────────────────── 归一化

/**
 * 已经是 v2 规范形态？（`loadRegistry` 每次都要重新归一化 10974 条，走快路径否则白烧 CPU）
 * 判定很严：规范键齐全 **且** 没有任何规范外的键（有 → 走慢路径，保证不静默丢字段）。
 */
function isCanonicalV2(raw) {
  if (!isPlainObject(raw)) return false;
  if (!hasOwn(raw, 'key') || !hasOwn(raw, 'descriptionZh') || !hasOwn(raw, 'descriptionEn') || !hasOwn(raw, 'description')) return false;
  if (!Array.isArray(raw.category) || !Array.isArray(raw.capabilities) || !Array.isArray(raw.capabilityRedLines)) return false;
  if (!Array.isArray(raw.unknownFields) || !isPlainObject(raw.extra)) return false;
  for (const key of Object.keys(raw)) {
    if (!KNOWN_KEYS.has(key) && !PASSTHROUGH_KEYS.has(key)) return false;
  }
  return true;
}

/** 规范形态 → 直接复制（快路径；字段一个不少，只是不重跑别名表）。 */
function copyCanonicalEntry(raw) {
  const entry = {};
  for (const key of CANONICAL_KEYS) {
    entry[key] = hasOwn(raw, key) ? raw[key] : null;
  }
  entry.category = Array.isArray(raw.category) ? raw.category : [];
  entry.capabilities = Array.isArray(raw.capabilities) ? raw.capabilities : [];
  entry.capabilityRedLines = Array.isArray(raw.capabilityRedLines) ? raw.capabilityRedLines : [];
  entry.unknownFields = raw.unknownFields;
  entry.extra = raw.extra;
  return entry;
}

/**
 * 单条归一化（v2）。字段不认识 → 进 `extra` 原样保留 + `unknownFields` 列出。
 * 幂等：对已经是 v2 规范形态的条目再跑一次，`extra` / `unknownFields` 原样保留（不会套娃）。
 * 一个可用字段都没有 → 进 malformed（不编造）。
 */
export function normalizeEntry(raw, index) {
  if (!isPlainObject(raw)) {
    return {
      ok: false,
      index,
      reason: `第 ${index} 条不是 JSON 对象（是 ${raw === null ? 'null' : Array.isArray(raw) ? 'array' : typeof raw}）`,
      raw,
    };
  }

  // 快路径：已经是 v2 规范形态 → 直接复制（10974 条快照每次加载都要过一遍，慢路径的别名表没必要重跑）
  if (isCanonicalV2(raw)) {
    return { ok: true, index, entry: copyCanonicalEntry(raw) };
  }

  const name = pickString(raw, FIELD_ALIASES.name);
  const owner = pickString(raw, FIELD_ALIASES.owner);
  const npm = pickString(raw, FIELD_ALIASES.npm);
  const version = pickString(raw, FIELD_ALIASES.version);
  const url = pickString(raw, FIELD_ALIASES.url);
  const page = pickString(raw, FIELD_ALIASES.page);
  const category = pickList(raw, FIELD_ALIASES.category);
  const capabilities = pickList(raw, FIELD_ALIASES.capabilities);
  const capabilityRedLines = pickList(raw, FIELD_ALIASES.capabilityRedLines);
  const capabilityCheckedAt = pickString(raw, FIELD_ALIASES.capabilityCheckedAt);
  const stars = pickNumber(raw, FIELD_ALIASES.stars);
  const downloads = pickNumber(raw, FIELD_ALIASES.downloads);
  const install = pickInstall(raw, FIELD_ALIASES.install);
  const added = pickString(raw, FIELD_ALIASES.added);

  // 描述：已是 v2 规范字段（descriptionZh/descriptionEn）就原样接住（幂等）；否则从原始 description 拆
  let descriptionZh = null;
  let descriptionEn = null;
  if (hasOwn(raw, 'descriptionZh') || hasOwn(raw, 'descriptionEn')) {
    descriptionZh = textOf(raw.descriptionZh);
    descriptionEn = textOf(raw.descriptionEn);
    if (!descriptionZh && !descriptionEn) {
      const legacy = pickDescription(raw, FIELD_ALIASES.description);
      descriptionZh = legacy.zh;
      descriptionEn = legacy.en;
    }
  } else {
    const desc = pickDescription(raw, FIELD_ALIASES.description);
    descriptionZh = desc.zh;
    descriptionEn = desc.en;
  }
  const description = descriptionZh || descriptionEn;

  // 条目唯一键：npm > owner/name > name（用于去重与报告定位；不是市场给的字段，是本工具算的）
  const key = npm || (owner && name ? `${owner}/${name}` : name);

  const extra = {};
  const unknownFields = [];
  // 先继承已经归一化的内容（幂等）
  if (isPlainObject(raw.extra)) {
    for (const [k, v] of Object.entries(raw.extra)) extra[k] = v;
  }
  if (Array.isArray(raw.unknownFields)) {
    for (const f of raw.unknownFields) {
      if (typeof f === 'string' && f.trim() && !unknownFields.includes(f.trim())) unknownFields.push(f.trim());
    }
  }
  // 再把本轮新看到的键并进来
  for (const rawKey of Object.keys(raw)) {
    if (KNOWN_KEYS.has(rawKey) || PASSTHROUGH_KEYS.has(rawKey)) continue;
    extra[rawKey] = raw[rawKey];
    if (!unknownFields.includes(rawKey)) unknownFields.push(rawKey);
  }
  unknownFields.sort(cmp);

  const usable = [key, name, npm, url, page, description, owner].filter((x) => x !== null && String(x).trim() !== '').length;
  if (usable === 0) {
    return {
      ok: false,
      index,
      reason: `第 ${index} 条没有可归一化的字段（key/name/npm/owner/url/page/description 全缺）`,
      raw,
    };
  }

  return {
    ok: true,
    index,
    entry: {
      key,
      name,
      owner,
      npm,
      version,
      category,
      descriptionZh,
      descriptionEn,
      description,
      capabilities,
      capabilityRedLines,
      capabilityCheckedAt,
      stars,
      downloads,
      install,
      page,
      url,
      added,
      unknownFields,
      extra,
    },
  };
}

/**
 * 整包归一化：形状识别 + 逐条归一化 + 未知字段并集。
 * **不截断、不抽样**：数组里有多少条就归一化多少条。
 *
 * @returns {{shape: string, arrayKey: string|null, containerKey: string|null, hostVersion: string|null,
 *            registryInfo: object|null, entries: object[], malformed: object[], unknownFields: string[]}}
 */
export function normalizePayload(payload) {
  const detected = detectShape(payload);
  const entries = [];
  const malformed = [];
  const unknown = new Set();

  const items = detected.items;
  for (let i = 0; i < items.length; i += 1) {
    const r = normalizeEntry(items[i], i);
    if (!r.ok) {
      malformed.push({ index: r.index, reason: r.reason, raw: r.raw === undefined ? null : r.raw });
      continue;
    }
    for (const f of r.entry.unknownFields) unknown.add(f);
    entries.push(r.entry);
  }

  return {
    shape: detected.shape,
    arrayKey: detected.arrayKey,
    containerKey: detected.containerKey,
    hostVersion: detected.hostVersion,
    registryInfo: detected.registryInfo,
    entries,
    malformed,
    unknownFields: [...unknown].sort(cmp),
  };
}

/** 快照体（唯一落盘结构，schemaVersion 2）。 */
export function buildSnapshot({ shape, arrayKey, containerKey, hostVersion, registryInfo, entries, malformed, unknownFields, source }) {
  return {
    schemaVersion: REGISTRY_SCHEMA_VERSION,
    source: {
      ...source,
      hostVersion: hostVersion === undefined ? null : hostVersion,
      shape: shape === undefined ? null : shape,
      arrayKey: arrayKey === undefined ? null : arrayKey,
      containerKey: containerKey === undefined ? null : containerKey,
      registry: registryInfo === undefined ? null : registryInfo,
    },
    count: entries.length,
    entries,
    malformed,
    unknownFields,
  };
}

// ────────────────────────────────────────────────────────────── loopback HTTP（只 GET）

/**
 * 只读 GET loopback。**不跟随重定向**、有超时与体积上限、失败即抛 CliError。
 * 响应体**流式累加**（C.3.1）：`data` 事件只 push 分块，结束后一次性 `Buffer.concat`；
 * 累计超过 `maxBytes` 立即 `req.destroy()`（不写半截快照）。
 *
 * @returns {Promise<{httpStatus: number, bytes: number, json: unknown, text: string}>}
 */
function httpGetJson(urlObj, maxBytes = MAX_BYTES) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const done = (fn, value) => {
      if (settled) return;
      settled = true;
      fn(value);
    };

    const req = http.request(
      {
        protocol: urlObj.protocol,
        hostname: urlObj.hostname.replace(/^\[|\]$/g, ''),
        port: urlObj.port,
        path: `${urlObj.pathname}${urlObj.search}`,
        method: 'GET',
        headers: {
          accept: 'application/json',
          'user-agent': 'lab-guide-registry/2 (loopback only)',
        },
        timeout: HTTP_TIMEOUT_MS,
      },
      (res) => {
        const status = typeof res.statusCode === 'number' ? res.statusCode : 0;

        if (status >= 300 && status < 400) {
          res.resume();
          done(
            reject,
            new CliError(
              `拒绝跟随重定向（HTTP ${status} → ${res.headers.location || '(无 Location)'}）：只允许直连 loopback，重定向可能把请求带出本机`,
            ),
          );
          return;
        }

        if (status !== 200) {
          const chunks = [];
          let size = 0;
          res.on('data', (c) => {
            size += c.length;
            if (size <= 4096) chunks.push(c);
          });
          res.on('end', () => {
            if (settled) return;
            const body = Buffer.concat(chunks).toString('utf8').slice(0, ERROR_BODY_ECHO);
            done(reject, new CliError(`HTTP ${status}：响应体前 ${ERROR_BODY_ECHO} 字符「${body || '(空)'}」（端口/路径对不对？市场起了没？）`));
          });
          res.on('error', (err) => done(reject, new CliError(`读响应失败：${describeFsError(err)}`)));
          return;
        }

        // 200：流式累加（分块只 push，最后一次性 concat —— 避免多份拷贝）
        const chunks = [];
        let size = 0;
        res.on('data', (c) => {
          if (settled) return; // 超限已中止：后面到的分块直接丢，不再累加
          size += c.length;
          if (size > maxBytes) {
            chunks.length = 0; // 立刻释放已累积分块，不留半截数据
            req.destroy();
            done(
              reject,
              new CliError(
                `响应超过 ${maxBytes} 字节上限 → 中止（不写半截快照）；响应确实更大时用 --max-bytes <n> 显式放开（例 --max-bytes 134217728）`,
              ),
            );
            return;
          }
          chunks.push(c);
        });
        res.on('end', () => {
          if (settled) return;
          const buf = Buffer.concat(chunks, size);
          chunks.length = 0;
          const text = buf.toString('utf8');
          try {
            const json = JSON.parse(text);
            done(resolve, { httpStatus: status, bytes: size, json, text });
          } catch (err) {
            const msg = err && err.message ? err.message : String(err);
            done(reject, new CliError(`响应不是合法 JSON（${msg}）；前 ${ERROR_BODY_ECHO} 字符：${text.slice(0, ERROR_BODY_ECHO)}`));
          }
        });
        res.on('error', (err) => done(reject, new CliError(`读响应失败：${describeFsError(err)}`)));
      },
    );

    req.on('timeout', () => {
      req.destroy();
      done(reject, new CliError(`请求 loopback 超时（${HTTP_TIMEOUT_MS}ms）→ 市场进程没起或端口不对（本工具不猜端口）`));
    });
    req.on('error', (err) => {
      const msg = err && err.message ? err.message : String(err);
      done(reject, new CliError(`请求 loopback 失败：${msg}（市场进程没起？端口对不对？本工具不猜端口）`));
    });
    req.end();
  });
}

// ────────────────────────────────────────────────────────────── 读文件（导入 / 校验）

/**
 * 读一个 JSON 文件并归一化成快照体。两种来源都吃：
 *   ① **原始市场响应**（`{registry:{plugins:[…]}, hostVersion}` / `{plugins:[…]}` / `[…]` / `{entries:[…]}`）；
 *   ② 本工具写的 **v2 快照**（`schemaVersion:2` + `entries`）。
 * v1 快照（含旧夹具）→ **明确报错**（它是本轮保留的负例：v1 会把对象形态的 description 静默丢掉）。
 * 解析出 0 条 → 抛错（绝不返回空快照）。
 */
export function snapshotFromFile(filePath) {
  const abs = path.resolve(filePath);
  const read = readText(abs);
  if (!read.ok) throw new CliError(`读不到文件：${abs}（${read.reason}）`);
  let value;
  try {
    value = JSON.parse(read.text);
  } catch (err) {
    throw new CliError(`文件不是合法 JSON：${abs}（${err && err.message ? err.message : String(err)}）`);
  }

  const isSnapshotShaped = isPlainObject(value) && value.schemaVersion !== undefined && Array.isArray(value.entries);
  let normalized;

  if (isSnapshotShaped) {
    if (value.schemaVersion !== REGISTRY_SCHEMA_VERSION) {
      throw new CliError(
        `快照 schemaVersion=${JSON.stringify(value.schemaVersion)}，本工具只认 ${REGISTRY_SCHEMA_VERSION}（C.3.2 起了新的 registry 形状与字段）→ 重新抓一次 --write；旧 v1 快照是把 description 当字符串理解的版本，用它会静默丢字段`,
      );
    }
    // 快照里的条目已经是规范名；再归一化一次是幂等的，顺带兼容手改过的文件
    const renormalized = normalizePayload({ entries: value.entries });
    normalized = {
      shape: value.source && typeof value.source.shape === 'string' ? value.source.shape : 'snapshot',
      arrayKey: value.source && typeof value.source.arrayKey === 'string' ? value.source.arrayKey : null,
      containerKey: value.source && typeof value.source.containerKey === 'string' ? value.source.containerKey : null,
      hostVersion: value.source && typeof value.source.hostVersion === 'string' ? value.source.hostVersion : null,
      registryInfo: value.source && isPlainObject(value.source.registry) ? value.source.registry : null,
      entries: renormalized.entries,
      malformed: Array.isArray(value.malformed) && value.malformed.length > 0 ? value.malformed : renormalized.malformed,
      unknownFields:
        renormalized.unknownFields.length > 0
          ? renormalized.unknownFields
          : Array.isArray(value.unknownFields)
            ? value.unknownFields
            : [],
    };
  } else if (isPlainObject(value) && value.schemaVersion !== undefined) {
    // 有 schemaVersion 但不是 v2 快照形态 → 说清楚，别猜
    throw new CliError(
      `文件带 schemaVersion=${JSON.stringify(value.schemaVersion)}，但没有 entries 数组 → 不是 v${REGISTRY_SCHEMA_VERSION} 快照；若是旧 v1 快照请重新抓一次 --write`,
    );
  } else {
    normalized = normalizePayload(value);
  }

  if (normalized.entries.length === 0) {
    throw new CliError(
      `文件里解析出 0 条 registry 条目：${abs}（malformed ${normalized.malformed.length} 条）→ 不写空快照、不返回空结果`,
    );
  }

  const bytes = Buffer.byteLength(read.text, 'utf8');
  return buildSnapshot({
    ...normalized,
    source: {
      kind: 'file',
      url: null,
      path: abs,
      fetchedAt: new Date().toISOString(),
      httpStatus: null,
      bytes,
      // 文件来源没有「响应上限」这个概念 → null（键在，值诚实为空）
      maxBytes: null,
    },
  });
}

// ────────────────────────────────────────────────────────────── 快照读写 / 查询

/** 条目多时用紧凑 JSON（10974 条 × 2 空格缩进几十 MB，没人读得动）；少时照旧好看。 */
export function serializeSnapshot(snapshot) {
  const big = Array.isArray(snapshot.entries) && snapshot.entries.length > PRETTY_MAX_ENTRIES;
  return `${big ? JSON.stringify(snapshot) : JSON.stringify(snapshot, null, 2)}\n`;
}

/** 写快照：唯一写动作，目标固定 data/registry.json（写目标守卫复用 B 阶段同一实现）。 */
export function writeSnapshot(snapshot, snapshotPath = DEFAULT_REGISTRY_SNAPSHOT) {
  if (!snapshot || !Array.isArray(snapshot.entries) || snapshot.entries.length === 0) {
    throw new CliError('拒绝写空快照：entries 为空（0 条）');
  }
  const abs = assertSafeLifecyclePath(snapshotPath, { profileDir: DEFAULT_PROFILE, labDir: DEFAULT_LAB });
  writeAtomic(abs, serializeSnapshot(snapshot));
  return abs;
}

/**
 * 读快照供 `lab-analyze` 使用（**只读、不联网**）。
 * 读不到 / 坏掉 / 空 / 版本不符 → `available:false` + 原因（调用方决定降级还是报错），**绝不返回空列表冒充成功**。
 */
export function loadRegistry(opts = {}) {
  const abs = path.resolve(opts.snapshotPath || DEFAULT_REGISTRY_SNAPSHOT);
  const warnings = [];
  const fail = (reason) => ({
    available: false,
    origin: 'none',
    path: abs,
    meta: null,
    entries: [],
    malformed: [],
    unknownFields: [],
    count: 0,
    reason,
    warnings,
  });

  const r = readJson(abs);
  if (!r.ok) {
    return fail(
      `registry 快照不可用：${abs}（${r.reason}）→ 第三方市场未参与；先跑 node tools/_registry.mjs --from-file <raw.json> --write（或 --url ${DEFAULT_REGISTRY_URL_PATTERN} --write）`,
    );
  }
  const v = r.value;
  const snapshotShaped = isPlainObject(v) && Array.isArray(v.entries) && v.schemaVersion !== undefined;
  if (snapshotShaped && v.schemaVersion !== REGISTRY_SCHEMA_VERSION) {
    return fail(
      `registry 快照 schemaVersion=${JSON.stringify(v.schemaVersion)}，本工具只认 ${REGISTRY_SCHEMA_VERSION}（C.3.2 起按真实市场字段重写）→ 重跑 --write`,
    );
  }
  if (isPlainObject(v) && v.schemaVersion !== undefined && !snapshotShaped) {
    return fail(`registry 快照没有 entries 数组（schemaVersion=${JSON.stringify(v.schemaVersion)}）→ 不是 v${REGISTRY_SCHEMA_VERSION} 快照，重跑 --write`);
  }
  if (snapshotShaped && v.count !== undefined && v.count !== v.entries.length) {
    warnings.push(`registry 快照的 count=${JSON.stringify(v.count)} 与 entries.length=${v.entries.length} 不一致 → 以 entries 实际条数为准（照实记录，不猜）`);
  }

  let normalized;
  try {
    if (snapshotShaped) {
      const re = normalizePayload({ entries: v.entries });
      normalized = {
        shape: v.source && typeof v.source.shape === 'string' ? v.source.shape : 'snapshot',
        entries: re.entries,
        malformed: Array.isArray(v.malformed) ? v.malformed : re.malformed,
        unknownFields: re.unknownFields,
      };
    } else {
      normalized = normalizePayload(v);
    }
  } catch (err) {
    const msg = err && err.message ? err.message : String(err);
    return fail(`registry 快照无法归一化：${abs}（${msg}）`);
  }

  if (normalized.entries.length === 0) {
    return fail(`registry 快照里 0 条可用条目（malformed ${normalized.malformed.length} 条）→ 不拿空快照冒充「市场没有插件」`);
  }

  const meta = snapshotShaped && isPlainObject(v.source) ? v.source : null;
  return {
    available: true,
    origin: snapshotShaped ? 'snapshot' : 'raw-file',
    path: abs,
    meta: meta
      ? {
          kind: typeof meta.kind === 'string' ? meta.kind : null,
          url: typeof meta.url === 'string' ? meta.url : null,
          fetchedAt: typeof meta.fetchedAt === 'string' ? meta.fetchedAt : null,
          httpStatus: typeof meta.httpStatus === 'number' ? meta.httpStatus : null,
          bytes: typeof meta.bytes === 'number' ? meta.bytes : null,
          maxBytes: typeof meta.maxBytes === 'number' ? meta.maxBytes : null,
          hostVersion: typeof meta.hostVersion === 'string' ? meta.hostVersion : null,
          shape: typeof meta.shape === 'string' ? meta.shape : null,
          arrayKey: typeof meta.arrayKey === 'string' ? meta.arrayKey : null,
          containerKey: typeof meta.containerKey === 'string' ? meta.containerKey : null,
          registry: isPlainObject(meta.registry) ? meta.registry : null,
        }
      : null,
    entries: normalized.entries,
    malformed: normalized.malformed,
    unknownFields: normalized.unknownFields,
    count: normalized.entries.length,
    reason: null,
    warnings,
  };
}

/** registry 条目的可比对文本（小写）：包名 / 显示名 / 中英描述 / 能力 / 分类。 */
export function registryHaystack(entry) {
  if (!entry || typeof entry !== 'object') return '';
  const caps = Array.isArray(entry.capabilities) ? entry.capabilities.join(' ') : '';
  return [
    entry.npm || '',
    entry.name || '',
    entry.owner || '',
    entry.descriptionZh || '',
    entry.descriptionEn || '',
    caps,
    Array.isArray(entry.category) ? entry.category.join(' ') : '',
  ]
    .join('\n')
    .toLowerCase();
}

/**
 * 包名 → registry 条目。命中顺序与 `_catalog.lookupEntry` 同口径（**不猜**）：
 *   exact（npm 全等）→ basename（去 scope 的短名唯一命中）→ 未命中（多候选就只给 candidates）。
 */
export function lookupRegistry(registry, pkg) {
  const empty = { hit: false, match: null, key: null, entry: null, candidates: [], reason: null };
  if (!registry || registry.available !== true || !Array.isArray(registry.entries) || !pkg) return empty;
  const name = String(pkg).trim();
  if (!name) return empty;

  const exact = registry.entries.filter((p) => p.npm === name);
  if (exact.length === 1) return { hit: true, match: 'exact', key: name, entry: exact[0], candidates: [name], reason: null };
  if (exact.length > 1) {
    return { ...empty, candidates: [name], reason: `registry 里有 ${exact.length} 条同 npm「${name}」→ 不猜` };
  }

  // GitHub-only 条目（npm 为 null）的主键是 key=owner/name：先按 key 全等再试一次，
  // 否则这半个市场（快照 10974 条里 5331 条）在 analyze 路径上永远显示「registry 里没有它」。
  const lowered = name.toLowerCase();
  const exactKey = registry.entries.filter((p) => typeof p.key === 'string' && p.key.toLowerCase() === lowered);
  if (exactKey.length === 1) {
    return { hit: true, match: 'key', key: exactKey[0].key, entry: exactKey[0], candidates: [exactKey[0].key], reason: null };
  }
  if (exactKey.length > 1) {
    return { ...empty, candidates: exactKey.map((p) => p.key), reason: `registry 里有 ${exactKey.length} 条同 key「${name}」→ 不猜` };
  }

  const base = name.split('/').pop();
  if (!base) return empty;
  const cands = registry.entries
    .filter((p) => typeof p.npm === 'string' && p.npm.split('/').pop() === base)
    .map((p) => p.npm)
    .sort(cmp);
  if (cands.length === 1) {
    const entry = registry.entries.find((p) => p.npm === cands[0]);
    return { hit: true, match: 'basename', key: cands[0], entry, candidates: cands, reason: null };
  }
  if (cands.length > 1) {
    return { hit: false, match: null, key: null, entry: null, candidates: cands, reason: `短名「${base}」命中 ${cands.length} 个 registry 条目 → 不猜` };
  }

  // npm 短名一条都没有 → 再用 key 的短名兜底（同样只认唯一命中，多候选仍然不猜）
  const keyCands = registry.entries
    .filter((p) => typeof p.key === 'string' && p.key.split('/').pop() === base)
    .map((p) => p.key)
    .sort(cmp);
  if (keyCands.length === 1) {
    const entry = registry.entries.find((p) => p.key === keyCands[0]);
    return { hit: true, match: 'key', key: keyCands[0], entry, candidates: keyCands, reason: null };
  }
  if (keyCands.length > 1) {
    return {
      hit: false,
      match: null,
      key: null,
      entry: null,
      candidates: keyCands,
      reason: `短名「${base}」在 key 里命中 ${keyCands.length} 个 registry 条目 → 不猜`,
    };
  }
  return empty;
}

/**
 * registry 内搜索：包名 / 显示名 / 中英描述 / 能力 / 分类，大小写不敏感，多词 AND。
 *
 * 注意：`lab-analyze` 的 `--search` / `--goal` **不走这个函数** —— 三源合并要求 registry / catalog /
 * 已装用**同一个**可比对文本口径（`candidateHaystack`），否则「同一句话在三个来源里命中不同」就成了第二个真相。
 * 这里保留它，是给「只想查 registry 快照」的调用方（脚本 / 将来 CLI）用的单一实现。
 */
export function searchRegistry(registry, query) {
  const tokens = String(query === null || query === undefined ? '' : query)
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => t.toLowerCase());
  const list = registry && registry.available === true && Array.isArray(registry.entries) ? registry.entries : [];
  const total = list.length;
  if (tokens.length === 0) return { tokens, matches: [], total };

  const matches = [];
  for (const p of list) {
    const hay = registryHaystack(p);
    if (!tokens.every((t) => hay.includes(t))) continue;
    matches.push({
      pkg: p.npm || p.name || '(无包名)',
      npm: p.npm,
      name: p.name,
      description: p.description,
      capabilities: p.capabilities,
      category: p.category,
    });
  }
  matches.sort((a, b) => cmp(a.pkg, b.pkg));
  return { tokens, matches, total };
}

// ────────────────────────────────────────────────────────────── --check 校验

/**
 * 校验快照结构（不联网、不改文件）。返回 `{ok, reason, diffs, count, malformedCount, unknownFieldCount}`；
 * `ok:false` 时 CLI exit 1 并打印前 20 处问题（不许静默通过）。
 *
 * v2 校验项：
 *   1. `schemaVersion === 2`（v1 快照 —— 含旧夹具 —— 一律失败，这是**负例**）；
 *   2. `source` 是对象：`url / fetchedAt / httpStatus / bytes / hostVersion` 五个键**必须存在**（值可 null），
 *      `kind ∈ {http,file}`、`fetchedAt` 非空字符串；`maxBytes` 存在时必须是数字或 null；
 *   3. `entries / malformed / unknownFields` 都是数组；
 *   4. `count === entries.length` 且 `entries.length > 0`（空快照不算通过）；
 *   5. **抽样**：前 ${CHECK_NAME_SAMPLE} 条必须有非空 `name`；
 *   6. 每条：键只能是 v2 规范字段 + `unknownFields` + `extra`；`category / capabilities / capabilityRedLines /
 *      unknownFields` 是数组、`extra` 是对象、`stars / downloads` 是数字或 null。
 */
export function checkSnapshot(snapshotPath = DEFAULT_REGISTRY_SNAPSHOT) {
  const abs = path.resolve(snapshotPath);
  const r = readJson(abs);
  const out = { path: abs, ok: false, reason: null, diffs: [], count: 0, malformedCount: 0, unknownFieldCount: 0, nameSample: CHECK_NAME_SAMPLE };
  if (!r.ok) {
    out.reason = `读不到快照：${abs}（${r.reason}）`;
    return out;
  }
  const v = r.value;
  if (!isPlainObject(v)) {
    out.reason = '快照顶层不是 JSON 对象';
    return out;
  }
  const diffs = [];
  if (v.schemaVersion !== REGISTRY_SCHEMA_VERSION) {
    diffs.push({
      where: 'schemaVersion',
      detail: `=${JSON.stringify(v.schemaVersion)}，应为 ${REGISTRY_SCHEMA_VERSION}（v1 快照会把对象形态的 description 静默丢字段 → 必须重抓）`,
    });
  }
  if (!isPlainObject(v.source)) {
    diffs.push({ where: 'source', detail: '缺少 source 对象' });
  } else {
    if (!isNonEmptyString(v.source.fetchedAt)) diffs.push({ where: 'source.fetchedAt', detail: '缺失或不是非空字符串（ISO 时刻）' });
    if (v.source.kind !== 'http' && v.source.kind !== 'file') {
      diffs.push({ where: 'source.kind', detail: `=${JSON.stringify(v.source.kind)}，应为 http 或 file` });
    }
    for (const key of SOURCE_REQUIRED_KEYS) {
      if (!hasOwn(v.source, key)) diffs.push({ where: `source.${key}`, detail: '字段缺失（值可以是 null，但键必须在）' });
    }
    if (hasOwn(v.source, 'maxBytes') && v.source.maxBytes !== null && typeof v.source.maxBytes !== 'number') {
      diffs.push({ where: 'source.maxBytes', detail: `=${JSON.stringify(v.source.maxBytes)}，应为数字或 null` });
    }
    if (hasOwn(v.source, 'arrayKey') && v.source.arrayKey !== null && typeof v.source.arrayKey !== 'string') {
      diffs.push({ where: 'source.arrayKey', detail: `=${JSON.stringify(v.source.arrayKey)}，应为字符串或 null` });
    }
  }
  if (!Array.isArray(v.entries)) diffs.push({ where: 'entries', detail: '不是数组（v2 快照的条目数组叫 entries）' });
  if (!Array.isArray(v.malformed)) diffs.push({ where: 'malformed', detail: '不是数组' });
  if (!Array.isArray(v.unknownFields)) diffs.push({ where: 'unknownFields', detail: '不是数组' });

  const entries = Array.isArray(v.entries) ? v.entries : [];
  out.count = entries.length;
  out.malformedCount = Array.isArray(v.malformed) ? v.malformed.length : 0;
  out.unknownFieldCount = Array.isArray(v.unknownFields) ? v.unknownFields.length : 0;

  if (entries.length === 0) diffs.push({ where: 'entries', detail: '0 条 —— 空快照不算「校验通过」' });
  if (v.count !== entries.length) diffs.push({ where: 'count', detail: `=${JSON.stringify(v.count)}，与 entries.length=${entries.length} 不一致` });

  // 抽样：前 N 条必须有 name（任务卡口径）
  const sampleSize = Math.min(CHECK_NAME_SAMPLE, entries.length);
  for (let i = 0; i < sampleSize; i += 1) {
    const e = entries[i];
    if (!isPlainObject(e)) {
      diffs.push({ where: `entries[${i}]`, detail: '不是对象' });
      continue;
    }
    if (!isNonEmptyString(e.name)) diffs.push({ where: `entries[${i}].name`, detail: `抽样前 ${sampleSize} 条必须是非空 name（真实市场每条都有）` });
  }

  const known = new Set([...CANONICAL_KEYS, 'unknownFields', 'extra']);
  entries.forEach((p, i) => {
    if (!isPlainObject(p)) {
      diffs.push({ where: `entries[${i}]`, detail: '不是对象' });
      return;
    }
    for (const key of Object.keys(p)) {
      if (!known.has(key)) diffs.push({ where: `entries[${i}].${key}`, detail: '规范条目里出现未知键（应放在 extra 里）' });
    }
    for (const arrKey of ['category', 'capabilities', 'capabilityRedLines', 'unknownFields']) {
      if (!Array.isArray(p[arrKey])) diffs.push({ where: `entries[${i}].${arrKey}`, detail: '不是数组' });
    }
    if (!isPlainObject(p.extra)) diffs.push({ where: `entries[${i}].extra`, detail: '不是对象' });
    for (const numKey of ['stars', 'downloads']) {
      if (p[numKey] !== null && typeof p[numKey] !== 'number') {
        diffs.push({ where: `entries[${i}].${numKey}`, detail: `=${JSON.stringify(p[numKey])}，应为数字或 null` });
      }
    }
    const usable = ['key', 'name', 'npm', 'url', 'page', 'description', 'owner'].filter((k) => isNonEmptyString(p[k])).length;
    if (usable === 0) diffs.push({ where: `entries[${i}]`, detail: 'key/name/npm/owner/url/page/description 全空 → 应进 malformed 而不是 entries' });
  });

  out.diffs = diffs.slice(0, 20);
  out.diffTotal = diffs.length;
  out.ok = diffs.length === 0;
  out.reason = diffs.length === 0 ? null : `快照结构有 ${diffs.length} 处问题`;
  return out;
}

// ────────────────────────────────────────────────────────────── CLI

/**
 * 解析 `--max-bytes` 的取值：纯字节数，或带 k/m/g 后缀（1024 进制，大小写不敏感，可写 `64MiB`）。
 * 不合法 / 非正数一律抛 CliError（不静默退回默认值 —— 那会让人以为「已放开」其实没放开）。
 */
export function parseByteSize(raw, flag = '--max-bytes') {
  const text = String(raw === null || raw === undefined ? '' : raw).trim();
  const m = /^(\d+)\s*([kmg])?i?b?$/i.exec(text);
  if (!m) {
    throw new CliError(`参数 ${flag} 取值不合法：「${text}」（纯字节数或带 k/m/g 后缀，例 67108864 / 64MiB / 64m）`);
  }
  const unit = (m[2] || '').toLowerCase();
  const factor = unit === 'k' ? 1024 : unit === 'm' ? 1024 ** 2 : unit === 'g' ? 1024 ** 3 : 1;
  const bytes = Number(m[1]) * factor;
  if (!Number.isSafeInteger(bytes) || bytes <= 0) {
    throw new CliError(`参数 ${flag} 取值不合法：「${text}」→ 必须是正整数字节数`);
  }
  return bytes;
}

function takeValue(argv, i, name) {
  const next = argv[i + 1];
  if (next === undefined || (typeof next === 'string' && next.startsWith('--'))) {
    throw new CliError(`参数 ${name} 缺少取值`);
  }
  return next;
}

function parseArgs(argv) {
  const opts = { url: null, fromFile: null, write: false, check: false, json: false, help: false, snapshot: DEFAULT_REGISTRY_SNAPSHOT, maxBytes: DEFAULT_MAX_BYTES };
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
      case '--url':
        opts.url = value('--url');
        break;
      case '--max-bytes':
        opts.maxBytes = parseByteSize(value('--max-bytes'));
        break;
      case '--from-file':
        opts.fromFile = value('--from-file');
        break;
      case '--write':
        opts.write = true;
        break;
      case '--check':
        opts.check = true;
        break;
      case '--snapshot':
        opts.snapshot = value('--snapshot');
        break;
      case '--json':
        opts.json = true;
        break;
      default:
        throw new CliError(`未知参数：${raw}（见 --help）`);
    }
  }
  if (opts.help) return opts;
  if (opts.url && opts.fromFile) throw new CliError('--url 与 --from-file 不能同时使用（一次只用一种数据源）');
  if (opts.check && (opts.url || opts.fromFile || opts.write)) {
    throw new CliError('--check 只校验现有快照，不与 --url / --from-file / --write 同时使用');
  }
  if (!opts.check && !opts.url && !opts.fromFile) {
    throw new CliError(
      `缺少数据源：--url ${DEFAULT_REGISTRY_URL_PATTERN}（端口必须由你传入，本工具不猜端口）/ --from-file <path> / --check`,
    );
  }
  return opts;
}

function fieldCoverage(entries) {
  const cover = {
    name: 0,
    owner: 0,
    npm: 0,
    version: 0,
    category: 0,
    descriptionZh: 0,
    descriptionEn: 0,
    capabilities: 0,
    capabilityRedLines: 0,
    stars: 0,
    downloads: 0,
    install: 0,
    page: 0,
    url: 0,
    added: 0,
  };
  for (const e of entries) {
    if (isNonEmptyString(e.name)) cover.name += 1;
    if (isNonEmptyString(e.owner)) cover.owner += 1;
    if (isNonEmptyString(e.npm)) cover.npm += 1;
    if (isNonEmptyString(e.version)) cover.version += 1;
    if (Array.isArray(e.category) && e.category.length > 0) cover.category += 1;
    if (isNonEmptyString(e.descriptionZh)) cover.descriptionZh += 1;
    if (isNonEmptyString(e.descriptionEn)) cover.descriptionEn += 1;
    if (Array.isArray(e.capabilities) && e.capabilities.length > 0) cover.capabilities += 1;
    if (Array.isArray(e.capabilityRedLines) && e.capabilityRedLines.length > 0) cover.capabilityRedLines += 1;
    if (typeof e.stars === 'number') cover.stars += 1;
    if (typeof e.downloads === 'number') cover.downloads += 1;
    if (e.install !== null && e.install !== undefined) cover.install += 1;
    if (isNonEmptyString(e.page)) cover.page += 1;
    if (isNonEmptyString(e.url)) cover.url += 1;
    if (isNonEmptyString(e.added)) cover.added += 1;
  }
  return cover;
}

function formatSourceLine(snapshot) {
  const s = snapshot.source;
  if (s.kind === 'http') {
    return [`registry 源: ${s.url}`, `响应: HTTP ${s.httpStatus} ｜ ${s.bytes} 字节 ｜ 形状 ${s.shape} ｜ 数组键 ${s.arrayKey === null ? '(裸数组)' : s.arrayKey} ｜ hostVersion ${s.hostVersion === null ? 'null（响应未给）' : s.hostVersion}`];
  }
  return [
    `registry 源: 本地文件 ${s.path}（${s.bytes} 字节）`,
    `响应: HTTP ${s.httpStatus === null ? 'null（--from-file 导入，抓取时的状态码不可知）' : s.httpStatus} ｜ 形状 ${s.shape} ｜ 数组键 ${s.arrayKey === null ? '(裸数组)' : s.arrayKey} ｜ hostVersion ${s.hostVersion === null ? 'null（响应未给）' : s.hostVersion}`,
  ];
}

async function main(argv) {
  const opts = parseArgs(argv);
  if (opts.help) {
    process.stdout.write(`${USAGE}\n`);
    return;
  }

  if (opts.check) {
    const res = checkSnapshot(opts.snapshot);
    if (opts.json) {
      process.stdout.write(`${JSON.stringify(res, null, 2)}\n`);
    } else {
      const out = [];
      out.push(`快照: ${res.path}`);
      if (res.ok) {
        out.push(`check: OK —— 快照结构完整（${res.count} 条 ｜ malformed ${res.malformedCount} ｜ 未知字段 ${res.unknownFieldCount} 个）`);
      } else {
        out.push(`check: ${res.reason}`);
        for (const d of res.diffs) out.push(`  - ${d.where} ｜ ${d.detail}`);
        if (res.diffTotal > res.diffs.length) out.push(`  - …另有 ${res.diffTotal - res.diffs.length} 处`);
      }
      process.stdout.write(`${out.join('\n')}\n`);
    }
    if (!res.ok) process.exitCode = 1;
    return;
  }

  let snapshot;
  const startedAt = new Date().toISOString();

  if (opts.url) {
    const u = assertLoopbackUrl(opts.url);
    const res = await httpGetJson(u, opts.maxBytes);
    const normalized = normalizePayload(res.json);
    if (normalized.entries.length === 0) {
      throw new CliError(
        `解析出 0 条 registry 条目（HTTP ${res.httpStatus} ｜ ${res.bytes} 字节 ｜ 形状 ${normalized.shape} ｜ malformed ${normalized.malformed.length}）→ 不写空快照、不返回空结果`,
      );
    }
    snapshot = buildSnapshot({
      ...normalized,
      source: {
        kind: 'http',
        url: u.toString(),
        path: null,
        fetchedAt: startedAt,
        httpStatus: res.httpStatus,
        bytes: res.bytes,
        maxBytes: opts.maxBytes,
      },
    });
  } else {
    snapshot = snapshotFromFile(opts.fromFile);
    if (snapshot.entries.length === 0) throw new CliError('文件里解析出 0 条 registry 条目 → 不写空快照');
  }

  let wrotePath = null;
  if (opts.write) wrotePath = writeSnapshot(snapshot);

  const bigResponse = typeof snapshot.source.bytes === 'number' && snapshot.source.bytes > LARGE_RESPONSE_BYTES;
  const declared = snapshot.source.registry && typeof snapshot.source.registry.declaredCount === 'number' ? snapshot.source.registry.declaredCount : null;

  const stats = {
    source: snapshot.source,
    shape: snapshot.source.shape,
    arrayKey: snapshot.source.arrayKey,
    containerKey: snapshot.source.containerKey,
    hostVersion: snapshot.source.hostVersion,
    declaredCount: declared,
    count: snapshot.count,
    countMatchesDeclared: declared === null ? null : declared === snapshot.count,
    malformedCount: snapshot.malformed.length,
    malformed: snapshot.malformed.slice(0, 10),
    unknownFields: snapshot.unknownFields,
    fieldCoverage: fieldCoverage(snapshot.entries),
    snapshotPath: wrotePath || path.resolve(DEFAULT_REGISTRY_SNAPSHOT),
    wrote: wrotePath !== null,
    largeResponse: bigResponse,
    largeResponseThreshold: LARGE_RESPONSE_BYTES,
    schemaVersion: snapshot.schemaVersion,
  };

  if (opts.json) {
    process.stdout.write(`${JSON.stringify(stats, null, 2)}\n`);
    return;
  }

  const out = [...formatSourceLine(snapshot)];
  const cov = stats.fieldCoverage;
  out.push(
    `归一化: count ${stats.count} 条 ｜ malformed ${stats.malformedCount} 条 ｜ 未知字段 ${stats.unknownFields.length} 个${stats.unknownFields.length > 0 ? `（${stats.unknownFields.slice(0, 8).join('、')}${stats.unknownFields.length > 8 ? ' 等' : ''}，已原样保留在条目 extra 里）` : ''}`,
  );
  if (declared !== null) {
    out.push(`market 自报: source.registry.count=${declared} ｜ 本工具实读 entries ${stats.count} 条 → ${stats.countMatchesDeclared ? '一致' : '**不一致**（以实读为准，照实记录）'}`);
  }
  if (bigResponse) {
    out.push(
      `大响应: ${snapshot.source.bytes} 字节（> ${LARGE_RESPONSE_BYTES} 字节 = 8 MiB 阈值；本次上限 ${typeof snapshot.source.maxBytes === 'number' ? snapshot.source.maxBytes : DEFAULT_MAX_BYTES} 字节）｜ 解析出 count ${stats.count} 条 ｜ 快照已保留 source.bytes${stats.wrote ? '，已写盘' : ''}`,
    );
  }
  out.push(
    `字段覆盖: name ${cov.name} ｜ npm ${cov.npm} ｜ owner ${cov.owner} ｜ descriptionZh ${cov.descriptionZh} ｜ descriptionEn ${cov.descriptionEn} ｜ capabilities ${cov.capabilities} ｜ redLines ${cov.capabilityRedLines} ｜ category ${cov.category} ｜ stars ${cov.stars} ｜ downloads ${cov.downloads} ｜ install ${cov.install} ｜ page ${cov.page} ｜ url ${cov.url} ｜ added ${cov.added} ｜ version ${cov.version}`,
  );
  for (const m of stats.malformed) out.push(`  - malformed：${m.reason}`);
  if (stats.malformedCount > stats.malformed.length) out.push(`  - …另有 ${stats.malformedCount - stats.malformed.length} 条 malformed`);
  out.push(stats.wrote ? `已写快照: ${stats.snapshotPath}（schemaVersion ${snapshot.schemaVersion}）` : `快照: ${stats.snapshotPath}（未写；要写请加 --write）`);
  out.push(`registry: ${stats.count} 条 ｜ malformed ${stats.malformedCount} ｜ 未知字段 ${stats.unknownFields.length} ｜ source=${snapshot.source.kind}`);
  process.stdout.write(`${out.join('\n')}\n`);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  main(process.argv.slice(2)).catch((err) => {
    const msg = err && err.message ? err.message : String(err);
    process.stderr.write(`error: ${msg}\n`);
    process.exitCode = 1;
  });
}
// ============================================================================
// 学习注记：这个文件为什么写成这样
// ----------------------------------------------------------------------------
// 一、它解决的真实问题
//    一句话：离线目录只认官方模块（195 条），第三方市场里的插件它一条都不认识；
//    这个文件负责**由用户显式跑一次**，把本机市场服务返回的 registry 落成 data/registry.json，
//    让 lab-analyze 能只读一份快照就搜到第三方（真实规模 10,974 条）。
//    真实例子：真实响应是 `{registry:{…,plugins:[…]}, hostVersion}`，13,837,168 字节、HTTP 200，
//    其中单条条目的 description 是 `{en, zh}` **对象**——不是字符串。
//
// 二、关键设计取舍
//    1) 只允许 loopback（127.0.0.1 / localhost / [::1]）+ http + **显式端口**，且**不跟随重定向**。
//       因为这不是通用 HTTP 客户端：重定向完全可能把请求带出本机，跟随一次就等于把
//       「只连本机」这条承诺作废（3xx 直接报错并回显 Location）。
//    2) 响应体流式累加 + 上限（默认 64 MiB，--max-bytes 可覆盖），超限立即 req.destroy()。
//       因为 13.8 MB 的真实响应会打爆任何「先整体读进来再判断」的写法；而超限时写半截快照，
//       比干脆失败更糟。
//    3) 数组键**运行时探测**（plugins/entries/items/…，再退化为容器里第一个数组值），不写死。
//       因为形状是别人定义的；写死等于把「抓取失败」和「形状变了」混成同一个错误。
//    4) 认不出的字段原样保留在 `extra` + 列进 `unknownFields`，不丢、也不算分。
//       因为「不认识」不代表没用；静默丢字段是这类工具最难被发现的一类 bug。
//    5) 快照 schema 升到 v2，v1（含旧夹具）**明确拒绝**。因为 v1 把 description 当字符串理解，
//       在真实数据上会静默丢字段——它被保留为负例，`--check` 必须红。
//    6) 条目超过 500 条就写紧凑 JSON。因为 10,974 条 × 2 空格缩进是几十 MB，没人读得动。
//
// 三、主要函数导读（按调用顺序）
//    assertLoopbackUrl  — 白名单 + 协议 + 端口 + 无凭据 — 不合格直接抛错，绝不降级成通用客户端
//    httpGetJson        — 只读 GET：拒 3xx、超时、流式累加、超限中止 — 注意 settled 只结算一次
//    detectShape        — 裸数组 → 顶层数组键 → 容器里的数组键 — 都不认就报错并列键名
//    normalizeEntry     — 单条归一化（别名表 + 描述拆 zh/en + key 计算 + extra/unknownFields）
//    normalizePayload   — 整包归一化：不截断、不抽样 — malformed 逐条记原因
//    snapshotFromFile   — 吃「原始响应」或「v2 快照」两种文件 — v1 快照直接报错
//    writeSnapshot      — 唯一写动作，走 _lifecycle 的路径守卫，拒绝写空快照
//    loadRegistry       — 只读给 lab-analyze 用；不可用就 available:false + 原因
//    lookupRegistry     — 包名 → 条目：npm 全等 → key 全等 → npm 短名 → key 短名，多候选不猜
//    checkSnapshot      — 结构校验：schema / source 五个必备键 / count / 抽样 name / 未知键
//
// 四、踩过的坑
//    1) **description 当成字符串**是 C.3.1 最致命的一处假设错误：真实数据是 `{en, zh}` 对象，
//       按字符串归一化会把整段描述静默丢掉，报告看起来「成功」，内容却少了一半。
//       修法是升 v2 + 把 v1 快照留成负例，让 check 永远红。
//    2) 8 MiB 上限被真实响应（13.8 MB）打爆 → 上限改 64 MiB，并改成流式累加；
//       同时 `--max-bytes` 不合法时**报错**而不是静默退回默认值——否则人会以为「已放开」其实没放开。
//    3) **GitHub-only 条目查不到**（v1.0.1 修复）：快照里 10,974 条中有一半（5,331 条）没有 npm 名，
//       主键是 `owner/name`；而 analyze 原先只按 npm 匹配，于是「--search 搜得到、analyze 说没有」。
//       现在加 `key` 全等命中 + npm 短名 0 命中时用 key 短名兜底，仍只认唯一命中、多候选不猜。
//    4) 重定向、代理环境、cookies 一律不碰：一旦「顺手」支持，工具就从「读本机快照」变成
//       「任意 HTTP 客户端」，安全边界会在一行代码里消失。
//
// 五、读代码的建议顺序
//    文件头「三条硬约束」→ assertLoopbackUrl（边界）→ httpGetJson（怎么读）→ detectShape（形状）
//    → normalizeEntry（字段怎么落位，重点看 description 分支与 key 计算）→ lookupRegistry
//    （v1.0.1 的 key 命中在这里）→ checkSnapshot（结构契约）。
// ============================================================================
