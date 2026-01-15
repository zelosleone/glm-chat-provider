import type * as vscode from "vscode";

export interface GlmModelInfo {
	id: string;
	name: string;
	family: string;
	version: string;
	maxInputTokens: number;
	maxOutputTokens: number;
	tooltip: string;
	capabilities: {
		imageInput: boolean;
		toolCalling: boolean;
	};
}

export const GLM_MODELS: GlmModelInfo[] = [
	{
		id: "glm-4.7",
		name: "GLM-4.7",
		family: "glm",
		version: "4.7",
		tooltip: "Z.ai",
		maxInputTokens: 200000,
		maxOutputTokens: 131072,
		capabilities: { imageInput: false, toolCalling: true },
	},
	{
		id: "glm-4.6",
		name: "GLM-4.6",
		family: "glm",
		version: "4.6",
		tooltip: "Z.ai",
		maxInputTokens: 200000,
		maxOutputTokens: 131072,
		capabilities: { imageInput: false, toolCalling: true },
	},
	{
		id: "glm-4.5",
		name: "GLM-4.5",
		family: "glm",
		version: "4.5",
		tooltip: "Z.ai",
		maxInputTokens: 131072,
		maxOutputTokens: 98304,
		capabilities: { imageInput: false, toolCalling: true },
	},
	{
		id: "glm-4.5-air",
		name: "GLM-4.5 Air",
		family: "glm",
		version: "4.5-air",
		tooltip: "Z.ai",
		maxInputTokens: 131072,
		maxOutputTokens: 98304,
		capabilities: { imageInput: false, toolCalling: true },
	},
];

export function toLanguageModelChatInformation(
	model: GlmModelInfo,
): vscode.LanguageModelChatInformation {
	return {
		id: model.id,
		name: model.name,
		family: model.family,
		version: model.version,
		tooltip: model.tooltip,
		detail: model.tooltip,
		maxInputTokens: model.maxInputTokens,
		maxOutputTokens: model.maxOutputTokens,
		capabilities: model.capabilities,
	};
}
