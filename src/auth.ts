import * as vscode from 'vscode';

const API_KEY_SECRET_KEY = 'glm-chat-provider.apiKey';

export class AuthManager {
  constructor(private readonly secrets: vscode.SecretStorage) {}

  async getApiKey(): Promise<string | undefined> {
    return this.secrets.get(API_KEY_SECRET_KEY);
  }

  async deleteApiKey(): Promise<void> {
    await this.secrets.delete(API_KEY_SECRET_KEY);
  }

  async promptForApiKey(): Promise<string | undefined> {
    const input = await vscode.window.showInputBox({
      prompt: 'Enter your Z.ai API Key',
      password: true,
      placeHolder: 'sk-...',
      ignoreFocusOut: true,
      validateInput: value => {
        if (!value || value.trim().length === 0) {
          return 'API key cannot be empty';
        }
        return undefined;
      },
    });

    if (!input) {
      return undefined;
    }

    const key = input.trim();
    await this.secrets.store(API_KEY_SECRET_KEY, key);
    vscode.window.showInformationMessage('GLM API key saved successfully');
    return key;
  }

  async getOrPromptApiKey(): Promise<string | undefined> {
    return (await this.getApiKey()) ?? this.promptForApiKey();
  }
}
