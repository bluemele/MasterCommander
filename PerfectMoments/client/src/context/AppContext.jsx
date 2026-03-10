import { createContext, useContext, useState, useCallback } from 'react';
import { api } from '../api';

const AppContext = createContext(null);

export function AppProvider({ children }) {
  const [user, setUser] = useState(() => {
    const id = localStorage.getItem('pm_user_id');
    const name = localStorage.getItem('pm_user_name');
    return id ? { id, name } : null;
  });
  const [journey, setJourney] = useState(null);
  const [moments, setMoments] = useState([]);
  const [realizations, setRealizations] = useState([]);
  const [principles, setPrinciples] = useState([]);
  const [habits, setHabits] = useState([]);

  const login = useCallback(async (name, email) => {
    const u = await api.login(name, email);
    localStorage.setItem('pm_user_id', u.id);
    localStorage.setItem('pm_user_name', u.name);
    setUser(u);
    return u;
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem('pm_user_id');
    localStorage.removeItem('pm_user_name');
    setUser(null);
    setJourney(null);
    setMoments([]);
    setRealizations([]);
    setPrinciples([]);
    setHabits([]);
  }, []);

  const startJourney = useCallback(async () => {
    const j = await api.createJourney();
    setJourney(j);
    setMoments([]);
    setRealizations([]);
    setPrinciples([]);
    setHabits([]);
    return j;
  }, []);

  const loadJourney = useCallback(async (id) => {
    const full = await api.getJourneyFull(id);
    setJourney(full);
    setMoments(full.moments || []);
    setRealizations(full.realizations || []);
    setPrinciples(full.principles || []);
    setHabits(full.habits || []);
    return full;
  }, []);

  const saveMoment = useCallback(async (slot, data) => {
    if (!journey) return;
    const m = await api.saveMoment(journey.id, slot, data);
    setMoments(prev => {
      const next = [...prev];
      const idx = next.findIndex(x => x.slot === slot);
      if (idx >= 0) next[idx] = m;
      else next.push(m);
      return next.sort((a, b) => a.slot - b.slot);
    });
    return m;
  }, [journey]);

  const advanceStage = useCallback(async (stage) => {
    if (!journey) return;
    const j = await api.updateStage(journey.id, stage);
    setJourney(j);
    return j;
  }, [journey]);

  const addRealization = useCallback(async (data) => {
    if (!journey) return;
    const r = await api.addRealization(journey.id, data);
    setRealizations(prev => [...prev, r]);
    return r;
  }, [journey]);

  const removeRealization = useCallback(async (id) => {
    if (!journey) return;
    await api.deleteRealization(journey.id, id);
    setRealizations(prev => prev.filter(r => r.id !== id));
  }, [journey]);

  const addPrinciple = useCallback(async (data) => {
    if (!journey) return;
    const p = await api.addPrinciple(journey.id, data);
    setPrinciples(prev => [...prev, p]);
    return p;
  }, [journey]);

  const removePrinciple = useCallback(async (id) => {
    if (!journey) return;
    await api.deletePrinciple(journey.id, id);
    setPrinciples(prev => prev.filter(p => p.id !== id));
  }, [journey]);

  const addHabit = useCallback(async (data) => {
    if (!journey) return;
    const h = await api.addHabit(journey.id, data);
    setHabits(prev => [...prev, h]);
    return h;
  }, [journey]);

  const removeHabit = useCallback(async (id) => {
    if (!journey) return;
    await api.deleteHabit(journey.id, id);
    setHabits(prev => prev.filter(h => h.id !== id));
  }, [journey]);

  return (
    <AppContext.Provider value={{
      user, login, logout,
      journey, startJourney, loadJourney, advanceStage,
      moments, saveMoment,
      realizations, addRealization, removeRealization,
      principles, addPrinciple, removePrinciple,
      habits, addHabit, removeHabit,
    }}>
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used within AppProvider');
  return ctx;
}
