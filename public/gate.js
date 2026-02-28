/**
 * Site Gate — Reusable Passwordless Access Control
 * Drop gate.js + gate.css into any site, call SiteGate.init({ site, siteName, logo, ndaText }).
 * Requires /api/gate/* endpoints on Overlord.
 */
(function () {
  'use strict';

  const API_BASE = '/api/gate';
  let config = {};
  let state = { name: '', email: '' };
  let _verifying = false;

  function el(id) { return document.getElementById(id); }

  function tokenKey() { return 'gate_token_' + config.site; }

  function buildOverlay() {
    const overlay = document.createElement('div');
    overlay.id = 'site-gate-overlay';
    overlay.innerHTML = `
      <div id="site-gate-card">
        <div id="site-gate-logo">${config.logo || '🔒'}</div>
        <h2 id="site-gate-title">${config.siteName || 'Access Required'}</h2>
        <p id="site-gate-subtitle">Enter your details to continue</p>

        <!-- Step 1: Name + Email -->
        <div class="gate-step gate-active" id="site-gate-step1">
          <label class="gate-label" for="site-gate-name">Full Name</label>
          <input class="gate-input" id="site-gate-name" type="text" placeholder="Your full name" autocomplete="name" />
          <label class="gate-label" for="site-gate-email">Email Address</label>
          <input class="gate-input" id="site-gate-email" type="email" placeholder="you@company.com" autocomplete="email" />
          <div class="gate-error" id="site-gate-err1"></div>
          <button class="gate-btn" id="site-gate-btn1">Send Verification Code</button>
        </div>

        <!-- Step 2: Code -->
        <div class="gate-step" id="site-gate-step2">
          <p class="gate-info" style="margin-bottom:20px">A 6-digit code was sent to <strong id="site-gate-sent-email"></strong></p>
          <label class="gate-label" for="site-gate-code-input">Verification Code</label>
          <input class="gate-input" id="site-gate-code-input" type="text" inputmode="numeric" maxlength="6" placeholder="000000" autocomplete="one-time-code" />
          <div class="gate-error" id="site-gate-err2"></div>
          <button class="gate-btn" id="site-gate-btn2">Verify</button>
          <p class="gate-info"><a href="#" id="site-gate-resend">Resend code</a></p>
        </div>

        <!-- Step 3: NDA -->
        <div class="gate-step" id="site-gate-step3">
          <div id="site-gate-nda-box"></div>
          <div id="site-gate-nda-signature"></div>
          <div class="gate-error" id="site-gate-err3"></div>
          <button class="gate-btn" id="site-gate-btn3">I Accept</button>
        </div>
      </div>
    `;
    document.body.prepend(overlay);
  }

  function showStep(n) {
    document.querySelectorAll('.gate-step').forEach(s => s.classList.remove('gate-active'));
    const step = el('site-gate-step' + n);
    if (step) step.classList.add('gate-active');

    const subtitles = {
      1: 'Enter your details to continue',
      2: 'Check your email',
      3: 'Review & Accept NDA',
    };
    el('site-gate-subtitle').textContent = subtitles[n] || '';
  }

  function setError(step, msg) {
    const e = el('site-gate-err' + step);
    if (e) e.textContent = msg || '';
  }

  function setBtnLoading(id, loading, text) {
    const btn = el(id);
    if (!btn) return;
    btn.disabled = loading;
    btn.innerHTML = loading ? '<span class="gate-spinner"></span>Please wait...' : text;
  }

  async function api(path, opts = {}) {
    const headers = { 'Content-Type': 'application/json' };
    const token = localStorage.getItem(tokenKey());
    if (token) headers['Authorization'] = 'Bearer ' + token;
    const res = await fetch(API_BASE + path, { ...opts, headers });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Request failed');
    return data;
  }

  // Step 1: Request code
  async function requestCode() {
    const name = el('site-gate-name').value.trim();
    const email = el('site-gate-email').value.trim();
    setError(1, '');

    if (!name) return setError(1, 'Please enter your name.');
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return setError(1, 'Please enter a valid email.');

    state.name = name;
    state.email = email;
    setBtnLoading('site-gate-btn1', true);

    try {
      await api('/request-code', {
        method: 'POST',
        body: JSON.stringify({ name, email, site: config.site }),
      });
      el('site-gate-sent-email').textContent = email;
      showStep(2);
      el('site-gate-code-input').focus();
    } catch (err) {
      setError(1, err.message);
    } finally {
      setBtnLoading('site-gate-btn1', false, 'Send Verification Code');
    }
  }

  // Step 2: Verify code
  async function verifyCode() {
    if (_verifying) return;
    const code = el('site-gate-code-input').value.trim();
    setError(2, '');

    if (!/^\d{6}$/.test(code)) return setError(2, 'Enter the 6-digit code from your email.');

    _verifying = true;
    setBtnLoading('site-gate-btn2', true);

    try {
      const data = await api('/verify-code', {
        method: 'POST',
        body: JSON.stringify({ email: state.email, code, site: config.site }),
      });
      localStorage.setItem(tokenKey(), data.token);
      if (data.ndaAccepted) {
        grantAccess();
      } else {
        showNDA();
        showStep(3);
      }
    } catch (err) {
      setError(2, err.message);
    } finally {
      _verifying = false;
      setBtnLoading('site-gate-btn2', false, 'Verify');
    }
  }

  // Step 3: Accept NDA
  function showNDA() {
    el('site-gate-nda-box').innerHTML = config.ndaText || '<p>No NDA configured.</p>';
    el('site-gate-nda-signature').innerHTML =
      '<strong>' + escapeHtml(state.name) + '</strong><br>' +
      escapeHtml(state.email) + '<br>' +
      new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  }

  async function acceptNDA() {
    setError(3, '');
    setBtnLoading('site-gate-btn3', true);

    try {
      const data = await api('/accept-nda', {
        method: 'POST',
        body: JSON.stringify({ site: config.site }),
      });
      localStorage.setItem(tokenKey(), data.token);
      grantAccess();
    } catch (err) {
      setError(3, err.message);
    } finally {
      setBtnLoading('site-gate-btn3', false, 'I Accept');
    }
  }

  function grantAccess() {
    const overlay = el('site-gate-overlay');
    overlay.classList.add('gate-hidden');
    setTimeout(() => overlay.remove(), 600);
  }

  // Check existing session on load
  async function checkSession() {
    const token = localStorage.getItem(tokenKey());
    if (!token) return false;

    try {
      const data = await api('/session?site=' + encodeURIComponent(config.site));
      state.name = data.name || '';
      state.email = data.email || '';
      if (data.valid && data.ndaAccepted) return true;
      // Token valid but NDA not accepted — show NDA step
      if (data.valid && !data.ndaAccepted) {
        showNDA();
        showStep(3);
        return 'nda';
      }
    } catch {
      localStorage.removeItem(tokenKey());
    }
    return false;
  }

  function escapeHtml(str) {
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  }

  function bindEvents() {
    el('site-gate-btn1').addEventListener('click', requestCode);
    el('site-gate-btn2').addEventListener('click', verifyCode);
    el('site-gate-btn3').addEventListener('click', acceptNDA);

    // Auto-submit code at 6 digits
    el('site-gate-code-input').addEventListener('input', function () {
      this.value = this.value.replace(/\D/g, '').slice(0, 6);
      if (this.value.length === 6) verifyCode();
    });

    // Enter key on inputs
    el('site-gate-name').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') el('site-gate-email').focus();
    });
    el('site-gate-email').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') requestCode();
    });
    el('site-gate-code-input').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') verifyCode();
    });

    // Resend link
    el('site-gate-resend').addEventListener('click', function (e) {
      e.preventDefault();
      requestCode();
    });
  }

  // Public init
  window.SiteGate = {
    init: async function (opts) {
      config = opts || {};
      if (!config.site) return console.error('[SiteGate] Missing site ID');

      // If token exists in localStorage, start hidden — verify async, only show if invalid
      const hasToken = !!localStorage.getItem(tokenKey());

      buildOverlay();
      if (hasToken) el('site-gate-overlay').classList.add('gate-hidden');
      bindEvents();

      // Pre-fill name from cache
      const cached = localStorage.getItem('gate_name_' + config.site);
      if (cached) el('site-gate-name').value = cached;

      const session = await checkSession();
      if (session === true) {
        // Already hidden if hasToken, remove overlay entirely
        const ov = el('site-gate-overlay');
        if (ov) ov.remove();
      } else if (hasToken) {
        // Token was bad — show the overlay
        el('site-gate-overlay').classList.remove('gate-hidden');
      }
      // if session === 'nda', step 3 is already shown
      // if false and no token, step 1 is shown (default)

      // Cache name on input
      el('site-gate-name').addEventListener('blur', function () {
        if (this.value.trim()) localStorage.setItem('gate_name_' + config.site, this.value.trim());
      });
    },
  };
})();
