#!/usr/bin/env node
/**
 * lab-guide / tools/selftest.mjs —— 把已有夹具断言收成一条命令
 *
 * 用法：
 *   node tools/selftest.mjs
 *   node tools/selftest.mjs --verbose     失败时额外打印子进程 stdout/stderr 尾巴
 *   node tools/selftest.mjs --help
 *
 * 覆盖（详见 ../README.md 的验收段与 fixtures/*-expected.json）：
 *   1. lab-drift   fake-profile + fake-lab → 四类差异 + 两类 info（expected.json）
 *   2. lab-triage  lifecycle-b.json 全生命周期 + 三条负例（lifecycle-expected.json）
 *   3. _catalog    --check 比对 data/catalog.json（analyze-expected.json · c2Cases）
 *   4. _registry   v1 旧夹具负例 + 真实 data/registry.json 正例（goal-expected.json · c32）
 *   5. lab-analyze fake-nm 两个夹具包 + 「本地无此包」（analyze-expected.json · positiveCases）
 *   6. 只读守卫   跑完全套后仓库根的 fixtures / data / out / docs / tools 一个文件都不许变
 *
 * 三条硬约束（本文件自己的红线）：
 *   A. **只读、只打印**：不写仓库根下任何文件。临时文件只在 os.tmpdir() 里建，
 *      跑完（含异常路径）整个目录删掉。
 *      唯一有「写压力」的是 lab-triage（promote --to rejected 会写 out/rejected-<date>.md，
 *      sync 会写 out/sync-suggestions.md），而它的落点是模块内的常量 `OUT_DIR = <模块根的上一级>/out`，
 *      没有 CLI 开关。所以本文件在临时目录里放一份 **字节一致的 tools/ 镜像**再跑 triage：
 *      模块根变成临时目录 → OUT_DIR 落进临时目录。复制后逐个 sha256 校验，镜像不是「另一份实现」。
 *   B. **期望值只从 fixtures/*-expected.json 读**：本文件里不出现任何包名、计数、路径、退出码的
 *      期望字面量；连命令行参数也是从夹具的 command 字段解析出来的（只替换路径与工具入口）。
 *      唯一「代码里的常量」是断言用的**字段路径**（如 rowContention.collidesWithHost[0].severity）
 *      与输出格式模板（如 `check: N violation(s)`）—— 那些是结构，不是期望值。
 *   C. **跑不了的用例必须 SKIP + 原因**，不许静默通过、也不计入 passed：
 *      · 缺 fixtures/<x>-expected.json      → 该组全部 SKIP
 *      · 缺 data/catalog.json / 目录源读不到 → CATALOG SKIP
 *      · 缺 data/registry.json              → REGISTRY 正例 SKIP（v1 负例照跑）
 *
 * 退出码：
 *   0  没有 FAIL（全 PASS，或只有 SKIP）
 *   1  任意 FAIL（含本文件自身的内部错误）
 *
 * 实现约束：零第三方依赖 / ESM / 只用 node: 内置模块。
 * 注意：piped stdio 在本项目沙箱里可能被拒（EPERM），所以子进程一律用**文件 fd**接输出。
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// 只读导入：rejected「至少 1 条 evidence」这条不变式在 fixtures/*-expected.json 里没有给出违反项代码，
// 所以判据取自工具自己的导出校验器（单一真相：_lifecycle.validateLifecycle），本文件不写死代码名。
import { validateLifecycle } from './_lifecycle.mjs';
// 仓库根唯一来源（import.meta.url 推导）：开发仓是父目录下的子仓、发布仓即仓库根本身，两种都成立。
import { REPO_ROOT } from './_profile.mjs';

// ────────────────────────────────────────────────────────────── 路径与常量

const HERE = path.dirname(fileURLToPath(import.meta.url));
const LAB_ROOT = REPO_ROOT; // 仓库根（上面那份常量的语义名：本文件全程按「仓库根」用）
const WORKSPACE = LAB_ROOT; // 夹具 command 里的相对路径基准 = 仓库根（开发仓/发布仓一致，不依赖 cwd）
const TOOLS_DIR = HERE;
const FIXTURES_DIR = path.join(LAB_ROOT, 'fixtures');
const DATA_DIR = path.join(LAB_ROOT, 'data');
const OUT_DIR = path.join(LAB_ROOT, 'out');
const NODE = process.execPath;
const CHILD_TIMEOUT_MS = 180000;

/** 只读守卫要盯的目录（跑完全套后逐个比对 size+mtime）。 */
const READONLY_DIRS = [FIXTURES_DIR, DATA_DIR, OUT_DIR, path.join(LAB_ROOT, 'docs'), TOOLS_DIR];

const VERBOSE = process.argv.includes('--verbose');

const USAGE = `selftest — 一条命令跑完 lab-guide 的夹具断言（只读、只打印）

用法：
  node tools/selftest.mjs [--verbose]

输出：
  每条一行 [PASS] / [FAIL] / [SKIP] <编号> <描述>
  末行   N passed, M failed, K skipped

退出码：
  0  没有 FAIL（只有 SKIP 也算 0，并打印跳过数）
  1  有 FAIL

跳过（SKIP）的常见原因：缺某份 fixtures/*-expected.json、缺 data/catalog.json、
缺 data/registry.json（该条只有一个 SKIP，其余用例照跑）、目录源读不到。`;

// ────────────────────────────────────────────────────────────── 结果收集与断言小工具

const results = [];
let runSeq = 0;
let RUN_TMP = null;

function record(kind, id, text) {
  results.push({ kind, id, text });
  const line = `[${kind}] ${id} ${text}`;
  process.stdout.write(`${line}\n`);
}

function pass(id, text) {
  record('PASS', id, text);
}

function skip(id, text, reason) {
  record('SKIP', id, `${text} ｜ 原因：${reason}`);
}

function fail(id, text, detail) {
  record('FAIL', id, `${text} ｜ ${detail}`);
}

/** 断言失败：抛出即由 runCase 落成 FAIL（一条用例一行）。 */
function must(cond, message) {
  if (!cond) throw new Error(message);
}

function fmt(v) {
  if (v === undefined) return 'undefined';
  if (typeof v === 'string') return JSON.stringify(v);
  return JSON.stringify(v);
}

function mustEqual(actual, expected, what) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) throw new Error(`${what}: 期望 ${b} 实际 ${a}`);
}

function mustContains(text, needle, what) {
  if (!String(text).includes(needle)) throw new Error(`${what}: 输出里找不到 ${JSON.stringify(needle)}`);
}

/** 取 `a.b[0].c` / `a.length` 形式的字段路径。 */
function getPath(obj, expr) {
  const parts = String(expr)
    .replace(/\[(\d+)\]/g, '.$1')
    .split('.')
    .filter((p) => p !== '');
  let cur = obj;
  for (const p of parts) {
    if (cur === null || cur === undefined) return undefined;
    cur = cur[p];
  }
  return cur;
}

/** 从夹具的散文期望里抽出「…」里的一串硬词（如「本地无此包」）。 */
function quotedTerms(text) {
  return [...String(text).matchAll(/「([^」]+)」/g)].map((m) => m[1]);
}

function lastNonEmptyLine(text) {
  const lines = String(text).split(/\r?\n/).filter((l) => l.trim() !== '');
  return lines.length === 0 ? '' : lines[lines.length - 1].trim();
}

function sha256(file) {
  // 只为「镜像与原件一致」与「负例前后文件未变」两件事做校验，不参与任何业务断言。
  try {
    return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  } catch {
    return null;
  }
}

// ────────────────────────────────────────────────────────────── 夹具读取

function readJsonFile(abs, what) {
  let text;
  try {
    text = fs.readFileSync(abs, 'utf8');
  } catch (err) {
    const e = new Error(`读不到 ${what}：${abs}（${err && err.code ? err.code : String(err)}）`);
    e.missing = true;
    throw e;
  }
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new Error(`${what} 不是合法 JSON：${abs}（${err && err.message ? err.message : String(err)}）`);
  }
}

function loadExpected(name) {
  const abs = path.join(FIXTURES_DIR, name);
  try {
    return { ok: true, abs, data: readJsonFile(abs, `fixtures/${name}`) };
  } catch (err) {
    return { ok: false, abs, reason: err.message };
  }
}

// ────────────────────────────────────────────────────────────── 子进程（文件 fd，不用管道）

function safeRead(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return '';
  }
}

function runNode(script, args, opts = {}) {
  runSeq += 1;
  const stamp = `${String(process.pid)}-${String(runSeq)}`;
  const outFile = path.join(RUN_TMP, `child-${stamp}.out`);
  const errFile = path.join(RUN_TMP, `child-${stamp}.err`);
  const fo = fs.openSync(outFile, 'w');
  const fe = fs.openSync(errFile, 'w');
  let res;
  try {
    res = spawnSync(NODE, [script, ...args], {
      cwd: opts.cwd || WORKSPACE,
      stdio: ['ignore', fo, fe],
      timeout: opts.timeout || CHILD_TIMEOUT_MS,
      windowsHide: true,
      env: process.env,
    });
  } finally {
    try {
      fs.closeSync(fo);
    } catch {
      /* 关闭失败不掩盖子进程结果 */
    }
    try {
      fs.closeSync(fe);
    } catch {
      /* 同上 */
    }
  }
  const stdout = safeRead(outFile);
  const stderr = safeRead(errFile);
  try {
    fs.unlinkSync(outFile);
  } catch {
    /* 清理失败不影响结果 */
  }
  try {
    fs.unlinkSync(errFile);
  } catch {
    /* 同上 */
  }
  return {
    status: res.status,
    signal: res.signal,
    error: res.error,
    stdout,
    stderr,
    cmd: `${path.basename(script)} ${args.join(' ')}`,
  };
}

function parseJsonOut(run, what) {
  const text = String(run.stdout || '').trim();
  if (text === '') {
    throw new Error(`${what}: 子进程没有 JSON 输出（exit ${String(run.status)}；stderr：${tail(run.stderr)}）`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${what}: 输出不是合法 JSON（exit ${String(run.status)}；stdout 尾巴：${tail(text)}）`);
  }
}

function tail(text, n = 300) {
  const s = String(text || '').replace(/\s+$/u, '').replace(/\s*\n\s*/gu, ' ⏎ ');
  return s.length <= n ? s : `…${s.slice(s.length - n)}`;
}

function assertExit(run, expected, what) {
  if (run.error) {
    throw new Error(`${what}: 子进程启动失败（${run.error.code || run.error.message}）`);
  }
  if (run.signal) {
    throw new Error(`${what}: 子进程被信号 ${run.signal} 结束（可能超时）`);
  }
  if (run.status !== expected) {
    throw new Error(`${what}: 退出码期望 ${String(expected)} 实际 ${String(run.status)}（stderr：${tail(run.stderr)}）`);
  }
}

// ────────────────────────────────────────────────────────────── 夹具 command 解析（参数不写死）

/** 空格分词 + 去双引号包裹（夹具 command 里的中文 reason 都带引号）。 */
function tokenizeCommand(cmd) {
  const out = [];
  let cur = '';
  let quoted = false;
  for (const ch of String(cmd)) {
    if (ch === '"') {
      quoted = !quoted;
      continue;
    }
    if (!quoted && /\s/u.test(ch)) {
      if (cur !== '') {
        out.push(cur);
        cur = '';
      }
      continue;
    }
    cur += ch;
  }
  if (cur !== '') out.push(cur);
  return out;
}

function findToken(command, suffix) {
  return tokenizeCommand(command).find((t) => t.replace(/\\/g, '/').endsWith(suffix)) || null;
}

/**
 * 跑一条夹具 command。
 *   - tokens[0] 视作 node（丢弃，改用自己的 process.execPath）；
 *   - tokens[1] 视作工具入口，按 basename 换成实际要跑的脚本路径；
 *   - 其余 token 交给 pathMapper 处理（夹具里是**仓库根相对**路径：tools/、fixtures/、data/、out/）。
 *     cwd 已是仓库根，所以相对路径直接可解析；顺带剥掉旧夹具残留的历史前缀（两种布局通吃）。
 */
function runFixtureCommand(command, opts = {}) {
  const tokens = tokenizeCommand(command);
  must(tokens.length >= 2, `夹具 command 结构不认识：${JSON.stringify(command)}`);
  const toolName = path.basename(String(tokens[1]).replace(/\\/g, '/'));
  const script = (opts.scriptFor || scriptFor)(toolName);
  const rawArgs = tokens.slice(2);
  const args = rawArgs
    .map((t) => (opts.mapArg ? opts.mapArg(t) : t))
    .map((t) => String(t).replace(/^lab-guide[\\/]/, ''));
  if (opts.json === true && !args.includes('--json')) args.push('--json');
  if (opts.extraArgs) args.push(...opts.extraArgs);
  return runNode(script, args, { cwd: opts.cwd || WORKSPACE });
}

/** 工具入口：只有 lab-triage 走临时镜像（OUT_DIR 落点问题），其余跑仓库里的原件。 */
const mirrorState = { dir: null, tools: [] };

function scriptFor(toolName) {
  if (toolName === 'lab-triage.mjs') {
    must(mirrorState.dir !== null, 'lab-triage 的临时镜像没准备好');
    const p = path.join(mirrorState.dir, toolName);
    must(fs.existsSync(p), `临时镜像里缺 ${toolName}`);
    return p;
  }
  const p = path.join(TOOLS_DIR, toolName);
  must(fs.existsSync(p), `仓库里缺工具 ${toolName}`);
  return p;
}

/**
 * 建 lab-triage 的临时镜像：字节级复制 tools/*.mjs，逐个 sha256 比对。
 * 目的只一个：模块根从仓库根变成 <tmp>/，于是 OUT_DIR=<tmp>/out，
 * rejected 归档与 sync 建议都落在 os.tmpdir() 里（约束 A）。
 */
function prepareTriageMirror() {
  const dir = path.join(RUN_TMP, 'tools');
  fs.mkdirSync(dir, { recursive: true });
  const copied = [];
  for (const name of fs.readdirSync(TOOLS_DIR)) {
    if (!name.endsWith('.mjs')) continue;
    const src = path.join(TOOLS_DIR, name);
    if (!fs.statSync(src).isFile()) continue;
    const dst = path.join(dir, name);
    fs.copyFileSync(src, dst);
    const a = sha256(src);
    const b = sha256(dst);
    must(a !== null && a === b, `工具镜像复制后内容不一致：${name}`);
    copied.push(name);
  }
  must(copied.includes('lab-triage.mjs'), '工具镜像里没有 lab-triage.mjs');
  mirrorState.dir = dir;
  mirrorState.tools = copied;
  return copied;
}

// ────────────────────────────────────────────────────────────── 只读快照

function snapshotTree(root) {
  const map = new Map();
  const walk = (dir) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const abs = path.join(dir, e.name);
      let rel;
      try {
        rel = path.relative(root, abs);
      } catch {
        continue;
      }
      if (e.isDirectory()) {
        map.set(`${rel}/`, 'dir');
        walk(abs);
        continue;
      }
      if (!e.isFile()) continue;
      try {
        const st = fs.statSync(abs);
        map.set(rel, `${String(st.size)}:${String(Math.round(st.mtimeMs))}`);
      } catch {
        map.set(rel, 'unreadable');
      }
    }
  };
  walk(root);
  return map;
}

function snapshotReadonlyDirs() {
  const all = new Map();
  for (const dir of READONLY_DIRS) {
    for (const [rel, sig] of snapshotTree(dir)) all.set(`${path.basename(dir)}/${rel}`, sig);
  }
  return all;
}

function diffSnapshots(before, after) {
  const added = [];
  const removed = [];
  const changed = [];
  for (const [k, v] of after) {
    if (!before.has(k)) added.push(k);
    else if (before.get(k) !== v) changed.push(k);
  }
  for (const k of before.keys()) if (!after.has(k)) removed.push(k);
  return { added, removed, changed };
}

// ────────────────────────────────────────────────────────────── 1) lab-drift

const DRIFT_KINDS = ['UNREGISTERED', 'MISSING', 'VERSION_DRIFT', 'PERMISSION_TODO'];
const DRIFT_INFO_KINDS = ['ROSTER_ONLY', 'ORPHAN_IN_NM'];

function pickKinds(differences, kinds) {
  return (Array.isArray(differences) ? differences : [])
    .filter((d) => d && kinds.includes(d.kind))
    .map((d) => ({ kind: d.kind, pkg: d.pkg }));
}

function runDriftCases(expected, next) {
  const fxp = path.join(FIXTURES_DIR, 'fake-profile');
  const fxl = path.join(FIXTURES_DIR, 'fake-lab');
  const envSkip = !fs.existsSync(path.join(fxp, 'package.json'))
    ? `夹具缺 ${path.join('fixtures', 'fake-profile', 'package.json')}`
    : !fs.existsSync(path.join(fxl, 'installed.md'))
      ? `夹具缺 ${path.join('fixtures', 'fake-lab', 'installed.md')}`
      : null;

  const body = expected.data;

  next('DRIFT-01', 'lab-drift 四类差异（expectedDifferences：kind+pkg 逐条全等）', () => {
    if (envSkip) return { skip: envSkip };
    const run = runFixtureCommand(body.command, { json: true });
    assertExit(run, body.exitCode, 'lab-drift --json');
    const payload = parseJsonOut(run, 'lab-drift --json');
    mustEqual(
      pickKinds(payload.differences, DRIFT_KINDS),
      body.expectedDifferences.map((d) => ({ kind: d.kind, pkg: d.pkg })),
      'differences（四类）',
    );
    return { payload };
  });

  next('DRIFT-02', 'lab-drift 计数与两类 info（expectedSummary / expectedInfo）', (prev) => {
    if (envSkip) return { skip: envSkip };
    const payload = prev && prev.payload ? prev.payload : parseJsonOut(runFixtureCommand(body.command, { json: true }), 'lab-drift');
    const s = payload.summary || {};
    const es = body.expectedSummary || {};
    for (const key of Object.keys(es)) {
      if (key === 'verdict') mustEqual(s.verdict, es.verdict, 'summary.verdict');
      else mustEqual(s[key], es[key], `summary.${key}`);
    }
    mustEqual(
      pickKinds(payload.differences, DRIFT_INFO_KINDS),
      (body.expectedInfo || []).map((d) => ({ kind: d.kind, pkg: d.pkg })),
      'differences（两类 info）',
    );
  });

  next('DRIFT-03', 'lab-drift 负样本不得出现在任何一类（expectedNotAnything）', () => {
    if (envSkip) return { skip: envSkip };
    const payload = parseJsonOut(runFixtureCommand(body.command, { json: true }), 'lab-drift');
    const seen = new Set((payload.differences || []).map((d) => d && d.pkg));
    for (const neg of body.expectedNotAnything || []) {
      must(!seen.has(neg.pkg), `负样本 ${neg.pkg} 不该出现在 differences 里（${neg.why}）`);
    }
  });

  next('DRIFT-04', 'lab-drift md 末行 verdict + 告警命中（expectedVerdictLine / expectedWarningsContain）', () => {
    if (envSkip) return { skip: envSkip };
    const run = runFixtureCommand(body.commandMd || body.command);
    assertExit(run, body.exitCode, 'lab-drift（md）');
    mustEqual(lastNonEmptyLine(run.stdout), body.expectedVerdictLine, 'md 末行');
    const payload = parseJsonOut(runFixtureCommand(body.command, { json: true }), 'lab-drift');
    const warnings = (payload.summary && payload.summary.warnings ? payload.summary.warnings : []).join('\n');
    for (const w of body.expectedWarningsContain || []) mustContains(warnings, w, 'summary.warnings');
  });

  next('DRIFT-05', 'lab-drift --fail-on-drift 退出码（exitCodeWithFailOnDrift）', () => {
    if (envSkip) return { skip: envSkip };
    const run = runFixtureCommand(body.command, { json: true, extraArgs: ['--fail-on-drift'] });
    assertExit(run, body.exitCodeWithFailOnDrift, 'lab-drift --fail-on-drift');
  });

  next('DRIFT-06', 'lab-drift --explain 判定（expectedExplain）', () => {
    if (envSkip) return { skip: envSkip };
    const run = runFixtureCommand(body.commandExplain, { json: true });
    assertExit(run, body.exitCode, 'lab-drift --explain');
    const payload = parseJsonOut(run, 'lab-drift --explain');
    const exp = body.expectedExplain || {};
    const info = payload.explain || {};
    for (const key of ['pkg', 'orphan', 'inNodeModules', 'inDependencies', 'inBundles', 'referencedByCount']) {
      mustEqual(info[key], exp[key], `explain.${key}`);
    }
    const first = (info.referencedBy || [])[0];
    must(typeof first === 'string' && first.startsWith(String(exp.referencedByFirst)), `explain.referencedBy[0] 期望以 ${fmt(exp.referencedByFirst)} 开头，实际 ${fmt(first)}`);
  });
}

// ────────────────────────────────────────────────────────────── 2) lab-triage

function assertItemShape(actual, expected, what) {
  must(actual && typeof actual === 'object', `${what}: 没有 item 对象`);
  for (const [key, val] of Object.entries(expected || {})) {
    if (key === 'evidenceCount') {
      const ev = Array.isArray(actual.evidence) ? actual.evidence : [];
      mustEqual(ev.length, val, `${what}.evidence.length（evidenceCount）`);
      continue;
    }
    if (key === 'evidenceRefsContain') {
      const refs = (Array.isArray(actual.evidence) ? actual.evidence : []).map((e) => String((e && e.ref) || ''));
      for (const ref of val) {
        // 夹具写的是引用的前缀（如「lab-triage: candidate→rejected」），实际 ref 后面还带原因括号 → 用包含判定
        must(refs.some((r) => r.includes(String(ref))), `${what}: evidence 里缺引用 ${fmt(ref)}（实际：${fmt(refs)}）`);
      }
      continue;
    }
    mustEqual(getPath(actual, key), val, `${what}.${key}`);
  }
}

function assertRows(actualRows, expectedRows, what) {
  const rows = Array.isArray(actualRows) ? actualRows : [];
  for (const exp of expectedRows || []) {
    const hit = rows.find((r) => r && r.pkg === exp.pkg);
    must(hit, `${what}: 找不到 pkg=${exp.pkg} 的行（实际：${fmt(rows.map((r) => r && r.pkg))}）`);
    for (const [key, val] of Object.entries(exp)) mustEqual(getPath(hit, key), val, `${what}[${exp.pkg}].${key}`);
  }
}

function runTriageCases(expected, next) {
  const body = expected.data;
  const seedRel = String(body.seedFile || '').replace(/^lab-guide[\\/]/, ''); // "fixtures/lifecycle-b.json"（仓库根相对）
  const seedAbs = path.resolve(WORKSPACE, seedRel);
  const workRel = String(body.workFile || 'out/lifecycle-b.tmp.json').replace(/^lab-guide[\\/]/, '');
  const steps = Array.isArray(body.steps) ? body.steps : [];
  const negCases = Array.isArray(body.negativeCases) ? body.negativeCases : [];

  const workFile = path.join(RUN_TMP, 'lifecycle-b.tmp.json');
  const negFile = path.join(RUN_TMP, 'lifecycle-b.neg.json');
  const negRel = String(findToken(negCases.map((c) => c && c.command).filter(Boolean).join(' && '), '.neg.json') || workRel.replace(/\.tmp\.json$/, '.neg.json')).replace(/^lab-guide[\\/]/, '');

  const envSkip = !fs.existsSync(seedAbs) ? `夹具缺 ${seedRel}` : null;

  /** 夹具里的相对路径 → 真路径（只换落点，不换语义）：一律仓库根相对，旧夹具的历史前缀先剥掉。 */
  function mapArg(token) {
    const norm = String(token).replace(/\\/g, '/').replace(/^lab-guide\//, '');
    if (norm === workRel) return workFile;
    if (norm === negRel) return negFile;
    return norm;
  }

  const stepById = (n) => steps.find((s) => s && s.step === n) || null;

  next('TRIAGE-01', '种子 lifecycle 通过 check（seedExpectation）', () => {
    if (envSkip) return { skip: envSkip };
    fs.copyFileSync(seedAbs, workFile);
    const seedCheck = (body.seedExpectation && body.seedExpectation.check) || {};
    const run = runNode(scriptFor('lab-triage.mjs'), ['--lifecycle', workFile, 'check', '--json'], { cwd: WORKSPACE });
    assertExit(run, seedCheck.exitCode, 'lab-triage check（种子）');
    const payload = parseJsonOut(run, 'lab-triage check（种子）');
    mustEqual(payload.summary.total, body.seedExpectation.total, '种子 summary.total');
    mustEqual(payload.summary.byState, body.seedExpectation.byState, '种子 summary.byState');
    mustEqual(payload.ok, true, '种子 check.ok');
  });

  next('TRIAGE-02', '步骤 1 list（total / byState / rowsContain）', () => {
    if (envSkip) return { skip: envSkip };
    const step = stepById(1);
    must(step, '夹具里没有 step 1');
    const run = runFixtureCommand(step.command, { mapArg, json: true });
    assertExit(run, step.exitCode, 'lab-triage list');
    const payload = parseJsonOut(run, 'lab-triage list');
    const exp = step.expect || {};
    mustEqual(payload.summary.total, exp.total, 'list summary.total');
    mustEqual(payload.summary.byState, exp.byState, 'list summary.byState');
    const pkgs = (payload.items || []).map((x) => x && x.pkg);
    for (const p of exp.rowsContain || []) must(pkgs.includes(p), `list 结果里缺 ${p}`);
  });

  next('TRIAGE-03', '步骤 2 candidate → trial（trialUntil 由 --now + 默认天数算出）', () => {
    if (envSkip) return { skip: envSkip };
    const step = stepById(2);
    must(step, '夹具里没有 step 2');
    const run = runFixtureCommand(step.command, { mapArg, json: true });
    assertExit(run, step.exitCode, 'lab-triage promote → trial');
    assertItemShape(parseJsonOut(run, 'lab-triage promote → trial').item, step.expect && step.expect.item, 'trial item');
  });

  next('TRIAGE-04', '步骤 3 due（trials / adopted / summaryLine）', () => {
    if (envSkip) return { skip: envSkip };
    const step = stepById(3);
    must(step, '夹具里没有 step 3');
    const exp = step.expect || {};
    const runJson = runFixtureCommand(step.command, { mapArg, json: true });
    assertExit(runJson, step.exitCode, 'lab-triage due（--json）');
    const payload = parseJsonOut(runJson, 'lab-triage due（--json）');
    assertRows(payload.trials, exp.trials, 'due.trials');
    assertRows(payload.adopted, exp.adopted, 'due.adopted');
    const runMd = runFixtureCommand(step.command, { mapArg });
    assertExit(runMd, step.exitCode, 'lab-triage due（md）');
    mustEqual(lastNonEmptyLine(runMd.stdout), exp.summaryLine, 'due md 末行');
  });

  next('TRIAGE-05', '步骤 4 trial → adopted（verifiedVersion 取 profile 实测）', () => {
    if (envSkip) return { skip: envSkip };
    const step = stepById(4);
    must(step, '夹具里没有 step 4');
    const run = runFixtureCommand(step.command, { mapArg, json: true });
    assertExit(run, step.exitCode, 'lab-triage promote → adopted');
    assertItemShape(parseJsonOut(run, 'lab-triage promote → adopted').item, step.expect && step.expect.item, 'adopted item');
  });

  next('TRIAGE-06', '步骤 5 candidate → rejected（证据条数 + 归档产物）', () => {
    if (envSkip) return { skip: envSkip };
    const step = stepById(5);
    must(step, '夹具里没有 step 5');
    const exp = step.expect || {};
    const run = runFixtureCommand(step.command, { mapArg, json: true });
    assertExit(run, step.exitCode, 'lab-triage promote → rejected');
    const payload = parseJsonOut(run, 'lab-triage promote → rejected');
    assertItemShape(payload.item, exp.item, 'rejected item');
    must(typeof payload.archive === 'string' && payload.archive !== '', 'rejected 没有生成归档文件');
    if (exp.archive) {
      mustEqual(path.basename(payload.archive), path.basename(exp.archive), '归档文件名');
      must(path.resolve(payload.archive).startsWith(path.resolve(RUN_TMP)), `归档文件跑到了临时目录之外：${payload.archive}`);
      const text = fs.readFileSync(payload.archive, 'utf8');
      for (const needle of exp.archiveContains || []) mustContains(text, needle, '归档内容');
    }
  });

  next('TRIAGE-07', '步骤 6 adopted → dormant（watch 保持 true）', () => {
    if (envSkip) return { skip: envSkip };
    const step = stepById(6);
    must(step, '夹具里没有 step 6');
    const run = runFixtureCommand(step.command, { mapArg, json: true });
    assertExit(run, step.exitCode, 'lab-triage promote → dormant');
    assertItemShape(parseJsonOut(run, 'lab-triage promote → dormant').item, step.expect && step.expect.item, 'dormant item');
  });

  next('TRIAGE-08', '步骤 7 check（byState + 末行 check: OK）', () => {
    if (envSkip) return { skip: envSkip };
    const step = stepById(7);
    must(step, '夹具里没有 step 7');
    const exp = step.expect || {};
    const runJson = runFixtureCommand(step.command, { mapArg, json: true });
    assertExit(runJson, step.exitCode, 'lab-triage check（全生命周期后）');
    mustEqual(parseJsonOut(runJson, 'lab-triage check').summary.byState, exp.byState, 'check byState');
    const runMd = runFixtureCommand(step.command, { mapArg });
    assertExit(runMd, step.exitCode, 'lab-triage check（md）');
    mustEqual(lastNonEmptyLine(runMd.stdout), exp.lastLine, 'check md 末行');
  });

  next('TRIAGE-09', '步骤 8 sync（建议 / 排除 / 反向 info / 产物 / 幂等）', () => {
    if (envSkip) return { skip: envSkip };
    const step = stepById(8);
    must(step, '夹具里没有 step 8');
    const exp = step.expect || {};
    const run = runFixtureCommand(step.command, { mapArg, json: true });
    assertExit(run, step.exitCode, 'lab-triage sync');
    const payload = parseJsonOut(run, 'lab-triage sync');
    const suggested = (payload.suggestions || []).map((x) => x && x.pkg);
    mustEqual(suggested, exp.suggestions, 'sync.suggestions');
    for (const p of exp.excluded || []) must(!suggested.includes(p), `sync 不该建议 ${p}（${JSON.stringify(payload.suggestions)}）`);
    mustEqual(payload.labOnly, exp.labOnly, 'sync.labOnly');
    must(typeof payload.outPath === 'string' && payload.outPath !== '', 'sync 没有写出建议文件');
    if (exp.artifact) {
      mustEqual(path.basename(payload.outPath), path.basename(exp.artifact), 'sync 产物文件名');
      must(path.resolve(payload.outPath).startsWith(path.resolve(RUN_TMP)), `sync 产物跑到了临时目录之外：${payload.outPath}`);
      const text = fs.readFileSync(payload.outPath, 'utf8');
      for (const needle of exp.artifactContains || []) mustContains(text, needle, 'sync 产物内容');
    }
    if (exp.idempotent === true) {
      const again = runFixtureCommand(step.command, { mapArg, json: true });
      assertExit(again, step.exitCode, 'lab-triage sync（第二遍）');
      const payload2 = parseJsonOut(again, 'lab-triage sync（第二遍）');
      mustEqual(path.basename(String(payload2.outPath || '')), path.basename(String(payload.outPath)), 'sync 产物路径（第二遍）');
      const first = fs.readFileSync(payload.outPath, 'utf8');
      const second = fs.readFileSync(payload2.outPath, 'utf8');
      must(first === second, 'sync 产物不幂等：同样的 --now 两次输出不一致');
    }
  });

  next('TRIAGE-10', '全生命周期终态（expectedFinalItems 逐字段对照）', () => {
    if (envSkip) return { skip: envSkip };
    const data = readJsonFile(workFile, '临时 lifecycle 副本');
    const items = Array.isArray(data.items) ? data.items : [];
    const expectedFinal = body.expectedFinalItems || [];
    mustEqual(items.length, expectedFinal.length, '终态条目数');
    for (const exp of expectedFinal) {
      const hit = items.find((x) => x && x.pkg === exp.pkg);
      must(hit, `终态里找不到 ${exp.pkg}`);
      for (const [key, val] of Object.entries(exp)) mustEqual(getPath(hit, key), val, `终态[${exp.pkg}].${key}`);
    }
  });

  // ── 负例 1：非法迁移（不写夹具里的 tmp 副本，用独立 neg 副本）
  next('TRIAGE-11', '负例：非法迁移必须 exit 非 0 且文件不变', () => {
    if (envSkip) return { skip: envSkip };
    const neg = negCases[0];
    must(neg, '夹具里没有 negativeCases[0]');
    fs.copyFileSync(seedAbs, negFile);
    const before = sha256(negFile);
    const run = runFixtureCommand(neg.command, { mapArg });
    assertExit(run, neg.exitCode, 'lab-triage 非法迁移');
    const expect = neg.expect || {};
    if (expect.stderrContains) mustContains(run.stderr, expect.stderrContains, '非法迁移 stderr');
    if (expect.fileUnchanged === true) mustEqual(sha256(negFile), before, '负例副本 sha256（文件必须不变）');
  });

  // ── 负例 2：rejected 没有 evidence → check 必须红
  next('TRIAGE-12', '负例：rejected 无 evidence（check 必须 exit 非 0 并点名违反项）', () => {
    if (envSkip) return { skip: envSkip };
    const template = negCases.find((c) => c && /(^|\s)check(\s|$)/u.test(String(c.command || '')));
    must(template, '夹具里没有 check 类负例可作模板');
    const mutated = JSON.parse(fs.readFileSync(seedAbs, 'utf8'));
    const target = (mutated.items || []).find((x) => x && x.state === 'rejected') || (mutated.items || [])[1];
    must(target, '种子夹具里没有可改造的条目');
    target.state = 'rejected';
    target.evidence = [];
    fs.writeFileSync(negFile, `${JSON.stringify(mutated, null, 2)}\n`, 'utf8');

    // 判据来自工具自己的导出校验器（本文件不写死违反项代码）
    const { violations } = validateLifecycle(mutated);
    must(violations.length > 0, '构造的 rejected 无 evidence 副本没有被校验器判为违反（夹具/工具口径变了）');
    const codes = [...new Set(violations.map((v) => v.code))];

    const run = runFixtureCommand(template.command, { mapArg });
    assertExit(run, template.exitCode, 'lab-triage check（rejected 无 evidence）');
    for (const code of codes) mustContains(run.stdout, code, 'check 违反项代码');
    mustContains(run.stdout, `check: ${String(violations.length)} violation(s)`, 'check 末行');
  });

  // ── 负例 3：trial 没有 trialUntil → check 必须红（期望字串取夹具 negativeCases）
  next('TRIAGE-13', '负例：trial 无 trialUntil（check 必须 exit 非 0，报 INV 违反项）', () => {
    if (envSkip) return { skip: envSkip };
    const neg = negCases.find((c) => c && Array.isArray(c.expect && c.expect.stdoutContains));
    must(neg, '夹具里没有「stdoutContains」型负例');
    const mutated = JSON.parse(fs.readFileSync(seedAbs, 'utf8'));
    const admitted = (mutated.items || []).find((x) => x && x.state === 'adopted');
    must(admitted, '种子夹具里没有 adopted 条目可改造');
    admitted.state = 'trial';
    admitted.trialUntil = null;
    fs.writeFileSync(negFile, `${JSON.stringify(mutated, null, 2)}\n`, 'utf8');
    const run = runFixtureCommand(neg.command, { mapArg });
    assertExit(run, neg.exitCode, 'lab-triage check（trial 无 trialUntil）');
    for (const needle of neg.expect.stdoutContains || []) mustContains(run.stdout, needle, 'check stdout');
  });
}

// ────────────────────────────────────────────────────────────── 3) _catalog

function runCatalogCases(expected, next) {
  const snapshot = path.join(DATA_DIR, 'catalog.json');
  const caseDef = ((expected.data.c2Cases || {}).cases || []).find((c) => c && c.id === 'catalog-check') || null;

  next('CATALOG-01', '_catalog --check 与 data/catalog.json 逐条一致（analyze-expected · catalog-check）', () => {
    if (!caseDef) return { skip: 'fixtures/analyze-expected.json 里没有 c2Cases.cases[id=catalog-check]；期望值无处可取' };
    if (!fs.existsSync(snapshot)) return { skip: `缺 data/catalog.json（先跑 node tools/_catalog.mjs --write）` };

    // 预检：目录源是否可读。源读不到属于环境问题（不是快照错），必须 SKIP 而不是 FAIL。
    const probe = runNode(scriptFor('_catalog.mjs'), ['--json'], { cwd: WORKSPACE });
    if (probe.status !== 0) {
      return { skip: `目录源读不到（_catalog.mjs --json 预检 exit ${String(probe.status)}：${tail(probe.stderr || probe.stdout, 160)}）` };
    }

    const run = runFixtureCommand(caseDef.command, { json: true });
    assertExit(run, caseDef.exitCode, '_catalog --check');
    const payload = parseJsonOut(run, '_catalog --check');
    const exp = caseDef.expect || {};
    for (const [key, val] of Object.entries(exp)) {
      mustEqual(getPath(payload, key), val, `catalog ${key}`);
    }
  });
}

// ────────────────────────────────────────────────────────────── 4) _registry

function runRegistryCases(expected, next) {
  const c32 = expected.data.c32 || {};
  const negatives = Array.isArray(c32.negative) ? c32.negative : [];
  const positives = Array.isArray(c32.positive) ? c32.positive : [];

  const v1Check = negatives.find((c) => c && c.id === 'c32-v1-fixture-check-fails') || null;
  const v1FromFile = negatives.find((c) => c && c.id === 'c32-v1-fixture-from-file-fails') || null;
  const realCheck = positives.find((c) => c && c.id === 'c32-check-ok') || null;
  const v1Fixture = path.join(FIXTURES_DIR, 'registry-sample.json');
  const realSnapshot = path.join(DATA_DIR, 'registry.json');

  next('REGISTRY-01', '负例：v1 旧夹具 --check 必须 exit 非 0（schemaVersion 应为 2）', () => {
    if (!v1Check) return { skip: 'fixtures/goal-expected.json 里没有 c32-v1-fixture-check-fails；期望值无处可取' };
    if (!fs.existsSync(v1Fixture)) return { skip: '缺 fixtures/registry-sample.json' };
    const run = runFixtureCommand(v1Check.command);
    assertExit(run, v1Check.exitCode, '_registry --check（v1 夹具）');
    const text = `${run.stdout}\n${run.stderr}`;
    for (const needle of (v1Check.mdExpect && v1Check.mdExpect.contains) || []) mustContains(text, needle, 'v1 check 输出');
  });

  next('REGISTRY-02', '负例：v1 旧夹具 --from-file 必须 exit 非 0（不许把 v1 当合法输入）', () => {
    if (!v1FromFile) return { skip: 'fixtures/goal-expected.json 里没有 c32-v1-fixture-from-file-fails；期望值无处可取' };
    if (!fs.existsSync(v1Fixture)) return { skip: '缺 fixtures/registry-sample.json' };
    const run = runFixtureCommand(v1FromFile.command, { json: true });
    assertExit(run, v1FromFile.exitCode, '_registry --from-file（v1 夹具）');
    const needle = v1FromFile.mdExpect && v1FromFile.mdExpect.stderrContains;
    if (needle) mustContains(run.stderr, needle, 'v1 from-file stderr');
  });

  next('REGISTRY-03', '正例：真实 data/registry.json --check 通过（c32-check-ok）', () => {
    if (!realCheck) return { skip: 'fixtures/goal-expected.json 里没有 c32-check-ok；期望值无处可取' };
    if (!fs.existsSync(realSnapshot)) {
      return { skip: '缺 data/registry.json（先跑 node tools/_registry.mjs --from-file <raw> --write）' };
    }
    const run = runFixtureCommand(realCheck.command, { json: true });
    must(!run.error && !run.signal, `_registry --check 没跑起来（${run.error ? run.error.code : run.signal}）`);
    // 正例的期望只有 md 形态的 lastLinePrefix（含快照条数，会随 --write 刷新而变）：
    // 取到第一个数字之前的部分当稳定前缀，条数本身不参与断言。
    const prefix = String((realCheck.mdExpect && realCheck.mdExpect.lastLinePrefix) || '').replace(/\d+[\s\S]*$/u, '');
    must(prefix !== '', 'c32-check-ok 没有给出可用的 lastLinePrefix');
    const payload = parseJsonOut(run, '_registry --check（真实快照）');
    mustEqual(payload.ok, true, 'registry check.ok');
    must(typeof payload.count === 'number' && payload.count > 0, `registry check.count 应当 > 0，实际 ${fmt(payload.count)}`);
    mustEqual(run.status, 0, '_registry --check（真实快照）退出码');
    // md 形态再跑一遍：末行必须命中稳定前缀（前缀来自夹具，不含条数）。
    const runMd = runFixtureCommand(realCheck.command);
    must(runMd.stdout.includes(prefix), `_registry --check 末行没命中期望前缀 ${fmt(prefix)}（实际末行：${fmt(lastNonEmptyLine(runMd.stdout))}）`);
  });
}

// ────────────────────────────────────────────────────────────── 5) lab-analyze

/**
 * 每个用例只看任务卡点名的字段（值全部来自 analyze-expected.json）。
 * 不把整个 expect 对象全量套上：例如 collidesWithPlugin.length 取决于本机装了哪些第三方包，
 * 属于环境相关字段，不在本文件断言范围内（见回传的 Q-003）。
 */
const ANALYZE_FIELDS = {
  'rowhog-host-collision': [
    'identity.localData',
    'identity.name',
    'permissions.conclusion',
    'rowContention.severity',
    'rowContention.collidesWithHost[0].severity',
  ],
  'shellcred-full-permission': [
    'identity.localData',
    'identity.name',
    'permissions.conclusion',
    'rowContention.severity',
    'rowContention.collidesWithHost.length',
    'rowContention.collidesWithPlugin.length',
  ],
  'not-local': [
    'identity.localData',
    'identity.name',
    'permissions.scanned',
    'rowContention.selfIds.length',
    'verdict.verdict',
    'warnings',
  ],
};

/**
 * 取夹具里的期望值。analyze-expected.json 用的是**扁平点号键**（"identity.localData": true），
 * 别的夹具用的是嵌套对象；两种都认，先取字面键再退回按路径取值。
 */
function getExpected(obj, field) {
  if (obj && typeof obj === 'object' && Object.prototype.hasOwnProperty.call(obj, field)) return obj[field];
  return getPath(obj, field);
}

function assertAnalyzeFields(payload, expectObj, fields, what) {
  for (const field of fields) {
    const exp = getExpected(expectObj, field);
    must(exp !== undefined, `${what}: 期望文件里没有字段 ${field}`);
    if (field === 'warnings') {
      const text = (Array.isArray(payload.warnings) ? payload.warnings : []).join('\n');
      const terms = quotedTerms(exp);
      must(terms.length > 0, `${what}: warnings 的期望不是「包含「…」」形态：${fmt(exp)}`);
      for (const term of terms) mustContains(text, term, 'warnings');
      continue;
    }
    mustEqual(getPath(payload, field), exp, `${what}.${field}`);
  }
}

function runAnalyzeCases(expected, next) {
  const cases = Array.isArray(expected.data.positiveCases) ? expected.data.positiveCases : [];
  const ids = ['rowhog-host-collision', 'shellcred-full-permission', 'not-local'];
  const labels = {
    'rowhog-host-collision': 'rowhog 夹具：row id 撞官方宿主行 → COLLIDES_WITH_HOST=danger',
    'shellcred-full-permission': 'shellcred 夹具：命令执行 + 凭据 → 权限档「全量（含命令或凭据）」',
    'not-local': '本地无此包 → localData:false + 明确提示（exit 0，不是失败）',
  };

  ids.forEach((id, index) => {
    const caseDef = cases.find((c) => c && c.id === id) || null;
    const num = String(index + 1).padStart(2, '0');
    next(`ANALYZE-${num}`, labels[id], () => {
      if (!caseDef) return { skip: `fixtures/analyze-expected.json 里没有 positiveCases[id=${id}]；期望值无处可取` };
      const fields = ANALYZE_FIELDS[id] || [];
      must(fields.length > 0, `ANALYZE_FIELDS 里没有 ${id} 的字段清单`);
      const run = runFixtureCommand(caseDef.command, { json: true });
      assertExit(run, caseDef.exitCode, `lab-analyze（${id}）`);
      const payload = parseJsonOut(run, `lab-analyze（${id}）`);
      assertAnalyzeFields(payload, caseDef.expect || {}, fields, id);
    });
  });
}

// ────────────────────────────────────────────────────────────── 6) 只读守卫

function runReadonlyCase(before, next) {
  next('READONLY-01', '只读守卫：跑完全套后 lab-guide 的 fixtures/data/out/docs/tools 一个文件都没变', () => {
    const after = snapshotReadonlyDirs();
    const diff = diffSnapshots(before, after);
    const bits = [];
    if (diff.added.length > 0) bits.push(`新增 ${diff.added.slice(0, 6).join('、')}`);
    if (diff.removed.length > 0) bits.push(`消失 ${diff.removed.slice(0, 6).join('、')}`);
    if (diff.changed.length > 0) bits.push(`被改 ${diff.changed.slice(0, 6).join('、')}`);
    must(bits.length === 0, `${bits.join(' ｜ ')}（本工具承诺只读、只打印）`);
  });
}

// ────────────────────────────────────────────────────────────── 主流程

function nextCaseCollector() {
  const queue = [];
  // 分组：TRIAGE 是顺序链（后一步依赖前一步的账本状态），前一步失败时后续同组用例标 SKIP；
  // 其他组互相独立，不受影响。
  const add = (id, desc, fn) => queue.push({ id, desc, fn, group: String(id).split('-')[0] });
  return { queue, add };
}

function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    process.stdout.write(`${USAGE}\n`);
    return 0;
  }

  RUN_TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'lab-guide-selftest-'));
  process.stdout.write(`# lab-guide selftest —— node ${process.version} ｜ 工作区 ${WORKSPACE}\n`);
  process.stdout.write(`# 临时目录 ${RUN_TMP}（跑完删除；仓库根下不写任何文件）\n`);

  let exitCode = 0;
  try {
    const mirror = prepareTriageMirror();
    process.stdout.write(`# lab-triage 临时镜像 ${mirror.length} 个 .mjs（sha256 逐个校验，只为把 OUT_DIR 引到临时目录）\n`);

    const before = snapshotReadonlyDirs();

    const driftExp = loadExpected('expected.json');
    const triageExp = loadExpected('lifecycle-expected.json');
    const analyzeExp = loadExpected('analyze-expected.json');
    const goalExp = loadExpected('goal-expected.json');

    const { queue, add } = nextCaseCollector();
    const next = (id, desc, fn) => add(id, desc, fn);

    if (driftExp.ok) runDriftCases(driftExp, next);
    else ['DRIFT-01', 'DRIFT-02', 'DRIFT-03', 'DRIFT-04', 'DRIFT-05', 'DRIFT-06'].forEach((id) => next(id, 'lab-drift 夹具断言', () => ({ skip: driftExp.reason })));

    if (triageExp.ok) runTriageCases(triageExp, next);
    else Array.from({ length: 13 }, (_, i) => `TRIAGE-${String(i + 1).padStart(2, '0')}`).forEach((id) => next(id, 'lab-triage 夹具断言', () => ({ skip: triageExp.reason })));

    if (analyzeExp.ok) {
      runCatalogCases(analyzeExp, next);
      runAnalyzeCases(analyzeExp, next);
    } else {
      next('CATALOG-01', '_catalog --check', () => ({ skip: analyzeExp.reason }));
      ['ANALYZE-01', 'ANALYZE-02', 'ANALYZE-03'].forEach((id) => next(id, 'lab-analyze 夹具断言', () => ({ skip: analyzeExp.reason })));
    }

    if (goalExp.ok) runRegistryCases(goalExp, next);
    else ['REGISTRY-01', 'REGISTRY-02', 'REGISTRY-03'].forEach((id) => next(id, '_registry 夹具断言', () => ({ skip: goalExp.reason })));

    runReadonlyCase(before, next);

    // 顺序执行；同组的前置用例失败后，依赖它的后续用例标 SKIP（不静默放过，也不重复刷 FAIL）
    const brokenGroups = new Map();
    let carry = null;
    for (const item of queue) {
      const broken = brokenGroups.get(item.group);
      if (broken) {
        skip(item.id, item.desc, broken);
        continue;
      }
      try {
        const r = item.fn(carry);
        if (r && r.skip) {
          skip(item.id, item.desc, r.skip);
        } else {
          pass(item.id, item.desc);
          carry = r || null;
        }
      } catch (err) {
        const msg = err && err.message ? err.message : String(err);
        fail(item.id, item.desc, msg);
        if (VERBOSE && err && err.stack) process.stdout.write(`${err.stack}\n`);
        if (item.group === 'TRIAGE') brokenGroups.set(item.group, `前置步骤失败（TRIAGE 是顺序链，失败点：${item.id}）`);
      }
    }

    const passed = results.filter((r) => r.kind === 'PASS').length;
    const failed = results.filter((r) => r.kind === 'FAIL').length;
    const skipped = results.filter((r) => r.kind === 'SKIP').length;
    process.stdout.write(`${passed} passed, ${failed} failed, ${skipped} skipped\n`);
    exitCode = failed > 0 ? 1 : 0;
  } catch (err) {
    const msg = err && err.message ? err.message : String(err);
    process.stdout.write(`[FAIL] HARNESS-01 selftest 自身执行失败 ｜ ${msg}\n`);
    const passed = results.filter((r) => r.kind === 'PASS').length;
    const failed = results.filter((r) => r.kind === 'FAIL').length + 1;
    const skipped = results.filter((r) => r.kind === 'SKIP').length;
    process.stdout.write(`${passed} passed, ${failed} failed, ${skipped} skipped\n`);
    exitCode = 1;
  } finally {
    try {
      fs.rmSync(RUN_TMP, { recursive: true, force: true });
    } catch {
      process.stderr.write(`selftest: 临时目录没删干净：${RUN_TMP}\n`);
    }
  }

  return exitCode;
}

process.exitCode = main();
