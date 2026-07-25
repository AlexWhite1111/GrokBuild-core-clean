import { lazy, Suspense, type ReactNode } from "react";
import { BrowserRouter, Navigate, Route, Routes, useLocation, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { AppShell } from "./AppShell.js";
import { RouteBoundary } from "./RouteBoundary.js";
import styles from "./App.module.css";
import { Spinner } from "../../ui/components/index.js";

const NewTaskPage = lazy(() => import("../pages/NewTaskPage.js").then((module) => ({ default: module.NewTaskPage })));
const SettingsPage = lazy(() => import("../pages/SettingsPage.js").then((module) => ({ default: module.SettingsPage })));
const TaskPage = lazy(() => import("../pages/TaskPage.js").then((module) => ({ default: module.TaskPage })));

export function App() {
  return <BrowserRouter><Routes>
    <Route element={<AppShell />}>
      <Route index element={<Navigate to="/new" replace />} />
      <Route path="new" element={<Deferred><NewTaskPage /></Deferred>} />
      <Route path="tasks/:taskId" element={<Deferred><TaskPage /></Deferred>} />
      <Route path="automations" element={<Navigate to="/settings/automations" replace />} />
      <Route path="extensions/:category?" element={<LegacyExtensionRedirect />} />
      <Route path="settings/:section?/:subsection?" element={<Deferred><SettingsPage /></Deferred>} />
      <Route path="diagnostics" element={<Navigate to="/settings/diagnostics" replace />} />
      <Route path="*" element={<Navigate to="/new" replace />} />
    </Route>
  </Routes></BrowserRouter>;
}

function Deferred({ children }: { children: ReactNode }) {
  const location = useLocation();
  const { t } = useTranslation();
  return <RouteBoundary key={location.pathname} title={t("routeRenderFailed")} detail={t("routeRenderFailedDetail")} retryLabel={t("retry")}>
    <Suspense fallback={<RouteLoading />}>{children}</Suspense>
  </RouteBoundary>;
}

function RouteLoading() {
  const { t } = useTranslation();
  return <div className={styles.routeLoading} role="status" aria-label={t("loading")}><Spinner /></div>;
}

function LegacyExtensionRedirect() {
  const { category = "plugins" } = useParams();
  return <Navigate to={`/settings/extensions/${category}`} replace />;
}
