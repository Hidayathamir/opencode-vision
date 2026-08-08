# opencode-eye

An [opencode](https://opencode.ai) plugin that lets non-eye models work with
images. When you attach an image while using a model that cannot see images
(e.g. DeepSeek), the plugin:

1. stores the image locally,
2. replaces it in the conversation with a marker,
3. exposes an `ask_image` tool that routes the image plus your question to a
   configurable, eye-capable model and relays the answer back.

Eye-capable models (e.g. Claude, GPT-4o, Gemini) pass images through
untouched — the plugin does nothing for them.

## Install

Add the plugin and an `eye.model` to your `opencode.json` (opencode installs
npm plugins automatically at startup — no manual `npm install` needed):

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": [
    ["opencode-eye", {
      "eye": {
        "model": "openrouter/qwen-2.5-vl-72b"
      }
    }]
  ]
}
```

`eye.model` is required for the core feature: without it there is no eye model
for `ask_image` to route to, so images from models known to lack eye support are
replaced with an explanatory text part instead of a marker (see [Behavior
without an eye model](#behavior-without-an-eye-model)). Restart opencode after
changing the config.

### Options

| Option | Default | Description |
| ------ | ------- | ----------- |
| `eye.model` | *(none — required)* | The model used to inspect images, as `provider/model`. Any model you already use in opencode works here — the plugin reuses opencode's provider auth, no extra API keys. |
| `eye.timeoutMs` | `60000` | Total budget for one `ask_image` call, covering sending the image and waiting for the reply. |
| `cacheDir` | `~/.cache/opencode-eye` | Where stripped images are stored (the cache files live under `<cacheDir>/img/`). |

## How it works

1. A message with an image arrives and opencode fires the `chat.message` hook.
2. If the target model cannot see images, the plugin writes the image bytes to
   `~/.cache/opencode-eye/img/`.
3. The image part is replaced with a marker:

   ```
   [Attached image /home/user/.cache/opencode-eye/img/img_<sha1>.png — use the ask_image tool to inspect its contents]
   ```

   The marker persists in opencode's history, so the image stays addressable
   across restarts.
4. When the model needs the image content, it calls
   `ask_image(imagePath, question)` where `imagePath` is any image file's
   absolute path — the cache path from the marker, or any other image file on
   disk (e.g. a screenshot).
5. The plugin reads the file, sends it plus the question to the configured
   eye model, and returns the answer.
6. The internal eye session is created with a fixed title and **all tools
   disabled** (`tools: {"*": false}`):
   - providers that cap the number of tools per request are never hit, no
     matter how many tools your opencode session registers;
   - opencode skips title generation for the internal session, so the eye
     model is not called (and cannot fail) just to title the session.
7. If the eye model fails, the provider's error detail is surfaced to the
   model with guidance to check `eye.model`. Failures detected on the
   internal session fail fast — the main model gets the error right away
   instead of waiting out the full timeout.

### Behavior without an eye model

- A model **known** to lack image support: the image is replaced with an
  explanatory text part telling the model to configure `eye.model` (opencode
  offers no way to fully block a message).
- A model whose capability **cannot be determined** (provider lookup fails or
  the model is absent from `providers()`): the message passes through untouched
  — the image is handed to a model that may not actually be able to see it.
  Configure an `eye.model` to get reliable stripping even when detection
  cannot decide.

## Security

`ask_image` can read **any** image file on disk and upload it to the configured
eye provider, and the model decides which path to pass. This is a deliberate
tradeoff: the model can inspect screenshots and other on-disk images you may
have referenced, not just pasted images. Consider:

- The eye provider receives every image the model asks about. Choose a
  provider you trust with your files.
- A prompt injection in session content could steer the model toward calling
  `ask_image` on sensitive files (e.g. `~/.ssh`, credential screenshots). Treat
  the model + provider as untrusted for anything you would not paste into a
  chat with that provider.
- No permission prompt is shown before a file is read and uploaded. If that is
  a problem for your threat model, this plugin is not a good fit without adding
  an allowlist.

## Notes

- Images are stored under `~/.cache/opencode-eye/img/` only when they are
  stripped for a non-eye model, and are sent only to the configured eye
  provider when `ask_image` is called.
- Only PNG, JPEG, GIF, and WEBP can be cached. Other formats (e.g. SVG, HEIC,
  BMP) are replaced with an error marker that tells the model to provide a file
  path instead of being silently mislabeled.
- Repeated `ask_image` calls with the same path and question are answered from
  an in-memory cache (no repeated billing). The cache key includes the file's
  size and mtime, so a changed file is re-inspected rather than returning a
  stale answer.
- `eye.timeoutMs` bounds the whole call. When a call exceeds the budget, the
  in-flight requests to the eye provider are aborted before the timeout is
  surfaced, so the provider stops working on them.

## Manual test

1. Configure the plugin with an eye model and restart opencode.
2. Open a session with a non-eye model (e.g. DeepSeek).
3. Paste an image and ask, e.g., "what error message is shown?".
4. Expected: the image becomes a marker, the model calls
   `ask_image(imagePath, question)`, and the answer is relayed to you.
5. Repeat in a session with an eye-capable model: the image passes through
   unchanged.
