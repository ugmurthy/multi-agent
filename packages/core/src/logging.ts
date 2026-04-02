import type { AgentRun, ModelMessage, ModelRequest, ModelResponse, RunResult, ToolDefinition } from './types.js';

import { captureValueForLog, summarizeValueForLog } from './logger.js';

export function runLogBindings(run: Pick<AgentRun, 'id' | 'rootRunId' | 'parentRunId' | 'delegateName' | 'delegationDepth'>) {
  return {
    runId: run.id,
    rootRunId: run.rootRunId,
    parentRunId: run.parentRunId,
    delegateName: run.delegateName,
    delegationDepth: run.delegationDepth,
  };
}

export function summarizeModelRequestForLog(request: ModelRequest) {
  return {
    messageCount: request.messages.length,
    messages: request.messages.map(summarizeModelMessageForLog),
    toolNames: request.tools?.map((tool) => tool.name) ?? [],
    outputSchema: request.outputSchema ? summarizeValueForLog(request.outputSchema) : undefined,
    metadata: captureValueForLog(request.metadata),
  };
}

export function summarizeModelResponseForLog(response: ModelResponse) {
  return {
    finishReason: response.finishReason,
    providerResponseId: response.providerResponseId,
    summary: response.summary,
    toolCalls:
      response.toolCalls?.map((toolCall) => ({
        id: toolCall.id,
        name: toolCall.name,
        input: summarizeValueForLog(toolCall.input),
      })) ?? [],
    text: response.text ? summarizeValueForLog(response.text) : undefined,
    structuredOutput:
      response.structuredOutput === undefined ? undefined : summarizeValueForLog(response.structuredOutput),
    usage: response.usage ? captureValueForLog(response.usage, { mode: 'full' }) : undefined,
  };
}

export function captureToolInputForLog(tool: ToolDefinition, input: unknown, fallbackMode: 'full' | 'summary' | 'none') {
  return captureValueForLog(input, {
    mode: tool.capture ?? fallbackMode,
    redactPaths: tool.redact?.inputPaths,
  });
}

export function captureToolOutputForLog(tool: ToolDefinition, output: unknown, fallbackMode: 'full' | 'summary' | 'none') {
  const mode = tool.capture ?? fallbackMode;
  const logValue = mode === 'summary' && tool.summarizeResult ? tool.summarizeResult(output as never) : output;
  return captureValueForLog(logValue, {
    mode,
    redactPaths: tool.redact?.outputPaths,
  });
}

export function summarizeRunResultForLog(result: RunResult) {
  switch (result.status) {
    case 'success':
      return {
        status: result.status,
        output: summarizeValueForLog(result.output),
        stepsUsed: result.stepsUsed,
        usage: captureValueForLog(result.usage, { mode: 'full' }),
      };
    case 'failure':
      return {
        status: result.status,
        error: result.error,
        code: result.code,
        stepsUsed: result.stepsUsed,
        usage: captureValueForLog(result.usage, { mode: 'full' }),
      };
    default:
      return captureValueForLog(result, { mode: 'summary' });
  }
}

function summarizeModelMessageForLog(message: ModelMessage) {
  return {
    role: message.role,
    name: message.name,
    toolCallId: message.toolCallId,
    content: summarizeValueForLog(message.content),
    toolCalls: message.toolCalls?.map((toolCall) => ({
      id: toolCall.id,
      name: toolCall.name,
      input: summarizeValueForLog(toolCall.input),
    })),
  };
}
