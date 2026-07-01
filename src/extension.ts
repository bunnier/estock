/**
 * 码盯 (estock) 插件入口
 * 注册命令、初始化 StatusBarManager 和 StockService
 */

import * as vscode from 'vscode';
import { StatusBarManager } from './statusBarManager';
import { StockService } from './stockService';

let stockService: StockService | undefined;

export function activate(ctx: vscode.ExtensionContext): void {
  console.log('[estock] activating...');

  const statusBar = new StatusBarManager();
  stockService = new StockService();

  ctx.subscriptions.push(
    vscode.commands.registerCommand('estock.refresh', async () => {
      await stockService?.refreshOnce();
      vscode.window.showInformationMessage('码盯: 数据已刷新');
    }),

    vscode.commands.registerCommand('estock.addStock', async () => {
      const input = await vscode.window.showInputBox({
        prompt: '输入股票代码（A股6位，港股5位）',
        placeHolder: '如 600519 或 00700',
        validateInput: (value: string) => {
          const v = value.trim();
          if (!v) return null;
          if (!/^\d{5,6}$/.test(v)) {
            return '请输入5位（港股）或6位（A股）数字代码';
          }
          return null;
        },
      });
      if (input) {
        await stockService?.addStock(input.trim());
      }
    }),

    vscode.commands.registerCommand('estock.removeStock', async () => {
      const cfg = vscode.workspace.getConfiguration('estock');
      const raw = cfg.get<string[]>('watchList', []);
      if (raw.length === 0) {
        vscode.window.showInformationMessage('股票池为空');
        return;
      }
      const pick = await vscode.window.showQuickPick(
        raw.map(s => ({ label: s, symbol: s })),
        { placeHolder: '选择要从股票池移除的股票' }
      );
      if (pick) {
        await stockService?.removeStock(pick.symbol);
      }
    }),

    // 点击状态栏 → 切换该位置的股票
    vscode.commands.registerCommand('estock.switchStock', async (position: number) => {
      await stockService?.switchStock(position);
    }),

    // 命令面板 → 查看详情
    vscode.commands.registerCommand('estock.showDetail', async () => {
      await stockService?.showDetail();
    }),
  );

  stockService.activate(ctx, statusBar);
  ctx.subscriptions.push({ dispose: () => stockService?.dispose() });

  console.log('[estock] activated');
}

export function deactivate(): void {
  stockService?.dispose();
  stockService = undefined;
}
