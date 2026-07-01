const workspace = {
  getConfiguration() {
    throw new Error('getConfiguration stub was not installed.');
  },
  onDidChangeConfiguration() {
    return { dispose() {} };
  },
};

const window = {
  showQuickPick() {
    throw new Error('showQuickPick stub was not installed.');
  },
  showInformationMessage() {},
  showWarningMessage() {},
  showErrorMessage() {},
  createStatusBarItem() {
    return {
      show() {},
      dispose() {},
    };
  },
  createOutputChannel() {
    return {
      clear() {},
      appendLine() {},
      show() {},
    };
  },
};

module.exports = {
  ConfigurationTarget: {
    Global: 1,
  },
  StatusBarAlignment: {
    Left: 1,
    Right: 2,
  },
  commands: {
    registerCommand() {
      return { dispose() {} };
    },
  },
  workspace,
  window,
};
