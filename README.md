# GLM Chat Provider

Use Z.AI GLM models from your GLM Coding Plan in GitHub Copilot Chat.

1. In the Copilot Chat model picker, open **Manage Models**, pick **Z.AI GLM** and paste your API key from [z.ai](https://z.ai).
2. Pick a GLM model in the model picker.
3. Set reasoning effort and temperature right in the picker.

The model list comes live from the Coding Plan API, and context windows, image support and effort levels come from [models.dev](https://models.dev), so new GLM models show up without an update. Brand-new models appear right away with safe default limits until models.dev lists them. Copilot's context window indicator works as usual.

## Model picker

| Option | Values |
|---|---|
| Reasoning Effort | Live per model: Auto, Off and On, or Auto plus levels such as Low, High and Max. Auto sends nothing and lets Z.AI decide. |
| Temperature | Balanced (0.7), Precise (0.2), Creative (0.9), Max (1.0) or Custom |

## Settings and commands

| | |
|---|---|
| `glm-chat-provider.temperature` | Used when the picker's temperature is Custom (0 to 1, default 0.7) |
| **GLM: Set Temperature** | Pick a preset or enter a custom value |
| **GLM: Set API Key** / **GLM: Clear API Key** | Save or remove a key in VS Code's secret storage |
| **GLM: Manage Provider** | Set or clear the key, or test the connection |

Uses the Coding Plan endpoint `https://api.z.ai/api/coding/paas/v4`. MIT license.
