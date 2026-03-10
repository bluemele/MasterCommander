import { Routes, Route, Navigate } from 'react-router-dom';
import { useApp } from './context/AppContext';
import Landing from './pages/Landing';
import Reflection from './pages/Reflection';
import Realizations from './pages/Realizations';
import Planning from './pages/Planning';
import Complete from './pages/Complete';

export default function App() {
  const { user, journey } = useApp();

  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route
        path="/reflect"
        element={user && journey ? <Reflection /> : <Navigate to="/" />}
      />
      <Route
        path="/realizations"
        element={user && journey ? <Realizations /> : <Navigate to="/" />}
      />
      <Route
        path="/planning"
        element={user && journey ? <Planning /> : <Navigate to="/" />}
      />
      <Route
        path="/complete"
        element={user && journey ? <Complete /> : <Navigate to="/" />}
      />
    </Routes>
  );
}
