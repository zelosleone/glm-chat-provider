import type * as vscode from 'vscode';
import OpenAI from 'openai';
import {match} from 'ts-pattern';
import type {
  ChatCompletionChunk,
  ChatCompletionCreateParamsNonStreaming,
  ChatCompletionCreateParamsStreaming,
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from 'openai/resources/chat/completions/completions';

const BASE_URL = 'https://api.z.ai/api/coding/paas/v4';

export type GlmContentPart =
  | {type: 'text'; text: string}
  | {type: 'image_url'; image_url: {url: string}};

export interface GlmMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | GlmContentPart[];
  name?: string;
  tool_calls?: GlmToolCall[];
  tool_call_id?: string;
}

export interface GlmToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export interface GlmTool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface ChatOptions {
  temperature?: number;
  topP?: number;
  maxTokens?: number;
  tools?: GlmTool[];
  stop?: string[];
  thinking?: Record<string, unknown>;
  reasoningEffort?: string;
  toolStream?: boolean;
  onUsage?: (usage: {prompt_tokens: number; completion_tokens: number; total_tokens: number; cached_tokens?: number}) => void;
}

export class GlmApiError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly response?: unknown,
  ) {
    super(message);
    this.name = 'GlmApiError';
  }
}

function prepareApiKeyForOpenAIClient(apiKey: string): string {
  const cleaned = apiKey.replace(/[\u200B-\u200D\ufeff\u00A0]/g, '').trim();
  let utf16Index = 0;
  for (const ch of cleaned) {
    const cp = ch.codePointAt(0) ?? 0;
    if (cp > 255) {
      throw new GlmApiError(
        `API key must be plain ASCII. Invalid character at index ${utf16Index} (Unicode U+${cp.toString(16).toUpperCase()}). Re-copy the key from the Z.AI console without extra symbols.`,
        400,
      );
    }
    utf16Index += ch.length;
  }
  if (!cleaned) {
    throw new GlmApiError('API key is empty after trimming.', 400);
  }
  return cleaned;
}

export class GlmApiClient {
  private readonly client: OpenAI;

  constructor(apiKey: string) {
    this.client = new OpenAI({
      apiKey: prepareApiKeyForOpenAIClient(apiKey),
      baseURL: BASE_URL,
    });
  }

  private toOpenAiMessages(
    messages: GlmMessage[],
  ): ChatCompletionMessageParam[] {
    return messages.map(message =>
      match(message.role)
        .with('tool', () => ({
          role: 'tool' as const,
          content: message.content,
          tool_call_id: message.tool_call_id ?? '',
        }))
        .with('assistant', () =>
          message.tool_calls?.length
            ? {
                role: 'assistant' as const,
                content: message.content,
                tool_calls: message.tool_calls.map(call => ({
                  id: call.id,
                  type: 'function' as const,
                  function: {
                    name: call.function.name,
                    arguments: call.function.arguments,
                  },
                })),
              }
            : {
                role: 'assistant' as const,
                content: message.content,
              },
        )
        .with('system', () => ({
          role: 'system' as const,
          content: message.content,
        }))
        .otherwise(() => ({
          role: 'user' as const,
          content: message.content,
        })),
    ) as ChatCompletionMessageParam[];
  }

  private toOpenAiTools(tools?: GlmTool[]): ChatCompletionTool[] | undefined {
    if (!tools?.length) {
      return undefined;
    }

    return tools.map(tool => ({
      type: 'function',
      function: {
        name: tool.function.name,
        description: tool.function.description,
        parameters: tool.function.parameters,
      },
    }));
  }

  private applyOptionalParams(
    params:
      | ChatCompletionCreateParamsStreaming
      | ChatCompletionCreateParamsNonStreaming,
    options?: ChatOptions,
  ): void {
    if (options?.topP !== undefined) {
      params.top_p = options.topP;
    }
    if (options?.maxTokens !== undefined) {
      params.max_tokens = options.maxTokens;
    }
    if (options?.stop?.length) {
      params.stop = options.stop;
    }
    if (options?.thinking) {
      (params as unknown as Record<string, unknown>).thinking =
        options.thinking;
    }
    if (options?.reasoningEffort) {
      (params as unknown as Record<string, unknown>).reasoning_effort =
        options.reasoningEffort;
    }
    if (options?.toolStream) {
      // Z.AI-specific: stream tool calls progressively (recommended for GLM-5.3+)
      (params as unknown as Record<string, unknown>).tool_stream = true;
    }

    const tools = this.toOpenAiTools(options?.tools);
    if (tools) {
      params.tools = tools;
    }
  }

  private buildStreamingParams(
    model: string,
    messages: GlmMessage[],
    options?: ChatOptions,
  ): ChatCompletionCreateParamsStreaming {
    const params: ChatCompletionCreateParamsStreaming = {
      model,
      messages: this.toOpenAiMessages(messages),
      stream: true,
      stream_options: {include_usage: true},
    };
    if (options?.temperature !== undefined) {
      params.temperature = options.temperature;
    }
    this.applyOptionalParams(params, options);
    return params;
  }

  private buildNonStreamingParams(
    model: string,
    messages: GlmMessage[],
    options?: ChatOptions,
  ): ChatCompletionCreateParamsNonStreaming {
    const params: ChatCompletionCreateParamsNonStreaming = {
      model,
      messages: this.toOpenAiMessages(messages),
      stream: false,
    };
    if (options?.temperature !== undefined) {
      params.temperature = options.temperature;
    }
    this.applyOptionalParams(params, options);
    return params;
  }

  private toGlmApiError(error: unknown): GlmApiError {
    return match(error)
      .when(
        (value): value is InstanceType<typeof OpenAI.APIError> =>
          value instanceof OpenAI.APIError,
        value =>
          new GlmApiError(
            `GLM API error: ${value.status} ${value.message}`,
            value.status ?? 0,
            value.error,
          ),
      )
      .when(
        (value): value is Error => value instanceof Error,
        value => new GlmApiError(`GLM API error: ${value.message}`, 0),
      )
      .otherwise(
        value => new GlmApiError(`GLM API error: ${String(value)}`, 0),
      );
  }

  async *streamChat(
    model: string,
    messages: GlmMessage[],
    options?: ChatOptions,
    cancellationToken?: vscode.CancellationToken,
  ): AsyncGenerator<ChatCompletionChunk> {
    const abortController = new AbortController();
    const cancellationDisposable = cancellationToken?.onCancellationRequested(
      () => abortController.abort(),
    );

    try {
      const stream = (await this.client.chat.completions.create(
        this.buildStreamingParams(model, messages, options),
        {
          signal: abortController.signal,
        },
      )) as AsyncIterable<ChatCompletionChunk>;

      for await (const chunk of stream) {
        if (cancellationToken?.isCancellationRequested) {
          return;
        }

        if (chunk.usage && options?.onUsage) {
          options.onUsage({
            prompt_tokens: chunk.usage.prompt_tokens,
            completion_tokens: chunk.usage.completion_tokens,
            total_tokens: chunk.usage.total_tokens,
            cached_tokens: (chunk.usage as {prompt_tokens_details?: {cached_tokens?: number}}).prompt_tokens_details?.cached_tokens,
          });
        }

        yield chunk;
      }
    } catch (error) {
      throw this.toGlmApiError(error);
    } finally {
      cancellationDisposable?.dispose();
    }
  }

  async chat(
    model: string,
    messages: GlmMessage[],
    options?: ChatOptions,
  ): Promise<void> {
    try {
      await this.client.chat.completions.create(
        this.buildNonStreamingParams(model, messages, options),
      );
    } catch (error) {
      throw this.toGlmApiError(error);
    }
  }
}
