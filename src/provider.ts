import * as vscode from "vscode";
import {
	GlmApiClient,
	GlmApiError,
	type GlmMessage,
	type GlmTool,
} from "./api";
import type { AuthManager } from "./auth";
import { GLM_MODELS, toLanguageModelChatInformation } from "./models";

interface ThinkingState {
	buffer: string;
	insideThinking: boolean;
}

const THINK_OPEN = "<think>";
const THINK_CLOSE = "</think>";

/**
 * Process streaming content to transform <think>...</think> blocks
 * into collapsible markdown <details> sections.
 */
function processThinkingContent(
	content: string,
	state: ThinkingState,
): { output: string; state: ThinkingState } {
	let output = "";
	let buffer = state.buffer + content;
	let insideThinking = state.insideThinking;

	while (buffer.length > 0) {
		if (insideThinking) {
			const closeIdx = buffer.indexOf(THINK_CLOSE);
			if (closeIdx !== -1) {
				output += `${buffer.slice(0, closeIdx)}\n\n</details>\n\n`;
				buffer = buffer.slice(closeIdx + THINK_CLOSE.length);
				insideThinking = false;
			} else {
				let partialMatch = 0;
				for (let i = 1; i < THINK_CLOSE.length && i <= buffer.length; i++) {
					if (buffer.slice(-i) === THINK_CLOSE.slice(0, i)) {
						partialMatch = i;
					}
				}
				if (partialMatch > 0) {
					output += buffer.slice(0, -partialMatch);
					buffer = buffer.slice(-partialMatch);
				} else {
					output += buffer;
					buffer = "";
				}
				break;
			}
		} else {
			const openIdx = buffer.indexOf(THINK_OPEN);
			if (openIdx !== -1) {
				output += `${buffer.slice(0, openIdx)}<details><summary>Thinking</summary>\n\n`;
				buffer = buffer.slice(openIdx + THINK_OPEN.length);
				insideThinking = true;
			} else {
				let partialMatch = 0;
				for (let i = 1; i < THINK_OPEN.length && i <= buffer.length; i++) {
					if (buffer.slice(-i) === THINK_OPEN.slice(0, i)) {
						partialMatch = i;
					}
				}
				if (partialMatch > 0) {
					output += buffer.slice(0, -partialMatch);
					buffer = buffer.slice(-partialMatch);
				} else {
					output += buffer;
					buffer = "";
				}
				break;
			}
		}
	}

	return {
		output,
		state: { buffer, insideThinking },
	};
}

export class GlmChatProvider implements vscode.LanguageModelChatProvider {
	constructor(private readonly authManager: AuthManager) {}

	provideLanguageModelChatInformation(
		_options: vscode.PrepareLanguageModelChatModelOptions,
		_token: vscode.CancellationToken,
	): vscode.ProviderResult<vscode.LanguageModelChatInformation[]> {
		return GLM_MODELS.map(toLanguageModelChatInformation);
	}

	async provideLanguageModelChatResponse(
		model: vscode.LanguageModelChatInformation,
		messages: readonly vscode.LanguageModelChatRequestMessage[],
		options: vscode.ProvideLanguageModelChatResponseOptions,
		progress: vscode.Progress<vscode.LanguageModelResponsePart>,
		token: vscode.CancellationToken,
	): Promise<void> {
		const apiKey = await this.authManager.ensureApiKey();
		if (!apiKey) {
			throw new Error(
				'API key not configured. Use "GLM: Set API Key" command.',
			);
		}

		const client = new GlmApiClient(apiKey);
		const glmMessages = this.convertMessages(messages);
		const glmTools = this.convertTools(options.tools);
		const maxTokens = options.modelOptions?.maxTokens as number | undefined;

		try {
			const stream = client.streamChat(
				model.id,
				glmMessages,
				{
					maxTokens,
					tools: glmTools,
				},
				token,
			);

			const toolCallBuilders = new Map<
				number,
				{ id: string; name: string; arguments: string }
			>();

			let thinkingState: ThinkingState = { buffer: "", insideThinking: false };

			for await (const chunk of stream) {
				if (token.isCancellationRequested) break;

				for (const choice of chunk.choices) {
					const delta = choice.delta;

					if (delta.content) {
						const result = processThinkingContent(delta.content, thinkingState);
						thinkingState = result.state;
						if (result.output) {
							progress.report(new vscode.LanguageModelTextPart(result.output));
						}
					}

					if (delta.tool_calls) {
						for (const toolCall of delta.tool_calls) {
							const index = toolCall.index;
							let builder = toolCallBuilders.get(index);

							if (!builder) {
								builder = { id: "", name: "", arguments: "" };
								toolCallBuilders.set(index, builder);
							}

							if (toolCall.id) builder.id = toolCall.id;
							if (toolCall.function?.name)
								builder.name = toolCall.function.name;
							if (toolCall.function?.arguments) {
								builder.arguments += toolCall.function.arguments;
							}
						}
					}

					if (choice.finish_reason === "tool_calls") {
						for (const [, builder] of toolCallBuilders) {
							if (builder.id && builder.name) {
								let args: Record<string, unknown> = {};
								try {
									args = JSON.parse(builder.arguments || "{}");
								} catch {}
								progress.report(
									new vscode.LanguageModelToolCallPart(
										builder.id,
										builder.name,
										args,
									),
								);
							}
						}
						toolCallBuilders.clear();
					}
				}
			}
		} catch (error) {
			if (error instanceof GlmApiError) {
				if (error.statusCode === 401) {
					await this.authManager.deleteApiKey();
					throw new Error(
						'Invalid API key. Please set a new one using "GLM: Set API Key".',
					);
				}
				if (error.statusCode === 429) {
					throw new Error("Rate limit exceeded. Please wait and try again.");
				}
				throw new Error(`GLM API error: ${error.message}`);
			}
			throw error;
		}
	}

	provideTokenCount(
		_model: vscode.LanguageModelChatInformation,
		text: string | vscode.LanguageModelChatRequestMessage,
		_token: vscode.CancellationToken,
	): Thenable<number> {
		// GLM doesn't provide a token counting endpoint
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
		const result: GlmMessage[] = [];

		for (const msg of messages) {
			const role = this.convertRole(msg.role);
			let content = "";
			let toolCalls: GlmMessage["tool_calls"] | undefined;
			let toolCallId: string | undefined;

			for (const part of msg.content) {
				if (part instanceof vscode.LanguageModelTextPart) {
					content += part.value;
				} else if (part instanceof vscode.LanguageModelToolCallPart) {
					if (!toolCalls) toolCalls = [];
					toolCalls.push({
						id: part.callId,
						type: "function",
						function: {
							name: part.name,
							arguments: JSON.stringify(part.input),
						},
					});
				} else if (part instanceof vscode.LanguageModelToolResultPart) {
					toolCallId = part.callId;
					content =
						typeof part.content === "string"
							? part.content
							: JSON.stringify(part.content);
				}
			}

			if (toolCallId) {
				result.push({
					role: "tool",
					content,
					tool_call_id: toolCallId,
				});
			} else if (toolCalls && toolCalls.length > 0) {
				result.push({
					role: "assistant",
					content: content || "",
					tool_calls: toolCalls,
				});
			} else {
				result.push({
					role,
					content,
					name: msg.name,
				});
			}
		}

		return result;
	}

	private convertRole(
		role: vscode.LanguageModelChatMessageRole,
	): "system" | "user" | "assistant" {
		switch (role) {
			case vscode.LanguageModelChatMessageRole.User:
				return "user";
			case vscode.LanguageModelChatMessageRole.Assistant:
				return "assistant";
			default:
				return "user";
		}
	}

	private convertTools(
		tools?: readonly vscode.LanguageModelChatTool[],
	): GlmTool[] | undefined {
		if (!tools || tools.length === 0) return undefined;

		return tools.map((tool) => ({
			type: "function" as const,
			function: {
				name: tool.name,
				description: tool.description,
				parameters: (tool.inputSchema ?? {}) as Record<string, unknown>,
			},
		}));
	}
}
