import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

const DEFAULTS = Object.freeze({ enabled: true, backupRetention: 10, verbose: false });
const MAX_RETENTION = 20;
const NAME = 'dsh-purge-safe';

function homePath(env = process.env) {
  const raw = typeof env.DSH_HOME === 'string' && env.DSH_HOME.trim()
    ? env.DSH_HOME.trim()
    : path.join(os.homedir(), '.dsh');
  return path.resolve(raw);
}
function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function supportedNodeVersion(version = process.versions.node) {
  const parts = version.split('.').map(Number);
  return parts[0] > 22 || (parts[0] === 22 && parts[1] >= 19);
}
export function validateConfig(value) {
  if (!isPlainObject(value)) throw new Error('配置必须是 JSON 对象');
  if (typeof value.enabled !== 'boolean') throw new Error('enabled 必须是布尔值');
  if (!Number.isInteger(value.backupRetention) || value.backupRetention < 1 || value.backupRetention > MAX_RETENTION) {
    throw new Error('backupRetention 必须是 1–' + MAX_RETENTION + ' 的整数');
  }
  if (typeof value.verbose !== 'boolean') throw new Error('verbose 必须是布尔值');
  return { enabled: value.enabled, backupRetention: value.backupRetention, verbose: value.verbose };
}
function safeDirectory(dir, create = false) {
  if (create) fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const stat = fs.lstatSync(dir);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('管理目录不是普通目录，已停止操作');
  return dir;
}
function atomicWrite(file, bytes) {
  const dir = path.dirname(file);
  safeDirectory(dir);
  const tmp = path.join(dir, '.tmp-' + crypto.randomUUID());
  let fd;
  try {
    fd = fs.openSync(tmp, 'wx', 0o600);
    fs.writeFileSync(fd, bytes);
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;
    fs.renameSync(tmp, file);
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
    try { fs.unlinkSync(tmp); } catch {}
  }
}
function digest(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}
export class SafeStore {
  constructor(options = {}) {
    this.home = homePath(options.env || process.env);
    this.base = path.join(this.home, NAME);
    this.backupDir = path.join(this.base, 'backups');
    this.configFile = path.join(this.base, 'config.json');
  }
  ensure() {
    safeDirectory(this.base, true);
    safeDirectory(this.backupDir, true);
  }
  readConfig() {
    if (!fs.existsSync(this.configFile)) return { ...DEFAULTS };
    const st = fs.lstatSync(this.configFile);
    if (!st.isFile() || st.isSymbolicLink()) throw new Error('配置文件不是普通文件');
    return validateConfig(JSON.parse(fs.readFileSync(this.configFile, 'utf8')));
  }
  saveConfig(input) {
    const config = validateConfig(input);
    this.ensure();
    atomicWrite(this.configFile, JSON.stringify(config, null, 2) + '\n');
    return config;
  }
  listBackups() {
    if (!fs.existsSync(this.backupDir)) return [];
    safeDirectory(this.base);
    safeDirectory(this.backupDir);
    return fs.readdirSync(this.backupDir)
      .filter(name => /^backup-[0-9]{8}T[0-9]{6}Z-[a-f0-9-]{36}\.json$/.test(name))
      .map(name => {
        const file = path.join(this.backupDir, name);
        try {
          const st = fs.lstatSync(file);
          if (!st.isFile() || st.isSymbolicLink()) return null;
          const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
          const body = JSON.stringify(doc.config);
          if (doc.format !== 1 || doc.sha256 !== digest(body)) return null;
          validateConfig(doc.config);
          return { id: name.slice(0, -5), createdAt: doc.createdAt, config: doc.config };
        } catch { return null; }
      })
      .filter(Boolean)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  createBackup(reason = 'manual') {
    this.ensure();
    const config = this.readConfig();
    const createdAt = new Date().toISOString();
    const compactDate = createdAt.replace(/[-:]/g, '').replace(/\.\d{3}/, '').replace(/Z$/, 'Z');
    const id = 'backup-' + compactDate + '-' + crypto.randomUUID();
    const doc = { format: 1, id, createdAt, reason, config };
    doc.sha256 = digest(JSON.stringify(config));
    atomicWrite(path.join(this.backupDir, id + '.json'), JSON.stringify(doc, null, 2) + '\n');
    this.prune(config.backupRetention);
    return { id, createdAt, config };
  }
  prune(retention) {
    const keep = this.listBackups().slice(0, Math.max(1, Math.min(MAX_RETENTION, retention)));
    const keepNames = new Set(keep.map(x => x.id + '.json'));
    for (const name of fs.readdirSync(this.backupDir)) {
      if (!/^backup-[0-9]{8}T[0-9]{6}Z-[a-f0-9-]{36}\.json$/.test(name) || keepNames.has(name)) continue;
      const file = path.join(this.backupDir, name);
      const st = fs.lstatSync(file);
      if (st.isFile() && !st.isSymbolicLink()) fs.unlinkSync(file);
    }
  }
  rollback(id) {
    if (typeof id !== 'string' || !/^backup-[0-9]{8}T[0-9]{6}Z-[a-f0-9-]{36}$/.test(id)) throw new Error('备份编号无效');
    const target = this.listBackups().find(item => item.id === id);
    if (!target) throw new Error('备份不存在或校验失败');
    const safety = this.createBackup('before-rollback');
    this.ensure();
    const current = this.readConfig();
    if (JSON.stringify(current) === JSON.stringify(target.config)) {
      return { changed: false, safetyBackup: safety.id, config: current };
    }
    atomicWrite(this.configFile, JSON.stringify(validateConfig(target.config), null, 2) + '\n');
    return { changed: true, safetyBackup: safety.id, config: target.config };
  }
  selfCheck() {
    const rows = [];
    rows.push({ label: 'Node.js', value: process.versions.node, ok: supportedNodeVersion() });
    rows.push({ label: 'DSH_HOME', value: this.home, ok: fs.existsSync(this.home) });
    try {
      if (fs.existsSync(this.base)) safeDirectory(this.base);
      if (fs.existsSync(this.backupDir)) safeDirectory(this.backupDir);
      rows.push({ label: '插件数据目录', value: '目录边界正常', ok: true });
    } catch (error) {
      rows.push({ label: '插件数据目录', value: error.message, ok: false });
    }
    try {
      const config = this.readConfig();
      rows.push({ label: '配置文件', value: '格式与字段校验通过', ok: true });
      rows.push({ label: '备份保留数', value: String(config.backupRetention), ok: true });
    } catch (error) {
      rows.push({ label: '配置文件', value: error.message, ok: false });
    }
    const backups = this.listBackups();
    rows.push({ label: '可用备份', value: String(backups.length) + ' 份（仅插件自身配置）', ok: true });
    return { rows, ok: rows.every(row => row.ok) };
  }
}
export { DEFAULTS };
