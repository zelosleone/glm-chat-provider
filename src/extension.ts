import * as vscode from "vscode";
import { GlmApiClient, GlmApiError } from "./api";
import { AuthManager } from "./auth";
import { GlmChatProvider } from "./provider";

export function activate(context: vscode.ExtensionContext): void {
	const authManager = new AuthManager(context.secrets);
	const provider = new GlmChatProvider(authManager);

	const providerDisposable = vscode.lm.registerLanguageModelChatProvider(
		"zai",
		provider,
	);
	context.subscriptions.push(providerDisposable);

	const setApiKeyCommand = vscode.commands.registerCommand(
		"glm-chat-provider.setApiKey",
		async () => {
			await authManager.promptForApiKey();
		},
	);
	context.subscriptions.push(setApiKeyCommand);

	const clearApiKeyCommand = vscode.commands.registerCommand(
		"glm-chat-provider.clearApiKey",
		async () => {
			await authManager.deleteApiKey();
			vscode.window.showInformationMessage("GLM API key cleared");
		},
	);
	context.subscriptions.push(clearApiKeyCommand);

	const manageCommand = vscode.commands.registerCommand(
		"glm-chat-provider.manage",
		async () => {
			const choice = await vscode.window.showQuickPick(
				["Set API Key", "Clear API Key", "Test Connection"],
				{ placeHolder: "Manage Z.AI GLM provider" },
			);
			if (!choice) return;

			if (choice === "Set API Key") {
				await authManager.promptForApiKey();
			} else if (choice === "Clear API Key") {
				await authManager.deleteApiKey();
				vscode.window.showInformationMessage("GLM API key cleared");
			} else if (choice === "Test Connection") {
				const key = await authManager.getApiKey();
				if (!key) {
					const result = await vscode.window.showInformationMessage(
						"API key is not set. Would you like to set it now?",
						"Set API Key",
					);
					if (result === "Set API Key") {
						await authManager.promptForApiKey();
					}
					return;
				}
				const client = new GlmApiClient(key);
				try {
					await client.chat("glm-4.7", [{ role: "user", content: "Ping" }], {
						maxTokens: 1,
					});
					vscode.window.showInformationMessage("GLM provider test succeeded.");
				} catch (err) {
					if (err instanceof GlmApiError && err.statusCode === 401) {
						vscode.window.showErrorMessage(
							"Invalid API key. Please set a new key.",
						);
					} else {
						vscode.window.showErrorMessage(
							`GLM provider test failed: ${err instanceof Error ? err.message : String(err)}`,
						);
					}
				}
			}
		},
	);
	context.subscriptions.push(manageCommand);
}

export function deactivate(): void {}
