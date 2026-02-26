import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useApp } from '../context/AppContext';
import StageBar from '../components/StageBar';
import Background from '../components/Background';
import './Reflection.css';

const prompts = [
  {
    title: 'Your First Perfect Moment',
    lead: 'Close your eyes and breathe. Think back to a time when everything felt exactly right.',
    guidance: 'It could be anything — a quiet sunrise, a conversation that changed you, a moment of pure joy. There are no wrong answers.',
  },
  {
    title: 'Your Second Perfect Moment',
    lead: 'Think of another time you felt completely alive and present.',
    guidance: 'Maybe it was unexpected. Maybe it was something you\'d waited for. Let the feeling come back to you.',
  },
  {
    title: 'Your Third Perfect Moment',
    lead: 'Remember a moment that still makes you smile when you think about it.',
    guidance: 'Perhaps it involved someone special. Perhaps you were alone. Either way, it was perfect.',
  },
  {
    title: 'Your Fourth Perfect Moment',
    lead: 'Think of a time when you felt deeply connected — to yourself, to others, or to the world.',
    guidance: 'Connection can come in many forms. What made this moment resonate?',
  },
  {
    title: 'Your Fifth Perfect Moment',
    lead: 'Your final moment. Let it be the one that keeps coming back to you.',
    guidance: 'This is the moment that defines something essential about who you are.',
  },
];

const fields = [
  { key: 'title', label: 'Give this moment a name', placeholder: 'e.g., "Sunset on Lake Como"', type: 'input' },
  { key: 'story', label: 'What happened?', placeholder: 'Describe the moment in your own words...', type: 'textarea' },
  { key: 'location', label: 'Where were you?', placeholder: 'The place, the setting...', type: 'input' },
  { key: 'people', label: 'Who was there?', placeholder: 'People who shared this moment with you (or just you)...', type: 'input' },
  { key: 'emotions', label: 'What did you feel?', placeholder: 'The emotions that filled you...', type: 'input' },
  { key: 'senses', label: 'What do you remember seeing, hearing, or feeling?', placeholder: 'The sensory details that made it vivid...', type: 'textarea' },
  { key: 'time_of_life', label: 'When in your life was this?', placeholder: 'e.g., "College years", "Last summer", "Childhood"', type: 'input' },
];

export default function Reflection() {
  const { moments, saveMoment, advanceStage } = useApp();
  const navigate = useNavigate();
  const [currentSlot, setCurrentSlot] = useState(1);
  const [form, setForm] = useState({});
  const [saving, setSaving] = useState(false);
  const [view, setView] = useState('prompt'); // 'prompt' | 'form' | 'saved'

  useEffect(() => {
    const existing = moments.find(m => m.slot === currentSlot);
    if (existing) {
      setForm({
        title: existing.title || '',
        story: existing.story || '',
        location: existing.location || '',
        people: existing.people || '',
        emotions: existing.emotions || '',
        senses: existing.senses || '',
        time_of_life: existing.time_of_life || '',
      });
      setView('form');
    } else {
      setForm({});
      setView('prompt');
    }
  }, [currentSlot, moments]);

  async function handleSave() {
    if (!form.title?.trim()) return;
    setSaving(true);
    await saveMoment(currentSlot, form);
    setSaving(false);
    setView('saved');
  }

  function handleNext() {
    if (currentSlot < 5) {
      setCurrentSlot(currentSlot + 1);
      setView('prompt');
    }
  }

  async function handleFinishReflection() {
    await advanceStage('realizations');
    navigate('/realizations');
  }

  const completedCount = moments.length;
  const prompt = prompts[currentSlot - 1];
  const allComplete = completedCount >= 5;

  const fadeUp = {
    initial: { opacity: 0, y: 40 },
    animate: { opacity: 1, y: 0 },
    exit: { opacity: 0, y: -30 },
    transition: { duration: 0.7, ease: [0.16, 1, 0.3, 1] }
  };

  return (
    <div className="reflection page">
      <Background variant="calm" />
      <StageBar />

      <div className="reflection-container">
        {/* Moment selector dots */}
        <div className="reflection-dots">
          {[1, 2, 3, 4, 5].map(slot => {
            const isDone = moments.some(m => m.slot === slot);
            const isActive = slot === currentSlot;
            return (
              <button
                key={slot}
                className={`reflection-dot ${isActive ? 'active' : ''} ${isDone ? 'done' : ''}`}
                onClick={() => setCurrentSlot(slot)}
              >
                {slot}
              </button>
            );
          })}
        </div>

        <AnimatePresence mode="wait">
          {view === 'prompt' && (
            <motion.div key={`prompt-${currentSlot}`} className="reflection-prompt" {...fadeUp}>
              <span className="reflection-moment-label">Moment {currentSlot} of 5</span>
              <h2 className="reflection-prompt-title">{prompt.title}</h2>
              <p className="reflection-prompt-lead">{prompt.lead}</p>
              <p className="reflection-prompt-guidance">{prompt.guidance}</p>
              <button className="btn btn-primary" onClick={() => setView('form')}>
                I Have a Moment
              </button>
            </motion.div>
          )}

          {view === 'form' && (
            <motion.div key={`form-${currentSlot}`} className="reflection-form-wrap" {...fadeUp}>
              <span className="reflection-moment-label">Moment {currentSlot} of 5</span>
              <h2 className="reflection-form-title">{prompt.title}</h2>

              <div className="reflection-fields">
                {fields.map(f => (
                  <div key={f.key} className="reflection-field">
                    <label>{f.label}</label>
                    {f.type === 'textarea' ? (
                      <textarea
                        className="textarea-field"
                        placeholder={f.placeholder}
                        value={form[f.key] || ''}
                        onChange={e => setForm({ ...form, [f.key]: e.target.value })}
                      />
                    ) : (
                      <input
                        type="text"
                        className="input-field"
                        placeholder={f.placeholder}
                        value={form[f.key] || ''}
                        onChange={e => setForm({ ...form, [f.key]: e.target.value })}
                      />
                    )}
                  </div>
                ))}
              </div>

              <div className="reflection-form-actions">
                <button className="btn btn-ghost" onClick={() => setView('prompt')}>
                  Back
                </button>
                <button
                  className="btn btn-primary"
                  onClick={handleSave}
                  disabled={!form.title?.trim() || saving}
                >
                  {saving ? 'Saving...' : 'Save This Moment'}
                </button>
              </div>
            </motion.div>
          )}

          {view === 'saved' && (
            <motion.div key={`saved-${currentSlot}`} className="reflection-saved" {...fadeUp}>
              <div className="reflection-saved-check">&#10003;</div>
              <h3>Moment Saved</h3>
              <p className="reflection-saved-title">{form.title}</p>
              <p className="reflection-saved-count">
                {completedCount} of 5 moments captured
              </p>

              {currentSlot < 5 ? (
                <button className="btn btn-primary" onClick={handleNext}>
                  Next Moment
                </button>
              ) : allComplete ? (
                <div className="reflection-saved-complete">
                  <p>All five moments captured. You're ready to discover what connects them.</p>
                  <button className="btn btn-primary" onClick={handleFinishReflection}>
                    Continue to Realizations
                  </button>
                </div>
              ) : (
                <p className="reflection-saved-count">
                  Fill in any remaining moments to continue.
                </p>
              )}

              <button className="btn btn-ghost" onClick={() => setView('form')}>
                Edit This Moment
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        {allComplete && view !== 'saved' && (
          <motion.div
            className="reflection-continue-bar"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
          >
            <button className="btn btn-primary" onClick={handleFinishReflection}>
              All 5 moments captured — Continue to Realizations
            </button>
          </motion.div>
        )}
      </div>
    </div>
  );
}
