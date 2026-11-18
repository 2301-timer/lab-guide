#!/usr/bin/env node
/**
 * lab-guide / tools/lab-drift.mjs — 只读对账器（A 阶段核心交付）
 *
 * 作用：把「profile 实际装了什么」与「lab 登记了什么」对一遍，输出四类差异
 * （UNREGISTERED / MISSING / VERSION_DRIFT / PERMISSION_TODO）+ 两类 info
 * （ROSTER_ONLY / ORPHAN_IN_NM）。
 *
 * A.1 语义修订（2026-11-14）：ORPHAN_IN_NM 从「在 node_modules 但未声明」收紧为「真孤儿」——
 *   在 node_modules 顶层、却未被任何已安装包引用的包。pnpm 提升出来的传递依赖不再计入
 *   （真实环境 333 个顶层目录里 320 个是别人的依赖，报它们等于没报）。
 *   判定口径见 ../docs/RULES.md §4.2；新开关 --show-all-orphans / --explain <pkg>。
 *
 * 只读契约（禁止突破）：
 *   1) 默认不写任何文件；只有显式 --write-report <path> 才写「一份」报告。
 *   2) 永不写 profile、永不写 --lab 目录、永不写 cordis.patch.yml、永不写 .dsh-market。
 *   3) 读不到的版本写 null 并在 evidence/warnings 写原因，绝不填默认值。
 *
 * 依赖：零第三方依赖；ESM；只用 node: 内置模块。
 *
 * 结构（2026-11-14 重构，零行为变更）：
 *   解析内核（profile / package.json / lab 表格）已抽到 `_profile.mjs`，本文件只留
 *   「对账判定 + 渲染 + 写报告 + CLI」。B 阶段 `lab-triage.mjs` 复用同一份内核，
 *   避免两套解析各说各话。裁决见 ../docs/RULES.md §9.5。
 *
 * 约定与语义见 ../docs/RULES.md（本文件不得与之矛盾）。
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

// 解析内核（profile / package.json / lab 表格）已抽到 _profile.mjs，与 lab-triage.mjs 共用同一份实现。
// 抽取是逐行搬运，零行为变更；语义见 ../docs/RULES.md §5 与 §9.5。
import {
  DEFAULT_LAB,
  DEFAULT_PROFILE,
  CliError,
  cmp,
  isInside,
  loadLab,
  loadProfile,
  mdCell,
  normalizePkgArg,
  sameVersion,
} from './_profile.mjs';

// ────────────────────────────────────────────────────────────── 常量

/** 四类差异（会给结论），顺序即输出顺序。 */
const KINDS = ['UNREGISTERED', 'MISSING', 'VERSION_DRIFT', 'PERMISSION_TODO'];
/** 两类 info（只记录事实，不给结论）。 */
const INFO_KINDS = ['ROSTER_ONLY', 'ORPHAN_IN_NM'];

/** md 报告里 ORPHAN_IN_NM 默认最多列出的条数。--json 始终全量；--show-all-orphans 显式放开。 */
const MD_ORPHAN_LIMIT = 20;

// REFERENCE_FIELDS / PERMISSION_TODO_MARKERS / NOT_INSTALLED_MARKERS 属于解析口径，
// 已随解析内核一起搬到 _profile.mjs（避免两处口径漂移）。

const KIND_TITLES = {
  UNREGISTERED: 'UNREGISTERED · 装了但 lab 没登记（结论：需要登记）',
  MISSING: 'MISSING · lab 登了但实际未装（结论：需要清理基线）',
  VERSION_DRIFT: 'VERSION_DRIFT · 两边版本不同（结论：需要核对）',
  PERMISSION_TODO: 'PERMISSION_TODO · lab 权限栏未结论（结论：需要补权限四项）',
  ROSTER_ONLY: 'ROSTER_ONLY · 在 bundles 但不在 dependencies（info，不给结论）',
  ORPHAN_IN_NM: 'ORPHAN_IN_NM · node_modules 顶层真孤儿（未声明且无人引用；info，不给结论）',
};

const USAGE = `lab-drift — 只读对账器（profile 实际安装 vs dsh-plugin-lab 登记）

用法：
  node tools/lab-drift.mjs [选项]

选项：
  --profile <dir>        profile 目录（默认：DSH_PROFILE_DIR 或 ~/.dsh/profiles/desktop）
  --lab <dir>            lab 目录（默认：未设置 —— 需 --lab 或 LAB_DIR；未设置时：对账/同轨段会跳过，其余功能正常）
  --json                 输出 JSON（机读；默认 md）
  --md                   输出 Markdown（默认）
  --write-report <path>  额外把报告写到此路径（唯一允许的写文件动作）
  --show-all-orphans     md 里全量列出 ORPHAN_IN_NM（默认只列前 ${MD_ORPHAN_LIMIT} 条）
  --explain <pkg>        不输出对账报告，只解释某个包为何被判为孤儿/非孤儿
  --fail-on-drift        有差异时 exit 2（供 CI）；不带则一律 exit 0
  --help, -h             显示本帮助

ORPHAN_IN_NM 口径（A.1 起）：
  只报「真孤儿」= 在 node_modules 顶层 + dependencies/bundles 均未声明
  + 未被任何已安装包的 dependencies/peerDependencies/optionalDependencies 引用。
  pnpm 提升出来的传递依赖不算孤儿，不产出条目。

退出码：
  0  成功（有差异也不代表失败）
  2  有差异且显式给了 --fail-on-drift（--explain 模式下恒为 0）
  1  参数错误 / 读取失败 / 拒绝写入等异常

只读承诺：
  本工具不改 profile、不改 lab、不装插件、不写 cordis.patch.yml / .dsh-market；
  --write-report 指向 profile 或 lab 目录内会被直接拒绝（exit 1）。`;

// ────────────────────────────────────────────────────────────── 参数解析

function parseArgs(argv) {
  const opts = {
    profile: DEFAULT_PROFILE,
    lab: DEFAULT_LAB,
    format: 'md',
    writeReport: null,
    failOnDrift: false,
    showAllOrphans: false,
    explain: null,
    help: false,
  };
  const formatFlags = new Set();

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
      case '--fail-on-drift':
        rejectInline('--fail-on-drift');
        opts.failOnDrift = true;
        break;
      case '--show-all-orphans':
        rejectInline('--show-all-orphans');
        opts.showAllOrphans = true;
        break;
      case '--explain':
        opts.explain = takeValue('--explain');
        break;
      default:
        throw new CliError(`未知参数：${raw}（见 --help）`);
    }
  }

  if (formatFlags.size > 1) throw new CliError('--json 与 --md 不能同时使用');
  if (!opts.help && !opts.profile) throw new CliError('--profile 不能为空'); // NOLAB：--lab 为空不再报错（降级见 loadLabOptional）
  if (!opts.help && opts.explain !== null && normalizePkgArg(opts.explain) === '') {
    throw new CliError('--explain 需要一个包名（如 --explain lab-fixture-orphan）');
  }

  return opts;
}

// ────────────────────────────────────────────────────────────── 对账

function evidenceForUnregistered(profile, pkg, labEntry) {
  const actual = profile.actual.get(pkg);
  const declared = profile.dependencies[pkg];
  const bits = [];
  bits.push(`dependencies 声明 ${declared}`);
  bits.push(actual && actual.version ? `node_modules 实测 ${actual.version}` : `node_modules 实测 null（${actual ? actual.reason : '未读取'}）`);
  if (profile.bundleSet.has(pkg)) bits.push('同时在 dsh.profile.bundles 花名册中');
  if (labEntry) {
    const why = labEntry.notInstalledWhy;
    const text = why ? why.text : labEntry.statusText || '未知（不在已装基线）';
    const cite = why ? why.cite : labEntry.statusCite || labEntry.primary.cite;
    bits.push(`lab 该条目标记为「${text}」（${cite}），不在已装基线上`);
  } else {
    bits.push('installed.md / INDEX.md 均无该包条目');
  }
  return bits.join('；');
}

function evidenceForMissing(entry) {
  const bits = [];
  bits.push(`lab 已装基线登记 ${entry.primary.version === null ? 'null' : entry.primary.version}（${entry.primary.cite}）`);
  bits.push('profile dependencies 无该包');
  bits.push('node_modules 无该包目录');
  return bits.join('；');
}

function evidenceForDrift(profile, pkg, labEntry) {
  const actual = profile.actual.get(pkg);
  const pieces = [`lab=${labEntry.primary.version}（${labEntry.primary.cite}）`];
  pieces.push(actual && actual.version ? `profile 实测=${actual.version}（node_modules/${pkg}/package.json）` : 'profile 实测=null');
  pieces.push(`dependencies 声明=${profile.dependencies[pkg]}`);
  if (labEntry.primary.raw && labEntry.primary.raw !== labEntry.primary.version) {
    pieces.push(`lab 原文=${labEntry.primary.raw}`);
  }
  return pieces.join('；');
}

function evidenceForPermissionTodo(entry) {
  const hit = entry.permissions.find((p) => entry.markers.some((m) => p.text.includes(m)));
  const where = hit ? `${hit.source}:${hit.line}` : entry.primary.cite;
  return `权限栏含未结论字样「${entry.markers.join('、')}」（${where}）`;
}

function evidenceForRosterOnly(profile, pkg) {
  const actual = profile.actual.get(pkg);
  const bits = ['仅在 dsh.profile.bundles 花名册中', 'dependencies 未声明'];
  bits.push(actual && actual.version ? `node_modules 实测 ${actual.version}` : 'node_modules 无该包目录/版本');
  return bits.join('；');
}

/**
 * 真孤儿的 evidence：必须把「为什么算孤儿」写全 —— 存在 + 未声明 + 无人引用。
 * 「无人引用」的判断范围必须写出来（已扫描多少个包的 package.json），否则不可复现。
 */
function evidenceForOrphan(profile, pkg) {
  const actual = profile.actual.get(pkg);
  const bits = [];
  bits.push(
    actual && actual.version
      ? `node_modules 顶层目录存在（version=${actual.version}）`
      : 'node_modules 顶层目录存在（版本读不到）',
  );
  bits.push('dependencies 与 dsh.profile.bundles 均未声明');
  bits.push(
    `未被任何已安装包引用（已扫描 ${profile.scannedPkgs} 个候选包的 package.json，引用者 0）`,
  );
  if (actual && actual.readable === false) {
    bits.push(`注意：该包 package.json 读不到（${actual.reason}），其自身引用关系未知`);
  }
  return bits.join('；');
}

function buildReport(opts) {
  const warnings = [];
  const profile = loadProfile(opts.profile, warnings);
  const lab = loadLabOptional(opts.lab, warnings);

  const differences = [];
  const depSet = new Set(profile.depNames);

  // 1) dependencies 侧：UNREGISTERED / VERSION_DRIFT
  for (const pkg of (lab.skipped ? [] : profile.depNames)) {
    const labEntry = lab.registry.get(pkg);
    if (!labEntry || labEntry.notInstalled) {
      if (labEntry && labEntry.notInstalled) {
        const why = labEntry.notInstalledWhy;
        warnings.push(
          `${pkg}: profile 已装上，但 lab 标记为「${why ? why.text : '未安装'}」——按未登记处理，lab 基线待更新`,
        );
      }
      differences.push({
        kind: 'UNREGISTERED',
        pkg,
        evidence: evidenceForUnregistered(profile, pkg, labEntry),
      });
      continue;
    }

    if (labEntry.primary.version === null) {
      warnings.push(`${pkg}: lab 条目版本读不到（${labEntry.primary.cite}），跳过版本对比，不填默认值`);
      continue;
    }
    const actual = profile.actual.get(pkg);
    if (!actual || actual.version === null) {
      warnings.push(`${pkg}: node_modules 版本读不到（${actual ? actual.reason : '未读取'}），跳过版本对比，不填默认值`);
      continue;
    }
    if (!sameVersion(labEntry.primary.version, actual.version)) {
      differences.push({
        kind: 'VERSION_DRIFT',
        pkg,
        evidence: evidenceForDrift(profile, pkg, labEntry),
      });
    }
  }

  // 2) lab 侧：MISSING / PERMISSION_TODO（只看已装基线条目）
  for (const pkg of (lab.skipped ? [] : [...lab.registry.keys()].sort(cmp))) {
    const entry = lab.registry.get(pkg);
    if (entry.notInstalled) continue;

    const inDeps = depSet.has(pkg);
    const inNm = profile.nmNames.has(pkg);

    if (!inDeps && !inNm) {
      differences.push({ kind: 'MISSING', pkg, evidence: evidenceForMissing(entry) });
      continue;
    }
    if (!inDeps && inNm) {
      warnings.push(
        `${pkg}: 在 node_modules 但不在 dependencies（残留或 peer），不判 MISSING；是否计入 ORPHAN_IN_NM 只看它是否被别的已安装包引用`,
      );
    }

    if (entry.markers.length > 0) {
      differences.push({
        kind: 'PERMISSION_TODO',
        pkg,
        evidence: evidenceForPermissionTodo(entry),
      });
    }
  }

  // 3) info：ROSTER_ONLY
  for (const pkg of [...profile.bundleSet].sort(cmp)) {
    if (depSet.has(pkg)) continue;
    differences.push({ kind: 'ROSTER_ONLY', pkg, evidence: evidenceForRosterOnly(profile, pkg) });
  }

  // 4) info：ORPHAN_IN_NM —— 只报「真孤儿」
  //    真孤儿 = 在 node_modules 顶层（C）− 已在 dependencies 声明 − 已在 bundles 声明 − 被引用集合 R
  //    被引用的（pnpm 提升的传递依赖）不产出任何条目：它们本来就在，报出来等于噪音。
  for (const pkg of [...profile.nmNames].sort(cmp)) {
    if (depSet.has(pkg) || profile.bundleSet.has(pkg)) continue;
    if (profile.referencedBy.has(pkg)) continue; // 传递依赖：有人引用 → 不是孤儿
    differences.push({ kind: 'ORPHAN_IN_NM', pkg, evidence: evidenceForOrphan(profile, pkg) });
  }

  // 稳定排序：先按 kind 顺序，再按 pkg 升序
  const kindIndex = (k) => {
    const i = KINDS.indexOf(k);
    if (i >= 0) return i;
    const j = INFO_KINDS.indexOf(k);
    return j >= 0 ? KINDS.length + j : KINDS.length + INFO_KINDS.length;
  };
  differences.sort((x, y) => {
    const d = kindIndex(x.kind) - kindIndex(y.kind);
    return d !== 0 ? d : cmp(x.pkg, y.pkg);
  });

  const counts = {};
  for (const k of [...KINDS, ...INFO_KINDS]) counts[k] = 0;
  for (const d of differences) counts[d.kind] = (counts[d.kind] || 0) + 1;
  const total = KINDS.reduce((sum, k) => sum + counts[k], 0);

  const summary = {
    total,
    UNREGISTERED: counts.UNREGISTERED,
    MISSING: counts.MISSING,
    VERSION_DRIFT: counts.VERSION_DRIFT,
    PERMISSION_TODO: counts.PERMISSION_TODO,
    ROSTER_ONLY: counts.ROSTER_ONLY,
    ORPHAN_IN_NM: counts.ORPHAN_IN_NM,
    verdict: `${total} drift(s)`,
    warnings,
  };

  return {
    generatedAt: new Date().toISOString(),
    profile: profile.path,
    lab: lab.path, labSkipped: lab.skipped === true,
    profileDetail: {
      dependencies: profile.depNames.length,
      bundles: profile.bundles.length,
      nodeModules: profile.nmNames.size,
    },
    summary,
    differences,
    // 内部上下文：仅供 --explain 使用。renderMd / renderJson 只读上面固定字段，
    // 所以它不会出现在任何输出里（输出契约见 docs/RULES.md §5.3）。
    context: { profile, lab },
  };
}

// ────────────────────────────────────────────────────────────── 渲染

function renderMd(report, renderOpts = {}) {
  const out = [];
  const s = report.summary;
  const showAllOrphans = renderOpts.showAllOrphans === true;

  out.push('# lab drift report（只读对账）');
  out.push('');
  out.push(`- generatedAt: ${report.generatedAt}`);
  out.push(`- profile: \`${report.profile}\`（dependencies ${report.profileDetail.dependencies} / bundles ${report.profileDetail.bundles} / node_modules ${report.profileDetail.nodeModules}）`);
  out.push(`- lab: \`${report.lab}\``);
  out.push('');
  out.push(
    `summary: **${s.total} drift(s)** ｜ UNREGISTERED ${s.UNREGISTERED} ｜ MISSING ${s.MISSING} ｜ VERSION_DRIFT ${s.VERSION_DRIFT} ｜ PERMISSION_TODO ${s.PERMISSION_TODO} ｜ info: ROSTER_ONLY ${s.ROSTER_ONLY} / ORPHAN_IN_NM ${s.ORPHAN_IN_NM}`,
  );
  out.push('');

  let n = 0;
  for (const kind of KINDS) {
    n += 1;
    const rows = report.differences.filter((d) => d.kind === kind);
    out.push(`## ${n}. ${KIND_TITLES[kind]} — ${rows.length} 条`);
    out.push('');
    if (rows.length === 0) {
      out.push('（无）');
      out.push('');
      continue;
    }
    out.push('| pkg | evidence |');
    out.push('|---|---|');
    for (const r of rows) out.push(`| \`${mdCell(r.pkg)}\` | ${mdCell(r.evidence)} |`);
    out.push('');
  }

  for (const kind of INFO_KINDS) {
    n += 1;
    const rows = report.differences.filter((d) => d.kind === kind);
    const limited = kind === 'ORPHAN_IN_NM' && !showAllOrphans;
    const shown = limited ? rows.slice(0, MD_ORPHAN_LIMIT) : rows;
    out.push(`## ${n}. ${KIND_TITLES[kind]} — ${rows.length} 条`);
    out.push('');
    if (rows.length === 0) {
      out.push('（无）');
      out.push('');
      continue;
    }
    out.push('| pkg | evidence |');
    out.push('|---|---|');
    for (const r of shown) out.push(`| \`${mdCell(r.pkg)}\` | ${mdCell(r.evidence)} |`);
    out.push('');
    if (shown.length < rows.length) {
      // 限流只影响 md 的展示，不影响 summary 计数，也不影响 --json（始终全量）
      out.push(
        `> 共 ${rows.length} 条（用 --json 看全量）；本表只列前 ${shown.length} 条，加 --show-all-orphans 可全量列出。`,
      );
      out.push('');
    }
  }

  if (s.warnings.length > 0) {
    out.push(`## 告警（读不到 / 不猜测 / lab 内部不一致）— ${s.warnings.length} 条`);
    out.push('');
    for (const w of s.warnings) out.push(`- ${w}`);
    out.push('');
  }

  out.push(`verdict: ${s.verdict}`);
  return out.join('\n');
}

function renderJson(report) {
  const s = report.summary;
  const ordered = {
    generatedAt: report.generatedAt,
    profile: report.profile,
    ...(report.labSkipped === true ? { lab: report.lab, labSkipped: true } : { lab: report.lab }),
    summary: {
      total: s.total,
      UNREGISTERED: s.UNREGISTERED,
      MISSING: s.MISSING,
      VERSION_DRIFT: s.VERSION_DRIFT,
      PERMISSION_TODO: s.PERMISSION_TODO,
      ROSTER_ONLY: s.ROSTER_ONLY,
      ORPHAN_IN_NM: s.ORPHAN_IN_NM,
      verdict: s.verdict,
      warnings: s.warnings,
    },
    differences: report.differences.map((d) => ({ kind: d.kind, pkg: d.pkg, evidence: d.evidence })),
  };
  return JSON.stringify(ordered, null, 2);
}

// ────────────────────────────────────────────────────────────── --explain

function describeReferrer(profile, pkg) {
  const meta = profile.actual.get(pkg);
  const ver = meta && meta.version ? `@${meta.version}` : '@?';
  return `${pkg}${ver}`;
}

/**
 * 解释一个包为什么被判为孤儿 / 非孤儿。
 * 判定顺序与 buildReport 的 ORPHAN_IN_NM 分支保持一致（改一处必须改另一处）。
 */
function buildExplain(profile, rawPkg) {
  const pkg = normalizePkgArg(rawPkg);
  if (!pkg) throw new CliError('--explain 需要一个包名（如 --explain lab-fixture-orphan）');

  const inNodeModules = profile.nmNames.has(pkg);
  const inDependencies = Object.prototype.hasOwnProperty.call(profile.dependencies, pkg);
  const declaredSpec = inDependencies ? profile.dependencies[pkg] : null;
  const inBundles = profile.bundleSet.has(pkg);
  const referrers = (profile.referencedBy.get(pkg) || []).slice().sort(cmp);
  const referencedByCount = referrers.length;
  const referencedBy = referrers.slice(0, 5).map((r) => describeReferrer(profile, r));

  let orphan = false;
  let conclusion;
  if (!inNodeModules) {
    conclusion = '不在 node_modules 顶层目录 → 不会被判 ORPHAN_IN_NM（它可能是 MISSING / ROSTER_ONLY，或压根不存在）';
  } else if (inDependencies) {
    conclusion = '已在 dependencies 声明 → 不是孤儿';
  } else if (inBundles) {
    conclusion = '已在 dsh.profile.bundles 花名册声明 → 不是孤儿';
  } else if (referencedByCount > 0) {
    conclusion = `被 ${referencedByCount} 个已安装包引用 → 传递依赖（pnpm 提升），不是真孤儿，不产出条目`;
  } else {
    orphan = true;
    conclusion = '未被任何已安装包引用，且 dependencies / bundles 均未声明 → 真孤儿，计入 ORPHAN_IN_NM（info，不计 verdict）';
  }

  const meta = profile.actual.get(pkg) || null;
  return {
    pkg,
    orphan,
    conclusion,
    inNodeModules,
    inDependencies,
    declaredSpec,
    inBundles,
    referencedByCount,
    referencedBy,
    scannedPkgs: profile.scannedPkgs,
    installedVersion: meta && meta.version ? meta.version : null,
    note: referencedByCount > referencedBy.length ? `只列前 ${referencedBy.length} 个引用者（共 ${referencedByCount} 个）` : null,
  };
}

function renderExplainMd(report, info) {
  const out = [];
  out.push(`# lab-drift explain: \`${info.pkg}\``);
  out.push('');
  out.push(`- profile: \`${report.profile}\``);
  out.push(`- lab: \`${report.lab}\``);
  out.push('');
  out.push(`- 判定：**${info.orphan ? '真孤儿（计入 ORPHAN_IN_NM）' : '非孤儿'}** —— ${info.conclusion}`);
  out.push(`- 在 node_modules 顶层：${info.inNodeModules ? '是' : '否'}`);
  out.push(
    `- 在 dependencies：${info.inDependencies ? `是（声明 ${info.declaredSpec}）` : '否'}`,
  );
  out.push(`- 在 dsh.profile.bundles：${info.inBundles ? '是' : '否'}`);
  out.push(`- node_modules 实测版本：${info.installedVersion === null ? 'null（读不到，不猜）' : info.installedVersion}`);
  out.push(
    `- 被引用：${info.referencedByCount} 个包（已扫描 ${info.scannedPkgs} 个候选包的 package.json）`,
  );
  if (info.referencedBy.length > 0) {
    for (const r of info.referencedBy) out.push(`  - \`${r}\``);
    if (info.note) out.push(`  - ……${info.note}`);
  }
  out.push('');
  out.push(
    '口径：只有「在 node_modules 顶层 + dependencies/bundles 均未声明 + 未被任何已安装包引用」三条同时成立才算 ORPHAN_IN_NM；pnpm 提升的传递依赖不算。见 docs/RULES.md §4.2。',
  );
  out.push('');
  out.push(`orphan: ${info.orphan ? 'true' : 'false'}`);
  return out.join('\n');
}

function renderExplainJson(report, info) {
  const ordered = {
    generatedAt: report.generatedAt,
    profile: report.profile,
    lab: report.lab,
    explain: {
      pkg: info.pkg,
      orphan: info.orphan,
      conclusion: info.conclusion,
      inNodeModules: info.inNodeModules,
      inDependencies: info.inDependencies,
      declaredSpec: info.declaredSpec,
      inBundles: info.inBundles,
      installedVersion: info.installedVersion,
      referencedByCount: info.referencedByCount,
      referencedBy: info.referencedBy,
      scannedPkgs: info.scannedPkgs,
      note: info.note,
    },
    warnings: report.summary.warnings,
  };
  return JSON.stringify(ordered, null, 2);
}

// ────────────────────────────────────────────────────────────── 写报告（唯一写动作）

function assertSafeWriteTarget(targetAbs, profileDir, labDir) {
  const abs = path.resolve(targetAbs);
  const base = path.basename(abs).toLowerCase();
  if (base === 'cordis.patch.yml' || base === 'cordis.patch.yaml') {
    throw new CliError(`拒绝写入 ${abs}：本工具永不写 cordis.patch.yml`);
  }
  const segments = abs.split(path.sep).map((x) => x.toLowerCase());
  if (segments.includes('.dsh-market')) {
    throw new CliError(`拒绝写入 ${abs}：本工具永不写 .dsh-market`);
  }
  if (isInside(abs, profileDir)) {
    throw new CliError(`拒绝写入 ${abs}：路径在 profile 目录内（${path.resolve(profileDir)}）`);
  }
  if (labDir && isInside(abs, labDir)) {
    throw new CliError(`拒绝写入 ${abs}：路径在 --lab 目录内（${path.resolve(labDir)}）`);
  }
  return abs;
}

function writeReportFile(targetAbs, content) {
  try {
    const st = fs.statSync(targetAbs);
    if (st.isDirectory()) throw new CliError(`--write-report 指向的是目录：${targetAbs}`);
  } catch (err) {
    if (err instanceof CliError) throw err;
    // 不存在属于正常情况（新建），其余错误继续尝试写入并由外层报告
  }
  fs.mkdirSync(path.dirname(targetAbs), { recursive: true });
  fs.writeFileSync(targetAbs, content, 'utf8');
}

// ────────────────────────────────────────────────────────────── 入口

function run() {
  const opts = parseArgs(process.argv.slice(2));

  if (opts.help) {
    process.stdout.write(`${USAGE}\n`);
    return;
  }

  const report = buildReport(opts);

  // --explain：只解释单个包，不输出对账报告（两者互斥，避免和「md 最后一行是 verdict」的契约打架）
  let text;
  if (opts.explain !== null && opts.explain !== undefined) {
    const info = buildExplain(report.context.profile, opts.explain);
    text = opts.format === 'json' ? renderExplainJson(report, info) : renderExplainMd(report, info);
  } else {
    text = opts.format === 'json' ? renderJson(report) : renderMd(report, { showAllOrphans: opts.showAllOrphans });
  }

  text = applyNoLabNotice(report, text); process.stdout.write(text.endsWith('\n') ? text : `${text}\n`);

  if (opts.writeReport) {
    const targetAbs = assertSafeWriteTarget(opts.writeReport, opts.profile, opts.lab);
    writeReportFile(targetAbs, text.endsWith('\n') ? text : `${text}\n`);
    // 提示走 stderr：保证 stdout 的格式纯净（md 的最后一行必须是 verdict；json 必须可解析）
    process.stderr.write(`lab-drift: report written -> ${targetAbs}\n`);
  }

  // --explain 是查询动作，不参与 CI 判定
  if (opts.explain !== null && opts.explain !== undefined) {
    process.exitCode = 0;
    return;
  }
  process.exitCode = opts.failOnDrift && report.summary.total > 0 ? 2 : 0;
}

try {
  run();
} catch (err) {
  const msg = err && err.message ? err.message : String(err);
  process.stderr.write(`lab-drift: ${msg}\n`);
  process.exit(1);
}

// ────────────────────────────────────────────────────────────── 降级（无 lab）

/**
 * NOLAB 降级：lab 为空（--lab 未给且 LAB_DIR 未设）或读不到时**不再 exit 1**。
 * 理由：新用户 clone 下来没有 lab 目录，第一次运行必须能看见 profile 侧的账，
 * 否则 `--search` 这类与 lab 无关的入口会被一个「没有 lab」的守卫整段拦住。
 * 口径：lab 为空/读不到 → skipped:true + registry 空 Map → 对账的 lab 侧四类差异
 * （UNREGISTERED / MISSING / VERSION_DRIFT / PERMISSION_TODO）全部跳过，profile 侧
 * （ROSTER_ONLY / ORPHAN_IN_NM）照常；报告头部加 ⚠ 提示，退出码仍为 0。
 * 带 --lab 且可读时走原来的 loadLab，逐字节不变。
 */
function loadLabOptional(labDir, warnings) {
  if (!labDir) {
    return { path: '（未提供 --lab / LAB_DIR）', installedPath: null, indexPath: null, registry: new Map(), skipped: true };
  }
  try {
    return { ...loadLab(labDir, warnings), skipped: false };
  } catch (err) {
    warnings.push(`lab 目录不可读（${err && err.message ? err.message : String(err)}）→ 对账的 lab 侧四类差异已跳过`);
    return { path: '（lab 目录不可读）', installedPath: null, indexPath: null, registry: new Map(), skipped: true };
  }
}

/**
 * md 报告头部插入 ⚠ 提示（--write-report 落盘的那份也带，便于事后复核）。
 * JSON 原样返回：机读侧用 `lab` / `labSkipped` 字段表达同一件事，不往 JSON 里塞中文提示。
 */
function applyNoLabNotice(report, text) {
  if (report.labSkipped !== true || text.startsWith('{')) return text;
  const head =
    report.lab === '（lab 目录不可读）'
      ? '⚠ lab 目录不可读（--lab / LAB_DIR 给的值读不到），本次只做了 profile 侧检查；对账需要你的 lab 目录'
      : '⚠ 未提供 lab（--lab 或 LAB_DIR），本次只做了 profile 侧检查；对账需要你的 lab 目录';
  const tip = `${head}。自建 lab：mkdir <目录> 后在 README 里看「lab 是什么」；或设 LAB_DIR 环境变量`;
  const nl = text.indexOf('\n');
  return nl < 0 ? `${tip}\n${text}` : `${text.slice(0, nl + 1)}\n${tip}\n${text.slice(nl + 1)}`;
}

// ============================================================================
// 学习注记：这个文件为什么写成这样
// ----------------------------------------------------------------------------
// 一、它解决的真实问题
//    一句话：把「profile 实际装了什么」和「dsh-plugin-lab 登记了什么」对成一本可复核的账，
//    让「要不要登记 / 要不要清理基线 / 版本对不对 / 权限四项填没填」变成命令输出，而不是靠人回忆。
//    真实例子：本机真实 profile 的 node_modules 顶层有 333 个目录，其中 320 个是 pnpm 提升上来的
//    传递依赖。旧口径「在 node_modules 且未声明 = 孤儿」一次吐出 320 条 info，把四类真差异整个
//    淹没；A.1 收紧成「真孤儿」后掉到个位数（本项目这一轮实测 4 条）。
//
// 二、关键设计取舍
//    1) 四类差异（UNREGISTERED / MISSING / VERSION_DRIFT / PERMISSION_TODO）算 verdict；
//       ROSTER_ONLY / ORPHAN_IN_NM 只算 info。选了「分开计」而不是把六类都塞进 summary.total，
//       因为 info 是事实记录，拿它当失败会让 CI 永远红（buildReport 里 total 只 reduce KINDS）。
//    2) ORPHAN_IN_NM 判「未被任何已安装包引用」，而不是判「未在 dependencies 声明」。
//       因为 pnpm 的 node_modules 是提升后的扁平布局，绝大多数目录本来就不在 dependencies 里，
//       按旧口径报出来的是别人的依赖，等于没报。
//    3) 版本只比 node_modules/<pkg>/package.json 的实测值，不做 semver 区间求值。
//       因为「^1.2.3 满足不满足」是包管理器的事，工具只回答「现在实际是什么版本」。
//    4) 读不到就写 null 并进 warnings，绝不填默认值；宁可跳过这一条对比，也不产出一个假的
//       VERSION_DRIFT——差异表的每一条都要能被人照着 cite 复核。
//    5) 输出顺序固定（kindIndex 顺序 → 包名升序），md 最后一行恒为 verdict。
//       因为报告要能被 grep 与断言，顺序一漂移，验收就漂移。
//
// 三、主要函数导读（按调用顺序）
//    parseArgs             — 解析 CLI；--json/--md 互斥，--explain 必须带包名 — 注意它边解析边校验
//    buildReport           — 对账主流程：①dependencies 侧 ②lab 侧 ③ROSTER_ONLY ④ORPHAN_IN_NM
//                            — 四段各自「谁和谁比」就是这个文件的全部语义
//    evidenceForUnregistered / evidenceForMissing / evidenceForDrift / evidenceForPermissionTodo
//                          — 每类差异的取证串 — 改判定必须同步改这里的措辞，否则证据和结论打架
//    evidenceForOrphan     — 真孤儿的三段证据（存在 + 未声明 + 无人引用）— 必须写出「扫描了多少个包」
//    renderMd / renderJson — 两种输出契约 — md 的 ORPHAN 默认只列前 20 条，json 始终全量
//    buildExplain          — --explain 的解释器 — 判定顺序必须与 buildReport 的孤儿分支一致
//    assertSafeWriteTarget — 唯一写动作的守卫（拒 cordis.patch.yml / .dsh-market / profile / lab）
//    run                   — 串起以上几步 — --explain 恒 exit 0（查询动作不参与 CI 判定）
//
// 四、踩过的坑
//    1) ORPHAN_IN_NM 320 条：见第一节。这是「指标看着很吓人却没人用」的典型——
//       信息量不在条数，而在「每条都值得看一眼」。
//    2) lab 条目版本读不到被当成差异：改成 warnings + 跳过对比，避免假 VERSION_DRIFT。
//    3) 「在 node_modules 但不在 dependencies」曾被判 MISSING：这类是残留或 peer，
//       现在只告警；它到底算不算孤儿，交给「有没有人引用」决定。
//    4) --explain 不能与主报告混排：md 契约要求最后一行是 verdict，两者一起输出就破坏契约，
//       所以 --explain 走独立渲染分支，且恒 exit 0。
//
// 五、读代码的建议顺序
//    文件头的「只读契约」→ parseArgs（先知道有哪些开关）→ buildReport（四段判定）
//    → evidenceForOrphan 与 buildExplain（最容易改错的一对）→ renderMd（输出契约）
//    → assertSafeWriteTarget（写守卫）→ run（收口与退出码）。
// ============================================================================
