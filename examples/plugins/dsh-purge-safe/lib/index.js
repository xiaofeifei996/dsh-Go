import { SafeStore } from './store.js';
import { managerView, panelData } from './view.js';

export const name = 'dsh-purge-safe';

export function apply(ctx, options = {}) {
  const store = options.store || new SafeStore(options.storeOptions);

  ctx.inject(['dshGo'], (ctx) => {
    ctx.dshGo.panel('manager', {
      view: (scope, caps) => managerView(scope, caps),
      data: (_scope, emit) => {
        const push = () => emit(panelData(store));
        push();
        return () => {};
      },
      actions: {
        'run-check': () => ({
          patch: panelData(store),
          toast: store.selfCheck().ok ? '自检通过' : '自检发现需要检查的项目'
        }),
        'create-backup': () => {
          if (!store.readConfig().enabled) return { toast: '管理操作已停用，请先重新启用' };
          const backup = store.createBackup('manual');
          return {
            patch: panelData(store),
            toast: `备份已创建：${backup.id.slice(-8)}`,
            refresh: 'manager'
          };
        },
        'save-config': (_scope, event) => {
          const values = event?.value?.values || {};
          const config = store.saveConfig({
            enabled: values['data.form.enabled'],
            backupRetention: values['data.form.backupRetention'],
            verbose: values['data.form.verbose']
          });
          store.prune(config.backupRetention);
          return {
            patch: panelData(store),
            toast: '配置已保存',
            refresh: 'manager'
          };
        },
        'rollback-latest': (_scope, event) => {
          if (!store.readConfig().enabled) return { toast: '管理操作已停用，请先重新启用' };
          if (event?.value?.confirmed !== true) return { toast: '已取消回滚' };
          const latest = store.listBackups()[0];
          if (!latest) return { toast: '没有可用备份' };
          const result = store.rollback(latest.id);
          return {
            patch: panelData(store),
            toast: result.changed ? '已回滚本插件配置' : '配置内容相同，无需回滚',
            refresh: 'manager'
          };
        }
      }
    });
  });
}
