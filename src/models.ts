import type * as vscode from 'vscode';

export type TemperaturePreset = 'recommended' | 'balanced' | 'precise' | 'creative' | 'max';
export type ThinkingMode = 'auto' | 'enabled' | 'disabled' | 'low' | 'high' | 'max';

export const TEMPERATURE_PRESET_VALUES: Record<TemperaturePreset, number> = {
  recommended: 1.0,
  balanced: 0.7,
  precise: 0.2,
  creative: 0.9,
  max: 1.0,
};

function buildModelConfigurationSchema(thinkingSupport?: ThinkingSupport) {
  if (thinkingSupport === 'always-on') {
    return {
      properties: {
        thinkingMode: {
          type: 'string',
          title: 'Thinking',
          enum: ['enabled'],
          enumItemLabels: ['Always On'],
          enumDescriptions: ['Thinking is always active for this model'],
          default: 'enabled',
          group: 'navigation',
        },
        temperature: {
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
        },
      },
    } as const;
  }

  if (thinkingSupport === 'always-on-effort') {
    return {
      properties: {
        thinkingMode: {
          type: 'string',
          title: 'Thinking',
          enum: ['low', 'high', 'max'],
          enumItemLabels: ['Low', 'High', 'Max'],
          enumDescriptions: [
            'Lightweight reasoning — fastest responses',
            'Enhanced reasoning — balanced',
            'Deep reasoning — best for complex tasks (default)',
          ],
          default: 'max',
          group: 'navigation',
        },
        temperature: {
          type: 'string',
          title: 'Temperature',
          enum: ['recommended', 'balanced', 'precise', 'creative', 'max', 'custom'],
          enumItemLabels: [
            'Recommended (1.0)',
            'Balanced',
            'Precise',
            'Creative',
            'Max',
            'Custom',
          ],
          enumDescriptions: [
            'Z.AI-recommended for this model (1.0)',
            'Standard (0.7)',
            'Low, good for code (0.2)',
            'Higher, good for writing (0.9)',
            'Highest (1.0)',
            'Custom value set in settings',
          ],
          default: 'recommended',
          description: 'Presets (range: 0.0 – 1.0)',
          group: 'navigation',
        },
      },
    } as const;
  }

  if (thinkingSupport === 'on-off-effort') {
    return {
      properties: {
        thinkingMode: {
          type: 'string',
          title: 'Thinking',
          enum: ['auto', 'high', 'max', 'disabled'],
          enumItemLabels: ['Auto', 'High', 'Max', 'Disabled'],
          enumDescriptions: [
            'Let the model decide (default)',
            'Enabled, high effort — faster responses',
            'Enabled, max effort — best for complex tasks (recommended)',
            'Disable chain-of-thought',
          ],
          default: 'auto',
          group: 'navigation',
        },
        temperature: {
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
        },
      },
    } as const;
  }

  return {
    properties: {
      thinkingMode: {
        type: 'string',
        title: 'Thinking',
        enum: ['auto', 'enabled', 'disabled'],
        enumItemLabels: ['Auto', 'Enabled', 'Disabled'],
        enumDescriptions: [
          'Let the model decide (default)',
          'Always enable chain-of-thought',
          'Disable chain-of-thought',
        ],
        default: 'auto',
        group: 'navigation',
      },
      temperature: {
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
      },
    },
  } as const;
}

export const MODEL_CONFIGURATION_SCHEMA_BASE = buildModelConfigurationSchema('on-off');
export const MODEL_CONFIGURATION_SCHEMA_EFFORT = buildModelConfigurationSchema('on-off-effort');

export function getModelConfigurationSchema(
  thinkingSupport?: ThinkingSupport,
): typeof MODEL_CONFIGURATION_SCHEMA_BASE {
  return buildModelConfigurationSchema(thinkingSupport);
}

export type ModelConfigurationOptions = vscode.ProvideLanguageModelChatResponseOptions & {
  readonly modelConfiguration?: Record<string, unknown>;
  readonly configuration?: Record<string, unknown>;
};

export type ModelPickerChatInformation = vscode.LanguageModelChatInformation & {
  readonly isUserSelectable: boolean;
  readonly statusIcon?: vscode.ThemeIcon;
  readonly detail?: string;
  readonly tooltip?: string;
  readonly configurationSchema?: ReturnType<typeof getModelConfigurationSchema>;
};

export type ThinkingSupport = 'on-off' | 'always-on' | 'on-off-effort' | 'always-on-effort';

export interface GlmModelDefinition {
  id: string;
  name: string;
  family: string;
  version: string;
  detail: string;
  maxInputTokens: number;
  maxOutputTokens: number;
  capabilities: {
    toolCalling: boolean;
    imageInput: boolean;
    thinking: boolean;
  };
  /** 'on-off': thinking can be enabled/disabled via API.
   *  'always-on': thinking is always active and cannot be disabled.
   *  'on-off-effort': thinking can be enabled/disabled, with multiple effort levels (high/max).
   *  'always-on-effort': thinking cannot be disabled; effort levels low/high/max (GLM-5.3+). */
  thinkingSupport: ThinkingSupport;
  /** Z.AI-recommended default temperature for this model, sent when the user
   *  has not picked a preset in the picker or settings (e.g. 1.0 for GLM-5.3). */
  readonly recommendedTemperature?: number;
  /** Model accepts `tool_stream: true` so tool calls stream progressively
   *  instead of arriving in one block at the end of the response. */
  readonly supportsToolStream?: boolean;
}

export const GLM_MODEL_DEFINITIONS: readonly GlmModelDefinition[] = [
  {
    id: 'glm-5.3',
    name: 'GLM-5.3',
    family: 'glm',
    version: '5.3',
    detail: 'Z.AI',
    maxInputTokens: 1000000,
    maxOutputTokens: 131072,
    capabilities: {imageInput: false, toolCalling: true, thinking: true},
    thinkingSupport: 'always-on-effort',
    recommendedTemperature: 1.0,
    supportsToolStream: true,
  },
  {
    id: 'glm-5.3-flash',
    name: 'GLM-5.3 Flash',
    family: 'glm',
    version: '5.3-flash',
    detail: 'Z.AI',
    maxInputTokens: 1000000,
    maxOutputTokens: 131072,
    capabilities: {imageInput: true, toolCalling: true, thinking: true},
    thinkingSupport: 'always-on-effort',
    recommendedTemperature: 1.0,
    supportsToolStream: true,
  },
  {
    id: 'glm-5.2',
    name: 'GLM-5.2',
    family: 'glm',
    version: '5.2',
    detail: 'Z.AI',
    maxInputTokens: 1000000,
    maxOutputTokens: 131072,
    capabilities: {imageInput: false, toolCalling: true, thinking: true},
    thinkingSupport: 'on-off-effort',
  },
  {
    id: 'glm-5.1',
    name: 'GLM-5.1',
    family: 'glm',
    version: '5.1',
    detail: 'Z.AI',
    maxInputTokens: 204800,
    maxOutputTokens: 131072,
    capabilities: {imageInput: false, toolCalling: true, thinking: true},
    thinkingSupport: 'on-off',
  },
  {
    id: 'glm-5',
    name: 'GLM-5',
    family: 'glm',
    version: '5',
    detail: 'Z.AI',
    maxInputTokens: 204800,
    maxOutputTokens: 131072,
    capabilities: {imageInput: false, toolCalling: true, thinking: true},
    thinkingSupport: 'on-off',
  },
  {
    id: 'glm-5-turbo',
    name: 'GLM-5-Turbo',
    family: 'glm',
    version: '5-turbo',
    detail: 'Z.AI',
    maxInputTokens: 204800,
    maxOutputTokens: 131072,
    capabilities: {imageInput: false, toolCalling: true, thinking: true},
    thinkingSupport: 'on-off',
  },
  {
    id: 'glm-5v-turbo',
    name: 'GLM-5V-Turbo',
    family: 'glm',
    version: '5v-turbo',
    detail: 'Z.AI',
    maxInputTokens: 204800,
    maxOutputTokens: 131072,
    capabilities: {imageInput: true, toolCalling: true, thinking: true},
    thinkingSupport: 'on-off',
  },
  {
    id: 'glm-4.7',
    name: 'GLM-4.7',
    family: 'glm',
    version: '4.7',
    detail: 'Z.AI',
    maxInputTokens: 204800,
    maxOutputTokens: 131072,
    capabilities: {imageInput: false, toolCalling: true, thinking: true},
    thinkingSupport: 'on-off',
  },
  {
    id: 'glm-4.7-flash',
    name: 'GLM-4.7 Flash',
    family: 'glm',
    version: '4.7-flash',
    detail: 'Z.AI',
    maxInputTokens: 204800,
    maxOutputTokens: 131072,
    capabilities: {imageInput: false, toolCalling: true, thinking: true},
    thinkingSupport: 'on-off',
  },
  {
    id: 'glm-4.7-flashx',
    name: 'GLM-4.7 FlashX',
    family: 'glm',
    version: '4.7-flashx',
    detail: 'Z.AI',
    maxInputTokens: 204800,
    maxOutputTokens: 131072,
    capabilities: {imageInput: false, toolCalling: true, thinking: true},
    thinkingSupport: 'on-off',
  },
  {
    id: 'glm-4.6',
    name: 'GLM-4.6',
    family: 'glm',
    version: '4.6',
    detail: 'Z.AI',
    maxInputTokens: 204800,
    maxOutputTokens: 131072,
    capabilities: {imageInput: false, toolCalling: true, thinking: true},
    thinkingSupport: 'on-off',
  },
  {
    id: 'glm-4.6v',
    name: 'GLM-4.6V',
    family: 'glm',
    version: '4.6v',
    detail: 'Z.AI',
    maxInputTokens: 131072,
    maxOutputTokens: 32768,
    capabilities: {imageInput: true, toolCalling: true, thinking: true},
    thinkingSupport: 'on-off',
  },
  {
    id: 'glm-4.5',
    name: 'GLM-4.5',
    family: 'glm',
    version: '4.5',
    detail: 'Z.AI',
    maxInputTokens: 131072,
    maxOutputTokens: 98304,
    capabilities: {imageInput: false, toolCalling: true, thinking: true},
    thinkingSupport: 'always-on',
  },
  {
    id: 'glm-4.5-flash',
    name: 'GLM-4.5 Flash',
    family: 'glm',
    version: '4.5-flash',
    detail: 'Z.AI',
    maxInputTokens: 131072,
    maxOutputTokens: 98304,
    capabilities: {imageInput: false, toolCalling: true, thinking: true},
    thinkingSupport: 'always-on',
  },
  {
    id: 'glm-4.5-air',
    name: 'GLM-4.5 Air',
    family: 'glm',
    version: '4.5-air',
    detail: 'Z.AI',
    maxInputTokens: 131072,
    maxOutputTokens: 98304,
    capabilities: {imageInput: false, toolCalling: true, thinking: true},
    thinkingSupport: 'always-on',
  },
  {
    id: 'glm-4.5v',
    name: 'GLM-4.5V',
    family: 'glm',
    version: '4.5v',
    detail: 'Z.AI',
    maxInputTokens: 64000,
    maxOutputTokens: 16384,
    capabilities: {imageInput: true, toolCalling: true, thinking: true},
    thinkingSupport: 'always-on',
  },
];

export const GLM_MODELS: vscode.LanguageModelChatInformation[] = GLM_MODEL_DEFINITIONS.map(
  (m) =>
    ({
      id: m.id,
      name: m.name,
      family: m.family,
      version: m.version,
      tooltip: 'Z.AI',
      detail: 'Z.AI',
      maxInputTokens: m.maxInputTokens,
      maxOutputTokens: m.maxOutputTokens,
      capabilities: {imageInput: m.capabilities.imageInput, toolCalling: m.capabilities.toolCalling},
    }) as vscode.LanguageModelChatInformation,
);
