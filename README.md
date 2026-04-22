# pi-powerline-melbourne

A compact `pi` footer extension with a powerline-style status line focused on context usage.

![pi-powerline-melbourne footer](assets/pi-powerline-melbourne-footer.png)

## Install

```bash
pi install npm:pi-powerline-melbourne
```

## Segments (left → right)

- **pi**: pi icon/label
- **path**: current working directory (home is shortened to `~`)
- **git**: current branch
- **model**: selected model + thinking level (`min`, `med`, `xhi`, etc.)
- **context_tokens**: `used/window` token view
- **mcp**: MCP server status (`connected/total`)

## Context warnings (default)

- **< 50%**: OK (green)
- **50% to < 70%**: warning (yellow)
- **>= 70%**: high usage (red)

You can also show percent by setting `showPercentInContext: true` in `powerline-context/index.ts`.

## Command

- `/powerline-melbourne on|off`

