const binding = (key) => ({ $: `data.${key}` });

function legacyView() {
  return {
    v: 1,
    type: 'stack',
    title: '安全管理',
    children: [
      { type: 'callout', tone: 'info', text: '此版本显示只读管理摘要。完整配置表单需要支持视图 v2 的 App。' },
      { type: 'row', children: [
        { type: 'metric', label: '自检结果', value: binding('check.summary') },
        { type: 'metric', label: '可用备份', value: binding('backupCount') }
      ]},
      { type: 'list', items: binding('check.rows') },
      { type: 'actions', items: [
        { label: '重新自检', icon: 'refresh', action: 'run-check' },
        { label: '立即备份', icon: 'save', action: 'create-backup' }
      ]},
      { type: 'list', items: binding('backups') },
      { type: 'confirm', id: 'rollback-latest', confirmLabel: '确认回滚', cancelLabel: '取消' }
    ]
  };
}

export function managerView(_scope, caps = {}) {
  const components = Array.isArray(caps.components) ? caps.components : [];
  if (!components.includes('form') || !components.includes('toggle') || !components.includes('number')) {
    return legacyView();
  }
  return {
    v: 2,
    type: 'stack',
    children: [
      { type: 'callout', tone: 'info', text: '安全管理版只检查和管理本插件自己的配置文件；不会修改 DSH 核心文件、权限或宿主安全设置。' },
      { type: 'row', children: [
        { type: 'metric', label: '自检结果', value: binding('check.summary') },
        { type: 'metric', label: '可用备份', value: binding('backupCount') }
      ]},
      { type: 'text', text: '**环境自检**', tone: 'muted' },
      { type: 'list', items: binding('check.rows') },
      { type: 'actions', items: [
        { label: '重新自检', icon: 'refresh', action: 'run-check' },
        { label: '立即备份', icon: 'save', action: 'create-backup', style: 'primary' }
      ]},
      { type: 'divider' },
      { type: 'text', text: '**本插件配置**', tone: 'muted' },
      {
        type: 'form',
        submit: 'save-config',
        submitLabel: '保存配置',
        children: [
          { type: 'toggle', label: '启用管理操作', bind: 'data.form.enabled' },
          { type: 'number', label: '备份保留份数（1–20）', bind: 'data.form.backupRetention', min: 1, max: 20, required: true },
          { type: 'toggle', label: '详细日志', bind: 'data.form.verbose' }
        ]
      },
      { type: 'divider' },
      { type: 'text', text: '**备份与回滚**', tone: 'muted' },
      { type: 'list', items: binding('backups') },
      { type: 'confirm', id: 'rollback-latest', confirmLabel: '确认回滚', cancelLabel: '取消' },
      { type: 'text', text: '回滚只恢复上方列出的本插件配置。执行前会自动创建一份当前配置的安全备份。', tone: 'muted' }
    ]
  };
}

export function panelData(store) {
  const check = store.selfCheck();
  const config = store.readConfig();
  const backups = store.listBackups();
  return {
    check: {
      summary: check.ok ? '通过' : '需检查',
      rows: check.rows.map(row => ({
        title: row.label,
        subtitle: row.value,
        trailing: row.ok ? '正常' : '注意',
        icon: row.ok ? 'check' : 'warning',
        tone: row.ok ? 'good' : 'warn'
      }))
    },
    backupCount: String(backups.length),
    backups: backups.slice(0, 10).map(item => ({
      title: item.id,
      subtitle: item.createdAt,
      trailing: '配置快照',
      icon: 'archive'
    })),
    form: config
  };
}
