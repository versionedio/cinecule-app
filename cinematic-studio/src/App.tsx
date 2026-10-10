import { BrowserRouter, Navigate, Outlet, Route, Routes } from "react-router-dom";
import { useAuth } from "./hooks/useAuth";
import AppLayout from "./components/AppLayout";
import HomePage from "./pages/HomePage";
import AuthPage from "./pages/AuthPage";
import DashboardPage from "./pages/DashboardPage";
import ProjectsPage from "./pages/ProjectsPage";
import NewProjectPage from "./pages/NewProjectPage";
import ProjectDetailPage from "./pages/ProjectDetailPage";
import ProfilePage from "./pages/ProfilePage";
import IntegrationsPage from "./pages/IntegrationsPage";
import StoryboardEditorPage from "./pages/StoryboardEditorPage";

export default function App() {
  const { loggedIn } = useAuth();

  return (
    <BrowserRouter>
      {loggedIn ? (
        <Routes>
          {/* Full-page takeover — no sidebar/header chrome */}
          <Route path="/projects/new" element={<NewProjectPage />} />

          <Route element={<AppLayout><Outlet /></AppLayout>}>
            <Route path="/" element={<DashboardPage />} />
            <Route path="/projects" element={<ProjectsPage />} />
            <Route path="/projects/:id" element={<ProjectDetailPage />} />
            <Route path="/projects/:id/storyboard" element={<StoryboardEditorPage />} />
            <Route path="/profile" element={<ProfilePage />} />
            <Route path="/integrations" element={<IntegrationsPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      ) : (
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/login" element={<AuthPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      )}
    </BrowserRouter>
  );
}
