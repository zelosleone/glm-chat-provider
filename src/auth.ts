import * as vscode from "vscode";

const API_KEY_SECRET_KEY = "glm-chat-provider.apiKey";

export class AuthManager {
	constructor(private readonly secrets: vscode.SecretStorage) {}

	async getApiKey(): Promise<string | undefined> {
		return this.secrets.get(API_KEY_SECRET_KEY);
	}

	async setApiKey(key: string): Promise<void> {
		await this.secrets.store(API_KEY_SECRET_KEY, key);
	}

	async deleteApiKey(): Promise<void> {
		await this.secrets.delete(API_KEY_SECRET_KEY);
	}

	async hasApiKey(): Promise<boolean> {
		const key = await this.getApiKey();
		return key !== undefined && key.length > 0;
	}

	async promptForApiKey(): Promise<string | undefined> {
		const key = await vscode.window.showInputBox({
			prompt: "Enter your Z.ai API Key",
			password: true,
			placeHolder: "sk-...",
			ignoreFocusOut: true,
			validateInput: (value) => {
				if (!value || value.trim().length === 0) {
					return "API key cannot be empty";
				}
				return undefined;
			},
		});

		if (key) {
			await this.setApiKey(key.trim());
			vscode.window.showInformationMessage("GLM API key saved successfully");
		}

		return key;
	}

	async ensureApiKey(): Promise<string | undefined> {
		let key = await this.getApiKey();
		if (!key) {
			key = await this.promptForApiKey();
		}
		return key;
	}
}
