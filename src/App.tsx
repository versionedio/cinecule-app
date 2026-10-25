import { BrowserRouter, Navigate, Outlet, Route, Routes } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import AppLayout from "@/components/layout/AppLayout";
import { Spinner } from "@/components/ui/spinner";
import HomePage from "@/pages/HomePage";
import AuthPage from "@/pages/AuthPage";
import DashboardPage from "@/pages/DashboardPage";
import ProjectsPage from "@/pages/ProjectsPage";
import ChatPage from "@/pages/ChatPage";
import AwaitingApprovalPage from "@/pages/AwaitingApprovalPage";
import ProfilePage from "@/pages/ProfilePage";
import IntegrationsPage from "@/pages/IntegrationsPage";
import StoryboardEditorPage from "@/pages/StoryboardEditorPage";
import RenderPage from "@/pages/RenderPage";
import AdminUsersPage from "@/pages/AdminUsersPage";

export default function App() {
  const { loggedIn, restoring, access, isAdmin } = useAuth();

  // Hold routing until a saved session is validated; otherwise a reload on a
  // deep link would bounce through the logged-out routes and land on "/".
  if (restoring) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <Spinner />
      </div>
    );
  }

  // Signed in, but an admin has not approved the account yet: the only thing to see is the waiting page.
  if (loggedIn && access === "checking") {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <Spinner />
      </div>
    );
  }
  if (loggedIn && access === "pending") {
    return (
      <BrowserRouter>
        <Routes>
          {/* The headless render surface is not a user page and has its own sign-in. */}
          <Route path="/render/:id" element={<RenderPage />} />
          <Route path="*" element={<AwaitingApprovalPage />} />
        </Routes>
      </BrowserRouter>
    );
  }

  return (
    <BrowserRouter>
      {loggedIn ? (
        <Routes>
          {/* Full-page chat — no sidebar/header chrome. "new" starts a film; any other id reopens that film's conversation. */}
          <Route path="/projects/:id" element={<ChatPage />} />
          {/* Headless render surface used by the render workflow; no chrome */}
          <Route path="/render/:id" element={<RenderPage />} />

          <Route element={<AppLayout><Outlet /></AppLayout>}>
            <Route path="/" element={<DashboardPage />} />
            <Route path="/projects" element={<ProjectsPage />} />
            <Route path="/projects/:id/storyboard" element={<StoryboardEditorPage />} />
            <Route path="/profile" element={<ProfilePage />} />
            <Route path="/integrations" element={<IntegrationsPage />} />
            {/* Only for people who can manage access. The page is a convenience; the backend refuses everyone else. */}
            <Route
              path="/admin"
              element={isAdmin === null ? <Spinner /> : isAdmin ? <AdminUsersPage /> : <Navigate to="/" replace />}
            />
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
