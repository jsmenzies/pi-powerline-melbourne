# pi-powerline-melbourne

A local repo for custom `pi` extensions.

Currently includes:

- `powerline-context/index.ts` — a lightweight nerd-style powerline footer focused on **current context tokens** (`ctx.getContextUsage()`), not just `%`.

## What this footer does

- Nerd-ish visual style (with ASCII fallback)
- Default segments: pi logo, cwd, git branch, model (+thinking level), context tokens, MCP server status
- Shows **context token count** as `used/window` (e.g. `38k/200k`)
- Color warnings for context pressure:
  - `> 70%` warning
  - `> 90%` error
- Toggle command: `/powerline-melbourne on|off`

## Customize segments

Edit this array in `powerline-context/index.ts`:

```ts
const CONFIG = {
  segments: ["pi", "path", "git", "model", "context_tokens", "mcp"],
  ...
}
```

Available segment IDs:

- `pi`
- `model`
- `path`
- `git`
- `context_tokens`
- `mcp`

If you want percent as well, set:

```ts
showPercentInContext: true
```

## Run locally

### Option A — quick test

```bash
pi -e /home/james/git/pi-powerline-melbourne/powerline-context/index.ts
```

### Option B — install as global extension

```bash
mkdir -p ~/.pi/agent/extensions/powerline-context
cp /home/james/git/pi-powerline-melbourne/powerline-context/index.ts ~/.pi/agent/extensions/powerline-context/index.ts
```

Then restart `pi` or run `/reload`.
