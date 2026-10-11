import { BrowserRouter, Navigate, Outlet, Route, Routes } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import AppLayout from "@/components/layout/AppLayout";
import { Spinner } from "@/components/ui/spinner";
import HomePage from "@/pages/HomePage";
import AuthPage from "@/pages/AuthPage";
import DashboardPage from "@/pages/DashboardPage";
import ProjectsPage from "@/pages/ProjectsPage";
import NewProjectPage from "@/pages/NewProjectPage";
import ProjectDetailPage from "@/pages/ProjectDetailPage";
import ProfilePage from "@/pages/ProfilePage";
import IntegrationsPage from "@/pages/IntegrationsPage";
import StoryboardEditorPage from "@/pages/StoryboardEditorPage";
import RenderPage from "@/pages/RenderPage";

export default function App() {
  const { loggedIn, restoring } = useAuth();

  // Hold routing until a saved session is validated; otherwise a reload on a
  // deep link would bounce through the logged-out routes and land on "/".
  if (restoring) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <Spinner />
      </div>
    );
  }

  return (
    <BrowserRouter>
      {loggedIn ? (
        <Routes>
          {/* Full-page takeover — no sidebar/header chrome */}
          <Route path="/projects/new" element={<NewProjectPage />} />
          {/* Headless render surface used by the render workflow; no chrome */}
          <Route path="/render/:id" element={<RenderPage />} />

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
          {/* The fixture project needs no login; real projects fail with "Unauthorized" here */}
          <Route path="/render/:id" element={<RenderPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      )}
    </BrowserRouter>
  );
}
