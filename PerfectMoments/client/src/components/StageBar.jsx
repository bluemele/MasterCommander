import { useNavigate, useLocation } from 'react-router-dom';
import { useApp } from '../context/AppContext';

const stages = [
  { key: 'reflection', label: 'Reflect', path: '/reflect' },
  { key: 'realizations', label: 'Realize', path: '/realizations' },
  { key: 'planning', label: 'Plan', path: '/planning' },
];

const stageOrder = ['reflection', 'realizations', 'planning', 'complete'];

export default function StageBar() {
  const { journey, logout } = useApp();
  const location = useLocation();
  const navigate = useNavigate();

  const currentStage = journey?.current_stage || 'reflection';
  const currentIdx = stageOrder.indexOf(currentStage);

  return (
    <div className="stage-bar">
      <span className="logo" onClick={() => navigate('/')} style={{ cursor: 'pointer' }}>
        Perfect Moments
      </span>
      {stages.map((s, i) => {
        const stageIdx = stageOrder.indexOf(s.key);
        const isDone = stageIdx < currentIdx;
        const isActive = location.pathname === s.path;
        const isReachable = stageIdx <= currentIdx;

        return (
          <div key={s.key} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {i > 0 && <div className={`stage-line ${isDone ? 'done' : ''}`} />}
            <div
              className={`stage-dot ${isActive ? 'active' : ''} ${isDone ? 'done' : ''}`}
              onClick={() => isReachable && navigate(s.path)}
              style={{ cursor: isReachable ? 'pointer' : 'default' }}
              title={s.label}
            />
          </div>
        );
      })}
      <button className="btn-ghost" style={{ marginLeft: 'auto', fontSize: '0.85rem' }} onClick={logout}>
        Sign out
      </button>
    </div>
  );
}
