import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useApp } from '../context/AppContext';
import StageBar from '../components/StageBar';
import Background from '../components/Background';
import './Planning.css';

const frequencies = ['daily', 'weekly', 'monthly', 'as needed'];

export default function Planning() {
  const {
    realizations, principles, habits,
    addPrinciple, removePrinciple,
    addHabit, removeHabit,
    advanceStage
  } = useApp();
  const navigate = useNavigate();
  const [view, setView] = useState('principles'); // 'principles' | 'habits' | 'review'
  const [principleText, setPrincipleText] = useState('');
  const [selectedRealization, setSelectedRealization] = useState('');
  const [habitText, setHabitText] = useState('');
  const [habitFreq, setHabitFreq] = useState('daily');
  const [selectedPrinciple, setSelectedPrinciple] = useState('');

  async function handleAddPrinciple() {
    if (!principleText.trim()) return;
    await addPrinciple({
      realization_id: selectedRealization || null,
      text: principleText.trim(),
    });
    setPrincipleText('');
    setSelectedRealization('');
  }

  async function handleAddHabit() {
    if (!habitText.trim()) return;
    await addHabit({
      principle_id: selectedPrinciple || null,
      text: habitText.trim(),
      frequency: habitFreq,
    });
    setHabitText('');
    setSelectedPrinciple('');
  }

  async function handleComplete() {
    await advanceStage('complete');
    navigate('/complete');
  }

  const fadeUp = {
    initial: { opacity: 0, y: 30 },
    animate: { opacity: 1, y: 0 },
    exit: { opacity: 0, y: -20 },
    transition: { duration: 0.7, ease: [0.16, 1, 0.3, 1] }
  };

  return (
    <div className="planning page">
      <Background variant="focus" />
      <StageBar />

      <div className="planning-container">
        {/* Sub-navigation */}
        <div className="plan-tabs">
          <button
            className={`plan-tab ${view === 'principles' ? 'active' : ''}`}
            onClick={() => setView('principles')}
          >
            Principles
          </button>
          <button
            className={`plan-tab ${view === 'habits' ? 'active' : ''}`}
            onClick={() => setView('habits')}
          >
            Habits
          </button>
          <button
            className={`plan-tab ${view === 'review' ? 'active' : ''}`}
            onClick={() => setView('review')}
          >
            Review
          </button>
        </div>

        <AnimatePresence mode="wait">
          {view === 'principles' && (
            <motion.div key="principles" className="plan-section" {...fadeUp}>
              <span className="plan-label">Stage 3 &mdash; Principles</span>
              <h2 className="plan-title">Define Your Principles</h2>
              <p className="plan-desc">
                Based on your realizations, what principles should guide your life?
                These are the truths you've uncovered about what makes perfect moments possible.
              </p>

              {/* Show realizations as reference */}
              {realizations.length > 0 && (
                <div className="plan-reference">
                  <h4>Your Realizations</h4>
                  <div className="plan-ref-grid">
                    {realizations.map(r => (
                      <div
                        key={r.id}
                        className={`plan-ref-card ${selectedRealization === r.id ? 'selected' : ''}`}
                        onClick={() => setSelectedRealization(selectedRealization === r.id ? '' : r.id)}
                      >
                        <p>{r.insight}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="plan-add-area">
                <label className="plan-add-label">Write a guiding principle:</label>
                <div className="plan-add-row">
                  <input
                    type="text"
                    className="input-field"
                    placeholder='e.g., "Prioritize presence over productivity"'
                    value={principleText}
                    onChange={e => setPrincipleText(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleAddPrinciple()}
                  />
                  <button
                    className="btn btn-secondary"
                    onClick={handleAddPrinciple}
                    disabled={!principleText.trim()}
                  >
                    Add
                  </button>
                </div>
              </div>

              {principles.length > 0 && (
                <div className="plan-list">
                  <h4>Your Principles</h4>
                  {principles.map((p, i) => (
                    <motion.div
                      key={p.id}
                      className="plan-item glass-card"
                      initial={{ opacity: 0, x: -20 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: i * 0.05 }}
                    >
                      <span className="plan-item-num">{i + 1}</span>
                      <p className="plan-item-text">{p.text}</p>
                      <button className="btn-ghost plan-item-remove" onClick={() => removePrinciple(p.id)}>
                        &times;
                      </button>
                    </motion.div>
                  ))}
                </div>
              )}

              <div className="plan-nav">
                <button className="btn btn-primary" onClick={() => setView('habits')}>
                  Next: Build Habits
                </button>
              </div>
            </motion.div>
          )}

          {view === 'habits' && (
            <motion.div key="habits" className="plan-section" {...fadeUp}>
              <span className="plan-label">Stage 3 &mdash; Habits</span>
              <h2 className="plan-title">Build Your Habits</h2>
              <p className="plan-desc">
                Turn your principles into concrete actions.
                What habits will bring more perfect moments into your daily life?
              </p>

              {/* Show principles as reference */}
              {principles.length > 0 && (
                <div className="plan-reference">
                  <h4>Your Principles</h4>
                  <div className="plan-ref-grid">
                    {principles.map(p => (
                      <div
                        key={p.id}
                        className={`plan-ref-card ${selectedPrinciple === p.id ? 'selected' : ''}`}
                        onClick={() => setSelectedPrinciple(selectedPrinciple === p.id ? '' : p.id)}
                      >
                        <p>{p.text}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="plan-add-area">
                <label className="plan-add-label">Define a habit:</label>
                <div className="plan-add-row">
                  <input
                    type="text"
                    className="input-field"
                    placeholder='e.g., "10 minutes of phone-free time with family at dinner"'
                    value={habitText}
                    onChange={e => setHabitText(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleAddHabit()}
                  />
                  <select
                    className="input-field plan-freq-select"
                    value={habitFreq}
                    onChange={e => setHabitFreq(e.target.value)}
                  >
                    {frequencies.map(f => (
                      <option key={f} value={f}>{f}</option>
                    ))}
                  </select>
                  <button
                    className="btn btn-secondary"
                    onClick={handleAddHabit}
                    disabled={!habitText.trim()}
                  >
                    Add
                  </button>
                </div>
              </div>

              {habits.length > 0 && (
                <div className="plan-list">
                  <h4>Your Habits</h4>
                  {habits.map((h, i) => (
                    <motion.div
                      key={h.id}
                      className="plan-item glass-card"
                      initial={{ opacity: 0, x: -20 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: i * 0.05 }}
                    >
                      <span className="plan-item-freq">{h.frequency}</span>
                      <p className="plan-item-text">{h.text}</p>
                      <button className="btn-ghost plan-item-remove" onClick={() => removeHabit(h.id)}>
                        &times;
                      </button>
                    </motion.div>
                  ))}
                </div>
              )}

              <div className="plan-nav">
                <button className="btn btn-ghost" onClick={() => setView('principles')}>
                  Back to Principles
                </button>
                <button className="btn btn-primary" onClick={() => setView('review')}>
                  Review Your Plan
                </button>
              </div>
            </motion.div>
          )}

          {view === 'review' && (
            <motion.div key="review" className="plan-section" {...fadeUp}>
              <span className="plan-label">Your Plan</span>
              <h2 className="plan-title">Your Path to More Perfect Moments</h2>

              {principles.length > 0 && (
                <div className="plan-review-section">
                  <h3 className="plan-review-heading">Guiding Principles</h3>
                  {principles.map((p, i) => (
                    <div key={p.id} className="plan-review-item">
                      <span className="plan-review-num">{i + 1}</span>
                      <p>{p.text}</p>
                    </div>
                  ))}
                </div>
              )}

              {habits.length > 0 && (
                <div className="plan-review-section">
                  <h3 className="plan-review-heading">Daily Practices & Habits</h3>
                  {habits.map(h => (
                    <div key={h.id} className="plan-review-item">
                      <span className="plan-review-freq">{h.frequency}</span>
                      <p>{h.text}</p>
                    </div>
                  ))}
                </div>
              )}

              {principles.length === 0 && habits.length === 0 && (
                <div className="rlz-empty">
                  <p>Add some principles and habits first.</p>
                  <button className="btn btn-secondary" onClick={() => setView('principles')}>
                    Start with Principles
                  </button>
                </div>
              )}

              <div className="plan-nav">
                <button className="btn btn-ghost" onClick={() => setView('habits')}>
                  Back to Habits
                </button>
                <button className="btn btn-primary" onClick={handleComplete}>
                  Complete My Journey
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
