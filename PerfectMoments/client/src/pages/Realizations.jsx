import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useApp } from '../context/AppContext';
import StageBar from '../components/StageBar';
import Background from '../components/Background';
import './Realizations.css';

const themes = [
  { key: 'people', label: 'People & Connection', icon: '~', question: 'Who keeps appearing in your perfect moments? What kind of relationships were present?' },
  { key: 'place', label: 'Place & Environment', icon: '~', question: 'Where did your perfect moments happen? Do certain environments come up again?' },
  { key: 'state', label: 'State of Being', icon: '~', question: 'How were you feeling before each moment? Were you relaxed? Open? Present?' },
  { key: 'activity', label: 'Activities & Actions', icon: '~', question: 'What were you doing? Were your moments about action or stillness?' },
  { key: 'surprise', label: 'Surprise & Spontaneity', icon: '~', question: 'Were your moments planned or unexpected? What role did surprise play?' },
  { key: 'meaning', label: 'Deeper Meaning', icon: '~', question: 'Looking across all five moments, what is your life trying to tell you about what matters most?' },
];

export default function Realizations() {
  const { moments, realizations, addRealization, removeRealization, advanceStage } = useApp();
  const navigate = useNavigate();
  const [currentTheme, setCurrentTheme] = useState(0);
  const [insightText, setInsightText] = useState('');
  const [selectedMoments, setSelectedMoments] = useState([]);
  const [view, setView] = useState('overview'); // 'overview' | 'explore' | 'summary'

  const theme = themes[currentTheme];

  // Extract data from moments for each theme
  const themeData = useMemo(() => {
    const data = {};
    themes.forEach(t => {
      data[t.key] = moments.map(m => {
        switch (t.key) {
          case 'people': return { moment: m, detail: m.people };
          case 'place': return { moment: m, detail: m.location };
          case 'state': return { moment: m, detail: m.emotions };
          case 'activity': return { moment: m, detail: m.story };
          case 'surprise': return { moment: m, detail: m.story };
          case 'meaning': return { moment: m, detail: `${m.emotions} — ${m.senses}` };
          default: return { moment: m, detail: '' };
        }
      });
    });
    return data;
  }, [moments]);

  async function handleAddInsight() {
    if (!insightText.trim()) return;
    await addRealization({
      insight: insightText.trim(),
      theme: theme.key,
      related_moment_ids: selectedMoments,
    });
    setInsightText('');
    setSelectedMoments([]);
  }

  function handleNextTheme() {
    if (currentTheme < themes.length - 1) {
      setCurrentTheme(currentTheme + 1);
    } else {
      setView('summary');
    }
  }

  async function handleContinue() {
    await advanceStage('planning');
    navigate('/planning');
  }

  const fadeUp = {
    initial: { opacity: 0, y: 30 },
    animate: { opacity: 1, y: 0 },
    exit: { opacity: 0, y: -20 },
    transition: { duration: 0.7, ease: [0.16, 1, 0.3, 1] }
  };

  return (
    <div className="realizations page">
      <Background variant="default" />
      <StageBar />

      <div className="realizations-container">
        <AnimatePresence mode="wait">
          {view === 'overview' && (
            <motion.div key="overview" className="rlz-overview" {...fadeUp}>
              <span className="rlz-label">Stage 2</span>
              <h2 className="rlz-title">Realizations</h2>
              <p className="rlz-subtitle">
                Now let's look deeper. Your five moments contain hidden patterns —
                threads that connect the best experiences of your life.
              </p>
              <p className="rlz-subtitle-dim">
                We'll walk through six lenses. For each, look at your moments side by side
                and capture what you notice.
              </p>

              <div className="rlz-moments-preview">
                {moments.map(m => (
                  <div key={m.id} className="rlz-moment-chip">
                    <span className="rlz-moment-chip-num">{m.slot}</span>
                    {m.title}
                  </div>
                ))}
              </div>

              <button className="btn btn-primary" onClick={() => setView('explore')}>
                Begin Exploration
              </button>
            </motion.div>
          )}

          {view === 'explore' && (
            <motion.div key={`explore-${currentTheme}`} className="rlz-explore" {...fadeUp}>
              <div className="rlz-theme-nav">
                {themes.map((t, i) => (
                  <button
                    key={t.key}
                    className={`rlz-theme-dot ${i === currentTheme ? 'active' : ''} ${i < currentTheme ? 'done' : ''}`}
                    onClick={() => setCurrentTheme(i)}
                  >
                    {i + 1}
                  </button>
                ))}
              </div>

              <span className="rlz-label">Lens {currentTheme + 1} of {themes.length}</span>
              <h2 className="rlz-explore-title">{theme.label}</h2>
              <p className="rlz-explore-question">{theme.question}</p>

              <div className="rlz-moment-cards">
                {themeData[theme.key]?.map(({ moment: m, detail }) => (
                  <div
                    key={m.id}
                    className={`rlz-moment-card ${selectedMoments.includes(m.id) ? 'selected' : ''}`}
                    onClick={() => {
                      setSelectedMoments(prev =>
                        prev.includes(m.id) ? prev.filter(x => x !== m.id) : [...prev, m.id]
                      );
                    }}
                  >
                    <div className="rlz-mc-header">
                      <span className="rlz-mc-num">{m.slot}</span>
                      <span className="rlz-mc-title">{m.title}</span>
                    </div>
                    <p className="rlz-mc-detail">{detail || 'No details recorded'}</p>
                  </div>
                ))}
              </div>

              <div className="rlz-insight-area">
                <label className="rlz-insight-label">
                  What pattern do you see? What did you realize?
                </label>
                <textarea
                  className="textarea-field"
                  placeholder="Write your realization here..."
                  value={insightText}
                  onChange={e => setInsightText(e.target.value)}
                  rows={3}
                />
                <div className="rlz-insight-actions">
                  <button
                    className="btn btn-secondary"
                    onClick={handleAddInsight}
                    disabled={!insightText.trim()}
                  >
                    Save Realization
                  </button>
                  <button className="btn btn-primary" onClick={handleNextTheme}>
                    {currentTheme < themes.length - 1 ? 'Next Lens' : 'View All Realizations'}
                  </button>
                </div>
              </div>

              {/* Show realizations for this theme */}
              {realizations.filter(r => r.theme === theme.key).length > 0 && (
                <div className="rlz-saved-insights">
                  <h4>Your realizations for this lens:</h4>
                  {realizations.filter(r => r.theme === theme.key).map(r => (
                    <div key={r.id} className="rlz-saved-insight">
                      <p>{r.insight}</p>
                      <button className="btn-ghost rlz-remove" onClick={() => removeRealization(r.id)}>
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </motion.div>
          )}

          {view === 'summary' && (
            <motion.div key="summary" className="rlz-summary" {...fadeUp}>
              <span className="rlz-label">Your Realizations</span>
              <h2 className="rlz-title">What You Discovered</h2>

              {realizations.length === 0 ? (
                <div className="rlz-empty">
                  <p>You haven't captured any realizations yet.</p>
                  <button className="btn btn-secondary" onClick={() => { setCurrentTheme(0); setView('explore'); }}>
                    Go Back and Explore
                  </button>
                </div>
              ) : (
                <>
                  <div className="rlz-summary-grid">
                    {realizations.map((r, i) => (
                      <motion.div
                        key={r.id}
                        className="rlz-summary-card glass-card"
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: i * 0.1 }}
                      >
                        <span className="rlz-summary-theme">
                          {themes.find(t => t.key === r.theme)?.label || 'Insight'}
                        </span>
                        <p className="rlz-summary-text">{r.insight}</p>
                      </motion.div>
                    ))}
                  </div>

                  <div className="rlz-summary-actions">
                    <button className="btn btn-ghost" onClick={() => { setCurrentTheme(0); setView('explore'); }}>
                      Explore More
                    </button>
                    <button className="btn btn-primary" onClick={handleContinue}>
                      Continue to Planning
                    </button>
                  </div>
                </>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
