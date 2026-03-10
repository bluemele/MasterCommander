import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useApp } from '../context/AppContext';
import Background from '../components/Background';
import './Complete.css';

export default function Complete() {
  const { user, moments, realizations, principles, habits, startJourney } = useApp();
  const navigate = useNavigate();

  async function handleNewJourney() {
    await startJourney();
    navigate('/reflect');
  }

  return (
    <div className="complete page">
      <Background variant="warm" />

      <div className="complete-container">
        <motion.div
          className="complete-hero"
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 1, ease: [0.16, 1, 0.3, 1] }}
        >
          <div className="complete-glow" />
          <h1 className="complete-title">Your Journey is Complete</h1>
          <p className="complete-subtitle">
            {user?.name}, you've uncovered the patterns behind your perfect moments
            and built a plan to create more of them.
          </p>
        </motion.div>

        <motion.div
          className="complete-stats"
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3, duration: 0.8 }}
        >
          <div className="complete-stat">
            <span className="complete-stat-num">{moments.length}</span>
            <span className="complete-stat-label">Moments Reflected</span>
          </div>
          <div className="complete-stat">
            <span className="complete-stat-num">{realizations.length}</span>
            <span className="complete-stat-label">Realizations Found</span>
          </div>
          <div className="complete-stat">
            <span className="complete-stat-num">{principles.length}</span>
            <span className="complete-stat-label">Principles Defined</span>
          </div>
          <div className="complete-stat">
            <span className="complete-stat-num">{habits.length}</span>
            <span className="complete-stat-label">Habits Committed</span>
          </div>
        </motion.div>

        {principles.length > 0 && (
          <motion.div
            className="complete-section"
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.5, duration: 0.8 }}
          >
            <h3>Your Guiding Principles</h3>
            <div className="complete-principles">
              {principles.map((p, i) => (
                <motion.div
                  key={p.id}
                  className="complete-principle"
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.6 + i * 0.1 }}
                >
                  <span className="complete-p-num">{i + 1}</span>
                  <p>{p.text}</p>
                </motion.div>
              ))}
            </div>
          </motion.div>
        )}

        {habits.length > 0 && (
          <motion.div
            className="complete-section"
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.7, duration: 0.8 }}
          >
            <h3>Your Habits</h3>
            <div className="complete-habits">
              {habits.map((h, i) => (
                <motion.div
                  key={h.id}
                  className="complete-habit"
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.8 + i * 0.1 }}
                >
                  <span className="complete-h-freq">{h.frequency}</span>
                  <p>{h.text}</p>
                </motion.div>
              ))}
            </div>
          </motion.div>
        )}

        <motion.div
          className="complete-closing"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 1 }}
        >
          <p className="complete-quote">
            "The quality of your life is determined by the quality of your moments."
          </p>
          <div className="complete-actions">
            <button className="btn btn-primary" onClick={handleNewJourney}>
              Start a New Journey
            </button>
            <button className="btn btn-ghost" onClick={() => navigate('/')}>
              Return Home
            </button>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
