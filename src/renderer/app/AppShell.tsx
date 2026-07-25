import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { PanelLeft } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { CommandPalette } from "../layout/CommandPalette.js";
import { SettingsNavigation } from "../layout/SettingsNavigation.js";
import { Sidebar } from "../layout/Sidebar.js";
import { AppShellLayout } from "../../ui/layouts/index.js";
import { useUiPreferenceIntent, useUiPreferences, useWorkspace } from "../api/hooks.js";
import { isSettingsSpace } from "./settingsSpace.js";
import { useMobileLayout, useMobileViewport } from "./mobileViewport.js";
import { restorableRoute, restoredInitialRoute } from "./routeRestore.js";
import { Control, ResizeHandle } from "../../ui/components/index.js";
import { useBootstrap } from "../api/BootstrapContext.js";
import { TerminalWorkspaceProvider } from "../terminal/TerminalWorkspace.js";
import { applyUiVisualPreferences } from "../design/applyUiVisualPreferences.js";

export function AppShell() {
  const location = useLocation();
  const navigate = useNavigate();
  const { api } = useBootstrap();
  const { i18n, t } = useTranslation();
  const preferences = useUiPreferences().data;
  const workspace = useWorkspace().data;
  const savePreferences = useUiPreferenceIntent();
  const sidebarOpen = preferences.sidebarOpen;
  const mobile = useMobileLayout();
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(preferences.sidebarWidth);
  const sidebarWidthRef = useRef(preferences.sidebarWidth);
  const sidebarResizeActiveRef = useRef(false);
  const preferencesRef = useRef(preferences);
  preferencesRef.current = preferences;
  const [palette, setPalette] = useState<"commands" | null>(null);
  const [routeReady, setRouteReady] = useState(false);
  const settingsSpace = isSettingsSpace(location.pathname);
  const visibleSidebar = mobile ? mobileSidebarOpen : sidebarOpen;
  const activeTaskId = /^\/tasks\/([^/]+)$/.exec(location.pathname)?.[1] || null;
  const activeProjectId = activeTaskId
    ? workspace.tasks.find((task) => task.taskId === decodeURIComponent(activeTaskId))?.projectId || null
    : null;

  useMobileViewport();
  const toggleSidebar = () => {
    if (mobile) setMobileSidebarOpen((open) => !open);
    else savePreferences.mutate({ ...preferences, sidebarOpen: !sidebarOpen });
  };
  useEffect(() => { if (mobile) setMobileSidebarOpen(false); }, [location.pathname, mobile]);
  useEffect(() => {
    if (sidebarResizeActiveRef.current || sidebarWidthRef.current === preferences.sidebarWidth) return;
    sidebarWidthRef.current = preferences.sidebarWidth;
    setSidebarWidth(preferences.sidebarWidth);
  }, [preferences.sidebarWidth]);
  useEffect(() => {
    document.documentElement.dataset.timestamps = preferences.timestamps;
    document.documentElement.lang = preferences.locale;
    localStorage.setItem("grok-build.locale", preferences.locale);
    applyUiVisualPreferences(preferences);
    if (i18n.language !== preferences.locale) void i18n.changeLanguage(preferences.locale);
  }, [i18n, preferences.fontScale, preferences.fontWeight, preferences.layoutScale, preferences.letterSpacing, preferences.lineSpacing, preferences.locale, preferences.readingWidth, preferences.timestamps]);
  useEffect(() => {
    const route = restorableRoute(location.pathname);
    if (!routeReady) {
      const initial = restoredInitialRoute(location.pathname, api.bootstrap.initialRoute || preferences.lastRoute, workspace.tasks.map((task) => task.taskId));
      setRouteReady(true);
      if (initial !== location.pathname) navigate(initial, { replace: true });
      if (window.grokDesktop) persistDesktopRoute(initial);
      else if (/^\/(?:new|tasks\/)/.test(initial) && initial !== preferences.lastRoute) savePreferences.mutate({ ...preferences, lastRoute: initial });
      return;
    }
    if (!route) return;
    if (window.grokDesktop) persistDesktopRoute(route);
    else if (/^\/(?:new|tasks\/)/.test(route) && route !== preferences.lastRoute) savePreferences.mutate({ ...preferences, lastRoute: route });
  }, [api.bootstrap.initialRoute, location.pathname, navigate, preferences, routeReady, savePreferences, workspace.tasks]);
  useEffect(() => {
    const desktop = window.grokDesktop;
    if (!desktop) return;
    return combine([
      desktop.onNewTask(() => navigate("/new")),
      desktop.onToggleSidebar(toggleSidebar),
      desktop.onCommandPalette(() => setPalette("commands")),
      desktop.onSettings(() => navigate("/settings/general")),
      desktop.onOpenTask((taskId) => navigate(`/tasks/${encodeURIComponent(taskId)}`)),
    ]);
  }, [navigate, preferences]);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey)) return;
      if (event.key.toLowerCase() === "k") { event.preventDefault(); setPalette("commands"); }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const commitSidebarWidth = (width: number) => {
    const latest = preferencesRef.current;
    if (latest.sidebarOpen && latest.sidebarWidth === width) return;
    savePreferences.mutate({ ...latest, sidebarOpen: true, sidebarWidth: width });
  };
  const resizeSidebar = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = sidebarWidthRef.current;
    let collapse = false;
    let settled = false;
    sidebarResizeActiveRef.current = true;
    const move = (pointer: PointerEvent) => {
      const raw = startWidth + pointer.clientX - startX;
      collapse = raw < 108;
      const width = clampSidebarWidth(raw);
      if (sidebarWidthRef.current === width) return;
      sidebarWidthRef.current = width;
      setSidebarWidth(width);
    };
    const cleanup = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", cancel);
      window.removeEventListener("blur", cancel);
    };
    const finish = () => {
      if (settled) return;
      settled = true;
      cleanup();
      sidebarResizeActiveRef.current = false;
      const latest = preferencesRef.current;
      if (collapse) {
        sidebarWidthRef.current = latest.sidebarWidth;
        setSidebarWidth(latest.sidebarWidth);
        if (latest.sidebarOpen) savePreferences.mutate({ ...latest, sidebarOpen: false });
        return;
      }
      commitSidebarWidth(sidebarWidthRef.current);
    };
    const cancel = () => {
      if (settled) return;
      settled = true;
      cleanup();
      sidebarResizeActiveRef.current = false;
      const restored = preferencesRef.current.sidebarWidth;
      sidebarWidthRef.current = restored;
      setSidebarWidth(restored);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish, { once: true });
    window.addEventListener("pointercancel", cancel, { once: true });
    window.addEventListener("blur", cancel, { once: true });
  };
  const resizeSidebarWithKeyboard = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const width = event.key === "Home"
      ? 216
      : event.key === "End"
        ? 360
        : clampSidebarWidth(sidebarWidthRef.current + (event.key === "ArrowLeft" ? -16 : 16));
    sidebarWidthRef.current = width;
    setSidebarWidth(width);
    commitSidebarWidth(width);
  };
  return <AppShellLayout
    mobile={mobile}
    nativeTitlebar={Boolean(window.grokDesktop)}
    sidebarWidth={sidebarWidth}
    titlebarControl={({ className }) => <Control recipe="icon" density="titlebar" className={className} onClick={toggleSidebar} aria-controls="primary-sidebar" aria-expanded={visibleSidebar} aria-label={t(visibleSidebar ? "collapseSidebar" : "expandSidebar")}><PanelLeft size={15} strokeWidth={1.5} /></Control>}
    mobileScrim={mobile && visibleSidebar ? ({ className }) => <Control recipe="text" hover="none" shape="none" className={className} aria-label={t("collapseSidebar")} onClick={() => setMobileSidebarOpen(false)} /> : undefined}
    sidebar={visibleSidebar ? <>{settingsSpace ? <SettingsNavigation /> : <Sidebar onSearch={() => { setMobileSidebarOpen(false); setPalette("commands"); }} />}<ResizeHandle orientation="vertical" tabIndex={0} aria-label={t("resizeSidebar")} aria-valuemin={216} aria-valuemax={360} aria-valuenow={sidebarWidth} onPointerDown={resizeSidebar} onKeyDown={resizeSidebarWithKeyboard} /></> : undefined}
    workspace={<TerminalWorkspaceProvider activeProjectId={activeProjectId} projects={workspace.projects}>{routeReady && <Outlet />}</TerminalWorkspaceProvider>}
    floating={<CommandPalette mode={palette} onClose={() => setPalette(null)} />}
  />;
}

function clampSidebarWidth(value: number): number {
  return Math.max(216, Math.min(360, Math.round(value)));
}

function combine(cleanups: Array<() => void>): () => void {
  return () => cleanups.forEach((cleanup) => cleanup());
}

function persistDesktopRoute(route: string): void {
  const persistence = window.grokDesktop?.setWindowRoute(route);
  if (persistence) void persistence.catch(() => undefined);
}
