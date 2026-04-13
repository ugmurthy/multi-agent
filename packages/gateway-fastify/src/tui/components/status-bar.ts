import chalk from 'chalk';
import type { Component } from '@mariozechner/pi-tui';
import { truncateToWidth } from '@mariozechner/pi-tui';
import type { TuiClientState } from '../types.js';

export class StatusBar implements Component {
  private state: TuiClientState;
  private cachedLines?: string[];
  private cachedWidth?: number;

  constructor(state: TuiClientState) {
    this.state = state;
  }

  render(width: number): string[] {
    if (this.cachedLines && this.cachedWidth === width) {
      return this.cachedLines;
    }

    const parts: string[] = [];

    const status = this.state.connected ? chalk.green('[connected]') : chalk.red('[disconnected]');
    parts.push(status);

    if (this.state.sessionId && typeof this.state.sessionId === 'string') {
      const shortId = this.state.sessionId.slice(0, 12);
      parts.push(`session: ${shortId}`);
    }

    if (this.state.runSessionId && typeof this.state.runSessionId === 'string') {
      const shortId = this.state.runSessionId.slice(0, 12);
      parts.push(`run: ${shortId}`);
    }

    if (this.state.eventMode !== 'off') {
      parts.push(chalk.dim(`events: ${this.state.eventMode}`));
    }

    if (this.state.pendingApprovalRunId) {
      parts.push(chalk.yellow('[approval pending]'));
    }

    if (this.state.pendingClarificationRunId) {
      parts.push(chalk.yellow('[clarification pending]'));
    }

    let line = parts.join(' | ');
    line = truncateToWidth(line, width);

    this.cachedLines = [line];
    this.cachedWidth = width;
    return this.cachedLines;
  }

  invalidate(): void {
    this.cachedLines = undefined;
    this.cachedWidth = undefined;
  }
}
