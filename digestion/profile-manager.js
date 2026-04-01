// ============================================================
// PROFILE MANAGER — User-type-based alert & panel filtering
// ============================================================
// Presets: captain, owner, charter, surveyor, crew
// Each profile controls which alerts, modules, and panels
// are active. Custom profiles extend the preset system.
// ============================================================

export class ProfileManager {
  constructor(configManager) {
    this.configManager = configManager;
  }

  getPresets() {
    return this.configManager.get('profiles')?.presets || {};
  }

  getActive() {
    return this.configManager.get('profiles')?.active || null;
  }

  setActive(profileId) {
    const profiles = this.configManager.get('profiles') || {};
    profiles.active = profileId;
    this.configManager.update('profiles', profiles);
    return this.getProfile(profileId);
  }

  getProfile(id) {
    if (!id) return null;
    const profiles = this.configManager.get('profiles') || {};
    if (profiles.presets?.[id]) {
      return { id, ...profiles.presets[id], type: 'preset' };
    }
    const custom = (profiles.custom || []).find(p => p.id === id);
    return custom ? { ...custom, type: 'custom' } : null;
  }

  getAllProfiles() {
    const profiles = this.configManager.get('profiles') || {};
    const result = [];
    for (const [id, preset] of Object.entries(profiles.presets || {})) {
      result.push({ id, ...preset, type: 'preset' });
    }
    for (const custom of (profiles.custom || [])) {
      result.push({ ...custom, type: 'custom' });
    }
    return result;
  }

  createCustom(profile) {
    const profiles = this.configManager.get('profiles') || {};
    profiles.custom = profiles.custom || [];
    profile.id = profile.id || this.configManager.generateId();
    profile.type = 'custom';
    profiles.custom.push(profile);
    this.configManager.update('profiles', profiles);
    return profile;
  }

  updateProfile(id, data) {
    const profiles = this.configManager.get('profiles') || {};
    if (profiles.presets?.[id]) {
      Object.assign(profiles.presets[id], data);
    } else {
      const idx = (profiles.custom || []).findIndex(p => p.id === id);
      if (idx >= 0) Object.assign(profiles.custom[idx], data);
      else return null;
    }
    this.configManager.update('profiles', profiles);
    return this.getProfile(id);
  }

  shouldReceiveAlert(severity) {
    const activeId = this.getActive();
    if (!activeId) return true;
    const profile = this.getProfile(activeId);
    return profile?.alerts?.includes(severity) ?? true;
  }

  getActivePanels() {
    const activeId = this.getActive();
    if (!activeId) return null; // null = show all
    const profile = this.getProfile(activeId);
    return profile?.panels || null;
  }

  getActiveModules() {
    const activeId = this.getActive();
    if (!activeId) return null; // null = all enabled
    const profile = this.getProfile(activeId);
    return profile?.modules || null;
  }
}
