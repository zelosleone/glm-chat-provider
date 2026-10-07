import type * as vscode from 'vscode';
import {BASE_URL} from './api';
import {
  reasoningChoices,
  reasoningSchema,
  resolveModelsDev,
  tokenLimits,
  type ModelsDevCache,
  type ReasoningChoices,
} from './modelsDev';

export type TemperaturePreset = 'balanced' | 'precise' | 'creative' | 'max';

export const TEMPERATURE_PRESET_VALUES: Record<TemperaturePreset, number> = {
  balanced: 0.7,
  precise: 0.2,
  creative: 0.9,
  max: 1.0,
};

export type ModelConfigurationOptions =
  vscode.ProvideLanguageModelChatResponseOptions & {
    readonly modelConfiguration?: Record<string, unknown>;
    readonly configuration?: Record<string, unknown>;
  };

export type ModelPickerChatInformation =
  vscode.LanguageModelChatInformation & {
    readonly isUserSelectable: boolean;
    readonly statusIcon?: vscode.ThemeIcon;
    readonly detail?: string;
    readonly tooltip?: string;
    readonly configurationSchema?: object;
  };

/**
 * Live-only served model. Ids come from GET {baseUrl}/models; every other
 * field comes from models.dev. Nothing here is hardcoded; this shape is what
 * gets persisted in globalState. New ids appear automatically, removed ids
 * disappear, and an id models.dev doesn't know yet is served with safe
 * default limits until models.dev lists it.
 */
export interface ServedModel {
  id: string;
  name: string;
  context: number;
  output: number;
  imageInput: boolean;
  toolCalling: boolean;
  choices?: ReasoningChoices;
}

export const MODEL_CATALOG_CACHE_KEY = 'glm.modelCatalog.v2';
export const CHARS_PER_TOKEN_KEY = 'glm.charsPerToken';

export interface GlmModelCatalogPersisted {
  devCache?: ModelsDevCache;
  models: ServedModel[];
}

export interface LiveModelEntry {
  id: string;
  name?: string;
}

const NON_CHAT_MODEL_PATTERN = /embed|rerank|moderation|tts|whisper/i;

interface OpenAiModelListResponse {
  data?: Array<{id?: unknown; name?: unknown}>;
}

/**
 * Live model entries from the Z.AI coding endpoint. In practice this
 * endpoint returns ids only, so all metadata is resolved via models.dev.
 */
export async function fetchLiveModels(
  apiKey: string,
): Promise<LiveModelEntry[]> {
  const response = await fetch(`${BASE_URL}/models`, {
    headers: {Authorization: `Bearer ${apiKey}`},
  });
  if (!response.ok) {
    throw new Error(
      `Failed to fetch GLM model catalog: ${response.status} ${response.statusText}`,
    );
  }
  const body = (await response.json()) as OpenAiModelListResponse;
  const entries = Array.isArray(body?.data) ? body.data : [];
  const live: LiveModelEntry[] = [];
  for (const entry of entries) {
    if (!entry || typeof entry.id !== 'string' || entry.id.length === 0) {
      continue;
    }
    if (NON_CHAT_MODEL_PATTERN.test(entry.id)) {
      continue;
    }
    live.push(
      typeof entry.name === 'string' && entry.name.length > 0
        ? {id: entry.id, name: entry.name}
        : {id: entry.id},
    );
  }
  return live;
}

/**
 * Metadata for the given live ids. Throws on network errors so callers keep
 * their previous catalog instead of inventing data.
 */
export function resolveDevCache(
  entries: readonly LiveModelEntry[],
  previous?: ModelsDevCache,
): Promise<ModelsDevCache> {
  return resolveModelsDev(
    BASE_URL,
    entries.map(entry => entry.id),
    previous,
  );
}

/**
 * Join live ids with models.dev metadata. A live id models.dev doesn't know yet still
 * shows up with safe default limits, corrected on the next refresh once models.dev lists it.
 * Name: provider-own name ?? models.dev name ?? id.
 */
export function buildServedModels(
  entries: readonly LiveModelEntry[],
  devCache: ModelsDevCache,
): ServedModel[] {
  const models: ServedModel[] = [];
  const defaulted: string[] = [];
  for (const entry of entries) {
    const dev = devCache.models[entry.id];
    const knownContext = dev?.limit?.context;
    const knownOutput = dev?.limit?.output;
    if (typeof knownContext !== 'number' || typeof knownOutput !== 'number') {
      // A model the vendor lists before models.dev catalogs it still shows up, with safe limits, corrected on the next refresh once models.dev knows it.
      defaulted.push(entry.id);
      models.push({
        id: entry.id,
        name: entry.name ?? dev?.name ?? entry.id,
        context: 131072,
        output: 32768,
        imageInput: false,
        toolCalling: true,
      });
      continue;
    }
    const inputModalities = dev?.modalities?.input ?? [];
    const choices = reasoningChoices(dev?.reasoning_options, undefined);
    models.push({
      id: entry.id,
      name: entry.name ?? dev?.name ?? entry.id,
      context: knownContext,
      output: knownOutput,
      imageInput: inputModalities.includes('image'),
      toolCalling: dev?.tool_call !== false,
      ...(choices ? {choices} : {}),
    });
  }
  if (defaulted.length > 0) {
    console.info(
      `[glm-chat-provider] Using safe default limits for models not yet in models.dev: ${defaulted.join(', ')}.`,
    );
  }
  return models;
}

const TEMPERATURE_SCHEMA_PROPERTY = {
  type: 'string',
  title: 'Temperature',
  enum: ['balanced', 'precise', 'creative', 'max', 'custom'],
  enumItemLabels: ['Balanced', 'Precise', 'Creative', 'Max', 'Custom'],
  enumDescriptions: [
    'Standard (0.7)',
    'Low, good for code (0.2)',
    'Higher, good for writing (0.9)',
    'Highest (1.0)',
    'Custom value set in settings',
  ],
  default: 'balanced',
  description: 'Presets (range: 0.0 – 1.0)',
  group: 'navigation',
} as const;

function buildConfigurationSchema(
  choices: ReasoningChoices | undefined,
): object {
  if (choices) {
    const base = reasoningSchema(choices) as {
      properties: Record<string, unknown>;
    };
    return {
      properties: {
        ...base.properties,
        temperature: TEMPERATURE_SCHEMA_PROPERTY,
      },
    };
  }
  return {
    properties: {
      temperature: TEMPERATURE_SCHEMA_PROPERTY,
    },
  };
}

/**
 * Copilot's own BYOK convention: the prompt budget is the window minus the
 * output reservation. Capabilities come from live models.dev data. The cast
 * covers proposed fields (isBYOK, maxContextWindowTokens) the same way the
 * repo already cast them.
 */
export function toChatInfo(m: ServedModel): ModelPickerChatInformation {
  return {
    id: m.id,
    name: m.name,
    family: 'glm',
    version: m.id.startsWith('glm-') ? m.id.slice('glm-'.length) : m.id,
    detail: 'Z.AI',
    tooltip: 'Z.AI',
    ...tokenLimits(m.context, m.output),
    isBYOK: true,
    isUserSelectable: true,
    capabilities: {
      toolCalling: m.toolCalling,
      imageInput: m.imageInput,
    },
    configurationSchema: buildConfigurationSchema(m.choices),
  } as ModelPickerChatInformation;
}
