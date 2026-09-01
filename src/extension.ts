import * as vscode from 'vscode';
import {match} from 'ts-pattern';
import {GlmApiClient, GlmApiError} from './api';
import {AuthManager} from './auth';
import {GlmChatProvider, type UsageCallback} from './provider';

async function setApiKey(
  authManager: AuthManager,
  provider: GlmChatProvider,
): Promise<void> {
  await authManager.promptForApiKey();
  provider.fireLanguageModelChatInformationChange();
}

async function clearApiKey(
  authManager: AuthManager,
  provider: GlmChatProvider,
): Promise<void> {
  await authManager.deleteApiKey();
  provider.fireLanguageModelChatInformationChange();
  vscode.window.showInformationMessage('GLM API key cleared');
}

async function testConnection(
  authManager: AuthManager,
  provider: GlmChatProvider,
): Promise<void> {
  const key = await authManager.getApiKey();
  if (!key) {
    const shouldSetKey = await vscode.window.showInformationMessage(
      'No API key in extension storage. Use "GLM: Set API Key" first, then run this test again.',
      'Set API Key',
    );
    if (shouldSetKey === 'Set API Key') {
      await setApiKey(authManager, provider);
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

async function setThinkingEffort(): Promise<void> {
  const config = vscode.workspace.getConfiguration('glm-chat-provider');
  const current = config.get<string>('defaultThinkingMode', 'auto');

  const items = [
    {
      label: 'Auto',
      description: 'Let the model decide when to think',
      value: 'auto',
      picked: current === 'auto',
    },
    {
      label: 'Enabled',
      description: 'Always enable thinking mode',
      value: 'enabled',
      picked: current === 'enabled',
    },
    {
      label: 'Low',
      description: 'Thinking enabled, low effort — fastest (GLM-5.3+)',
      value: 'low',
      picked: current === 'low',
    },
    {
      label: 'High',
      description: 'Thinking enabled, high effort (GLM-5.2+)',
      value: 'high',
      picked: current === 'high',
    },
    {
      label: 'Max',
      description: 'Thinking enabled, max effort (GLM-5.2+)',
      value: 'max',
      picked: current === 'max',
    },
    {
      label: 'Disabled',
      description: 'Always disable thinking mode',
      value: 'disabled',
      picked: current === 'disabled',
    },
  ];

  const choice = await vscode.window.showQuickPick(items, {
    placeHolder: 'Select thinking effort for GLM models',
  });

  if (!choice) {
    return;
  }

  await config.update('defaultThinkingMode', choice.value, true);
  vscode.window.showInformationMessage(
    `GLM thinking effort set to ${choice.label}`,
  );
}

async function setTemperature(): Promise<void> {
  const presets = [
    {key: 'balanced', label: 'Balanced', value: 0.7, description: 'Default for most tasks'},
    {
      key: 'precise',
      label: 'Precise',
      value: 0.2,
      description: 'Coding / Math (deterministic)',
    },
    {key: 'creative', label: 'Creative', value: 0.9, description: 'Writing / Brainstorming'},
    {key: 'max', label: 'Max', value: 1.0, description: 'Maximum (most random)'},
  ];

  const selection = await vscode.window.showQuickPick(
    [
      ...presets.map(p => ({
        label: p.label,
        description: `${p.value} — ${p.description}`,
        value: p.value,
      })),
      {label: 'Custom', description: 'Enter your own value (0.0 - 1.0)', value: undefined},
    ],
    {placeHolder: 'Select temperature for GLM models'},
  );

  if (!selection) return;

  let value: number;
  if (selection.value === undefined) {
    const input = await vscode.window.showInputBox({
      prompt: 'Enter temperature value (0.0 - 1.0)',
      validateInput: (text) => {
        const parsed = Number.parseFloat(text);
        if (Number.isNaN(parsed) || parsed < 0 || parsed > 1) {
          return 'Value must be a number between 0.0 and 1.0';
        }
        return undefined;
      },
    });
    if (!input) return;
    value = Number.parseFloat(input);
  } else {
    value = selection.value;
  }

  await vscode.workspace.getConfiguration('glm-chat-provider').update('temperature', value, true);
  vscode.window.showInformationMessage(`GLM temperature set to ${value}`);
}

export function activate(context: vscode.ExtensionContext): void {
  const authManager = new AuthManager(context.secrets);

  let requestCount = 0;
  const usageStatusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    100,
  );
  usageStatusBarItem.text = 'GLM: $(database) 0 req';
  usageStatusBarItem.tooltip =
    'Requests this session. Resets every 5h. Click to manage.';
  usageStatusBarItem.command = 'glm-chat-provider.manage';

  const onUsage: UsageCallback = (_usage) => {
    requestCount += 1;
    usageStatusBarItem.text = `GLM: $(database) ${requestCount} req`;
    usageStatusBarItem.tooltip = [
      `Requests this session: ${requestCount}`,
      'Click to manage provider',
    ].join('\n');
    usageStatusBarItem.show();
  };

  const provider = new GlmChatProvider(authManager, onUsage);

  const manageActions: Record<string, () => Promise<void>> = {
    'Set API Key': () => setApiKey(authManager, provider),
    'Clear API Key': () => clearApiKey(authManager, provider),
    'Test Connection': () => testConnection(authManager, provider),
  };

  context.subscriptions.push(
    usageStatusBarItem,
    vscode.lm.registerLanguageModelChatProvider('zai', provider),
    vscode.commands.registerCommand('glm-chat-provider.setApiKey', async () => {
      await setApiKey(authManager, provider);
    }),
    vscode.commands.registerCommand(
      'glm-chat-provider.clearApiKey',
      async () => {
        await clearApiKey(authManager, provider);
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
    vscode.commands.registerCommand(
      'glm-chat-provider.setThinkingEffort',
      async () => {
        await setThinkingEffort();
      },
    ),
    vscode.commands.registerCommand(
      'glm-chat-provider.setTemperature',
      async () => {
        await setTemperature();
      },
    ),
  );
}

export function deactivate(): void {}
