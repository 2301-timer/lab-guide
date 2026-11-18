/**
 * 夹具 lab-fixture-shellcred —— 命令执行 + 凭据读取（不是可加载的 DSH 插件）。
 *
 * 权限面刻意做成「命令 + 凭据」两格同时命中：
 *   - child_process / spawn：起一个子进程跑本地命令
 *   - 凭据：从环境变量读 api key，并接受一个 credentialRef 名字
 * 不写文件、不发网络请求 → 结论应当直接落到最高一档
 * 「全量（含命令或凭据）」，成因只有这两个，断言不含糊。
 */

import { spawn } from 'node:child_process';
import path from 'node:path';

export const CREDENTIAL_ENV = 'DSH_API_KEY';

/** 只读环境变量名，不打印、不落盘、不外发（夹具本身也不做这些事）。 */
export function resolveApiKey(env = process.env) {
  const value = env[CREDENTIAL_ENV];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

export function credentialRefOf(name) {
  return `credential:${String(name || 'default')}`;
}

/** 起子进程执行一个本地命令（夹具只在被显式调用时才会跑）。 */
export function runLocalCommand(command, args = [], options = {}) {
  const child = spawn(command, args, {
    cwd: options.cwd || process.cwd(),
    shell: process.platform === 'win32',
    windowsHide: true,
    stdio: 'inherit',
  });
  return child;
}

export function commandFor(target, flag) {
  const dir = path.resolve(target || '.');
  return { command: process.platform === 'win32' ? 'cmd' : 'ls', args: process.platform === 'win32' ? ['/c', 'dir', dir] : [flag || '-la', dir], cwd: dir };
}

export default { CREDENTIAL_ENV, resolveApiKey, credentialRefOf, runLocalCommand, commandFor };
