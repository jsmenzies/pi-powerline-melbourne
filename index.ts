import type { ExtensionAPI, ReadonlyFooterDataProvider, Theme, ThemeColor } from "@mariozechner/pi-coding-agent";
import { truncateToWidth } from "@mariozechner/pi-tui";

type SegmentId = "pi" | "model" | "path" | "git" | "context_tokens" | "mcp";

const CONFIG = {
  segments: ["pi", "path", "git", "model", "context_tokens", "mcp"] as SegmentId[],

  segmentColors: {
    pi: "accent",
    model: "customMessageLabel",
    path: "success",
    git: "thinkingHigh",
    context_tokens: "dim",
    mcp: "dim",
  } as Record<SegmentId, ThemeColor>,

  separator: " ❯ ",
  asciiSeparator: " | ",
  separatorColor: "warning" as ThemeColor,

  showPercentInContext: false,
  contextOkColor: "success" as ThemeColor,
  contextWarnColor: "warning" as ThemeColor,
  contextErrorColor: "error" as ThemeColor,
  contextOkThresholdPct: 50,
  contextWarnThresholdPct: 70,

  modelIconColor: "accent" as ThemeColor,
  modelThinkingColor: "text" as ThemeColor,
};

const THINKING_LABELS: Record<string, string> = {
  minimal: "min",
  medium: "med",
  xhigh: "xhi",
};

const ICONS = {
  nerd: {
    pi: "",
    model: "",
    path: "",
    git: "",
    context: "󰍛",
  },
  ascii: {
    pi: "pi",
    model: "mdl",
    path: "dir",
    git: "git",
    context: "ctx",
  },
};

function hasNerdFonts(): boolean {
  if (process.env.POWERLINE_NERD_FONTS === "1") return true;
  if (process.env.POWERLINE_NERD_FONTS === "0") return false;

  const term = (process.env.TERM_PROGRAM || "").toLowerCase();
  if (["iterm", "wezterm", "kitty", "ghostty", "alacritty"].some((v) => term.includes(v))) return true;
  return Boolean(process.env.GHOSTTY_RESOURCES_DIR);
}

function formatTokens(n: number): string {
  if (n < 1000) return `${n}`;
  if (n < 10000) return `${(n / 1000).toFixed(1)}k`;
  if (n < 1000000) return `${Math.round(n / 1000)}k`;
  if (n < 10000000) return `${(n / 1000000).toFixed(1)}M`;
  return `${Math.round(n / 1000000)}M`;
}

function getThinkingLabel(pi: ExtensionAPI): string {
  const level = pi.getThinkingLevel();
  return THINKING_LABELS[level] ?? level;
}

function modelName(model: { id: string; name?: string } | undefined): string {
  const raw = model?.name || model?.id || "no-model";
  return raw.startsWith("Claude ") ? raw.slice(7) : raw;
}

function formatDisplayPath(cwd: string): string {
  const home = process.env.HOME || process.env.USERPROFILE;
  if (home && cwd.startsWith(home)) return `~${cwd.slice(home.length)}` || "~";
  return cwd;
}

function getMcpServerCounts(footerData: ReadonlyFooterDataProvider): { connected: number; total: number } | null {
  const status = footerData.getExtensionStatuses().get("mcp");
  if (!status) return null;

  const plain = status.replace(/\x1B\[[0-9;]*m/g, "");
  const slashMatch = plain.match(/MCP:\s*(\d+)\s*\/\s*(\d+)\s*servers/i);
  if (slashMatch) {
    return { connected: Number(slashMatch[1]), total: Number(slashMatch[2]) };
  }

  const connectedMatch = plain.match(/MCP:\s*(\d+)\s*servers\s*connected/i);
  if (!connectedMatch) return null;

  const connected = Number(connectedMatch[1]);
  return { connected, total: Math.max(1, connected) };
}

function renderSegment(
  id: SegmentId,
  pi: ExtensionAPI,
  ctx: any,
  theme: Theme,
  footerData: ReadonlyFooterDataProvider,
  nerd: boolean,
): string | null {
  const icon = nerd ? ICONS.nerd : ICONS.ascii;

  switch (id) {
    case "pi":
      return theme.fg(CONFIG.segmentColors.pi ?? "accent", `${icon.pi}`);

    case "model": {
      const level = getThinkingLabel(pi);
      return [
        theme.fg(CONFIG.modelIconColor, icon.model),
        theme.fg(CONFIG.modelIconColor, ` ${modelName(ctx.model)}`),
        theme.fg(CONFIG.modelThinkingColor, ` (${level})`),
      ].join("");
    }

    case "path":
      return theme.fg(CONFIG.segmentColors.path ?? "mdLink", `${icon.path} ${formatDisplayPath(ctx.cwd)}`);

    case "git": {
      const branch = footerData.getGitBranch();
      return branch ? theme.fg(CONFIG.segmentColors.git ?? "success", `${icon.git} ${branch}`) : null;
    }

    case "context_tokens": {
      const usage = ctx.getContextUsage?.();
      const windowSize = usage?.contextWindow ?? ctx.model?.contextWindow;
      if (!windowSize) return null;

      const tokens = usage?.tokens;
      const pct = usage?.percent;
      const ratio = tokens === undefined || tokens === null
        ? `?/${formatTokens(windowSize)}`
        : `${formatTokens(tokens)}/${formatTokens(windowSize)}`;
      const display = CONFIG.showPercentInContext && pct !== undefined && pct !== null
        ? `${ratio} (${pct.toFixed(1)}%)`
        : ratio;
      const text = `${icon.context} ${display}`;

      if (pct === undefined || pct === null) return theme.fg(CONFIG.segmentColors.context_tokens ?? "dim", text);
      if (pct < CONFIG.contextOkThresholdPct) return theme.fg(CONFIG.contextOkColor, text);
      if (pct < CONFIG.contextWarnThresholdPct) return theme.fg(CONFIG.contextWarnColor, text);
      return theme.fg(CONFIG.contextErrorColor, text);
    }

    case "mcp": {
      const counts = getMcpServerCounts(footerData);
      const connected = counts?.connected ?? 0;
      const total = counts?.total ?? 1;
      return theme.fg(CONFIG.segmentColors.mcp ?? "dim", `MCP: ${connected}/${total} servers`);
    }

    default:
      return null;
  }
}

export default function powerlineContextFooter(pi: ExtensionAPI) {
  let enabled = true;
  let requestRender: (() => void) | null = null;

  const applyFooter = (ctx: any) => {
    if (!ctx.hasUI) return;

    if (!enabled) {
      ctx.ui.setFooter(undefined);
      return;
    }

    const nerd = hasNerdFonts();
    const separator = nerd ? CONFIG.separator : CONFIG.asciiSeparator;
    const needsBranchWatcher = CONFIG.segments.includes("git");

    ctx.ui.setFooter((tui, theme, footerData) => {
      requestRender = () => tui.requestRender();
      const unsubBranch = needsBranchWatcher ? footerData.onBranchChange(() => tui.requestRender()) : () => {};

      return {
        dispose() {
          unsubBranch();
          requestRender = null;
        },
        invalidate() {},
        render(width: number): string[] {
          const parts = CONFIG.segments
            .map((id) => renderSegment(id, pi, ctx, theme, footerData, nerd))
            .filter((p): p is string => Boolean(p));

          if (parts.length === 0) return [];

          const sep = theme.fg(CONFIG.separatorColor, separator);
          const line = ` ${parts.join(sep)} `;
          return [truncateToWidth(line, width, "…")];
        },
      };
    });
  };

  pi.on("session_start", (_event, ctx) => applyFooter(ctx));

  for (const eventName of ["model_select", "turn_end", "message_update", "agent_end"] as const) {
    pi.on(eventName, () => requestRender?.());
  }

  pi.registerCommand("powerline-melbourne", {
    description: "Enable or disable the powerline footer: /powerline-melbourne on|off",
    handler: async (args, ctx) => {
      const action = args.trim().toLowerCase();

      if (action === "on") enabled = true;
      else if (action === "off") enabled = false;
      else {
        ctx.ui.notify("Usage: /powerline-melbourne on|off", "warning");
        return;
      }

      applyFooter(ctx);
      ctx.ui.notify(enabled ? "Powerline footer enabled" : "Powerline footer disabled", "info");
    },
  });
}
