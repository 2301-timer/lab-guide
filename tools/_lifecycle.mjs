/**
 * lab-guide / tools/_lifecycle.mjs — 生命周期条目（schema v1）读写 + 原子写 + schema 守卫
 *
 * 定位：B 阶段「生命周期状态机」的**唯一数据层**。`lab-triage.mjs`（CLI）与未来的脚本
 * （C 阶段维护卡、D 阶段巡检）都通过本模块读写 `data/lifecycle.json`，不各自手写 fs 逻辑。
 *
 * 三层职责：
 *   1. 读：`loadLifecycle` —— 只读 + JSON 解析，不猜、不补默认值（RULES §0 R-2）；
 *   2. 校验：`validateLifecycle` / `validateItem` —— schema 字段 + 不变式（见 data/schema.md）；
 *   3. 写：`saveLifecycle` —— **先校验再原子写**（tmp → rename）；违反不变式一律抛错、不落盘。
 *
 * 守卫（继承 A 阶段红线 R-1）：
 *   - 不写 lab 目录、不写 profile 目录、不写 `cordis.patch.yml`、不写 `.dsh-market`；
 *   - 写目标一律先过 `assertSafeLifecyclePath`；lab 侧只输出「建议」到 `out/`（仓库根相对）。
 *
 * 依赖：零第三方依赖；ESM；只用 node: 内置模块（解析口径复用 `_profile.mjs`）。
 * 语义权威：`../docs/RULES.md` §9 与 `../data/schema.md`。
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import { CliError, cmp, describeFsError, isInside, normalizePkgArg, readText } from './_profile.mjs';

// ────────────────────────────────────────────────────────────── schema v1 常量

export const SCHEMA_VERSION = 1;

/** 状态枚举。顺序即 list 的分组顺序，也是 schema.md 迁移表的行序。 */
export const STATES = ['candidate', 'trial', 'adopted', 'rejected', 'dormant'];

/** 条目类型；pkg 前缀必须与 kind 一致。 */
export const KINDS = ['plugin', 'skill', 'mcp', 'app'];

/** 非插件条目的主键前缀：`skill:xxx` / `mcp:xxx` / `app:xxx`；plugin 不带前缀。 */
export const KIND_PREFIX = { plugin: '', skill: 'skill:', mcp: 'mcp:', app: 'app:' };

/** evidence.type 枚举（与任务卡一致，不多不少）。 */
export const EVIDENCE_TYPES = ['drift', 'conflict', 'usage', 'note', 'update'];

/** reason 上限（按码点计，中文算 1 字）。 */
export const REASON_MAX_CHARS = 80;

/** trial 默认试用天数。 */
export const TRIAL_DEFAULT_DAYS = 14;

/** adopted「30 天未活动」阈值。 */
export const ADOPTED_STALE_DAYS = 30;

/** 允许出现在 `sync` 建议里的状态：候选还在评估、rejected 归档进 rejected.md，都不进 lab 已装表。 */
export const SYNC_STATES = ['trial', 'adopted', 'dormant'];

/** 条目字段序（落盘/输出时固定，便于 diff）。 */
export const ITEM_FIELDS = [
  'pkg',
  'kind',
  'label',
  'state',
  'since',
  'trialUntil',
  'watch',
  'lastVerified',
  'verifiedVersion',
  'reason',
  'evidence',
];

/**
 * 合法迁移表（唯一权威在 `../data/schema.md`，改这里必须先改那里）。
 * 未列出的组合一律拒绝并 exit 1。
 */
export const TRANSITIONS = {
  candidate: ['trial', 'rejected'],
  trial: ['adopted', 'rejected'],
  adopted: ['rejected', 'dormant'],
  dormant: ['rejected', 'trial'],
  rejected: [],
};

// ────────────────────────────────────────────────────────────── 日期工具

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;

export function isValidDate(value) {
  if (typeof value !== 'string' || !DATE_RE.test(value)) return false;
  return !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

export function isValidIso(value) {
  if (typeof value !== 'string' || !ISO_RE.test(value)) return false;
  return !Number.isNaN(Date.parse(value));
}

/** 从 date 或 ISO 取 `YYYY-MM-DD`；取不到 → null（不猜）。 */
export function dateOf(value) {
  if (isValidDate(value)) return value;
  if (isValidIso(value)) return value.slice(0, 10);
  return null;
}

/**
 * 解析 `--now`：
 *   - 不传 → 真实时钟（秒级截断，避免毫秒进文件）；
 *   - `YYYY-MM-DD` → date 原样，iso 补 `T00:00:00Z`；
 *   - `YYYY-MM-DDTHH:mm:ssZ` → 原样。
 * 其余形式直接报错：测试时间旅行必须是可断言的确定值。
 */
export function resolveNow(raw) {
  if (raw === null || raw === undefined || raw === '') {
    const iso = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
    return { date: iso.slice(0, 10), iso, source: 'clock' };
  }
  if (isValidDate(raw)) return { date: raw, iso: `${raw}T00:00:00Z`, source: 'arg' };
  if (isValidIso(raw)) return { date: raw.slice(0, 10), iso: raw, source: 'arg' };
  throw new CliError(`--now 需要 YYYY-MM-DD 或 YYYY-MM-DDTHH:mm:ssZ，收到「${raw}」`);
}

export function addDays(date, days) {
  const t = Date.parse(`${date}T00:00:00Z`) + days * 86400000;
  return new Date(t).toISOString().slice(0, 10);
}

/** to - from 的天数（按 UTC 日界，避免本地时区把 12-01 算成 11-30）。 */
export function daysBetween(fromDate, toDate) {
  const a = Date.parse(`${fromDate}T00:00:00Z`);
  const b = Date.parse(`${toDate}T00:00:00Z`);
  return Math.round((b - a) / 86400000);
}

function reasonLength(text) {
  return [...String(text)].length;
}

// ────────────────────────────────────────────────────────────── 校验（schema + 不变式）

/**
 * 校验单个条目。
 * 返回 `[{ code, pkg, field, detail }]`；空数组 = 通过。
 * 不变式（任务卡 + data/schema.md）：
 *   - rejected 必须有 reason 且至少 1 条 evidence；
 *   - trial 必须有 trialUntil；
 *   - adopted 必须 watch:true 且 verifiedVersion 非空。
 */
export function validateItem(item, ctx = {}) {
  const where = typeof ctx.index === 'number' ? `items[${ctx.index}]` : 'item';
  const violations = [];
  if (!item || typeof item !== 'object' || Array.isArray(item)) {
    return [{ code: 'ITEM_NOT_OBJECT', pkg: null, field: null, detail: `${where} 必须是 JSON 对象` }];
  }

  const pkg = typeof item.pkg === 'string' && item.pkg.trim() ? item.pkg.trim() : null;
  const push = (code, field, detail) => violations.push({ code, pkg, field, detail: `${where} ${detail}` });

  if (!pkg) push('PKG_EMPTY', 'pkg', 'pkg 必须是非空字符串（主键）');

  const kindOk = typeof item.kind === 'string' && KINDS.includes(item.kind);
  if (!kindOk) {
    push('KIND_INVALID', 'kind', `kind 必须是 ${KINDS.join(' / ')}，收到 ${JSON.stringify(item.kind)}`);
  } else if (pkg) {
    const required = KIND_PREFIX[item.kind] || '';
    const lower = pkg.toLowerCase();
    const foreign = Object.entries(KIND_PREFIX)
      .filter(([, prefix]) => prefix && lower.startsWith(prefix))
      .map(([, prefix]) => prefix);
    if (required) {
      if (!lower.startsWith(required)) {
        push('KIND_PREFIX_MISMATCH', 'pkg', `kind=${item.kind} 时 pkg 必须以「${required}」开头（收到 ${pkg}）`);
      }
    } else if (foreign.length > 0) {
      push('KIND_PREFIX_MISMATCH', 'pkg', `kind=plugin 时 pkg 不得带 ${foreign.join(' / ')} 前缀（收到 ${pkg}）`);
    }
  }

  if (typeof item.label !== 'string' || item.label.trim() === '') {
    push('LABEL_EMPTY', 'label', 'label 必须是非空字符串（分类轨，如 embedded / toolchain）');
  }

  if (typeof item.state !== 'string' || !STATES.includes(item.state)) {
    push('STATE_INVALID', 'state', `state 必须是 ${STATES.join(' / ')}，收到 ${JSON.stringify(item.state)}`);
  }

  if (!isValidDate(item.since)) {
    push('SINCE_INVALID', 'since', `since 必须是 YYYY-MM-DD，收到 ${JSON.stringify(item.since)}`);
  }
  if (!(item.trialUntil === null || isValidDate(item.trialUntil))) {
    push('TRIAL_UNTIL_INVALID', 'trialUntil', `trialUntil 必须是 YYYY-MM-DD 或 null，收到 ${JSON.stringify(item.trialUntil)}`);
  }
  if (typeof item.watch !== 'boolean') {
    push('WATCH_NOT_BOOLEAN', 'watch', `watch 必须是 true / false，收到 ${JSON.stringify(item.watch)}`);
  }
  if (!(item.lastVerified === null || isValidIso(item.lastVerified))) {
    push('LAST_VERIFIED_INVALID', 'lastVerified', `lastVerified 必须是 ISO（YYYY-MM-DDTHH:mm:ssZ）或 null，收到 ${JSON.stringify(item.lastVerified)}`);
  }
  if (!(item.verifiedVersion === null || (typeof item.verifiedVersion === 'string' && item.verifiedVersion.trim() !== ''))) {
    push('VERIFIED_VERSION_INVALID', 'verifiedVersion', `verifiedVersion 必须是非空字符串或 null，收到 ${JSON.stringify(item.verifiedVersion)}`);
  }

  const reason = typeof item.reason === 'string' ? item.reason.trim() : '';
  const reasonOk = reason !== '';
  if (!reasonOk) {
    push('REASON_EMPTY', 'reason', 'reason 必须非空（一句话结论）');
  } else if (reasonLength(reason) > REASON_MAX_CHARS) {
    push('REASON_TOO_LONG', 'reason', `reason 超过 ${REASON_MAX_CHARS} 字（当前 ${reasonLength(reason)} 字）`);
  }

  if (!Array.isArray(item.evidence)) {
    push('EVIDENCE_INVALID', 'evidence', 'evidence 必须是数组（可为空）');
  } else {
    item.evidence.forEach((ev, i) => {
      const at = `evidence[${i}]`;
      if (!ev || typeof ev !== 'object' || Array.isArray(ev)) {
        push('EVIDENCE_INVALID', 'evidence', `${at} 必须是对象 {type, ref, at}`);
        return;
      }
      if (!EVIDENCE_TYPES.includes(ev.type)) {
        push('EVIDENCE_INVALID', 'evidence', `${at}.type 必须是 ${EVIDENCE_TYPES.join(' / ')}，收到 ${JSON.stringify(ev.type)}`);
      }
      if (typeof ev.ref !== 'string' || ev.ref.trim() === '') {
        push('EVIDENCE_INVALID', 'evidence', `${at}.ref 必须是非空字符串（文件:行 或 命令输出摘要）`);
      }
      if (!isValidIso(ev.at)) {
        push('EVIDENCE_INVALID', 'evidence', `${at}.at 必须是 ISO（YYYY-MM-DDTHH:mm:ssZ），收到 ${JSON.stringify(ev.at)}`);
      }
    });
  }

  // ── 不变式 ──────────────────────────────────────────────
  if (item.state === 'rejected') {
    if (!reasonOk) push('INV_REJECTED_NO_REASON', 'reason', 'rejected 必须有非空 reason');
    if (!Array.isArray(item.evidence) || item.evidence.length === 0) {
      push('INV_REJECTED_NO_EVIDENCE', 'evidence', 'rejected 至少要有 1 条 evidence（否则无从复核为什么否掉）');
    }
  }
  if (item.state === 'trial' && !isValidDate(item.trialUntil)) {
    push('INV_TRIAL_NO_TRIAL_UNTIL', 'trialUntil', 'trial 必须有 trialUntil（YYYY-MM-DD），否则 due 永远看不见它');
  }
  if (item.state === 'adopted') {
    if (item.watch !== true) push('INV_ADOPTED_NO_WATCH', 'watch', 'adopted 必须 watch:true（否则版本漂移没人盯）');
    if (!(typeof item.verifiedVersion === 'string' && item.verifiedVersion.trim() !== '')) {
      push('INV_ADOPTED_NO_VERSION', 'verifiedVersion', 'adopted 必须 verifiedVersion 非空（取 profile 实测版本，不猜）');
    }
  }

  return violations;
}

export function countsByState(items) {
  const counts = {};
  for (const s of STATES) counts[s] = 0;
  for (const item of Array.isArray(items) ? items : []) {
    if (item && STATES.includes(item.state)) counts[item.state] += 1;
  }
  return counts;
}

/**
 * 校验整份 lifecycle：结构 + 每条条目 + pkg 全局唯一。
 * 返回 `{ violations, counts }`；`counts` 只统计合法状态，便于 check 摘要。
 */
export function validateLifecycle(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return {
      violations: [{ code: 'NOT_OBJECT', pkg: null, field: null, detail: 'lifecycle 顶层必须是 JSON 对象' }],
      counts: countsByState([]),
    };
  }

  const violations = [];
  if (data.schemaVersion !== SCHEMA_VERSION) {
    violations.push({
      code: 'SCHEMA_VERSION',
      pkg: null,
      field: 'schemaVersion',
      detail: `schemaVersion 必须是 ${SCHEMA_VERSION}，收到 ${JSON.stringify(data.schemaVersion)}`,
    });
  }
  if (!isValidIso(data.updatedAt)) {
    violations.push({
      code: 'UPDATED_AT_INVALID',
      pkg: null,
      field: 'updatedAt',
      detail: `updatedAt 必须是 ISO（YYYY-MM-DDTHH:mm:ssZ），收到 ${JSON.stringify(data.updatedAt)}`,
    });
  }
  if (!Array.isArray(data.items)) {
    violations.push({ code: 'ITEMS_NOT_ARRAY', pkg: null, field: 'items', detail: 'items 必须是数组' });
    return { violations, counts: countsByState([]) };
  }

  const seen = new Map();
  data.items.forEach((item, index) => {
    for (const v of validateItem(item, { index })) violations.push(v);
    const pkg = item && typeof item === 'object' && typeof item.pkg === 'string' ? item.pkg.trim() : '';
    if (!pkg) return;
    if (seen.has(pkg)) {
      violations.push({
        code: 'PKG_DUPLICATE',
        pkg,
        field: 'pkg',
        detail: `items[${index}] 的 pkg 与 items[${seen.get(pkg)}] 重复（pkg 必须全局唯一）`,
      });
    } else {
      seen.set(pkg, index);
    }
  });

  return { violations, counts: countsByState(data.items) };
}

export function formatViolations(violations) {
  return violations
    .map((v) => `- [${v.code}]${v.pkg ? ` \`${v.pkg}\`` : ''}：${v.detail}`)
    .join('\n');
}

// ────────────────────────────────────────────────────────────── 读写

export function createEmpty(now) {
  return { schemaVersion: SCHEMA_VERSION, updatedAt: now.iso, items: [] };
}

/**
 * 读 lifecycle 文件。只读 + 不猜：
 *   - 文件不存在 / 不是 JSON / 顶层不是对象 → CliError（交给 CLI 报 exit 1 并给提示）；
 *   - 字段级问题不在读取阶段报，统一交给 `validateLifecycle`（check 与写入前各跑一次）。
 */
export function loadLifecycle(filePath) {
  const abs = path.resolve(filePath);
  const r = readText(abs);
  if (!r.ok) {
    const hint = r.reason && r.reason.startsWith('ENOENT')
      ? '；不存在就先 `lab-triage add` 建第一条，或用 --lifecycle 指向 fixtures/lifecycle-b.json 的副本'
      : '';
    throw new CliError(`读不到 lifecycle 文件：${abs}（${r.reason}）${hint}`);
  }
  let data;
  try {
    data = JSON.parse(r.text);
  } catch (err) {
    throw new CliError(`lifecycle 文件不是合法 JSON：${abs}（${err && err.message ? err.message : String(err)}）`);
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new CliError(`lifecycle 顶层必须是 JSON 对象：${abs}`);
  }
  return { path: abs, data };
}

/**
 * 同 `loadLifecycle`，但「文件不存在」视为空账本（只有 `add` 用它）。
 * 其余读取异常（无权限、非法 JSON、顶层不是对象）照旧抛错。
 */
export function loadLifecycleOrEmpty(filePath, now) {
  const abs = path.resolve(filePath);
  if (!fs.existsSync(abs)) return { path: abs, data: createEmpty(now || resolveNow(null)) };
  return loadLifecycle(abs);
}

/**
 * 写目标守卫（与 A 阶段 `--write-report` 同一套红线）：
 * 拒绝 lab 目录、profile 目录、`cordis.patch.yml`、`.dsh-market`。
 */
export function assertSafeLifecyclePath(filePath, opts = {}) {
  const abs = path.resolve(filePath);
  const base = path.basename(abs).toLowerCase();
  if (base === 'cordis.patch.yml' || base === 'cordis.patch.yaml') {
    throw new CliError(`拒绝写入 ${abs}：本工具永不写 cordis.patch.yml`);
  }
  const segments = abs.split(path.sep).map((s) => s.toLowerCase());
  if (segments.includes('.dsh-market')) {
    throw new CliError(`拒绝写入 ${abs}：本工具永不写 .dsh-market`);
  }
  if (opts.labDir && isInside(abs, opts.labDir)) {
    throw new CliError(
      `拒绝写入 ${abs}：路径在 lab 目录内（${path.resolve(opts.labDir)}）——lab 只由主对话单一写入，本工具只把建议写到仓库根的 out/`,
    );
  }
  if (opts.profileDir && isInside(abs, opts.profileDir)) {
    throw new CliError(`拒绝写入 ${abs}：路径在 profile 目录内（${path.resolve(opts.profileDir)}）`);
  }
  return abs;
}

/** 原子写：同目录 tmp → rename；失败清理 tmp 并抛错（不留半截文件）。 */
export function writeAtomic(absPath, text) {
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  const tmp = `${absPath}.tmp-${process.pid}-${Date.now()}`;
  try {
    fs.writeFileSync(tmp, text, 'utf8');
    fs.renameSync(tmp, absPath);
  } catch (err) {
    try {
      fs.unlinkSync(tmp);
    } catch {
      // 清理失败不掩盖原始错误
    }
    throw new CliError(`写入失败：${absPath}（${describeFsError(err)}）`);
  }
  return absPath;
}

function orderEvidence(ev) {
  if (!ev || typeof ev !== 'object' || Array.isArray(ev)) return ev;
  const out = {
    type: ev.type === undefined ? null : ev.type,
    ref: ev.ref === undefined ? null : ev.ref,
    at: ev.at === undefined ? null : ev.at,
  };
  for (const [k, v] of Object.entries(ev)) if (!(k in out)) out[k] = v;
  return out;
}

/** 固定字段序，便于 git diff 与人工核对；未知字段保留在尾部，不静默丢弃。 */
export function orderItem(item) {
  const out = {};
  for (const field of ITEM_FIELDS) out[field] = item[field] === undefined ? null : item[field];
  if (Array.isArray(out.evidence)) out.evidence = out.evidence.map(orderEvidence);
  for (const [k, v] of Object.entries(item)) if (!(k in out)) out[k] = v;
  return out;
}

/**
 * 保存 lifecycle：**先校验，再原子写**。
 * 任一 schema / 不变式违反 → 抛 CliError（CLI 转 exit 1），**文件保持原样**。
 */
export function saveLifecycle(filePath, data, opts = {}) {
  const abs = assertSafeLifecyclePath(filePath, { labDir: opts.labDir, profileDir: opts.profileDir });
  const now = opts.now || resolveNow(null);
  const next = { schemaVersion: data ? data.schemaVersion : SCHEMA_VERSION, updatedAt: now.iso, items: data ? data.items : [] };
  for (const [k, v] of Object.entries(data || {})) if (!(k in next)) next[k] = v;

  const { violations } = validateLifecycle(next);
  if (violations.length > 0) {
    throw new CliError(
      `拒绝写入 ${abs}：${violations.length} 处 schema/不变式违反（文件未改动）\n${formatViolations(violations)}`,
    );
  }

  const ordered = {
    schemaVersion: next.schemaVersion,
    updatedAt: next.updatedAt,
    items: next.items.map(orderItem),
  };
  for (const [k, v] of Object.entries(next)) if (!(k in ordered)) ordered[k] = v;

  writeAtomic(abs, `${JSON.stringify(ordered, null, 2)}\n`);
  return { path: abs, data: ordered };
}

/** 写 out/ 建议文件（rejected 归档、sync 建议）：同一套路径守卫 + 原子写。 */
export function writeArtifact(filePath, text, opts = {}) {
  const abs = assertSafeLifecyclePath(filePath, { labDir: opts.labDir, profileDir: opts.profileDir });
  writeAtomic(abs, text.endsWith('\n') ? text : `${text}\n`);
  return abs;
}

// ────────────────────────────────────────────────────────────── 条目操作

export function findItem(data, rawPkg) {
  const pkg = normalizePkgArg(rawPkg);
  if (!pkg) throw new CliError('需要一个包名（如 lab-fixture-alpha）');
  const items = data && Array.isArray(data.items) ? data.items : [];
  return { pkg, item: items.find((x) => x && normalizePkgArg(x.pkg) === pkg) || null };
}

export function assertReason(reason) {
  const text = typeof reason === 'string' ? reason.trim() : '';
  if (!text) throw new CliError('--reason 不能为空：没有结论的条目等于没记');
  if (reasonLength(text) > REASON_MAX_CHARS) {
    throw new CliError(`--reason 超过 ${REASON_MAX_CHARS} 字（当前 ${reasonLength(text)} 字）：${text}`);
  }
  return text;
}

/** 新建候选条目（state 固定 candidate；其它状态只能靠 promote 迁移得到，保证有迁移证据）。 */
export function newItem({ pkg, kind, label, reason, now }) {
  const p = normalizePkgArg(pkg);
  if (!p) throw new CliError('--pkg 不能为空');
  if (!KINDS.includes(kind)) throw new CliError(`--kind 必须是 ${KINDS.join(' / ')}，收到「${kind}」`);
  const required = KIND_PREFIX[kind];
  const lower = p.toLowerCase();
  if (required && !lower.startsWith(required)) {
    throw new CliError(`kind=${kind} 时 pkg 必须以「${required}」开头（收到 ${p}）`);
  }
  if (!required) {
    const foreign = Object.entries(KIND_PREFIX).filter(([, prefix]) => prefix && lower.startsWith(prefix));
    if (foreign.length > 0) {
      throw new CliError(`kind=plugin 时 pkg 不得带 ${foreign.map(([, x]) => x).join(' / ')} 前缀（收到 ${p}）`);
    }
  }
  const lab = typeof label === 'string' ? label.trim() : '';
  if (!lab) throw new CliError('--label 不能为空（分类轨，与 lab 类别同名，如 embedded / toolchain）');

  return {
    pkg: p,
    kind,
    label: lab,
    state: 'candidate',
    since: now.date,
    trialUntil: null,
    watch: false,
    lastVerified: null,
    verifiedVersion: null,
    reason: assertReason(reason),
    evidence: [],
  };
}

export function appendEvidence(item, { type, ref, at }) {
  if (!EVIDENCE_TYPES.includes(type)) throw new CliError(`evidence type 必须是 ${EVIDENCE_TYPES.join(' / ')}，收到「${type}」`);
  const text = typeof ref === 'string' ? ref.trim() : '';
  if (!text) throw new CliError('evidence 内容不能为空');
  if (!isValidIso(at)) throw new CliError(`evidence 时间必须是 ISO（YYYY-MM-DDTHH:mm:ssZ），收到「${at}」`);
  return { ...item, evidence: [...(Array.isArray(item.evidence) ? item.evidence : []), { type, ref: text, at }] };
}

export function transitionHint(from) {
  const allowed = TRANSITIONS[from] || [];
  return allowed.length > 0 ? allowed.join(' / ') : '无（终结态）';
}

/**
 * 迁移合法性守卫（唯一报错口径）：非法迁移直接抛错，CLI 转 exit 1、不写文件。
 * CLI 在读 profile 版本之前就先调它——先判「能不能迁」，再判「版本读不读得到」，
 * 否则 candidate→adopted 会被误报成「版本读不到」。
 */
export function assertTransition(from, to) {
  if (!STATES.includes(to)) throw new CliError(`未知目标状态「${to}」；合法状态：${STATES.join(' / ')}`);
  const allowed = TRANSITIONS[from] || [];
  if (!allowed.includes(to)) {
    throw new CliError(
      `非法迁移 ${from} → ${to}（拒绝执行，文件未改动）。${from} 允许的目标：${transitionHint(from)}；迁移表见 data/schema.md`,
    );
  }
  return { from, to };
}

/**
 * 状态迁移（纯函数）：非法迁移直接抛错（CLI 转 exit 1，不写文件）。
 * 副作用口径：
 *   - 进 trial：写 trialUntil = now + trialDays（默认 14）；
 *   - 进 adopted：watch=true、trialUntil=null，verifiedVersion 必须由调用方从 profile 实测传入；
 *   - 进 rejected：watch=false、trialUntil=null；
 *   - 进 dormant：watch 保持（休眠但仍值得盯版本更新）、trialUntil=null；
 *   - 任何迁移都把 since 更新为「进入当前状态的日期」。
 */
export function applyTransition(item, opts) {
  const to = opts.to;
  const now = opts.now;
  const from = item.state;
  assertTransition(from, to);

  const next = { ...item, state: to, since: now.date, trialUntil: null };
  if (to === 'trial') {
    const days = Number.isInteger(opts.trialDays) && opts.trialDays > 0 ? opts.trialDays : TRIAL_DEFAULT_DAYS;
    next.trialUntil = addDays(now.date, days);
  }
  if (to === 'adopted') {
    next.watch = true;
    const version = typeof opts.verifiedVersion === 'string' ? opts.verifiedVersion.trim() : '';
    if (!version) {
      throw new CliError(
        '迁移到 adopted 需要 profile 实测版本（verifiedVersion），当前读不到 → 停在 trial / candidate，绝不填默认值（RULES §0 R-2）',
      );
    }
    next.verifiedVersion = version;
  }
  if (to === 'rejected') next.watch = false;
  return next;
}

/** 最近一次「活动」的日期：lastVerified、最后一条 evidence、since 三者取最大；都没有 → null。 */
export function lastActivityOf(item) {
  const candidates = [];
  const lv = dateOf(item.lastVerified);
  if (lv) candidates.push(lv);
  for (const ev of Array.isArray(item.evidence) ? item.evidence : []) {
    const d = dateOf(ev && ev.at);
    if (d) candidates.push(d);
  }
  const since = dateOf(item.since);
  if (since) candidates.push(since);
  if (candidates.length === 0) return null;
  return candidates.sort(cmp)[candidates.length - 1];
}

/**
 * due 报告：
 *   - trial：`trialUntil <= now` 即到期（含当天），给出逾期天数；
 *   - adopted：最近活动距今 `>= 30` 天（或从未核对）→ 需要复核。
 */
export function dueReport(items, nowDate) {
  const trials = [];
  const adopted = [];
  for (const item of Array.isArray(items) ? items : []) {
    if (!item || typeof item !== 'object') continue;
    if (item.state === 'trial' && isValidDate(item.trialUntil)) {
      const overdueDays = daysBetween(item.trialUntil, nowDate);
      if (overdueDays >= 0) {
        trials.push({
          pkg: item.pkg,
          trialUntil: item.trialUntil,
          overdueDays,
          label: item.label,
          reason: item.reason,
        });
      }
    }
    if (item.state === 'adopted') {
      const last = lastActivityOf(item);
      if (last === null) {
        adopted.push({
          pkg: item.pkg,
          lastActivity: null,
          silentDays: null,
          lastVerified: item.lastVerified === undefined ? null : item.lastVerified,
          label: item.label,
          reason: item.reason,
          note: '从未核对（lastVerified / evidence / since 都没有可用日期）',
        });
        continue;
      }
      const silentDays = daysBetween(last, nowDate);
      if (silentDays >= ADOPTED_STALE_DAYS) {
        adopted.push({
          pkg: item.pkg,
          lastActivity: last,
          silentDays,
          lastVerified: item.lastVerified === undefined ? null : item.lastVerified,
          label: item.label,
          reason: item.reason,
          note: null,
        });
      }
    }
  }
  trials.sort((a, b) => cmp(a.pkg, b.pkg));
  adopted.sort((a, b) => cmp(a.pkg, b.pkg));
  return { trials, adopted };
}

/**
 * sync 建议：lifecycle 处于 trial / adopted / dormant，但 lab 的已装基线里没有它。
 * candidate 还在评估、rejected 应进 rejected.md，都不建议写进 lab 已装表。
 */
export function syncSuggestions(items, labPkgSet) {
  const suggestions = [];
  for (const item of Array.isArray(items) ? items : []) {
    if (!item || !SYNC_STATES.includes(item.state)) continue;
    if (labPkgSet.has(item.pkg)) continue;
    suggestions.push(item);
  }
  suggestions.sort((a, b) => cmp(a.pkg, b.pkg));
  return suggestions;
}
// ============================================================================
// 学习注记：这个文件为什么写成这样
// ----------------------------------------------------------------------------
// 一、它解决的真实问题
//    一句话：把「生命周期账本怎么读、怎么校验、怎么写」收成唯一一份实现，
//    让 CLI 和将来的脚本不会各自手写 fs 逻辑、各自解释一遍 schema。
//    真实例子：saveLifecycle 先跑 validateLifecycle 再落盘。只要有一条 rejected 缺 evidence，
//    整次写入被拒、文件保持原样——不会出现「写了一半、下次 check 才发现」的账本。
//
// 二、关键设计取舍
//    1) 校验放在数据层（validateItem / validateLifecycle），不放在 CLI。
//       因为写路径以后会变多；规则只有一份，才不会出现「这个入口松、那个入口紧」。
//    2) 不变式选「拒绝写入」而不是「写入后告警」。rejected 必须有 reason + ≥1 evidence、
//       trial 必须有 trialUntil、adopted 必须有 watch 且 verifiedVersion 非空；
//       因为账本的价值全在「能不能复核」，缺字段的条目等于没记。
//    3) 原子写用「同目录 tmp → rename」。不用「跨目录 tmp」是因为 rename 只在同一文件系统内
//       才是原子的；失败时清理 tmp 再抛错，绝不留下半截 JSON。
//    4) 写路径守卫（assertSafeLifecyclePath）挡住 profile、外部 lab、cordis.patch.yml、
//       .dsh-market，而不是靠调用方自觉。因为这几个目标一旦被写，坏的是别人的环境。
//    5) 字段序固定（ITEM_FIELDS）+ 未知字段保留在尾部。固定序是为了 git diff 可读；
//       保留未知字段是为了「schema 升级后旧文件里的手写字段不被静默丢掉」。
//    6) 日期一律按 UTC 日界算（daysBetween 用 `T00:00:00Z`）。因为本地时区会把 12-01
//       算成 11-30，due 的验收就会漂一天。
//
// 三、主要函数导读（按调用顺序）
//    resolveNow        — 解析 --now：不传取真实时钟（秒级截断），传了就认 date / ISO — 其余一律报错
//    loadLifecycle     — 只读 + JSON 解析；字段级问题留给校验阶段 — 不在读的时候就猜
//    validateItem      — 单条 schema + 三条不变式 — 返回违反数组，空数组即通过
//    validateLifecycle — 整份结构 + pkg 全局唯一 — check 与写入前各跑一次
//    assertSafeLifecyclePath — 写目标守卫 — 四个禁止目标全在这里
//    writeAtomic       — tmp → rename — 失败清理，不留半截文件
//    saveLifecycle     — 先校验再写，违反就抛 CliError（文件未改动）
//    orderItem / applyTransition / dueReport / syncSuggestions — 字段序、迁移副作用、到期口径
//
// 四、踩过的坑
//   1) 迁移表写了两份（代码里的 TRANSITIONS 与 data/schema.md）就一定会漂；
//      现在的纪律是「schema.md 是唯一权威，改代码前先改文档」。
//   2) 原子写的 tmp 文件必须和目标同目录：跨盘/跨挂载点 rename 会直接失败，
//      而且失败时最容易被误判成「磁盘满了」。
//   3) 校验失败却已经写了文件，是最难查的一类问题：所以 saveLifecycle 里的顺序是
//      构造 next → validate → 落盘，中间不许插入任何写动作。
//   4) reason 的 80 字上限按**码点**数（[...text].length），中文一个字算 1；
//      用 String.length 会把一个汉字算成 1 也好、算成 2 也好，在不同环境里不一致。
//
// 五、读代码的建议顺序
//    SCHEMA_VERSION / STATES / TRANSITIONS（状态机长什么样）→ validateItem（规则）
//    → assertSafeLifecyclePath（能写哪）→ writeAtomic（怎么写）→ saveLifecycle（三者怎么串）
//    → applyTransition / dueReport / syncSuggestions（业务口径）。
// ============================================================================
