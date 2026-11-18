/**
 * 夹具 lab-fixture-rowhog —— 只会写本地文件的假插件（不是可加载的 DSH 插件）。
 *
 * 权限面刻意做成「只有文件写」：
 *   - 用 node:fs 的 mkdirSync / writeFileSync 落地目录文件与备份 → 命中「文件写」
 *   - 不启动子进程（没有命令执行能力）
 *   - 不含任何网络客户端
 *   - 不读取任何凭据
 * 这样「写入」这一档结论才有唯一成因，断言才不含糊。
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const CATALOG_NAME = 'catalog.json';

export function catalogPath(homeDir) {
  return path.join(homeDir, 'plugin-manager', CATALOG_NAME);
}

export function readCatalog(homeDir) {
  const file = catalogPath(homeDir);
  if (!existsSync(file)) return { entries: [] };
  try {
    const text = readFileSync(file, 'utf8');
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' ? parsed : { entries: [] };
  } catch {
    // 读坏了就当成空目录，不覆盖原文件（夹具的「保守」行为）
    return { entries: [] };
  }
}

export function writeCatalog(homeDir, entries) {
  const file = catalogPath(homeDir);
  mkdirSync(path.dirname(file), { recursive: true });
  const payload = { entries: Array.isArray(entries) ? entries : [], updatedAt: new Date().toISOString() };
  writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  return file;
}

export function writeBackup(homeDir, name, content) {
  const dir = path.join(homeDir, 'plugin-manager', 'backups');
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, String(name));
  writeFileSync(file, String(content), 'utf8');
  return file;
}

export default { catalogPath, readCatalog, writeCatalog, writeBackup };
