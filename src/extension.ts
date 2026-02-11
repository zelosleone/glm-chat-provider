import * as vscode from 'vscode';
import {match} from 'ts-pattern';
import {GlmApiClient, GlmApiError} from './api';
import {AuthManager} from './auth';
import {GlmChatProvider} from './provider';

async function setApiKey(authManager: AuthManager): Promise<void> {
  await authManager.promptForApiKey();
}

async function clearApiKey(authManager: AuthManager): Promise<void> {
  await authManager.deleteApiKey();
  vscode.window.showInformationMessage('GLM API key cleared');
}

async function testConnection(authManager: AuthManager): Promise<void> {
  const key = await authManager.getApiKey();
  if (!key) {
    const shouldSetKey = await vscode.window.showInformationMessage(
      'API key is not set. Would you like to set it now?',
      'Set API Key',
    );
    if (shouldSetKey === 'Set API Key') {
      await authManager.promptForApiKey();
    }
    return;
  }

  const client = new GlmApiClient(key);
  try {
    await client.chat('glm-4.7', [{role: 'user', content: 'Ping'}], {
      maxTokens: 1,
    });
    vscode.window.showInformationMessage('GLM provider test succeeded.');
  } catch (error) {
    const message = match(error)
      .when(
        (value): value is GlmApiError =>
          value instanceof GlmApiError && value.statusCode === 401,
        () => 'Invalid API key. Please set a new key.',
      )
      .when(
        (value): value is Error => value instanceof Error,
        value => `GLM provider test failed: ${value.message}`,
      )
      .otherwise(value => `GLM provider test failed: ${String(value)}`);
    vscode.window.showErrorMessage(message);
  }
}

export function activate(context: vscode.ExtensionContext): void {
  const authManager = new AuthManager(context.secrets);
  const provider = new GlmChatProvider(authManager);

  const manageActions: Record<string, () => Promise<void>> = {
    'Set API Key': () => setApiKey(authManager),
    'Clear API Key': () => clearApiKey(authManager),
    'Test Connection': () => testConnection(authManager),
  };

  context.subscriptions.push(
    vscode.lm.registerLanguageModelChatProvider('zai', provider),
    vscode.commands.registerCommand('glm-chat-provider.setApiKey', async () => {
      await setApiKey(authManager);
    }),
    vscode.commands.registerCommand(
      'glm-chat-provider.clearApiKey',
      async () => {
        await clearApiKey(authManager);
      },
    ),
    vscode.commands.registerCommand('glm-chat-provider.manage', async () => {
      const choice = await vscode.window.showQuickPick(
        Object.keys(manageActions),
        {
          placeHolder: 'Manage Z.AI GLM provider',
        },
      );
      const action = choice ? manageActions[choice] : undefined;
      if (!action) {
        return;
      }
      await action();
    }),
  );
}

export function deactivate(): void {}
