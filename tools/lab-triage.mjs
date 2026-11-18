#!/usr/bin/env node
/**
 * lab-guide / tools/lab-triage.mjs — 生命周期状态机 CLI（B 阶段核心交付）
 *
 * 做什么：给「这个插件/技能/MCP/应用要不要留下」这条判断建一本**可审计的账**，
 * 把状态迁移、到期复核、与 lab 的登记差异都变成命令，而不是散落在对话里。
 *
 * 七个动作：
 *   list     按 state 分组列表（一屏表）
 *   add      新增候选（只能是 candidate；其它状态必须靠 promote 迁移，保证有迁移证据）
 *   promote  状态迁移（迁移表见 ../data/schema.md；rejected 会额外生成归档建议）
 *   due      到期 trial（trialUntil <= now）+ 30 天未活动的 adopted
 *   note     追加 evidence + 刷新 lastVerified / verifiedVersion（版本取 profile 实测）
 *   sync     生成「建议补登记」Markdown 到 out/sync-suggestions.md（**不写 lab**）
 *   check    跑 schema + 不变式，有违反 → exit 1
 *
 * 红线（与 A 阶段一致，不得突破）：
 *   1) 不写 profile、不装/卸插件、不碰 cordis.patch.yml；
 *   2) 不写 lab：lab 只作为**只读输入**，同步建议只落到 `out/`（仓库根相对）；
 *   3) 读不到就写 null 并说明原因，绝不填默认值（RULES §0 R-2）；
 *   4) 违反不变式 → exit 1 且**不写文件**（先校验再原子写）。
 *
 * 依赖：零第三方依赖；ESM；只用 node: 内置模块。
 * 解析口径复用 `_profile.mjs`（A 阶段实跑验证过的那份），数据层复用 `_lifecycle.mjs`。
 */

import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import {
  CliError,
  DEFAULT_LAB,
  DEFAULT_PROFILE,
  REPO_ROOT,
  cmp,
  isInside,
  loadLab,
  mdCell,
  normalizePkgArg,
  readInstalledVersion,
} from './_profile.mjs';

import {
  ADOPTED_STALE_DAYS,
  EVIDENCE_TYPES,
  SCHEMA_VERSION,
  STATES,
  TRIAL_DEFAULT_DAYS,
  applyTransition,
  appendEvidence,
  assertReason,
  assertTransition,
  countsByState,
  dueReport,
  findItem,
  formatViolations,
  loadLifecycle,
  loadLifecycleOrEmpty,
  newItem,
  orderItem,
  resolveNow,
  saveLifecycle,
  syncSuggestions,
  validateLifecycle,
  writeArtifact,
} from './_lifecycle.mjs';

// ────────────────────────────────────────────────────────────── 常量与路径

const TOOLS_DIR = path.dirname(fileURLToPath(import.meta.url));
const LAB_GUIDE_ROOT = REPO_ROOT; // 仓库根（开发仓是 plugin-helper 下的子目录；发布仓就是仓库根本身），不依赖 cwd
const DEFAULT_LIFECYCLE = path.join(LAB_GUIDE_ROOT, 'data', 'lifecycle.json');
const OUT_DIR = path.join(LAB_GUIDE_ROOT, 'out');
const FIXTURES_DIR = path.join(LAB_GUIDE_ROOT, 'fixtures');

/** 会写账本的子命令（其余子命令只读或只写 out/）。 */
const MUTATING_COMMANDS = ['add', 'promote', 'note'];

const COMMANDS = ['list', 'add', 'promote', 'due', 'note', 'sync', 'check'];

/** 每个子命令允许的专属参数（全局参数另算）；多余参数一律报错，避免「手滑以为生效了」。 */
const COMMAND_OPTIONS = {
  list: ['--state'],
  add: ['--pkg', '--kind', '--label', '--reason', '--state'],
  promote: ['--to', '--reason', '--trial-days', '--evidence'],
  due: [],
  note: ['--text', '--type'],
  sync: [],
  check: [],
};

const STATE_TITLES = {
  candidate: 'candidate · 候选（还没试）',
  trial: 'trial · 试用中（有 trialUntil）',
  adopted: 'adopted · 已采用（watch + verifiedVersion 必填）',
  rejected: 'rejected · 已否掉（必须有 reason + evidence）',
  dormant: 'dormant · 休眠（曾采用，暂不用）',
};

const STATE_TO_CONCLUSION = {
  candidate: '观察',
  trial: '试用中',
  adopted: '已采用',
  rejected: '淘汰',
  dormant: '休眠',
};

const USAGE = `lab-triage — 生命周期状态机（candidate → trial → adopted / rejected / dormant）

用法：
  node tools/lab-triage.mjs [全局参数] <子命令> [子命令参数]

子命令：
  list [--state <s>] [--json]
      按 state 分组列出条目（一屏表）；--state 只看某一种状态。

  add --pkg <p> --kind <plugin|skill|mcp|app> --label <l> --reason <r> [--state candidate]
      新增候选（state 只能是 candidate）；pkg 重复直接报错。

  promote <pkg> --to <trial|adopted|rejected|dormant> --reason <r> [--trial-days ${TRIAL_DEFAULT_DAYS}] [--evidence <text>]
      状态迁移；非法迁移拒绝并 exit 1（迁移表见 ../data/schema.md）。
      --to adopted 需要 profile 实测版本（--profile 指向装了它的 profile），读不到就拒绝，不猜。
      --to rejected 额外生成 out/rejected-<date>.md（归档**建议**，不写 lab）。

  due [--now YYYY-MM-DD]
      列出已到期的 trial（trialUntil <= now）与 ${ADOPTED_STALE_DAYS} 天未活动的 adopted。

  note <pkg> --text <t> [--type ${EVIDENCE_TYPES.join('|')}]
      追加一条 evidence，并把 lastVerified 刷成 now、verifiedVersion 刷成 profile 实测版本
      （读不到写 null；adopted 条目读不到时保留原值，不把不变式打破）。

  sync
      对比 lifecycle 与 lab 已装基线：lifecycle 有、lab 没登记 → 生成
      out/sync-suggestions.md（给人复制进 lab 的 Markdown 片段）。**不自动写 lab**。

  check
      跑 schema 校验 + 不变式（5 条，见 ../data/schema.md §3.4 / ../docs/RULES.md §9.3）；
      有违反 → exit 1（不写任何文件）。

全局参数：
  --lifecycle <path>   生命周期账本（默认：data/lifecycle.json）
  --profile <dir>      profile 目录（默认：DSH_PROFILE_DIR 或 ~/.dsh/profiles/desktop）
  --lab <dir>          lab 目录（只读；默认：未设置 —— 需 --lab 或 LAB_DIR；未设置时：对账/同轨段会跳过，其余功能正常）
  --now <date>         时间旅行：YYYY-MM-DD 或 YYYY-MM-DDTHH:mm:ssZ（测试用）
  --json               机读输出
  --help, -h           本帮助

退出码：
  0  跑通（有到期项、有建议也算 0）
  1  参数错误 / 读取失败 / 非法迁移 / 违反不变式 / 拒绝写入

不变式（违反则 exit 1 且不写文件）：
  rejected 必须有 reason 且至少 1 条 evidence；
  trial 必须有 trialUntil；
  adopted 必须 watch:true 且 verifiedVersion 非空；
  pkg 全局唯一；kind 与 pkg 前缀一致（skill: / mcp: / app:）。`;

// ────────────────────────────────────────────────────────────── 参数解析

function parseArgv(argv) {
  const opts = {
    lifecycle: DEFAULT_LIFECYCLE,
    profile: DEFAULT_PROFILE,
    lab: DEFAULT_LAB,
    nowRaw: null,
    json: false,
    help: false,
    positionals: [],
    extras: {},
  };

  for (let i = 0; i < argv.length; i += 1) {
    const raw = argv[i];
    if (typeof raw !== 'string' || raw === '') throw new CliError(`空参数（第 ${i + 1} 个），见 --help`);

    if (!raw.startsWith('-')) {
      opts.positionals.push(raw);
      continue;
    }

    let key = raw;
    let inline = null;
    const eq = raw.indexOf('=');
    if (raw.startsWith('--') && eq > 2) {
      key = raw.slice(0, eq);
      inline = raw.slice(eq + 1);
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

    switch (key) {
      case '--help':
      case '-h':
        if (inline !== null) throw new CliError(`参数 ${key} 不接受取值（收到「${inline}」）`);
        opts.help = true;
        break;
      case '--lifecycle':
        opts.lifecycle = takeValue('--lifecycle');
        break;
      case '--profile':
        opts.profile = takeValue('--profile');
        break;
      case '--lab':
        opts.lab = takeValue('--lab');
        break;
      case '--now':
        opts.nowRaw = takeValue('--now');
        break;
      case '--json':
        if (inline !== null) throw new CliError(`参数 --json 不接受取值（收到「${inline}」）`);
        opts.json = true;
        break;
      default:
        if (!key.startsWith('--')) throw new CliError(`未知参数：${raw}（见 --help）`);
        // 子命令专属参数先收下，等子命令确定后再按白名单校验
        opts.extras[key] = takeValue(key);
        break;
    }
  }

  if (opts.help) return { ...opts, command: null, args: [] };

  const command = opts.positionals[0];
  if (!command) {
    throw new CliError(`缺少子命令；可用：${COMMANDS.join(' / ')}（--help 看用法）`);
  }
  if (!COMMANDS.includes(command)) {
    throw new CliError(`未知子命令「${command}」；可用：${COMMANDS.join(' / ')}`);
  }

  const allowed = COMMAND_OPTIONS[command];
  for (const key of Object.keys(opts.extras)) {
    if (!allowed.includes(key)) {
      throw new CliError(
        `子命令 ${command} 不支持参数 ${key}；允许：${allowed.length > 0 ? allowed.join(' ') : '（无专属参数）'}`,
      );
    }
  }

  return { ...opts, command, args: opts.positionals.slice(1) };
}

// ────────────────────────────────────────────────────────────── 小工具

function jsonOut(payload) {
  return JSON.stringify(payload, null, 2);
}

function stderr(line) {
  process.stderr.write(`${line}\n`);
}

function pick1(args, command, usage) {
  const pkg = args[0];
  if (!pkg) throw new CliError(`${command} 需要包名。用法：${usage}`);
  if (args.length > 1) throw new CliError(`${command} 只接受一个包名，多出：${args.slice(1).join(' ')}`);
  return normalizePkgArg(pkg);
}

function dash(value) {
  return value === null || value === undefined || value === '' ? '—' : String(value);
}

function stateFilter(raw) {
  if (raw === undefined || raw === null) return null;
  if (!STATES.includes(raw)) throw new CliError(`--state 必须是 ${STATES.join(' / ')}，收到「${raw}」`);
  return raw;
}

function saveOpts(opts) {
  return { labDir: opts.lab, profileDir: opts.profile };
}

// ────────────────────────────────────────────────────────────── list

function cmdList(opts, now) {
  const { path: file, data } = loadLifecycle(opts.lifecycle);
  const filter = stateFilter(opts.extras['--state']);
  const items = (Array.isArray(data.items) ? data.items : []).filter((x) => x && typeof x === 'object');
  const shown = filter === null ? items : items.filter((x) => x.state === filter);
  const counts = countsByState(items);

  if (opts.json) {
    return {
      code: 0,
      text: jsonOut({
        generatedAt: now.iso,
        lifecycle: file,
        schemaVersion: data.schemaVersion,
        updatedAt: data.updatedAt,
        summary: { total: items.length, byState: counts, filter },
        items: shown.map(orderItem),
      }),
    };
  }

  const out = [];
  out.push(`# lab-triage list — 共 ${items.length} 条`);
  out.push('');
  out.push(`- lifecycle: \`${file}\`（schemaVersion ${data.schemaVersion}，updatedAt ${data.updatedAt}）`);
  out.push(`- 分组: ${STATES.map((s) => `${s} ${counts[s]}`).join(' ｜ ')}${filter ? `（本次只看 ${filter}）` : ''}`);
  out.push('');

  for (const state of STATES) {
    if (filter !== null && state !== filter) continue;
    const rows = shown.filter((x) => x.state === state);
    out.push(`## ${STATE_TITLES[state]} — ${rows.length} 条`);
    out.push('');
    if (rows.length === 0) {
      out.push('（无）');
      out.push('');
      continue;
    }
    out.push('| pkg | kind | label | since | trialUntil | watch | verifiedVersion | reason |');
    out.push('|---|---|---|---|---|---|---|---|');
    for (const r of rows) {
      out.push(
        `| \`${mdCell(r.pkg)}\` | ${mdCell(dash(r.kind))} | ${mdCell(dash(r.label))} | ${mdCell(dash(r.since))} | ${mdCell(dash(r.trialUntil))} | ${r.watch === true ? 'true' : 'false'} | ${mdCell(dash(r.verifiedVersion))} | ${mdCell(dash(r.reason))} |`,
      );
    }
    out.push('');
  }

  return { code: 0, text: out.join('\n') };
}

// ────────────────────────────────────────────────────────────── add

function cmdAdd(opts, now) {
  const wantState = opts.extras['--state'] === undefined ? 'candidate' : opts.extras['--state'];
  if (wantState !== 'candidate') {
    throw new CliError(
      `add 只建 candidate（新条目必须从候选开始，迁移要有证据）；要进入 ${wantState} 请用 promote（收到 --state ${wantState}）`,
    );
  }

  const { path: file, data } = loadLifecycleOrEmpty(opts.lifecycle, now);
  const pkg = normalizePkgArg(opts.extras['--pkg']);
  if (!pkg) throw new CliError('add 需要 --pkg');

  const existed = (Array.isArray(data.items) ? data.items : []).find((x) => x && normalizePkgArg(x.pkg) === pkg);
  if (existed) {
    throw new CliError(`pkg 已存在（pkg=\`${pkg}\`，state=${existed.state}，since=${existed.since}）：重复登记会掩盖历史，改用 promote / note`);
  }

  const created = newItem({
    pkg,
    kind: opts.extras['--kind'],
    label: opts.extras['--label'],
    reason: opts.extras['--reason'],
    now,
  });

  data.items = [...(Array.isArray(data.items) ? data.items : []), created];
  const saved = saveLifecycle(file, data, { ...saveOpts(opts), now });

  if (opts.json) {
    return {
      code: 0,
      text: jsonOut({ generatedAt: now.iso, lifecycle: saved.path, added: orderItem(created), total: saved.data.items.length }),
    };
  }
  return {
    code: 0,
    text: [
      `added: \`${created.pkg}\` → candidate（since ${created.since}）`,
      `- lifecycle: \`${saved.path}\`（共 ${saved.data.items.length} 条）`,
      `- reason: ${created.reason}`,
      '- 下一步：试过之后用 promote 进入 trial / rejected',
    ].join('\n'),
  };
}

// ────────────────────────────────────────────────────────────── promote

function renderRejectedArchive(items, now, lifecycleFile) {
  const rejected = (Array.isArray(items) ? items : [])
    .filter((x) => x && x.state === 'rejected')
    .sort((a, b) => cmp(a.pkg, b.pkg));

  const out = [];
  out.push(`# 归档建议 · rejected（${now.date}）`);
  out.push('');
  out.push('> 这是**建议**：搬进 lab 的 `rejected.md` 时由人决定措辞与编号。');
  out.push('> 本工具**不写 lab**（RULES §0 R-1、§9.4）；版本以 lifecycle 的 verifiedVersion 为准，读不到写「待补」。');
  out.push('');
  out.push(`- 生成时间: ${now.iso}`);
  out.push(`- lifecycle: \`${lifecycleFile}\``);
  out.push(`- 条目数: ${rejected.length}`);
  out.push('');
  if (rejected.length === 0) {
    out.push('（无 rejected 条目）');
    return out.join('\n');
  }

  out.push('| pkg | label | since | reason | evidence |');
  out.push('|---|---|---|---|---|');
  for (const r of rejected) {
    const ev = (Array.isArray(r.evidence) ? r.evidence : [])
      .map((e) => `${e.type}:${e.ref}`)
      .join('；') || '（无）';
    out.push(
      `| \`${mdCell(r.pkg)}\` | ${mdCell(dash(r.label))} | ${mdCell(dash(r.since))} | ${mdCell(dash(r.reason))} | ${mdCell(ev)} |`,
    );
  }
  out.push('');
  out.push('## 可直接复制的片段（编号由主对话分配）');
  out.push('');
  out.push('```markdown');
  for (const r of rejected) {
    const ver = r.verifiedVersion === null || r.verifiedVersion === undefined ? '待补' : r.verifiedVersion;
    const ev = (Array.isArray(r.evidence) ? r.evidence : []).map((e) => e.ref).join('；') || '见 lifecycle';
    out.push(`- \`${r.pkg}\`@${ver}｜类别 ${dash(r.label)}｜淘汰原因：${dash(r.reason)}｜证据：${ev}`);
  }
  out.push('```');
  return out.join('\n');
}

function cmdPromote(opts, now) {
  const { args } = opts;
  const pkg = pick1(args, 'promote', 'promote <pkg> --to <state> --reason <r> [--trial-days N] [--evidence <text>]');

  const to = opts.extras['--to'];
  if (!to) throw new CliError('promote 需要 --to（trial / adopted / rejected / dormant）');
  if (!STATES.includes(to)) throw new CliError(`--to 必须是 ${STATES.join(' / ')}，收到「${to}」`);

  const reason = assertReason(opts.extras['--reason']);

  let trialDays;
  const rawDays = opts.extras['--trial-days'];
  if (rawDays !== undefined) {
    const n = Number(rawDays);
    if (!Number.isInteger(n) || n <= 0 || n > 365) {
      throw new CliError(`--trial-days 需要 1..365 的整数，收到「${rawDays}」`);
    }
    trialDays = n;
  }

  const evidenceText = opts.extras['--evidence'] === undefined ? null : opts.extras['--evidence'];

  const { path: file, data } = loadLifecycle(opts.lifecycle);
  const found = findItem(data, pkg);
  if (!found.item) throw new CliError(`lifecycle 里没有 \`${found.pkg}\`（先用 add 建候选）`);
  const item = found.item;

  // 先判「能不能迁」，再判「版本读不读得到」——否则 candidate→adopted 会被误报成版本问题
  assertTransition(item.state, to);

  // adopted 需要 profile 实测版本：读不到就拒绝，不填默认值（RULES §0 R-2）
  let verifiedVersion = null;
  let versionLine = null;
  if (to === 'adopted') {
    const read = readInstalledVersion(opts.profile, found.pkg);
    if (read.version === null) {
      throw new CliError(
        `adopted 需要 profile 实测版本：读不到 ${read.profile}/node_modules/${found.pkg}/package.json（${read.reason}）→ 不猜、不填默认值；装好后重试，或用 --profile 指向装了它的 profile`,
      );
    }
    verifiedVersion = read.version;
    versionLine = `profile 实测 ${verifiedVersion}`;
  }

  const next = {
    ...applyTransition(item, { to, now, trialDays, verifiedVersion }),
    reason,
  };

  // 每次迁移都留一条证据；rejected「至少 1 条 evidence」由它兜底，--evidence 再补细节
  let audited = appendEvidence(next, {
    type: 'note',
    ref: `lab-triage: ${item.state}→${to}（${reason}）`,
    at: now.iso,
  });
  if (evidenceText !== null) {
    audited = appendEvidence(audited, { type: 'note', ref: evidenceText, at: now.iso });
  }

  data.items = data.items.map((x) => (x && normalizePkgArg(x.pkg) === found.pkg ? audited : x));
  const saved = saveLifecycle(file, data, { ...saveOpts(opts), now });

  let archivePath = null;
  if (to === 'rejected') {
    archivePath = writeArtifact(
      path.join(OUT_DIR, `rejected-${now.date}.md`),
      renderRejectedArchive(saved.data.items, now, saved.path),
      saveOpts(opts),
    );
    stderr(`lab-triage: 归档建议 -> ${archivePath}（只建议，不写 lab）`);
  }

  if (opts.json) {
    return {
      code: 0,
      text: jsonOut({
        generatedAt: now.iso,
        lifecycle: saved.path,
        from: item.state,
        to,
        item: orderItem(audited),
        archive: archivePath,
      }),
    };
  }

  const out = [`promote: \`${found.pkg}\` ${item.state} → ${to}（${audited.since} 起）`];
  if (audited.trialUntil) out.push(`- trialUntil: ${audited.trialUntil}`);
  if (versionLine) out.push(`- 版本: ${versionLine}`);
  out.push(`- reason: ${audited.reason}`);
  out.push(`- evidence: 共 ${audited.evidence.length} 条（本次追加 ${evidenceText ? 2 : 1} 条）`);
  out.push(`- lifecycle: \`${saved.path}\``);
  return { code: 0, text: out.join('\n') };
}

// ────────────────────────────────────────────────────────────── due

function cmdDue(opts, now) {
  const { path: file, data } = loadLifecycle(opts.lifecycle);
  const report = dueReport(data.items, now.date);

  if (opts.json) {
    return {
      code: 0,
      text: jsonOut({
        generatedAt: now.iso,
        lifecycle: file,
        now: now.date,
        trials: report.trials,
        adopted: report.adopted,
        summary: { trials: report.trials.length, adopted: report.adopted.length },
      }),
    };
  }

  const out = [];
  out.push(`# lab-triage due — now ${now.date}`);
  out.push('');
  out.push(`- lifecycle: \`${file}\``);
  out.push(`- 口径: trial 看 trialUntil <= now（含当天）；adopted 看最近活动（lastVerified / evidence / since 取最大）距今 >= ${ADOPTED_STALE_DAYS} 天`);
  out.push('');

  out.push(`## 到期 trial（trialUntil <= ${now.date}）— ${report.trials.length} 条`);
  out.push('');
  if (report.trials.length === 0) {
    out.push('（无）');
  } else {
    out.push('| pkg | trialUntil | 逾期天数 | reason |');
    out.push('|---|---|---|---|');
    for (const r of report.trials) {
      out.push(`| \`${mdCell(r.pkg)}\` | ${r.trialUntil} | ${r.overdueDays} | ${mdCell(dash(r.reason))} |`);
    }
  }
  out.push('');

  out.push(`## ${ADOPTED_STALE_DAYS} 天未活动的 adopted — ${report.adopted.length} 条`);
  out.push('');
  if (report.adopted.length === 0) {
    out.push('（无）');
  } else {
    out.push('| pkg | 最近活动 | 静默天数 | lastVerified | 备注 |');
    out.push('|---|---|---|---|---|');
    for (const r of report.adopted) {
      out.push(
        `| \`${mdCell(r.pkg)}\` | ${dash(r.lastActivity)} | ${r.silentDays === null ? '—' : r.silentDays} | ${mdCell(dash(r.lastVerified))} | ${mdCell(dash(r.note))} |`,
      );
    }
  }
  out.push('');
  out.push(`due: ${report.trials.length} trial(s) / ${report.adopted.length} adopted(s)`);
  return { code: 0, text: out.join('\n') };
}

// ────────────────────────────────────────────────────────────── note

function cmdNote(opts, now) {
  const pkg = pick1(opts.args, 'note', 'note <pkg> --text <t> [--type note]');
  const text = opts.extras['--text'];
  if (typeof text !== 'string' || text.trim() === '') throw new CliError('note 需要 --text（非空）');
  const type = opts.extras['--type'] === undefined ? 'note' : opts.extras['--type'];
  if (!EVIDENCE_TYPES.includes(type)) {
    throw new CliError(`--type 必须是 ${EVIDENCE_TYPES.join(' / ')}，收到「${type}」`);
  }

  const { path: file, data } = loadLifecycle(opts.lifecycle);
  const found = findItem(data, pkg);
  if (!found.item) throw new CliError(`lifecycle 里没有 \`${found.pkg}\`（先用 add 建候选）`);

  const read = readInstalledVersion(opts.profile, found.pkg);
  let verifiedVersion = read.version;
  let versionLine;
  if (read.version === null) {
    if (found.item.state === 'adopted' && found.item.verifiedVersion) {
      // 读不到不覆盖已有事实：否则 adopted 的不变式会被一条读失败打破
      verifiedVersion = found.item.verifiedVersion;
      versionLine = `profile 读不到版本（${read.reason}）→ 保留原 verifiedVersion=${verifiedVersion}`;
    } else {
      versionLine = `profile 读不到版本（${read.reason}）→ verifiedVersion 记 null（不猜）`;
    }
  } else {
    versionLine = `verifiedVersion=${verifiedVersion}`;
  }

  const next = {
    ...appendEvidence(found.item, { type, ref: text, at: now.iso }),
    lastVerified: now.iso,
    verifiedVersion,
  };

  data.items = data.items.map((x) => (x && normalizePkgArg(x.pkg) === found.pkg ? next : x));
  const saved = saveLifecycle(file, data, { ...saveOpts(opts), now });

  if (opts.json) {
    return {
      code: 0,
      text: jsonOut({
        generatedAt: now.iso,
        lifecycle: saved.path,
        pkg: found.pkg,
        item: orderItem(next),
        verifiedVersion,
        note: versionLine,
      }),
    };
  }

  return {
    code: 0,
    text: [
      `note: \`${found.pkg}\` ← ${type}`,
      `- lastVerified: ${now.iso}`,
      `- ${versionLine}`,
      `- evidence: 共 ${next.evidence.length} 条（state 保持 ${next.state}）`,
    ].join('\n'),
  };
}

// ────────────────────────────────────────────────────────────── sync

function renderSyncMd({ now, file, labPath, suggestions, labOnly, labWarnings }) {
  const out = [];
  out.push(`# sync 建议（lifecycle → lab，只建议不写）— ${now.date}`);
  out.push('');
  out.push('> **本文件不会写 lab**：lab 由主对话按 lab README §9.1/§9.2 单一写入。这里只给可复制片段。');
  out.push('> 权限四项读不到时按 lab 规矩写「待补」，不写「未知」（RULES §0 R-3）。');
  out.push('');
  out.push(`- 生成时间: ${now.iso}`);
  out.push(`- lifecycle: \`${file}\``);
  out.push(`- lab: \`${labPath}\``);
  out.push('');

  out.push(`## 建议补登记（lifecycle 有、lab 已装基线没有）— ${suggestions.length} 条`);
  out.push('');
  if (suggestions.length === 0) {
    out.push('（无）');
    out.push('');
  } else {
    out.push('```markdown');
    out.push('| 包名 | 版本 | 类别 | 状态 | 权限（代码级） | 结论 |');
    out.push('|---|---|---|---|---|---|');
    for (const item of suggestions) {
      const ver = item.verifiedVersion === null || item.verifiedVersion === undefined ? '待补' : item.verifiedVersion;
      out.push(
        `| \`${item.pkg}\` | ${ver} | ${dash(item.label)} | ${item.state} | 待补｜待补｜待补｜待补 | ${STATE_TO_CONCLUSION[item.state] || '待评估'} |`,
      );
    }
    out.push('```');
    out.push('');
    out.push('> 复制注意：`状态` 列写 lifecycle 的真实状态（trial / adopted / dormant），别一律写「已安装」；');
    out.push(`> 结论列按状态映射（trial→试用中、adopted→已采用、dormant→休眠）。`);
    out.push('');
  }

  out.push(`## 反向（lab 已装基线有、lifecycle 没记）— ${labOnly.length} 条（info）`);
  out.push('');
  if (labOnly.length === 0) {
    out.push('（无）');
  } else {
    for (const pkg of labOnly) out.push(`- \`${pkg}\``);
    out.push('');
    out.push('> 只是提示：lifecycle 是**采集账**，不要求覆盖 lab 全部历史条目；要不要补由人判断。');
  }

  if (labWarnings.length > 0) {
    out.push('');
    out.push(`## lab 读取告警 — ${labWarnings.length} 条`);
    out.push('');
    for (const w of labWarnings) out.push(`- ${w}`);
  }

  return out.join('\n');
}

function cmdSync(opts, now) {
  const { path: file, data } = loadLifecycle(opts.lifecycle);
  const labWarnings = [];
  const lab = loadLab(requireLabForSync(opts.lab), labWarnings);
  const labPkgs = new Set(
    [...lab.registry.values()].filter((e) => !e.notInstalled).map((e) => e.pkg),
  );

  const suggestions = syncSuggestions(data.items, labPkgs);
  const lifecyclePkgs = new Set(
    (Array.isArray(data.items) ? data.items : [])
      .filter((x) => x && typeof x === 'object' && typeof x.pkg === 'string')
      .map((x) => normalizePkgArg(x.pkg)),
  );
  const labOnly = [...labPkgs].filter((p) => !lifecyclePkgs.has(p)).sort(cmp);

  const outPath = path.join(OUT_DIR, 'sync-suggestions.md');
  const md = renderSyncMd({
    now,
    file,
    labPath: lab.path,
    suggestions,
    labOnly,
    labWarnings,
  });
  const written = writeArtifact(outPath, md, saveOpts(opts));

  for (const w of labWarnings) stderr(`lab-triage: lab 告警：${w}`);
  stderr(`lab-triage: sync 建议 -> ${written}（只建议，不写 lab）`);

  if (opts.json) {
    return {
      code: 0,
      text: jsonOut({
        generatedAt: now.iso,
        lifecycle: file,
        lab: lab.path,
        outPath: written,
        suggestions: suggestions.map((x) => ({ pkg: x.pkg, state: x.state, label: x.label, verifiedVersion: x.verifiedVersion })),
        labOnly,
        labWarnings,
      }),
    };
  }
  return { code: 0, text: md };
}

// ────────────────────────────────────────────────────────────── check

function cmdCheck(opts, now) {
  const { path: file, data } = loadLifecycle(opts.lifecycle);
  const { violations, counts } = validateLifecycle(data);
  const total = Array.isArray(data.items) ? data.items.length : 0;
  const ok = violations.length === 0;

  if (opts.json) {
    return {
      code: ok ? 0 : 1,
      text: jsonOut({
        generatedAt: now.iso,
        lifecycle: file,
        schemaVersion: data.schemaVersion,
        updatedAt: data.updatedAt,
        ok,
        summary: { total, byState: counts },
        violations,
      }),
    };
  }

  const out = [];
  out.push(`# lab-triage check — ${ok ? 'OK' : 'FAIL'}（${file}）`);
  out.push('');
  out.push(`- schemaVersion: ${data.schemaVersion}（期望 ${SCHEMA_VERSION}）｜updatedAt: ${data.updatedAt}`);
  out.push(`- 条目: ${total} 条（${STATES.map((s) => `${s} ${counts[s]}`).join(' ｜ ')}）`);
  out.push(`- 不变式: rejected 有 reason+evidence ｜ trial 有 trialUntil ｜ adopted 有 watch+verifiedVersion ｜ pkg 唯一 ｜ kind 与 pkg 前缀一致`);
  out.push('');

  if (!ok) {
    out.push(`## 违反项 — ${violations.length} 条`);
    out.push('');
    out.push(formatViolations(violations));
    out.push('');
  }
  out.push(`check: ${ok ? 'OK' : `${violations.length} violation(s)`}`);
  return { code: ok ? 0 : 1, text: out.join('\n') };
}

// ────────────────────────────────────────────────────────────── 入口

function dispatch(opts, now) {
  switch (opts.command) {
    case 'list':
      return cmdList(opts, now);
    case 'add':
      return cmdAdd(opts, now);
    case 'promote':
      return cmdPromote(opts, now);
    case 'due':
      return cmdDue(opts, now);
    case 'note':
      return cmdNote(opts, now);
    case 'sync':
      return cmdSync(opts, now);
    case 'check':
      return cmdCheck(opts, now);
    default:
      throw new CliError(`未实现的子命令「${opts.command}」`);
  }
}

function main() {
  const opts = parseArgv(process.argv.slice(2));
  if (opts.help) {
    process.stdout.write(`${USAGE}\n`);
    return 0;
  }
  const now = resolveNow(opts.nowRaw);
  // 夹具是「只读种子」：真要写它之前先说一声，验收请用 out/ 下的副本（README §5.3）
  if (MUTATING_COMMANDS.includes(opts.command) && isInside(opts.lifecycle, FIXTURES_DIR)) {
    stderr(`lab-triage: 注意：正在写 fixtures/ 内的文件（${path.resolve(opts.lifecycle)}）；验收请先 copy 到 out/ 再跑（README §5.3）`);
  }
  const result = dispatch(opts, now);
  const text = result.text.endsWith('\n') ? result.text : `${result.text}\n`;
  process.stdout.write(text);
  return result.code;
}

try {
  process.exitCode = main();
} catch (err) {
  const msg = err && err.message ? err.message : String(err);
  process.stderr.write(`lab-triage: ${msg}\n`);
  process.exitCode = 1;
}

// ────────────────────────────────────────────────────────────── 降级（无 lab）

/**
 * NOLAB 降级：账本是本地的（data/lifecycle.json），与 lab 无关 —— **只有 sync 需要 lab**。
 * 其余子命令（list / add / promote / due / note / check）在 lab 为空时照常跑，
 * 不再被一个「没有 lab」的守卫整段拦住；sync 缺 lab 时给一句可执行的话，而不是让人猜。
 */
function requireLabForSync(labDir) {
  if (labDir) return labDir;
  throw new CliError(
    'sync 需要 lab：本子命令要把 lifecycle 与 lab 已装基线对一遍，但没有 lab（--lab 或 LAB_DIR）。' +
      '自建 lab：mkdir <目录> 后在 README 里看「lab 是什么」；或设 LAB_DIR 环境变量。' +
      '其余子命令 list/add/promote/due/note/check 与 lab 无关，不受影响。',
  );
}

// ============================================================================
// 学习注记：这个文件为什么写成这样
// ----------------------------------------------------------------------------
// 一、它解决的真实问题
//    一句话：给「这个插件/技能/MCP/应用要不要留下」建一本可审计的账，
//    把「试用几天、到期没到期、否掉为什么、多久没复核」都落成 data/lifecycle.json 里的字段，
//    而不是散落在对话记录里。
//    真实例子：五态里 rejected 是终态且**必须**有 reason + 至少 1 条 evidence，
//    所以「我看着它不顺眼所以删了」这种决定进不了账本——它会被 check 直接判违反。
//
// 二、关键设计取舍
//    1) 真源是 data/lifecycle.json，外部 lab 只做「投影」。选了「lab 只读 +
//       sync 只生成建议」而不是「triage 顺手把条目写进 lab」，因为 lab 由主对话单一写入；
//       两个写者 = 两份真相，迟早对不上（sync 只落 out/sync-suggestions.md 就是这个原因）。
//    2) add 只允许建 candidate，要进其它状态必须 promote。因为「迁移」本身要留证据：
//       promote 会强制写一条 `old→new（reason）` 的 evidence，add 不写，绕过去就没有审计链。
//    3) 不变式放数据层（_lifecycle.validateItem），CLI 只负责转成 exit 1。
//       因为将来会有别的脚本写这本账，规则放 CLI 里就等于只有一条路径受约束。
//    4) --now 是显式的时间旅行参数，不接受「相对时间」写法。
//       因为 due / trialUntil 的验收必须可断言；真实时钟参与就只能靠 sleep 等一天。
//    5) 先校验再原子写（tmp → rename）。违反不变式时文件一个字节都不动，
//       因为「半改了一半的账本」比「没改」更难修。
//
// 三、主要函数导读（按调用顺序）
//    parseArgv        — 全局参数 + 子命令 + **每个子命令的参数白名单** — 多给一个参数直接报错，
//                       防「手滑以为生效了」（COMMAND_OPTIONS）
//    cmdList          — 按 state 分组的一屏表 — 注意它同时给 counts 与 filter
//    cmdAdd           — 只建 candidate；pkg 重复直接拒绝 — 重复登记会掩盖历史
//    cmdPromote       — 迁移主流程 — 先 assertTransition 再读版本，顺序错了会误报
//    cmdDue           — trial 到期（trialUntil <= now，含当天）+ adopted 30 天未活动
//    cmdNote          — 追加 evidence 并刷新 lastVerified / verifiedVersion
//    cmdSync          — 生成建议 Markdown 到 out/ — 绝不写 lab
//    cmdCheck         — schema + 五条不变式 — 有违反 exit 1 且不写文件
//
// 四、踩过的坑
//    1) 顺序坑：先判「能不能迁」再判「版本读不读得到」。反过来的话，
//       candidate→adopted 这种非法迁移会被报成「版本读不到」，人按提示去装包，装完还是迁不过去。
//    2) note 读不到版本时，如果直接写 verifiedVersion=null，会把 adopted 的不变式打破、
//       下一条 note 之后 check 就红；现在 adopted 条目读不到时**保留原值**并说明原因。
//    3) 夹具是只读种子：对 fixtures/ 内的账本执行 add/promote/note 会污染验收基线，
//       所以 main 里对 MUTATING_COMMANDS 落在 fixtures/ 的情况往 stderr 提醒「先 copy 到 out/」。
//    4) 写 fixtures/、写 lab、写 profile、写 cordis.patch.yml 全部要拦——拦截发生在
//       assertSafeLifecyclePath，不在各个子命令里各写一遍。
//
// 五、读代码的建议顺序
//    文件头「七个动作 + 四条红线」→ COMMAND_OPTIONS（参数面）→ cmdPromote（最复杂的一条）
//    → main 的 fixtures 提醒 → 再回头读 _lifecycle.mjs（规则都在那里，本文件只是壳）。
// ============================================================================
