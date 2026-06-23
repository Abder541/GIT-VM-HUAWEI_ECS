import { useTranslation } from 'react-i18next';
import { Navigate, Route, Routes } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api, ApiError } from './api';
import { AppShell } from './components/AppShell';
import { Login } from './pages/Login';
import { MyVms } from './pages/MyVms';
import { NewVm } from './pages/NewVm';
import { Admin } from './pages/Admin';
import { TrainerBatch } from './pages/TrainerBatch';
import { Profile } from './pages/Profile';
import { RequestDetail } from './pages/RequestDetail';
import { Spinner } from './ui';

export default function App() {
  const { t } = useTranslation();
  const meQ = useQuery({
    queryKey: ['me'],
    queryFn: api.me,
    retry: (count, err) => !(err instanceof ApiError && err.status === 401) && count < 2,
  });

  if (meQ.isLoading)
    return (
      <div className="grid min-h-full place-items-center text-muted-foreground">
        <span className="flex items-center gap-2 text-sm">
          <Spinner /> {t('common.loading')}
        </span>
      </div>
    );

  if (meQ.isError || !meQ.data) return <Login />;

  const user = meQ.data;
  return (
    <AppShell user={user}>
      <Routes>
        <Route path="/" element={<MyVms />} />
        <Route path="/new" element={<NewVm />} />
        <Route path="/profile" element={<Profile />} />
        <Route path="/requests/:id" element={<RequestDetail />} />
        <Route path="/trainer" element={user.role === 'formateur' || user.role === 'admin' ? <TrainerBatch /> : <Navigate to="/" replace />} />
        <Route path="/admin" element={user.role === 'admin' ? <Admin /> : <Navigate to="/" replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AppShell>
  );
}
