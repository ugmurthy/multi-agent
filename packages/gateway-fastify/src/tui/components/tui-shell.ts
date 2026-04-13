import type { Component, Terminal } from '@mariozechner/pi-tui';

export class TuiShell implements Component {
  private terminal: Terminal;
  private statusBar: Component;
  private messageLog: Component;
  private inputPanel: Component;

  constructor(terminal: Terminal, statusBar: Component, messageLog: Component, inputPanel: Component) {
    this.terminal = terminal;
    this.statusBar = statusBar;
    this.messageLog = messageLog;
    this.inputPanel = inputPanel;
  }

  render(width: number): string[] {
    const statusLines = this.statusBar.render(width);
    const inputLines = this.inputPanel.render(width);
    const availableMessageLines = Math.max(1, this.terminal.rows - statusLines.length - inputLines.length);
    const messageLines = this.messageLog.render(width).slice(-availableMessageLines);
    const paddingLines = Array.from(
      { length: Math.max(0, availableMessageLines - messageLines.length) },
      () => '',
    );

    return [...statusLines, ...paddingLines, ...messageLines, ...inputLines];
  }

  invalidate(): void {
    this.statusBar.invalidate();
    this.messageLog.invalidate();
    this.inputPanel.invalidate();
  }
}
