import * as vscode from "vscode";
import secureJsonParse from "secure-json-parse";
import { P, match } from "ts-pattern";
import { GlmApiClient, GlmApiError, type GlmMessage, type GlmTool, type GlmToolCall } from "./api";
import type { ChatCompletionChunk } from "openai/resources/chat/completions/completions";
import type { AuthManager } from "./auth";

type ToolCallBuilder = {
  id: string;
  name: string;
  arguments: string;
};

type ToolResult = {
  callId: string;
  content: string;
};

type MessageAccumulator = {
  text: string;
  toolCalls: GlmToolCall[];
  toolResult?: ToolResult;
};

type ThinkingState = {
  buffer: string;
  insideThinking: boolean;
};

type PrepareOptionsWithConfiguration = vscode.PrepareLanguageModelChatModelOptions & {
  configuration?: Record<string, unknown>;
};

type ModelWithApiKey = vscode.LanguageModelChatInformation & {
  __glmApiKey?: string;
};

const THINK_OPEN = "<think>";
const THINK_CLOSE = "</think>";
const THINK_OPEN_MARKDOWN = "<details><summary>Thinking</summary>\n\n";
const THINK_CLOSE_MARKDOWN = "\n\n</details>\n\n";

const GLM_MODELS: vscode.LanguageModelChatInformation[] = [
  {
    id: "glm-5",
    name: "GLM-5",
    family: "glm",
    version: "5",
    tooltip: "Z.AI",
    detail: "Z.AI",
    maxInputTokens: 200000,
    maxOutputTokens: 131072,
    capabilities: { imageInput: true, toolCalling: true },
  },
  {
    id: "glm-5-code",
    name: "GLM-5-Code",
    family: "glm",
    version: "5-code",
    tooltip: "Z.AI",
    detail: "Z.AI",
    maxInputTokens: 200000,
    maxOutputTokens: 131072,
    capabilities: { imageInput: true, toolCalling: true },
  },
  {
    id: "glm-4.7",
    name: "GLM-4.7",
    family: "glm",
    version: "4.7",
    tooltip: "Z.AI",
    detail: "Z.AI",
    maxInputTokens: 200000,
    maxOutputTokens: 131072,
    capabilities: { imageInput: false, toolCalling: true },
  },
  {
    id: "glm-4.7-flash",
    name: "GLM-4.7 Flash",
    family: "glm",
    version: "4.7-flash",
    tooltip: "Z.AI",
    detail: "Z.AI",
    maxInputTokens: 200000,
    maxOutputTokens: 131072,
    capabilities: { imageInput: false, toolCalling: true },
  },
  {
    id: "glm-4.6",
    name: "GLM-4.6",
    family: "glm",
    version: "4.6",
    tooltip: "Z.AI",
    detail: "Z.AI",
    maxInputTokens: 200000,
    maxOutputTokens: 131072,
    capabilities: { imageInput: false, toolCalling: true },
  },
  {
    id: "glm-4.5",
    name: "GLM-4.5",
    family: "glm",
    version: "4.5",
    tooltip: "Z.AI",
    detail: "Z.AI",
    maxInputTokens: 131072,
    maxOutputTokens: 98304,
    capabilities: { imageInput: false, toolCalling: true },
  },
  {
    id: "glm-4.5-air",
    name: "GLM-4.5 Air",
    family: "glm",
    version: "4.5-air",
    tooltip: "Z.AI",
    detail: "Z.AI",
    maxInputTokens: 131072,
    maxOutputTokens: 98304,
    capabilities: { imageInput: false, toolCalling: true },
  },
];

function getPartialSuffixLength(buffer: string, marker: string): number {
  for (let i = Math.min(buffer.length, marker.length - 1); i > 0; i--) {
    if (buffer.endsWith(marker.slice(0, i))) {
      return i;
    }
  }
  return 0;
}

function parseToolArguments(argumentsText: string): Record<string, unknown> {
  const parsed = secureJsonParse.safeParse(argumentsText || "{}");
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {};
  }
  return parsed as Record<string, unknown>;
}

function appendThinkingSegment(segment: string, insideThinking: boolean): string {
  return insideThinking ? `${segment}${THINK_CLOSE_MARKDOWN}` : `${segment}${THINK_OPEN_MARKDOWN}`;
}

function processThinkingContent(
  content: string,
  state: ThinkingState,
): { output: string; state: ThinkingState } {
  let output = "";
  let buffer = state.buffer + content;
  let insideThinking = state.insideThinking;

  while (buffer.length > 0) {
    const marker = insideThinking ? THINK_CLOSE : THINK_OPEN;
    const markerIndex = buffer.indexOf(marker);
    if (markerIndex >= 0) {
      output += appendThinkingSegment(buffer.slice(0, markerIndex), insideThinking);
      buffer = buffer.slice(markerIndex + marker.length);
      insideThinking = !insideThinking;
      continue;
    }

    const partialSuffixLength = getPartialSuffixLength(buffer, marker);
    if (partialSuffixLength === 0) {
      output += buffer;
      buffer = "";
      continue;
    }

    output += buffer.slice(0, -partialSuffixLength);
    buffer = buffer.slice(-partialSuffixLength);
  }

  return { output, state: { buffer, insideThinking } };
}

export class GlmChatProvider implements vscode.LanguageModelChatProvider {
  constructor(private readonly authManager: AuthManager) {}

  async provideLanguageModelChatInformation(
    options: vscode.PrepareLanguageModelChatModelOptions,
    token: vscode.CancellationToken,
  ): Promise<vscode.LanguageModelChatInformation[]> {
    void token;
    const optionsWithConfig = options as PrepareOptionsWithConfiguration;

    const configuredApiKey = this.extractConfiguredApiKey(optionsWithConfig);
    if (configuredApiKey) {
      return this.modelsWithApiKey(configuredApiKey);
    }

    const supportsProviderConfiguration = Object.prototype.hasOwnProperty.call(
      optionsWithConfig,
      "configuration",
    );

    // With provider configuration enabled, the ungrouped call should not
    // contribute models. Otherwise each configured group duplicates models.
    if (supportsProviderConfiguration) {
      return [];
    }

    if (options.silent) {
      return [];
    }

    const legacyApiKey = await this.authManager.getApiKey();
    if (!legacyApiKey) {
      return [];
    }

    return this.modelsWithApiKey(legacyApiKey);
  }

  async provideLanguageModelChatResponse(
    model: vscode.LanguageModelChatInformation,
    messages: readonly vscode.LanguageModelChatRequestMessage[],
    options: vscode.ProvideLanguageModelChatResponseOptions,
    progress: vscode.Progress<vscode.LanguageModelResponsePart>,
    token: vscode.CancellationToken,
  ): Promise<void> {
    const modelApiKey = (model as ModelWithApiKey).__glmApiKey;
    const apiKey =
      modelApiKey && modelApiKey.trim().length > 0
        ? modelApiKey
        : await this.authManager.getOrPromptApiKey();

    if (!apiKey) {
      throw new Error('API key not configured. Use "GLM: Set API Key" command.');
    }

    try {
      await this.streamResponse(
        new GlmApiClient(apiKey),
        model,
        messages,
        options,
        progress,
        token,
      );
    } catch (error) {
      await this.throwMappedError(error);
    }
  }

  private async streamResponse(
    client: GlmApiClient,
    model: vscode.LanguageModelChatInformation,
    messages: readonly vscode.LanguageModelChatRequestMessage[],
    options: vscode.ProvideLanguageModelChatResponseOptions,
    progress: vscode.Progress<vscode.LanguageModelResponsePart>,
    token: vscode.CancellationToken,
  ): Promise<void> {
    const toolCallBuilders = new Map<number, ToolCallBuilder>();
    let thinkingState: ThinkingState = { buffer: "", insideThinking: false };

    const stream = client.streamChat(
      model.id,
      this.convertMessages(messages),
      {
        maxTokens: options.modelOptions?.maxTokens as number | undefined,
        tools: this.convertTools(options.tools),
      },
      token,
    );

    for await (const chunk of stream) {
      if (token.isCancellationRequested) {
        return;
      }

      for (const choice of chunk.choices) {
        thinkingState = this.reportTextDelta(choice.delta.content, thinkingState, progress);
        this.collectToolCalls(choice.delta.tool_calls, toolCallBuilders);
        if (choice.finish_reason === "tool_calls") {
          this.reportToolCalls(progress, toolCallBuilders);
        }
      }
    }

    this.reportToolCalls(progress, toolCallBuilders);
  }

  private reportTextDelta(
    content: string | null | undefined,
    state: ThinkingState,
    progress: vscode.Progress<vscode.LanguageModelResponsePart>,
  ): ThinkingState {
    if (!content) {
      return state;
    }

    const result = processThinkingContent(content, state);
    if (result.output) {
      progress.report(new vscode.LanguageModelTextPart(result.output));
    }
    return result.state;
  }

  private collectToolCalls(
    toolCalls: ChatCompletionChunk.Choice.Delta.ToolCall[] | undefined,
    builders: Map<number, ToolCallBuilder>,
  ): void {
    if (!toolCalls?.length) {
      return;
    }

    for (const call of toolCalls) {
      const builder = builders.get(call.index) ?? {
        id: "",
        name: "",
        arguments: "",
      };

      if (call.id) {
        builder.id = call.id;
      }
      if (call.function?.name) {
        builder.name = call.function.name;
      }
      if (call.function?.arguments) {
        builder.arguments += call.function.arguments;
      }

      builders.set(call.index, builder);
    }
  }

  private reportToolCalls(
    progress: vscode.Progress<vscode.LanguageModelResponsePart>,
    builders: Map<number, ToolCallBuilder>,
  ): void {
    if (builders.size === 0) {
      return;
    }

    for (const builder of builders.values()) {
      if (!builder.id || !builder.name) {
        continue;
      }

      progress.report(
        new vscode.LanguageModelToolCallPart(
          builder.id,
          builder.name,
          parseToolArguments(builder.arguments),
        ),
      );
    }

    builders.clear();
  }

  private async throwMappedError(error: unknown): Promise<never> {
    if (!(error instanceof GlmApiError)) {
      throw error;
    }

    await match(error.statusCode)
      .with(401, async () => {
        await this.authManager.deleteApiKey();
        throw new Error('Invalid API key. Please set a new one using "GLM: Set API Key".');
      })
      .with(429, async () => {
        throw new Error("Rate limit exceeded. Please wait and try again.");
      })
      .otherwise(async () => {
        throw new Error(`GLM API error: ${error.message}`);
      });

    throw error;
  }

  provideTokenCount(
    model: vscode.LanguageModelChatInformation,
    text: string | vscode.LanguageModelChatRequestMessage,
    token: vscode.CancellationToken,
  ): Thenable<number> {
    void model;
    void token;
    if (typeof text === "string") {
      return Promise.resolve(Math.ceil(text.length / 4));
    }

    let totalChars = 0;
    for (const part of text.content) {
      if (part instanceof vscode.LanguageModelTextPart) {
        totalChars += part.value.length;
      }
    }
    return Promise.resolve(Math.ceil(totalChars / 4));
  }

  private convertMessages(
    messages: readonly vscode.LanguageModelChatRequestMessage[],
  ): GlmMessage[] {
    return messages.map((message) => this.toGlmMessage(message));
  }

  private toGlmMessage(message: vscode.LanguageModelChatRequestMessage): GlmMessage {
    const accumulated = message.content.reduce<MessageAccumulator>(
      (state, part) =>
        match(part)
          .with(P.instanceOf(vscode.LanguageModelTextPart), (value) => ({
            ...state,
            text: state.text + value.value,
          }))
          .with(P.instanceOf(vscode.LanguageModelToolCallPart), (value) => ({
            ...state,
            toolCalls: [
              ...state.toolCalls,
              {
                id: value.callId,
                type: "function" as const,
                function: {
                  name: value.name,
                  arguments: JSON.stringify(value.input),
                },
              },
            ],
          }))
          .with(P.instanceOf(vscode.LanguageModelToolResultPart), (value) => ({
            ...state,
            toolResult: {
              callId: value.callId,
              content:
                typeof value.content === "string" ? value.content : JSON.stringify(value.content),
            },
          }))
          .otherwise(() => state),
      {
        text: "",
        toolCalls: [],
      },
    );

    if (accumulated.toolResult) {
      return {
        role: "tool",
        content: accumulated.toolResult.content,
        tool_call_id: accumulated.toolResult.callId,
      };
    }

    if (accumulated.toolCalls.length > 0) {
      return {
        role: "assistant",
        content: accumulated.text,
        tool_calls: accumulated.toolCalls,
      };
    }

    return {
      role: this.convertRole(message.role),
      content: accumulated.text,
      name: message.name,
    };
  }

  private convertRole(role: vscode.LanguageModelChatMessageRole): "system" | "user" | "assistant" {
    return match(role)
      .with(vscode.LanguageModelChatMessageRole.Assistant, () => "assistant" as const)
      .with(vscode.LanguageModelChatMessageRole.User, () => "user" as const)
      .otherwise(() => "system" as const);
  }

  private convertTools(tools?: readonly vscode.LanguageModelChatTool[]): GlmTool[] | undefined {
    return tools?.length
      ? tools.map((tool) => ({
          type: "function",
          function: {
            name: tool.name,
            description: tool.description,
            parameters: (tool.inputSchema ?? {}) as Record<string, unknown>,
          },
        }))
      : undefined;
  }

  private extractConfiguredApiKey(options: PrepareOptionsWithConfiguration): string | undefined {
    const config = options.configuration;
    if (!config || typeof config !== "object") {
      return undefined;
    }

    const apiKey = config.apiKey;
    if (typeof apiKey !== "string") {
      return undefined;
    }

    const normalized = apiKey.trim();
    return normalized.length > 0 ? normalized : undefined;
  }

  private modelsWithApiKey(apiKey: string): vscode.LanguageModelChatInformation[] {
    return GLM_MODELS.map((model) => ({
      ...model,
      __glmApiKey: apiKey,
    }));
  }
}
