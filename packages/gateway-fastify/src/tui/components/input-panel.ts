import chalk from 'chalk';
import type { Component, Editor } from '@mariozechner/pi-tui';
import type { TuiClientState } from '../types.js';
import { renderBottomBorder, renderFrameLine, renderTopBorder } from './box-frame.js';

export class InputPanel implements Component {
  private state: TuiClientState;
  private editor: Editor;

  constructor(state: TuiClientState, editor: Editor) {
    this.state = state;
    this.editor = editor;
  }

  render(width: number): string[] {
    const innerWidth = Math.max(1, width - 2);
    const lines: string[] = [];
    lines.push(renderTopBorder(width, { border: chalk.dim }));
    lines.push(this.frameLine(this.formatPrimaryStatus(), innerWidth));
    lines.push(this.frameLine(this.formatConnectionContext(), innerWidth));

    const eventLine = this.formatEventStatus();
    if (eventLine) {
      lines.push(this.frameLine(eventLine, innerWidth));
    }

    for (const editorLine of this.editor.render(innerWidth)) {
      lines.push(this.frameLine(editorLine, innerWidth));
    }

    lines.push(this.frameLine(chalk.dim('Enter to send | \\ + Enter for newline | /help for commands'), innerWidth));
    lines.push(renderBottomBorder(width, { border: chalk.dim }));

    return lines;
  }

  invalidate(): void {
    this.editor.invalidate();
  }

  private frameLine(content: string, width: number): string {
    return renderFrameLine(content, width, { border: chalk.dim });
  }

  private formatPrimaryStatus(): string {
    const parts = [
      this.state.connected ? chalk.green('connected') : chalk.red('disconnected'),
      this.state.sessionId ? `session ${this.state.sessionId.slice(0, 12)}` : 'session pending',
    ];

    if (this.state.runSessionId) {
      parts.push(`run ${this.state.runSessionId.slice(0, 12)}`);
    }

    parts.push(`events ${this.state.eventMode}`);

    if (this.state.pendingApprovalRunId) {
      parts.push(chalk.yellow(`approval ${this.state.pendingApprovalRunId.slice(0, 8)}`));
    }

    if (this.state.pendingClarificationRunId) {
      parts.push(chalk.yellow(`clarify ${this.state.pendingClarificationRunId.slice(0, 8)}`));
    }

    return parts.join(chalk.dim(' | '));
  }

  private formatConnectionContext(): string {
    const parts = [`channel ${this.state.channel}`];

    if (this.state.tenantId) {
      parts.push(`tenant ${this.state.tenantId}`);
    }

    if (this.state.roles.length > 0) {
      parts.push(`roles ${this.state.roles.join(',')}`);
    }

    return parts.join(chalk.dim(' | '));
  }

  private formatEventStatus(): string | undefined {
    const event = this.state.latestAgentEvent;
    if (!event) {
      return chalk.dim('live event none yet');
    }

    return [chalk.dim('live'), event.compactText].join(chalk.dim(' | '));
  }
}
