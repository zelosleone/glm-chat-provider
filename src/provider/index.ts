import * as vscode from 'vscode';
import {match} from 'ts-pattern';
import {GlmApiClient, GlmApiError} from '../api';
import type {ChatCompletionChunk} from 'openai/resources/chat/completions/completions';
import type {AuthManager} from '../auth';
import {
  CHARS_PER_TOKEN_KEY,
  MODEL_CATALOG_CACHE_KEY,
  buildServedModels,
  fetchLiveModels,
  resolveDevCache,
  toChatInfo,
  type GlmModelCatalogPersisted,
  type ModelConfigurationOptions,
  type ModelPickerChatInformation,
  type ServedModel,
} from '../models';
import {
  reasoningRequestFields,
  resolveReasoningChoice,
  type ModelsDevCache,
} from '../modelsDev';
import {createThinkingPart} from './thinking';
import {
  convertMessages,
  convertTools,
  parseToolArguments,
  type ToolCallBuilder,
} from './convert';
import {getConfiguredTemperature} from './temperature';

type ModelWithApiKey = vscode.LanguageModelChatInformation & {
  __glmApiKey?: string;
};

type PrepareLanguageModelChatInfoOptions =
  vscode.PrepareLanguageModelChatModelOptions & {
    readonly configuration?: {
      readonly apiKey?: string;
      readonly [key: string]: unknown;
    };
  };

type UsageDetails = NonNullable<ChatCompletionChunk['usage']>;

const MODEL_CATALOG_REFRESH_INTERVAL_MS = 30 * 60 * 1000;
const COPILOT_USAGE_DATA_PART_MIME = 'usage';

/** Strip image payloads (data URLs / base64) before measuring text size. */
function stripImageData(json: string): string {
  return json.replace(/data:[^"'\\s]*;base64,[A-Za-z0-9+/=\s]+/g, '');
}

function requestCharsOf(messages: unknown, tools: unknown): number {
  return stripImageData(JSON.stringify({messages, tools})).length;
}

function isValidServedModel(value: unknown): value is ServedModel {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const m = value as Record<string, unknown>;
  return (
    typeof m['id'] === 'string' &&
    typeof m['name'] === 'string' &&
    typeof m['context'] === 'number' &&
    typeof m['output'] === 'number' &&
    typeof m['imageInput'] === 'boolean' &&
    typeof m['toolCalling'] === 'boolean'
  );
}

function readCachedCatalog(
  globalState?: vscode.Memento,
): GlmModelCatalogPersisted | undefined {
  if (!globalState) {
    return undefined;
  }
  try {
    const cached =
      globalState.get<GlmModelCatalogPersisted>(MODEL_CATALOG_CACHE_KEY);
    if (!cached || !Array.isArray(cached.models)) {
      return undefined;
    }
    const models = cached.models.filter(isValidServedModel);
    if (models.length === 0) {
      return undefined;
    }
    const devCache =
      cached.devCache &&
      typeof cached.devCache === 'object' &&
      cached.devCache.models &&
      typeof cached.devCache.models === 'object'
        ? (cached.devCache as ModelsDevCache)
        : undefined;
    return {devCache, models};
  } catch {
    return undefined;
  }
}

/**
 * Copilot Chat reads token usage off a data part with this MIME to drive the
 * context-window indicator. Without it the indicator never moves for a
 * third-party provider.
 */
function reportCopilotUsage(
  progress: vscode.Progress<vscode.LanguageModelResponsePart>,
  usage: UsageDetails,
): void {
  const data = {
    prompt_tokens: usage.prompt_tokens,
    completion_tokens: usage.completion_tokens,
    total_tokens: usage.total_tokens,
    prompt_tokens_details: {
      cached_tokens: usage.prompt_tokens_details?.cached_tokens ?? 0,
    },
  };
  progress.report(
    new vscode.LanguageModelDataPart(
      new TextEncoder().encode(JSON.stringify(data)),
      COPILOT_USAGE_DATA_PART_MIME,
    ),
  );
}

export type UsageCallback = (usage: {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  cached_tokens?: number;
}) => void;

export class GlmChatProvider implements vscode.LanguageModelChatProvider {
  private readonly _onDidChangeLanguageModelChatInformation =
    new vscode.EventEmitter<void>();

  readonly onDidChangeLanguageModelChatInformation =
    this._onDidChangeLanguageModelChatInformation.event;

  constructor(
    private readonly authManager: AuthManager,
    globalStateOrUsage?: vscode.Memento | UsageCallback,
    onUsageMaybe?: UsageCallback,
  ) {
    if (typeof globalStateOrUsage === 'function') {
      this.globalState = undefined;
      this.onUsage = globalStateOrUsage;
    } else {
      this.globalState = globalStateOrUsage;
      this.onUsage = onUsageMaybe;
    }
    const cached = readCachedCatalog(this.globalState);
    this.availableModels = cached?.models ?? [];
    this.devCache = cached?.devCache;
    this.servedInfos = this.availableModels.map(toChatInfo);
    const storedCpt = this.globalState?.get<number>(CHARS_PER_TOKEN_KEY);
    this.charsPerToken =
      typeof storedCpt === 'number' && storedCpt > 0 ? storedCpt : 4;
    void this.refreshModels();
    this.refreshTimer = setInterval(() => {
      void this.refreshModels();
    }, MODEL_CATALOG_REFRESH_INTERVAL_MS);
    // Unref in Node so the interval never keeps a test process alive.
    const timer = this.refreshTimer as unknown as {unref?: () => void};
    if (typeof timer.unref === 'function') {
      timer.unref();
    }
  }

  private readonly globalState?: vscode.Memento;
  private readonly onUsage?: UsageCallback;
  private availableModels: ServedModel[];
  private servedInfos: ModelPickerChatInformation[];
  private devCache?: ModelsDevCache;
  private charsPerToken: number;
  private refreshTimer?: ReturnType<typeof setInterval>;
  private lastSeenApiKey?: string;
  private disposed = false;

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = undefined;
    }
    this._onDidChangeLanguageModelChatInformation.dispose();
  }

  /**
   * Re-fetch the live id list, re-resolve models.dev metadata, persist, and
   * fire the change event only when the served infos actually changed.
   * No-op when no API key is available; keeps the previous catalog when
   * either live source fails.
   */
  async refreshModels(apiKeyOverride?: string): Promise<void> {
    if (this.disposed) {
      return;
    }
    // Prefer the key VS Code hands us (requests use it), so timer refreshes work without a stored secret.
    const stored =
      apiKeyOverride?.trim() ||
      this.lastSeenApiKey ||
      (await this.authManager.getApiKey())?.trim();
    if (!stored) {
      return;
    }
    let entries;
    try {
      entries = await fetchLiveModels(stored);
    } catch {
      return;
    }
    let devCache: ModelsDevCache;
    try {
      devCache = await resolveDevCache(entries, this.devCache);
    } catch {
      // models.dev unreachable: keep serving the previous catalog.
      return;
    }
    const models = buildServedModels(entries, devCache);
    if (models.length === 0) {
      return;
    }
    const nextInfos = models.map(toChatInfo);
    const changed =
      JSON.stringify(nextInfos) !== JSON.stringify(this.servedInfos);
    this.devCache = devCache;
    if (!changed) {
      return;
    }
    this.availableModels = models;
    this.servedInfos = nextInfos;
    await this.globalState?.update(MODEL_CATALOG_CACHE_KEY, {
      devCache,
      models,
    } satisfies GlmModelCatalogPersisted);
    this.fireLanguageModelChatInformationChange();
  }

  /** First currently served model id, for connection tests that must not hardcode a model. */
  firstServedModelId(): string | undefined {
    return this.availableModels[0]?.id;
  }

  private findServedModel(modelId: string): ServedModel | undefined {
    return this.availableModels.find(m => m.id === modelId);
  }

  fireLanguageModelChatInformationChange(): void {
    this._onDidChangeLanguageModelChatInformation.fire();
  }

  async provideLanguageModelChatInformation(
    options: PrepareLanguageModelChatInfoOptions,
    token: vscode.CancellationToken,
  ): Promise<vscode.LanguageModelChatInformation[]> {
    void token;
    if (options.configuration === undefined) {
      return [];
    }

    const raw = options.configuration.apiKey;
    const apiKey =
      typeof raw === 'string' && raw.trim().length > 0 ? raw.trim() : undefined;

    if (!apiKey) {
      return [];
    }

    if (apiKey !== this.lastSeenApiKey || this.servedInfos.length === 0) {
      this.lastSeenApiKey = apiKey;
      const refresh = this.refreshModels(apiKey);
      // First run: no catalog yet, so wait instead of showing an empty picker.
      if (this.servedInfos.length === 0) {
        await refresh;
      }
    }

    return this.modelsWithApiKey(apiKey);
  }

  private modelsWithApiKey(
    apiKey: string,
  ): vscode.LanguageModelChatInformation[] {
    return this.servedInfos.map(
      model =>
        ({
          ...model,
          __glmApiKey: apiKey,
        }) as unknown as vscode.LanguageModelChatInformation,
    );
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
      throw new Error(
        'API key not configured. Use "GLM: Set API Key" command.',
      );
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

    const modelConfig = options as ModelConfigurationOptions;
    const temperature = getConfiguredTemperature(modelConfig);
    const served = this.findServedModel(model.id);
    const configured =
      modelConfig.modelConfiguration?.reasoningEffort ??
      modelConfig.configuration?.reasoningEffort;
    const reasoningChoice = resolveReasoningChoice(
      served?.choices,
      configured,
    );
    const reasoningFields = reasoningRequestFields(reasoningChoice, 'enabled');

    const glmMessages = convertMessages(messages);
    const glmTools = convertTools(options.tools);
    const requestChars = requestCharsOf(glmMessages, glmTools);

    const stream = client.streamChat(
      model.id,
      glmMessages,
      {
        maxTokens: options.modelOptions?.maxTokens as number | undefined,
        tools: glmTools,
        temperature,
        thinking: reasoningFields['thinking'] as
          | Record<string, unknown>
          | undefined,
        reasoningEffort: reasoningFields['reasoning_effort'] as
          | string
          | undefined,
        onUsage: usage => {
          this.onUsage?.(usage);
          this.calibrateCharsPerToken(requestChars, usage.prompt_tokens);
        },
      },
      token,
    );

    for await (const chunk of stream) {
      if (token.isCancellationRequested) {
        return;
      }

      if (chunk.usage) {
        reportCopilotUsage(progress, chunk.usage);
      }

      for (const choice of chunk.choices) {
        this.reportDelta(choice.delta, progress);
        this.collectToolCalls(choice.delta.tool_calls, toolCallBuilders);
        if (choice.finish_reason === 'tool_calls') {
          this.reportToolCalls(progress, toolCallBuilders);
        }
      }
    }

    this.reportToolCalls(progress, toolCallBuilders);
  }

  private calibrateCharsPerToken(
    requestChars: number,
    promptTokens: number,
  ): void {
    if (!requestChars || !promptTokens || promptTokens <= 0) {
      return;
    }
    const ratio = Math.min(12, Math.max(1, requestChars / promptTokens));
    this.charsPerToken = 0.7 * this.charsPerToken + 0.3 * ratio;
    void this.globalState?.update(CHARS_PER_TOKEN_KEY, this.charsPerToken);
  }

  private reportDelta(
    delta: ChatCompletionChunk.Choice.Delta,
    progress: vscode.Progress<vscode.LanguageModelResponsePart>,
  ): void {
    const deltaAny = delta as Record<string, unknown>;

    const reasoningContent = deltaAny['reasoning_content'];
    if (typeof reasoningContent === 'string' && reasoningContent) {
      const thinkingPart = createThinkingPart(reasoningContent);
      if (thinkingPart) {
        progress.report(thinkingPart);
      }
    }

    if (delta.content) {
      progress.report(new vscode.LanguageModelTextPart(delta.content));
    }
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
        id: '',
        name: '',
        arguments: '',
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
        throw new Error(
          'Invalid API key. Please set a new one using "GLM: Set API Key".',
        );
      })
      .with(429, async () => {
        throw new Error('Rate limit exceeded. Please wait and try again.');
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
    if (typeof text === 'string') {
      return Promise.resolve(
        Math.max(1, Math.round(text.length / this.charsPerToken)),
      );
    }

    const converted = convertMessages([text]);
    const chars = stripImageData(JSON.stringify(converted)).length;
    return Promise.resolve(
      Math.max(1, Math.round(chars / this.charsPerToken)),
    );
  }
}
