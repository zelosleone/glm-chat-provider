import type * as vscode from "vscode";

const BASE_URL = "https://api.z.ai/api/coding/paas/v4";
const CHAT_ENDPOINT = "/chat/completions";

export interface GlmMessage {
	role: "system" | "user" | "assistant" | "tool";
	content: string;
	name?: string;
	tool_calls?: GlmToolCall[];
	tool_call_id?: string;
}

export interface GlmToolCall {
	id: string;
	type: "function";
	function: {
		name: string;
		arguments: string;
	};
}

export interface GlmTool {
	type: "function";
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
}

export interface GlmStreamChunk {
	id: string;
	created: number;
	model: string;
	choices: Array<{
		index: number;
		delta: {
			role?: string;
			content?: string;
			tool_calls?: Array<{
				index: number;
				id?: string;
				type?: string;
				function?: {
					name?: string;
					arguments?: string;
				};
			}>;
		};
		finish_reason: string | null;
	}>;
}

export interface GlmResponse {
	id: string;
	created: number;
	model: string;
	choices: Array<{
		index: number;
		message: {
			role: string;
			content: string;
			tool_calls?: GlmToolCall[];
		};
		finish_reason: string;
	}>;
	usage: {
		prompt_tokens: number;
		completion_tokens: number;
		total_tokens: number;
	};
}

export class GlmApiError extends Error {
	constructor(
		message: string,
		public readonly statusCode: number,
		public readonly response?: unknown,
	) {
		super(message);
		this.name = "GlmApiError";
	}
}

export class GlmApiClient {
	constructor(private readonly apiKey: string) {}

	async *streamChat(
		model: string,
		messages: GlmMessage[],
		options?: ChatOptions,
		cancellationToken?: vscode.CancellationToken,
	): AsyncGenerator<GlmStreamChunk> {
		const body = {
			model,
			messages,
			stream: true,
			temperature: options?.temperature ?? 0.7,
			top_p: options?.topP,
			max_tokens: options?.maxTokens,
			tools: options?.tools,
			stop: options?.stop,
		};

		// Remove undefined values
		const cleanBody = JSON.parse(JSON.stringify(body));

		const response = await fetch(`${BASE_URL}${CHAT_ENDPOINT}`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${this.apiKey}`,
			},
			body: JSON.stringify(cleanBody),
		});

		if (!response.ok) {
			const errorText = await response.text();
			let errorJson: unknown;
			try {
				errorJson = JSON.parse(errorText);
			} catch {
				errorJson = errorText;
			}
			throw new GlmApiError(
				`GLM API error: ${response.status} ${response.statusText}`,
				response.status,
				errorJson,
			);
		}

		if (!response.body) {
			throw new GlmApiError("No response body", 0);
		}

		const reader = response.body.getReader();
		const decoder = new TextDecoder();
		let buffer = "";

		try {
			while (true) {
				if (cancellationToken?.isCancellationRequested) {
					reader.cancel();
					break;
				}

				const { done, value } = await reader.read();
				if (done) break;

				buffer += decoder.decode(value, { stream: true });
				const lines = buffer.split("\n");
				buffer = lines.pop() || "";

				for (const line of lines) {
					const trimmed = line.trim();
					if (!trimmed || !trimmed.startsWith("data:")) continue;

					const data = trimmed.slice(5).trim();
					if (data === "[DONE]") return;

					try {
						const chunk = JSON.parse(data) as GlmStreamChunk;
						yield chunk;
					} catch {
						// Skip malformed JSON
					}
				}
			}
		} finally {
			reader.releaseLock();
		}
	}

	async chat(
		model: string,
		messages: GlmMessage[],
		options?: ChatOptions,
	): Promise<GlmResponse> {
		const body = {
			model,
			messages,
			stream: false,
			temperature: options?.temperature ?? 0.7,
			top_p: options?.topP,
			max_tokens: options?.maxTokens,
			tools: options?.tools,
			stop: options?.stop,
		};

		const cleanBody = JSON.parse(JSON.stringify(body));

		const response = await fetch(`${BASE_URL}${CHAT_ENDPOINT}`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${this.apiKey}`,
			},
			body: JSON.stringify(cleanBody),
		});

		if (!response.ok) {
			const errorText = await response.text();
			let errorJson: unknown;
			try {
				errorJson = JSON.parse(errorText);
			} catch {
				errorJson = errorText;
			}
			throw new GlmApiError(
				`GLM API error: ${response.status} ${response.statusText}`,
				response.status,
				errorJson,
			);
		}

		return response.json() as Promise<GlmResponse>;
	}
}
