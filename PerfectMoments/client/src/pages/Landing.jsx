import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useApp } from '../context/AppContext';
import Background from '../components/Background';
import './Landing.css';

export default function Landing() {
  const { user, login, startJourney, loadJourney } = useApp();
  const navigate = useNavigate();
  const [step, setStep] = useState(user ? 'welcome-back' : 'intro');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleLogin(e) {
    e.preventDefault();
    if (!name.trim() || !email.trim()) return;
    setLoading(true);
    try {
      await login(name.trim(), email.trim());
      setStep('ready');
    } catch {
      alert('Something went wrong. Please try again.');
    }
    setLoading(false);
  }

  async function handleBegin() {
    setLoading(true);
    try {
      await startJourney();
      navigate('/reflect');
    } catch {
      alert('Could not start journey. Please try again.');
    }
    setLoading(false);
  }

  async function handleContinue() {
    setLoading(true);
    try {
      const { api } = await import('../api.js');
      const journeys = await api.getJourneys();
      if (journeys.length > 0) {
        await loadJourney(journeys[0].id);
        const stage = journeys[0].current_stage;
        const paths = { reflection: '/reflect', realizations: '/realizations', planning: '/planning', complete: '/complete' };
        navigate(paths[stage] || '/reflect');
      } else {
        await handleBegin();
      }
    } catch {
      await handleBegin();
    }
    setLoading(false);
  }

  const fadeUp = {
    initial: { opacity: 0, y: 30 },
    animate: { opacity: 1, y: 0 },
    exit: { opacity: 0, y: -20 },
    transition: { duration: 0.8, ease: [0.16, 1, 0.3, 1] }
  };

  return (
    <div className="landing page">
      <Background variant="warm" />

      <div className="landing-content">
        <AnimatePresence mode="wait">
          {step === 'intro' && (
            <motion.div key="intro" className="landing-center" {...fadeUp}>
              <motion.div
                className="landing-star"
                animate={{ rotate: 360, scale: [1, 1.1, 1] }}
                transition={{ rotate: { duration: 60, repeat: Infinity, ease: 'linear' }, scale: { duration: 4, repeat: Infinity, ease: 'easeInOut' } }}
              />
              <h1 className="landing-title">
                Perfect<br />Moments
              </h1>
              <p className="landing-subtitle">
                Discover what makes your most meaningful experiences possible,
                and learn to create more of them.
              </p>
              <div className="landing-cta">
                <button className="btn btn-primary" onClick={() => setStep('auth')}>
                  Begin Your Journey
                </button>
              </div>
              <div className="landing-stages">
                <div className="landing-stage-item">
                  <span className="landing-stage-num">1</span>
                  <span>Reflect</span>
                </div>
                <div className="landing-stage-divider" />
                <div className="landing-stage-item">
                  <span className="landing-stage-num">2</span>
                  <span>Realize</span>
                </div>
                <div className="landing-stage-divider" />
                <div className="landing-stage-item">
                  <span className="landing-stage-num">3</span>
                  <span>Plan</span>
                </div>
              </div>
            </motion.div>
          )}

          {step === 'auth' && (
            <motion.div key="auth" className="landing-center" {...fadeUp}>
              <h2 className="landing-auth-title">Welcome</h2>
              <p className="landing-auth-sub">
                Before we begin, tell us a bit about yourself.
              </p>
              <form className="landing-form" onSubmit={handleLogin}>
                <input
                  type="text"
                  className="input-field"
                  placeholder="Your name"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  autoFocus
                />
                <input
                  type="email"
                  className="input-field"
                  placeholder="Your email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                />
                <button className="btn btn-primary" type="submit" disabled={loading}>
                  {loading ? 'One moment...' : 'Continue'}
                </button>
                <button className="btn btn-ghost" type="button" onClick={() => setStep('intro')}>
                  Back
                </button>
              </form>
            </motion.div>
          )}

          {step === 'ready' && (
            <motion.div key="ready" className="landing-center" {...fadeUp}>
              <h2 className="landing-auth-title">Welcome, {user?.name}</h2>
              <p className="landing-auth-sub">
                You're about to embark on a journey of self-discovery.<br />
                Think of five moments in your life that felt truly perfect.
              </p>
              <div className="landing-ready-steps">
                <p>This journey has three stages:</p>
                <div className="landing-ready-step">
                  <strong>Reflect</strong> &mdash; Revisit your 5 most perfect moments through guided meditation
                </div>
                <div className="landing-ready-step">
                  <strong>Realize</strong> &mdash; Discover the hidden patterns and themes that connect them
                </div>
                <div className="landing-ready-step">
                  <strong>Plan</strong> &mdash; Turn those insights into principles and daily habits
                </div>
              </div>
              <button className="btn btn-primary" onClick={handleBegin} disabled={loading}>
                {loading ? 'Starting...' : 'I\'m Ready'}
              </button>
            </motion.div>
          )}

          {step === 'welcome-back' && (
            <motion.div key="wb" className="landing-center" {...fadeUp}>
              <h2 className="landing-auth-title">Welcome back</h2>
              <p className="landing-auth-sub">
                Continue your journey or start a new one.
              </p>
              <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', justifyContent: 'center' }}>
                <button className="btn btn-primary" onClick={handleContinue} disabled={loading}>
                  {loading ? 'Loading...' : 'Continue Journey'}
                </button>
                <button className="btn btn-secondary" onClick={handleBegin} disabled={loading}>
                  New Journey
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
