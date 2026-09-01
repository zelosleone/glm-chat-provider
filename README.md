# GLM Chat Provider

Z.AI GLM models as a VS Code Language Model Chat Provider for the Coding Plan.

### Text Models

| Model | Context | Output | Tool Calling |
|---|---|---|---|
| GLM-5.3 | 1M | 128K | Yes |
| GLM-5.2 | 1M | 131K | Yes |
| GLM-5.1 | 200K | 131K | Yes |
| GLM-5 | 205K | 131K | Yes |
| GLM-5-Turbo | 200K | 131K | Yes |
| GLM-4.7 | 205K | 131K | Yes |
| GLM-4.7-Flash | 200K | 131K | Yes |
| GLM-4.7-FlashX | 200K | 131K | Yes |
| GLM-4.6 | 205K | 131K | Yes |
| GLM-4.5 | 131K | 98K | Yes |
| GLM-4.5-Flash | 131K | 98K | Yes |
| GLM-4.5-Air | 131K | 98K | Yes |

### Vision Models

| Model | Context | Output | Image Input | Tool Calling |
|---|---|---|---|---|
| GLM-5.3-Flash | 1M | 128K | Yes (image/video) | Yes |
| GLM-5V-Turbo | 200K | 131K | Yes | Yes |
| GLM-4.6V | 128K | 33K | Yes | Yes |
| GLM-4.5V | 64K | 16K | Yes | Yes |

## Commands

- `GLM: Set API Key` -- Store your Z.AI API key in VS Code secrets
- `GLM: Clear API Key` -- Remove the stored API key
- `GLM: Manage Provider` -- Open provider management options
- `GLM: Set Thinking Effort` -- Toggle thinking mode (Auto, Enabled, Low, High, Max, Disabled)

## Thinking Mode

For models that support it (GLM-4.5 and above), you can control whether the model uses its reasoning/thinking capability.

Run `GLM: Set Thinking Effort` from the Command Palette to choose between:

- **Auto** -- Let the model decide when to think (default)
- **Enabled** -- Always use thinking mode
- **Disabled** -- Never use thinking mode

The selected value is persisted in your VS Code settings under `glm-chat-provider.defaultThinkingMode`.

## How to Use

1. Open the Command Palette and run `GLM: Set API Key` to configure your API credentials
2. Use the provider from VS Code's Language Model Chat UI and select **Z.AI GLM**

---

## License

MIT (c) Denizhan Dakilir
