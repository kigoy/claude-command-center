import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useState, useEffect } from 'react';
import { Login } from './pages/Login';
import { Respond } from './pages/Respond';
import { MissionControl } from './components/MissionControl';

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const [auth, setAuth] = useState<'loading' | 'ok' | 'denied'>('loading');

  useEffect(() => {
    fetch('/api/auth/check')
      .then((r) => setAuth(r.ok ? 'ok' : 'denied'))
      .catch(() => setAuth('denied'));
  }, []);

  if (auth === 'loading') return null;
  if (auth === 'denied') return <Navigate to="/login" replace />;
  return <>{children}</>;
}

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/respond/:requestId" element={<Respond />} />
        <Route
          path="*"
          element={
            <ProtectedRoute>
              <MissionControl />
            </ProtectedRoute>
          }
        />
      </Routes>
    </BrowserRouter>
  );
}
