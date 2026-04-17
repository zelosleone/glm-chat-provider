import * as vscode from 'vscode';

const CONFIG_SECTION = 'glm-chat-provider';
const CUSTOM_MODELS_KEY = 'customModels';

const DEFAULT_MAX_INPUT_TOKENS = 200000;
const DEFAULT_MAX_OUTPUT_TOKENS = 131072;
const DEFAULT_FAMILY = 'glm';
const DEFAULT_TOOLTIP = 'Z.AI';
const DEFAULT_DETAIL = 'Z.AI';

export interface CustomModelConfig {
  id: string;
  name?: string;
  family?: string;
  version?: string;
  tooltip?: string;
  detail?: string;
  maxInputTokens?: number;
  maxOutputTokens?: number;
  imageInput?: boolean;
  toolCalling?: boolean;
}

export const DEFAULT_GLM_MODELS: vscode.LanguageModelChatInformation[] = [
  {
    id: 'glm-5.1',
    name: 'GLM-5.1',
    family: 'glm',
    version: '5.1',
    tooltip: 'Z.AI',
    detail: 'Z.AI',
    maxInputTokens: 200000,
    maxOutputTokens: 131072,
    capabilities: {imageInput: true, toolCalling: true},
  },
  {
    id: 'glm-5',
    name: 'GLM-5',
    family: 'glm',
    version: '5',
    tooltip: 'Z.AI',
    detail: 'Z.AI',
    maxInputTokens: 200000,
    maxOutputTokens: 131072,
    capabilities: {imageInput: true, toolCalling: true},
  },
  {
    id: 'glm-5-code',
    name: 'GLM-5-Code',
    family: 'glm',
    version: '5-code',
    tooltip: 'Z.AI',
    detail: 'Z.AI',
    maxInputTokens: 200000,
    maxOutputTokens: 131072,
    capabilities: {imageInput: true, toolCalling: true},
  },
  {
    id: 'glm-4.7',
    name: 'GLM-4.7',
    family: 'glm',
    version: '4.7',
    tooltip: 'Z.AI',
    detail: 'Z.AI',
    maxInputTokens: 200000,
    maxOutputTokens: 131072,
    capabilities: {imageInput: false, toolCalling: true},
  },
  {
    id: 'glm-4.7-flash',
    name: 'GLM-4.7 Flash',
    family: 'glm',
    version: '4.7-flash',
    tooltip: 'Z.AI',
    detail: 'Z.AI',
    maxInputTokens: 200000,
    maxOutputTokens: 131072,
    capabilities: {imageInput: false, toolCalling: true},
  },
  {
    id: 'glm-4.6',
    name: 'GLM-4.6',
    family: 'glm',
    version: '4.6',
    tooltip: 'Z.AI',
    detail: 'Z.AI',
    maxInputTokens: 200000,
    maxOutputTokens: 131072,
    capabilities: {imageInput: false, toolCalling: true},
  },
  {
    id: 'glm-4.5',
    name: 'GLM-4.5',
    family: 'glm',
    version: '4.5',
    tooltip: 'Z.AI',
    detail: 'Z.AI',
    maxInputTokens: 131072,
    maxOutputTokens: 98304,
    capabilities: {imageInput: false, toolCalling: true},
  },
  {
    id: 'glm-4.5-air',
    name: 'GLM-4.5 Air',
    family: 'glm',
    version: '4.5-air',
    tooltip: 'Z.AI',
    detail: 'Z.AI',
    maxInputTokens: 131072,
    maxOutputTokens: 98304,
    capabilities: {imageInput: false, toolCalling: true},
  },
];

function applyOverride(
  base: vscode.LanguageModelChatInformation | undefined,
  raw: CustomModelConfig,
  id: string,
): vscode.LanguageModelChatInformation {
  return {
    id,
    name: raw.name ?? base?.name ?? id,
    family: raw.family ?? base?.family ?? DEFAULT_FAMILY,
    version: raw.version ?? base?.version ?? id,
    tooltip: raw.tooltip ?? base?.tooltip ?? DEFAULT_TOOLTIP,
    detail: raw.detail ?? base?.detail ?? DEFAULT_DETAIL,
    maxInputTokens:
      raw.maxInputTokens ?? base?.maxInputTokens ?? DEFAULT_MAX_INPUT_TOKENS,
    maxOutputTokens:
      raw.maxOutputTokens ?? base?.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
    capabilities: {
      imageInput: raw.imageInput ?? base?.capabilities?.imageInput ?? false,
      toolCalling: raw.toolCalling ?? base?.capabilities?.toolCalling ?? true,
    },
  };
}

export function resolveGlmModels(): vscode.LanguageModelChatInformation[] {
  const custom = vscode.workspace
    .getConfiguration(CONFIG_SECTION)
    .get<CustomModelConfig[]>(CUSTOM_MODELS_KEY, []);

  const byId = new Map<string, vscode.LanguageModelChatInformation>();
  for (const model of DEFAULT_GLM_MODELS) {
    byId.set(model.id, model);
  }

  if (Array.isArray(custom)) {
    for (const raw of custom) {
      if (!raw || typeof raw.id !== 'string') {
        continue;
      }
      const id = raw.id.trim();
      if (id.length === 0) {
        continue;
      }
      byId.set(id, applyOverride(byId.get(id), raw, id));
    }
  }

  return [...byId.values()];
}
