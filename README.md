**Z.ai GLM models for Coding Plan as a VS Code Language Model Chat Provider.**

- Adds **Z.AI GLM** as a `languageModelChatProvider` for VS Code
- Commands available from the Command Palette:
  - `GLM: Set API Key` (`glm-chat-provider.setApiKey`)
  - `GLM: Clear API Key` (`glm-chat-provider.clearApiKey`)
  - `GLM: Manage Provider` (`glm-chat-provider.manage`)

## How to use

- Open the Command Palette and run `GLM: Set API Key` to configure your API credentials.
- Use the provider from VS Code's Language Model Chat UI and select **Z.AI GLM**.

## Custom models

Built-in models (GLM-5.1, GLM-5, GLM-4.7, …) are always available. To expose an
additional model without rebuilding the extension, add it to
`glm-chat-provider.customModels` in `settings.json`. Only `id` is required; if
an entry's `id` matches a built-in model, it overrides the built-in.

```jsonc
"glm-chat-provider.customModels": [
  {
    "id": "glm-5.1-air",
    "name": "GLM-5.1 Air",
    "version": "5.1-air",
    "maxInputTokens": 200000,
    "maxOutputTokens": 131072,
    "imageInput": false,
    "toolCalling": true
  }
]
```

---

## License

MIT © Denizhan Dakılır
