/**
 * lab-guide / tools/_profile.mjs
 *
 * A 阶段解析内核的**唯一实现**（2026-11-14 从 `lab-drift.mjs` 原样抽出）。
 *
 * 为什么抽出来：
 *   B 阶段（生命周期状态机，`lab-triage.mjs`）需要读同一批东西——profile 的
 *   `dependencies` / `dsh.profile.bundles` / `node_modules/<pkg>/package.json` 实测版本、
 *   lab 的 `installed.md` + `INDEX.md` 表格。这些解析逻辑 A 阶段已经写好并实跑验证过
 *   （真实环境 `verdict: 2 drift(s)`、`ORPHAN_IN_NM` 320→4）。再抄一遍就是两份会各自腐烂的
 *   真相，所以抽成共享模块，两个 CLI 共用。
 *
 * 抽取原则：**逐行搬运、零行为变更**。常量、函数体、报错文案、判定顺序与 A 阶段完全一致，
 * 只是从 `lab-drift.mjs` 的顶层搬到这里并加了 `export`。
 *
 * 语义权威仍是 `../docs/RULES.md`（§5 数据源与解析口径、§0 三条红线）。本文件与 RULES 冲突
 * 时以 RULES 为准；改口径必须先改 RULES，再同步改这里。
 *
 * 依赖：零第三方依赖；ESM；只用 node: 内置模块。
 */

import fs from 'node:fs';
import path from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

// ────────────────────────────────────────────────────────────── 常量

/**
 * REPO_ROOT：仓库根 = `tools/` 的上一级（`dirname(dirname(import.meta.url))`）。
 *
 * 为什么不用 cwd：开发布局是 `plugin-helper` 下再套一层工具仓，**发布仓根就是工具仓根**。
 * 默认路径（data/、fixtures/、docs/、out/）必须两种布局都指向仓库根，且与调用时的 cwd 无关，
 * 所以统一从这里推导；其余 tools 文件一律 `const ROOT = REPO_ROOT`，不再各自 `path.resolve(HERE, '..')`。
 */
export const REPO_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

/** 默认 profile 目录：DSH_PROFILE_DIR > 绝对路径的 DSH_PROFILE > DSH_HOME/profiles/<DSH_PROFILE|desktop> > ~/.dsh/profiles/desktop；空串等同未设置，源码不含任何用户名 */
export const DEFAULT_PROFILE = process.env.DSH_PROFILE_DIR || (path.isAbsolute(process.env.DSH_PROFILE || '') ? process.env.DSH_PROFILE : path.join(process.env.DSH_HOME || path.join(homedir(), '.dsh'), 'profiles', process.env.DSH_PROFILE || 'desktop'));
export const DEFAULT_LAB = process.env.LAB_DIR || ''; // 空串 = 未指定；调用方必须显式报错，绝不静默降级到 cwd

/**
 * 「被引用集合」的采集来源：只读每个候选包 package.json 的这三个字段的 key。
 * 只读顶层 node_modules/<pkg>/package.json，绝不进 node_modules/<pkg>/node_modules。
 */
export const REFERENCE_FIELDS = ['dependencies', 'peerDependencies', 'optionalDependencies'];

/** 权限栏「未结论」字样：命中任意一个即 PERMISSION_TODO。 */
export const PERMISSION_TODO_MARKERS = ['待补', '待观察', '待评估', '待定', '待确认', '待核实', 'TBD', 'TODO'];

/** lab 条目状态里表示「不在已装基线」的字样：这类条目不参与 MISSING / PERMISSION_TODO。 */
export const NOT_INSTALLED_MARKERS = ['未安装', '已卸载', '已移除', '淘汰'];

// ────────────────────────────────────────────────────────────── 错误类型

export class CliError extends Error {
  constructor(message) {
    super(message);
    this.name = 'CliError';
  }
}

// ────────────────────────────────────────────────────────────── 通用小工具

/** 与 locale 无关的稳定排序，保证输出可断言。 */
export function cmp(a, b) {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

export function describeFsError(err) {
  if (!err || typeof err !== 'object') return String(err);
  const code = err.code ? String(err.code) : 'ERROR';
  const msg = err.message ? String(err.message) : '';
  if (code === 'ENOENT') return 'ENOENT（文件/目录不存在）';
  if (code === 'EACCES' || code === 'EPERM') return `${code}（无权限读取）`;
  return msg ? `${code}: ${msg}` : code;
}

export function readText(absPath) {
  try {
    return { ok: true, text: fs.readFileSync(absPath, 'utf8'), reason: null };
  } catch (err) {
    return { ok: false, text: null, reason: describeFsError(err) };
  }
}

export function readJson(absPath) {
  const r = readText(absPath);
  if (!r.ok) return { ok: false, value: null, reason: r.reason };
  try {
    return { ok: true, value: JSON.parse(r.text), reason: null };
  } catch (err) {
    return { ok: false, value: null, reason: `JSON 解析失败：${err && err.message ? err.message : String(err)}` };
  }
}

/** 去掉反引号/引号与 semver 装饰前缀，仅用于「相等判断」，不做区间求值。 */
export function normalizeVersion(raw) {
  if (raw === null || raw === undefined) return null;
  let s = String(raw).trim();
  if (!s) return null;
  s = s.replace(/^[`'"]+/, '').replace(/[`'"]+$/, '');
  s = s.split(/\s+/)[0]; // 去掉尾随注释
  if (!s) return null;
  if (/^(—|-|–|n\/a|N\/A|null|undefined)$/.test(s)) return null;
  let guard = 0;
  while (guard++ < 8 && /^[\^~=v]/.test(s)) s = s.slice(1);
  s = s.trim();
  return s === '' ? null : s;
}

export function looksLikeSemver(spec) {
  if (typeof spec !== 'string') return false;
  return /^[\^~=v]?\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(spec.trim());
}

export function sameVersion(a, b) {
  if (a === null || b === null) return false;
  return String(a).toLowerCase() === String(b).toLowerCase();
}

export function isInside(childAbs, parentAbs) {
  const c = path.resolve(childAbs).toLowerCase();
  const p = path.resolve(parentAbs).toLowerCase();
  if (c === p) return true;
  const withSep = p.endsWith(path.sep) ? p : p + path.sep;
  return c.startsWith(withSep);
}

/** 归一化用户给的包名：去反引号/引号/空白、反斜杠转正斜杠、去尾随斜杠。 */
export function normalizePkgArg(raw) {
  let s = String(raw === null || raw === undefined ? '' : raw).trim();
  s = s.replace(/^[`'"]+/, '').replace(/[`'"]+$/, '');
  s = s.replace(/\\/g, '/').trim();
  while (s.endsWith('/')) s = s.slice(0, -1);
  return s;
}

/** Markdown 表格单元转义：竖线与换行会打断表格结构。 */
export function mdCell(text) {
  return String(text === null || text === undefined ? '' : text).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

// ────────────────────────────────────────────────────────────── Markdown 表格解析

export function splitRow(line) {
  let s = String(line).trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|')) s = s.slice(0, -1);
  return s.split('|').map((c) => c.trim());
}

export function isSeparatorRow(line) {
  const t = String(line).trim();
  if (!t.startsWith('|')) return false;
  if (!t.includes('-')) return false;
  return /^\|?[\s:|\-]+\|?$/.test(t);
}

/**
 * 解析 Markdown 中的全部表格：{ heading, header, rows:[{cells, lineNo}] }
 * lineNo 为 1-based，便于 evidence 里写「installed.md:12」。
 */
export function parseTables(text) {
  const lines = String(text).split(/\r?\n/);
  const tables = [];
  let heading = null;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const headingMatch = /^#{1,6}\s+(.*)$/.exec(line.trim());
    if (headingMatch) {
      heading = headingMatch[1].trim();
      continue;
    }
    if (!line.trim().startsWith('|')) continue;
    const nextLine = lines[i + 1];
    if (nextLine === undefined || !isSeparatorRow(nextLine)) continue;

    const header = splitRow(line);
    const rows = [];
    let j = i + 2;
    for (; j < lines.length; j += 1) {
      const rowLine = lines[j];
      if (!rowLine.trim().startsWith('|')) break;
      if (isSeparatorRow(rowLine)) continue;
      rows.push({ cells: splitRow(rowLine), lineNo: j + 1 });
    }
    tables.push({ heading, header, rows });
    i = j - 1;
  }

  return tables;
}

export function findCol(header, predicate) {
  for (let i = 0; i < header.length; i += 1) {
    if (predicate(String(header[i] || ''), i)) return i;
  }
  return -1;
}

export function extractBacktick(cell) {
  const m = /`([^`]+)`/.exec(String(cell || ''));
  return m ? m[1].trim() : null;
}

// ────────────────────────────────────────────────────────────── profile 读取

export function listNodeModules(nmDir) {
  const names = new Set();
  let dirents;
  try {
    dirents = fs.readdirSync(nmDir, { withFileTypes: true });
  } catch (err) {
    return { names, error: describeFsError(err) };
  }

  for (const d of dirents) {
    const name = d.name;
    if (!name || name.startsWith('.')) continue;
    const isDirLike = d.isDirectory() || d.isSymbolicLink();
    if (!isDirLike) continue;

    if (name.startsWith('@')) {
      let subs;
      try {
        subs = fs.readdirSync(path.join(nmDir, name), { withFileTypes: true });
      } catch {
        continue; // 空 scope / 读不到：不猜，直接跳过
      }
      for (const s of subs) {
        if (!s.name || s.name.startsWith('.')) continue;
        if (!(s.isDirectory() || s.isSymbolicLink())) continue;
        names.add(`${name}/${s.name}`);
      }
    } else {
      names.add(name);
    }
  }

  return { names, error: null };
}

/**
 * 读一个候选包（node_modules 顶层）的 package.json —— **全流程只读这一次**。
 *
 * 返回字段：
 *   version   实测版本（读不到 → null，绝不填默认值）
 *   name      package.json 里的 name（与目录名不一致时由调用方告警）
 *   reason    版本不可用的原因
 *   readable  package.json 是否读到了（false → 它引用了谁无法得知）
 *   refs      该包 dependencies/peerDependencies/optionalDependencies 的 key 并集
 *             （只读顶层这一份 package.json，不进 node_modules/<pkg>/node_modules）
 */
export function readPackageMeta(nmDir, pkg) {
  const p = path.join(nmDir, ...String(pkg).split('/'), 'package.json');
  const r = readJson(p);
  if (!r.ok) {
    return { version: null, name: null, reason: r.reason, readable: false, refs: [] };
  }
  const value = r.value && typeof r.value === 'object' && !Array.isArray(r.value) ? r.value : {};
  const name = typeof value.name === 'string' && value.name.trim() ? value.name.trim() : null;
  const version = typeof value.version === 'string' && value.version.trim() ? value.version.trim() : null;

  const refs = [];
  for (const field of REFERENCE_FIELDS) {
    const block = value[field];
    if (!block || typeof block !== 'object' || Array.isArray(block)) continue;
    for (const key of Object.keys(block)) {
      const dep = String(key).trim();
      if (dep && !refs.includes(dep)) refs.push(dep);
    }
  }

  return {
    version,
    name,
    reason: version ? null : 'package.json 内没有可用的 version 字段',
    readable: true,
    refs,
  };
}

/**
 * 只取**单个包**的 profile 实测版本（B 阶段 `note` / `promote --to adopted` 用）。
 * 与 loadProfile 的 readPackageMeta 同一口径：读不到就是 null + 原因，绝不猜（RULES §0 R-2）。
 */
export function readInstalledVersion(profileDir, pkg) {
  const nmDir = path.join(profileDir, 'node_modules');
  const meta = readPackageMeta(nmDir, pkg);
  return {
    profile: path.resolve(profileDir),
    pkg,
    version: meta.version === null ? null : meta.version,
    reason: meta.version === null ? meta.reason : null,
  };
}

export function loadProfile(profileDir, warnings) {
  const pkgJsonPath = path.join(profileDir, 'package.json');
  const read = readJson(pkgJsonPath);
  if (!read.ok) throw new CliError(`读不到 profile 的 package.json：${pkgJsonPath}（${read.reason}）`);
  const root = read.value;
  if (!root || typeof root !== 'object' || Array.isArray(root)) {
    throw new CliError(`profile 的 package.json 不是 JSON 对象：${pkgJsonPath}`);
  }

  const dependencies = {};
  if (root.dependencies && typeof root.dependencies === 'object' && !Array.isArray(root.dependencies)) {
    for (const [k, v] of Object.entries(root.dependencies)) {
      const name = String(k).trim();
      if (!name) continue;
      dependencies[name] = typeof v === 'string' ? v.trim() : String(v);
    }
  } else if (root.dependencies !== undefined) {
    warnings.push('profile package.json 的 dependencies 不是对象，已忽略');
  } else {
    warnings.push('profile package.json 没有 dependencies → UNREGISTERED 结论不生成');
  }

  const bundles = [];
  const rawBundles = root.dsh && root.dsh.profile ? root.dsh.profile.bundles : undefined;
  if (Array.isArray(rawBundles)) {
    for (const item of rawBundles) {
      if (typeof item === 'string') {
        const name = item.trim();
        if (name) bundles.push(name);
        continue;
      }
      if (item && typeof item === 'object') {
        const candidate = [item.name, item.package, item.id].find(
          (x) => typeof x === 'string' && x.trim(),
        );
        if (candidate) {
          bundles.push(candidate.trim());
          continue;
        }
      }
      warnings.push('dsh.profile.bundles 中有无法识别的条目（既非字符串也无 name/package/id），已跳过');
    }
  } else if (rawBundles !== undefined) {
    warnings.push('dsh.profile.bundles 不是数组，已忽略');
  } else {
    warnings.push('profile package.json 没有 dsh.profile.bundles → ROSTER_ONLY 结论不生成');
  }

  const uniqueBundles = [...new Set(bundles)];

  const nmDir = path.join(profileDir, 'node_modules');
  const nm = listNodeModules(nmDir);
  if (nm.error) {
    warnings.push(`读不到 profile 的 node_modules（${nm.error}）→ 实测版本一律 null，绝不填默认值`);
  }

  const depNames = Object.keys(dependencies).sort(cmp);
  const names = new Set([...depNames, ...uniqueBundles, ...nm.names]);
  const actual = new Map();
  for (const pkg of [...names].sort(cmp)) {
    const meta = readPackageMeta(nmDir, pkg);
    actual.set(pkg, meta);
    const shouldWarn = Object.prototype.hasOwnProperty.call(dependencies, pkg) || nm.names.has(pkg);
    if (shouldWarn && !meta.version) {
      warnings.push(`${pkg}: 读不到 node_modules 版本（${meta.reason}），记 version=null`);
    }
    if (shouldWarn && meta.name && meta.name !== pkg) {
      warnings.push(`${pkg}: node_modules/<pkg>/package.json 的 name 为「${meta.name}」，与目录名不一致`);
    }
  }

  for (const pkg of depNames) {
    const spec = dependencies[pkg];
    if (!looksLikeSemver(spec)) {
      warnings.push(`${pkg}: dependencies 规格「${spec}」不是 semver 形式，版本对比只取 node_modules 实测值，不按规格推断`);
    }
  }

  // ── 被引用集合 R（真孤儿判定的核心）────────────────────────────────
  // 候选集 C = node_modules 顶层目录（nm.names）；R = 所有候选包 package.json 里
  // dependencies / peerDependencies / optionalDependencies 的 key 并集。
  // 性能契约：这里**只复用**上面 actual 里已经读过的 meta，绝不第二次读同一个文件。
  const referencedBy = new Map(); // 被引用包名 -> [引用者包名, ...]（顺序即 nm 枚举顺序，仅 --explain 用）
  const unreadableCandidates = [];
  let scannedPkgs = 0;
  for (const pkg of nm.names) {
    const meta = actual.get(pkg);
    if (!meta) continue;
    if (!meta.readable) {
      unreadableCandidates.push(pkg);
      continue;
    }
    scannedPkgs += 1;
    for (const dep of meta.refs) {
      let referrers = referencedBy.get(dep);
      if (!referrers) {
        referrers = [];
        referencedBy.set(dep, referrers);
      }
      if (!referrers.includes(pkg)) referrers.push(pkg);
    }
  }

  if (unreadableCandidates.length > 0) {
    const sample = unreadableCandidates.slice(0, 3).join('、');
    const more = unreadableCandidates.length > 3 ? ' 等' : '';
    warnings.push(
      `真孤儿判定：${unreadableCandidates.length} 个候选包（${sample}${more}）的 package.json 读不到 → 它们引用了谁无从得知，相关包可能被误判为真孤儿，需人工确认`,
    );
  }

  return {
    path: path.resolve(profileDir),
    packageJson: pkgJsonPath,
    dependencies,
    depNames,
    bundles: uniqueBundles,
    bundleSet: new Set(uniqueBundles),
    nmDir,
    nmNames: nm.names,
    nmError: nm.error,
    actual,
    referencedBy,
    scannedPkgs,
    unreadableCandidates,
  };
}

// ────────────────────────────────────────────────────────────── lab 读取

export function ensureEntry(registry, pkg) {
  let entry = registry.get(pkg);
  if (!entry) {
    entry = {
      pkg,
      versions: new Map(), // source -> {raw, version, line}
      permissions: [], // {source, line, text}
      decisionCells: [], // {source, line, header, text}：状态/基线/结论列
      cites: [],
      sources: [],
      status: null, // {text, line, source}
    };
    registry.set(pkg, entry);
  }
  return entry;
}

export function noteSource(entry, source) {
  if (!entry.sources.includes(source)) entry.sources.push(source);
}

export function noteCite(entry, cite) {
  if (!entry.cites.includes(cite)) entry.cites.push(cite);
}

export function ingestLabTables(tables, source, registry, warnings) {
  for (const table of tables) {
    const comboCol = findCol(
      table.header,
      (h) => h.includes('包名@版本') || (h.includes('包名') && h.includes('@')),
    );
    const singlePkgCol = findCol(table.header, (h) => h.includes('包名') && !h.includes('@'));
    const verCol = findCol(table.header, (h) => h === '版本' || (h.includes('版本') && !h.includes('包名')));
    const permCol = findCol(table.header, (h) => h.includes('权限'));
    const statusCol = findCol(table.header, (h) => h.includes('状态'));
    // 「这一步算不算已装基线」只看状态/基线/结论列；权限列不参与（它另有 PERMISSION_TODO 规则）
    const decisionCols = [];
    table.header.forEach((h, idx) => {
      const head = String(h || '');
      if (head.includes('权限')) return;
      if (head.includes('状态') || head.includes('基线') || head.includes('结论')) {
        decisionCols.push({ idx, header: head });
      }
    });

    // 只处理「插件表」：必须能定位包名列
    if (comboCol < 0 && singlePkgCol < 0) continue;
    if (comboCol < 0 && (verCol < 0 || singlePkgCol < 0)) continue;

    for (const row of table.rows) {
      const lineNo = row.lineNo;
      let pkg = null;
      let versionCell = null;

      if (comboCol >= 0) {
        const inner = extractBacktick(row.cells[comboCol] ?? '');
        if (!inner) {
          warnings.push(`${source}:${lineNo} 的「包名@版本」列读不到反引号内容，已跳过`);
          continue;
        }
        const at = inner.lastIndexOf('@');
        if (at <= 0) {
          warnings.push(`${source}:${lineNo} 的「${inner}」不是 pkg@ver 形式，已跳过`);
          continue;
        }
        pkg = inner.slice(0, at).trim();
        versionCell = inner.slice(at + 1).trim();
      } else {
        pkg = extractBacktick(row.cells[singlePkgCol] ?? '');
        if (!pkg) {
          warnings.push(`${source}:${lineNo} 的包名列读不到反引号内容，已跳过`);
          continue;
        }
        versionCell = row.cells[verCol] ?? '';
      }

      if (!pkg) continue;

      const entry = ensureEntry(registry, pkg);
      noteSource(entry, source);

      const rawVersion = versionCell === null ? null : String(versionCell).trim();
      const normalized = normalizeVersion(rawVersion);
      entry.versions.set(source, { raw: rawVersion, version: normalized, line: lineNo });
      noteCite(entry, `${source}:${lineNo}`);

      if (permCol >= 0) {
        const text = String(row.cells[permCol] ?? '').trim();
        if (text) {
          entry.permissions.push({ source, line: lineNo, text });
          noteCite(entry, `${source}:${lineNo}`);
        }
      }
      if (statusCol >= 0) {
        const text = String(row.cells[statusCol] ?? '').trim();
        if (text) entry.status = { text, line: lineNo, source };
      }
      for (const col of decisionCols) {
        const text = String(row.cells[col.idx] ?? '').trim();
        if (text) entry.decisionCells.push({ source, line: lineNo, header: col.header, text });
      }
    }
  }
}

export function primaryVersionOf(entry) {
  for (const src of ['installed.md', 'INDEX.md']) {
    const v = entry.versions.get(src);
    if (v && v.version) return { version: v.version, raw: v.raw, cite: `${src}:${v.line}` };
  }
  for (const [src, v] of entry.versions) {
    if (v && v.version) return { version: v.version, raw: v.raw, cite: `${src}:${v.line}` };
  }
  const firstCite = entry.cites[0] || '（无行号）';
  return { version: null, raw: null, cite: firstCite };
}

/**
 * 判定「该条目是否在已装基线内」：只看状态/基线/结论列。
 * 例：INDEX 里 PLG-009..011 状态写「待批/观察」，基线列写「未安装」——必须按未安装处理，
 * 否则会把 3 个未装条目误报成 MISSING。
 */
export function findNotInstalledReason(entry) {
  for (const cell of entry.decisionCells) {
    if (NOT_INSTALLED_MARKERS.some((m) => cell.text.includes(m))) {
      return { text: cell.text, cite: `${cell.source}:${cell.line}` };
    }
  }
  if (entry.status && entry.status.text) {
    const s = entry.status.text;
    if (NOT_INSTALLED_MARKERS.some((m) => s.includes(m))) {
      return { text: s, cite: `${entry.status.source}:${entry.status.line}` };
    }
  }
  return null;
}

export function permissionMarkersOf(entry) {
  const hits = [];
  for (const p of entry.permissions) {
    for (const marker of PERMISSION_TODO_MARKERS) {
      if (p.text.includes(marker) && !hits.includes(marker)) hits.push(marker);
    }
  }
  return hits;
}

export function loadLab(labDir, warnings) {
  let stat = null;
  try {
    stat = fs.statSync(labDir);
  } catch (err) {
    throw new CliError(labDir ? `读不到 lab 目录：${path.resolve(labDir)}（${describeFsError(err)}）` : '未指定 --lab，且未设置 LAB_DIR');
  }
  if (!stat.isDirectory()) throw new CliError(`--lab 不是目录：${path.resolve(labDir)}`);

  const registry = new Map();
  const installedPath = path.join(labDir, 'installed.md');
  const indexPath = path.join(labDir, 'INDEX.md');

  const installedRead = readText(installedPath);
  if (!installedRead.ok) {
    warnings.push(`lab: 读不到 installed.md（${installedRead.reason}）→ 仅使用 INDEX.md，MISSING 结论可能不完整`);
  } else {
    ingestLabTables(parseTables(installedRead.text), 'installed.md', registry, warnings);
  }

  const indexRead = readText(indexPath);
  if (!indexRead.ok) {
    warnings.push(`lab: 读不到 INDEX.md（${indexRead.reason}）→ 仅使用 installed.md，状态列/权限摘要缺一侧`);
  } else {
    ingestLabTables(parseTables(indexRead.text), 'INDEX.md', registry, warnings);
  }

  if (registry.size === 0) {
    warnings.push('lab: 两份索引里都没解析出任何插件条目 → 所有 profile 包都会被记为 UNREGISTERED');
  }

  // 收尾：核对 lab 内部一致性，并给出可直接引用的字段
  for (const entry of registry.values()) {
    const a = entry.versions.get('installed.md');
    const b = entry.versions.get('INDEX.md');
    if (a && b && a.version && b.version && !sameVersion(a.version, b.version)) {
      warnings.push(
        `${entry.pkg}: lab 内部版本不一致（installed.md:${a.line}=${a.version} / INDEX.md:${b.line}=${b.version}）`,
      );
    }
    const primary = primaryVersionOf(entry);
    const notInstalledWhy = findNotInstalledReason(entry);
    entry.primary = primary;
    entry.markers = permissionMarkersOf(entry);
    entry.notInstalled = notInstalledWhy !== null;
    entry.notInstalledWhy = notInstalledWhy;
    entry.statusText = entry.status ? entry.status.text : null;
    entry.statusCite = entry.status ? `${entry.status.source}:${entry.status.line}` : null;
  }

  return { path: path.resolve(labDir), installedPath, indexPath, registry };
}
// ============================================================================
// 学习注记：这个文件为什么写成这样
// ----------------------------------------------------------------------------
// 一、它解决的真实问题
//    一句话：A 阶段写好的「读 profile / 读 package.json / 读 lab 的 Markdown 表格」有一套口径，
//    后来 B 阶段（生命周期）和 C 阶段（分析器）要读同一批东西；与其再抄一遍，不如抽成一份共享内核。
//    真实例子：`ORPHAN_IN_NM` 从 320 条收紧到个位数的判定，全部落在 loadProfile 的
//    referencedBy 里；如果每个 CLI 自己实现一遍，这份「真孤儿口径」就会有三份，各自腐烂。
//
// 二、关键设计取舍
//    1) 抽成共享模块，而不是让每个 CLI 引 lab-drift 的私有函数。
//       因为 lab-drift 是 CLI（有入口、有 process.exit 副作用），被 import 会连带跑入口逻辑。
//    2) 抽取原则是「逐行搬运、零行为变更」：常量、函数体、报错文案、判定顺序都不动。
//       因为抽取本身不该顺手改语义；口径要改就去改 docs/RULES.md，再同步改这里。
//    3) 版本只做**相等**比较（sameVersion 小写后全等），normalizeVersion 只去掉反引号/引号、
//       `^ ~ = v` 前缀与尾随注释，不做区间求值。因为区间求值是包管理器的活。
//    4) 每个候选包的 package.json 在一次运行里**只读一次**，读到的 version 与引用 key 一起缓存。
//       因为「分类 + 孤儿判定」都要用同一份元数据，重复读 333 个小 JSON 是白烧 IO。
//    5) 读不到就写 null + reason，并把「这会影响孤儿判定」单独告警。
//       因为 readPackageMeta 读不到的包，它引用了谁无从得知，相关包可能被误判成真孤儿。
//
// 三、主要函数导读（按调用顺序）
//    normalizePkgArg / mdCell / cmp — 输入清洗、Markdown 转义、与 locale 无关的排序
//    parseTables / splitRow / findCol / extractBacktick — lab 的 Markdown 表格解析（带 1-based 行号）
//    listNodeModules   — node_modules 顶层枚举（展开 @scope、认 symlink、跳过隐藏项）
//    readPackageMeta   — 读**顶层**这一个 package.json，返回 version / refs / readable
//    readInstalledVersion — 单包版本（B 阶段的 note / promote --to adopted 用它）
//    loadProfile       — profile 主读取：dependencies、bundles、实测版本、构建引用集合 R
//    ingestLabTables / primaryVersionOf / findNotInstalledReason / permissionMarkersOf / loadLab
//                      — lab 侧：从 installed.md + INDEX.md 合并出一份 registry
//
// 四、踩过的坑
//   1) `.bak` 目录噪音：宿主的自愈/升级会在 node_modules 里留下 `<pkg>.bak-<旧版本>` 这类目录，
//      listNodeModules 只跳过 `.` 开头的项，不特判 `.bak-*`，于是它们会以「顶层目录存在、
//      未声明、无人引用」的身份变成 ORPHAN_IN_NM 里的噪音。处理方式是 `--explain` 逐条确认，
//      确认是宿主备份就**不要**当孤儿清理（.bak 副本可能与正式目录指向同一份数据）。
//   2) 「在 node_modules 但不在 dependencies」不等于未安装：listNodeModules 与 dependencies
//      是两个不同的集合，判定必须同时看，否则会把 peer / 残留误判成 MISSING。
//   3) INDEX 里状态列写「待批 / 观察」、基线列写「未安装」的条目（PLG-009..011 那类），
//      必须按未安装处理，否则会被误报成 3 条 MISSING——所以 findNotInstalledReason 只看
//      状态/基线/结论列，权限列不参与。
//   4) lab 两份索引版本不一致（installed.md 与 INDEX.md 各说一个版本）时不要「取一个信」，
//      而是原样告警，人来自行核对。
//
// 五、读代码的建议顺序
//    normalizePkgArg / normalizeVersion（先理解「相等」的定义）→ listNodeModules + readPackageMeta
//    → loadProfile（含 referencedBy 那段注释：候选集 C 与被引用集合 R 的定义）
//    → parseTables + ingestLabTables（lab 侧）→ findNotInstalledReason（最容易被误读的一条口径）。
// ============================================================================
