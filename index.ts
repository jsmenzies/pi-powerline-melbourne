import { copyToClipboard, type ExtensionAPI, type ReadonlyFooterDataProvider, type Theme, type ThemeColor } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { renderFixedEditorCluster } from "./fixed-editor/cluster.ts";
import { emergencyTerminalModeReset, TerminalSplitCompositor } from "./fixed-editor/terminal-split.ts";

type SegmentId = "pi" | "model" | "path" | "git" | "context_tokens" | "mcp";
type ChatJumpRole = "user" | "assistant" | "any";
type ChatJumpDirection = "previous" | "next";

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

const RUNTIME_CONFIG = {
  mouseScroll: true,
  fixedEditor: true,
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

function findContainerWithChild(tui: any, child: any): { container: any; index: number } | null {
  const children = Array.isArray(tui?.children) ? tui.children : [];
  const index = children.findIndex((candidate: any) => Array.isArray(candidate?.children) && candidate.children.includes(child));
  if (index === -1) return null;

  return { container: children[index], index };
}

function collectComponents(root: any): any[] {
  const found: any[] = [];
  const seen = new Set<any>();

  const walk = (node: any) => {
    if (!node || typeof node !== "object" || seen.has(node)) return;
    seen.add(node);
    found.push(node);

    const children = Reflect.get(node, "children");
    if (!Array.isArray(children)) return;
    for (const child of children) walk(child);
  };

  walk(root);
  return found;
}

function looksLikeEditor(component: any): boolean {
  if (!component || typeof component !== "object") return false;
  if (typeof component.render !== "function") return false;

  const ctorName = component.constructor?.name;
  if (typeof ctorName === "string" && /Editor/i.test(ctorName)) return true;

  return typeof component.getText === "function"
    && typeof component.setText === "function"
    && typeof component.handleInput === "function";
}

function isChatMessageComponentForRole(component: unknown, role: ChatJumpRole): boolean {
  const componentName = typeof component === "object" && component !== null ? (component as any).constructor?.name : undefined;
  if (role === "assistant") {
    return componentName === "AssistantMessageComponent";
  }

  if (role === "user") {
    return componentName === "UserMessageComponent" || componentName === "SkillInvocationMessageComponent";
  }

  return componentName === "AssistantMessageComponent"
    || componentName === "UserMessageComponent"
    || componentName === "SkillInvocationMessageComponent";
}

function renderLineCount(component: unknown, width: number): number {
  if (typeof component !== "object" || component === null) return 0;

  const render = Reflect.get(component, "render");
  if (typeof render !== "function") return 0;

  const lines = render.call(component, width);
  return Array.isArray(lines) ? lines.length : 0;
}

function collectMessageStartLines(component: unknown, width: number, role: ChatJumpRole, offset: number): {
  targets: number[];
  lineCount: number;
} {
  const lineCount = renderLineCount(component, width);
  if (isChatMessageComponentForRole(component, role)) {
    return { targets: [offset], lineCount };
  }

  const children = typeof component === "object" && component !== null ? Reflect.get(component, "children") : null;
  if (!Array.isArray(children) || children.length === 0) {
    return { targets: [], lineCount };
  }

  const targets: number[] = [];
  let childOffset = offset;
  let childrenLineCount = 0;
  for (const child of children) {
    const result = collectMessageStartLines(child, width, role, childOffset);
    targets.push(...result.targets);
    childOffset += result.lineCount;
    childrenLineCount += result.lineCount;
  }

  return { targets, lineCount: Math.max(lineCount, childrenLineCount) };
}

export default function powerlineContextFooter(pi: ExtensionAPI) {
  let enabled = true;
  let requestRender: (() => void) | null = null;
  let currentCtx: any = null;
  let tuiRef: any = null;
  let footerDataRef: ReadonlyFooterDataProvider | null = null;
  let fixedEditorCompositor: TerminalSplitCompositor | null = null;
  let fixedEditorContainer: any = null;
  let fixedStatusContainer: any = null;
  let fixedWidgetContainerAbove: any = null;
  let fixedWidgetContainerBelow: any = null;

  const nerd = hasNerdFonts();
  const separator = nerd ? CONFIG.separator : CONFIG.asciiSeparator;

  const renderFooterLines = (ctx: any, theme: Theme, footerData: ReadonlyFooterDataProvider, width: number): string[] => {
    const parts = CONFIG.segments
      .map((id) => renderSegment(id, pi, ctx, theme, footerData, nerd))
      .filter((p): p is string => Boolean(p));

    if (parts.length === 0) return [];

    const sep = theme.fg(CONFIG.separatorColor, separator);
    const line = ` ${parts.join(sep)} `;
    return [truncateToWidth(line, width, "…")];
  };

  const teardownFixedEditorCompositor = (options?: { resetExtendedKeyboardModes?: boolean }) => {
    const hadCompositor = fixedEditorCompositor !== null;
    fixedEditorCompositor?.dispose(options);
    if (!hadCompositor && options?.resetExtendedKeyboardModes) {
      try {
        process.stdout.write(emergencyTerminalModeReset());
      } catch {
        // ignore
      }
    }

    fixedEditorCompositor = null;
    fixedStatusContainer = null;
    fixedEditorContainer = null;
    fixedWidgetContainerAbove = null;
    fixedWidgetContainerBelow = null;
  };

  const installFixedEditorCompositor = (ctx: any, tui: any, theme: Theme, footerData: ReadonlyFooterDataProvider) => {
    teardownFixedEditorCompositor();
    if (!ctx.hasUI || !RUNTIME_CONFIG.fixedEditor) return;

    if (!tui?.terminal || typeof tui.terminal.write !== "function") {
      throw new Error("[powerline-melbourne] Fixed editor compositor could not find tui.terminal.write()");
    }

    const candidates = collectComponents(tui).filter(looksLikeEditor);
    const editorComponent = candidates[0] ?? null;
    if (!editorComponent) {
      throw new Error("[powerline-melbourne] Fixed editor compositor could not locate editor component");
    }

    const editorContainerMatch = findContainerWithChild(tui, editorComponent);
    if (!editorContainerMatch) {
      throw new Error("[powerline-melbourne] Fixed editor compositor could not find editor container");
    }

    const tuiChildren = Array.isArray(tui.children) ? tui.children : [];
    fixedEditorContainer = editorContainerMatch.container;
    const statusContainerCandidate = tuiChildren[editorContainerMatch.index - 2] ?? null;
    fixedStatusContainer = statusContainerCandidate && typeof statusContainerCandidate.render === "function"
      ? statusContainerCandidate
      : null;
    fixedWidgetContainerAbove = tuiChildren[editorContainerMatch.index - 1] ?? null;
    fixedWidgetContainerBelow = tuiChildren[editorContainerMatch.index + 1] ?? null;

    let compositor: TerminalSplitCompositor;
    compositor = new TerminalSplitCompositor({
      tui,
      terminal: tui.terminal,
      mouseScroll: RUNTIME_CONFIG.mouseScroll,
      keyboardScrollShortcuts: {
        up: "super+up",
        down: "super+down",
      },
      onCopySelection: (text) => {
        copyToClipboard(text);
      },
      getShowHardwareCursor: () => typeof tui.getShowHardwareCursor === "function" && tui.getShowHardwareCursor(),
      renderCluster: (width, terminalRows) => {
        const statusContainerLines = fixedStatusContainer
          ? compositor.renderHidden(fixedStatusContainer, width).filter((line) => visibleWidth(line) > 0)
          : [];
        const aboveWidgetLines = fixedWidgetContainerAbove ? compositor.renderHidden(fixedWidgetContainerAbove, width) : [];
        const belowWidgetLines = fixedWidgetContainerBelow ? compositor.renderHidden(fixedWidgetContainerBelow, width) : [];

        return renderFixedEditorCluster({
          width,
          terminalRows,
          statusLines: [
            ...aboveWidgetLines,
            ...renderFooterLines(ctx, theme, footerData, width),
            ...statusContainerLines,
          ],
          editorLines: fixedEditorContainer ? compositor.renderHidden(fixedEditorContainer, width) : [],
          secondaryLines: [...belowWidgetLines],
        });
      },
    });

    fixedEditorCompositor = compositor;
    if (fixedStatusContainer?.render) compositor.hideRenderable(fixedStatusContainer);
    if (fixedWidgetContainerAbove?.render) compositor.hideRenderable(fixedWidgetContainerAbove);
    compositor.hideRenderable(fixedEditorContainer);
    if (fixedWidgetContainerBelow?.render) compositor.hideRenderable(fixedWidgetContainerBelow);
    compositor.install();
    tui.requestRender(true);
  };

  const collectChatMessageStartLines = (role: ChatJumpRole): number[] => {
    const children = Array.isArray(tuiRef?.children) ? tuiRef.children : [];
    const width = Math.max(1, tuiRef?.terminal?.columns ?? 80);
    const targets: number[] = [];
    let offset = 0;

    for (const child of children) {
      const result = collectMessageStartLines(child, width, role, offset);
      targets.push(...result.targets);
      offset += result.lineCount;
    }

    return [...new Set(targets)].sort((a, b) => a - b);
  };

  const jumpToChatMessage = (ctx: any, role: ChatJumpRole, direction: ChatJumpDirection): void => {
    if (!fixedEditorCompositor) {
      ctx.ui.notify("Chat message jumps require /powerline-melbourne fixed-editor on", "warning");
      return;
    }

    const targets = collectChatMessageStartLines(role);
    if (targets.length === 0) {
      const label = role === "assistant" ? "LLM" : role === "user" ? "user" : "chat";
      ctx.ui.notify(`No ${label} messages found`, "info");
      return;
    }

    const moved = direction === "previous"
      ? fixedEditorCompositor.jumpToPreviousRootTarget(targets)
      : fixedEditorCompositor.jumpToNextRootTarget(targets);

    if (!moved) {
      const label = role === "assistant" ? "LLM" : role === "user" ? "user" : "chat";
      ctx.ui.notify(
        direction === "previous"
          ? `Already at earliest visible ${label} message`
          : `Already at latest visible ${label} message`,
        "info",
      );
    }
  };

  const jumpChatToBottom = (ctx: any) => {
    if (!fixedEditorCompositor) {
      ctx.ui.notify("Chat bottom jump requires /powerline-melbourne fixed-editor on", "warning");
      return;
    }

    if (!fixedEditorCompositor.jumpToRootBottom()) {
      ctx.ui.notify("Chat viewport already at bottom", "info");
    }
  };

  const applyFooter = (ctx: any) => {
    if (!ctx.hasUI) return;
    currentCtx = ctx;

    if (!enabled) {
      teardownFixedEditorCompositor({ resetExtendedKeyboardModes: true });
      ctx.ui.setFooter(undefined);
      return;
    }

    const needsBranchWatcher = CONFIG.segments.includes("git");

    ctx.ui.setFooter((tui, theme, footerData) => {
      requestRender = () => tui.requestRender();
      tuiRef = tui;
      footerDataRef = footerData;

      if (RUNTIME_CONFIG.fixedEditor) {
        try {
          installFixedEditorCompositor(ctx, tui, theme, footerData);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          ctx.ui.notify(`Fixed editor failed to initialize: ${message}`, "warning");
          teardownFixedEditorCompositor({ resetExtendedKeyboardModes: true });
        }
      } else {
        teardownFixedEditorCompositor({ resetExtendedKeyboardModes: true });
      }

      const unsubBranch = needsBranchWatcher ? footerData.onBranchChange(() => tui.requestRender()) : () => {};

      return {
        dispose() {
          unsubBranch();
          requestRender = null;
          if (tuiRef === tui) {
            teardownFixedEditorCompositor({ resetExtendedKeyboardModes: true });
            tuiRef = null;
            footerDataRef = null;
          }
        },
        invalidate() {},
        render(width: number): string[] {
          if (RUNTIME_CONFIG.fixedEditor) return [];
          return renderFooterLines(currentCtx ?? ctx, theme, footerDataRef ?? footerData, width);
        },
      };
    });
  };

  pi.on("session_start", (_event, ctx) => applyFooter(ctx));

  for (const eventName of ["model_select", "turn_end", "message_update", "agent_end"] as const) {
    pi.on(eventName, () => {
      requestRender?.();
      fixedEditorCompositor?.requestRepaint();
    });
  }

  pi.registerCommand("powerline-melbourne", {
    description: "Enable or disable powerline footer: /powerline-melbourne on|off",
    handler: async (args, ctx) => {
      const action = args.trim().toLowerCase();

      if (action === "on") {
        enabled = true;
        applyFooter(ctx);
        ctx.ui.notify("Powerline footer enabled", "info");
        return;
      }

      if (action === "off") {
        enabled = false;
        applyFooter(ctx);
        ctx.ui.notify("Powerline footer disabled", "info");
        return;
      }

      ctx.ui.notify("Usage: /powerline-melbourne on|off (fixed editor + mouse scroll are always enabled)", "warning");
    },
  });
}
