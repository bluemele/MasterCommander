// ============================================================
// WHATSAPP BOT — Commander's communication layer
// ============================================================
// Two modes:
//   'dedicated' — Commander has its own WhatsApp number.
//                 Boat owners text the boat's number directly.
//   'bridge'    — Runs on the owner's existing WhatsApp.
//                 Same as Gil's whatsapp-claude-bridge approach.
//
// Both modes support: queries, alerts, auto-status updates.
// ============================================================

import makeWASocket, { useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } from '@whiskeysockets/baileys';
import pino from 'pino';
import { EventEmitter } from 'events';

const logger = pino({ level: 'warn' });

export class WhatsAppBot extends EventEmitter {
  constructor(config = {}) {
    super();
    this.mode = config.mode || 'dedicated';  // 'dedicated' | 'bridge'
    this.authDir = config.authDir || './auth';
    this.adminNumber = config.adminNumber || '';
    this.allowedNumbers = config.allowedNumbers || [];
    this.respondToGroups = config.respondToGroups || false;
    this.triggerWord = config.triggerWord || 'commander';
    this.sock = null;
    this.connected = false;

    // Handler to be set by commander.js
    this.onMessage = null;  // async (text, senderNumber, isGroup) => response
  }

  async start() {
    try {
      const { state, saveCreds } = await useMultiFileAuthState(this.authDir);
      const { version } = await fetchLatestBaileysVersion();

      this.sock = makeWASocket({
        version,
        auth: state,
        logger,
        printQRInTerminal: true,
        browser: ['Commander', 'Bot', '1.0'],
        connectTimeoutMs: 30000,
      });

      this.sock.ev.on('creds.update', saveCreds);

      this.sock.ev.on('connection.update', ({ connection, lastDisconnect }) => {
        if (connection === 'close') {
          const reason = lastDisconnect?.error?.output?.statusCode;
          if (reason === DisconnectReason.loggedOut) {
            console.log('❌ WhatsApp logged out. Delete auth dir and re-scan QR.');
            this.connected = false;
            this.emit('loggedOut');
          } else {
            console.log(`🔄 WhatsApp reconnecting... (reason=${reason})`);
            this.connected = false;
            setTimeout(() => this.start(), 3000);
          }
        } else if (connection === 'open') {
          console.log('✅ WhatsApp connected');
          this.connected = true;
          this.emit('connected');
        }
      });

      this.sock.ev.on('messages.upsert', async ({ messages }) => {
        for (const msg of messages) {
          try {
            if (msg.key.fromMe) continue;
            if (msg.key.remoteJid === 'status@broadcast') continue;
            if (msg.message?.reactionMessage) continue;

            await this._handleMessage(msg);
          } catch (err) {
            console.error('[whatsapp] Error processing message:', err.message);
          }
        }
      });
    } catch (err) {
      console.error('[whatsapp] Failed to start:', err.message);
      this.connected = false;
      // Retry after delay
      console.log('[whatsapp] Retrying in 10s...');
      setTimeout(() => this.start(), 10000);
    }
  }

  async _handleMessage(msg) {
    const jid = msg.key.remoteJid;
    const isGroup = jid.endsWith('@g.us');
    const senderNumber = isGroup
      ? msg.key.participant?.replace('@s.whatsapp.net', '') || ''
      : jid.replace('@s.whatsapp.net', '');

    const text = msg.message?.conversation
      || msg.message?.extendedTextMessage?.text
      || '';
    if (!text.trim()) return;

    // ── Access control ─────────────────────────────────
    if (this.mode === 'dedicated') {
      // Dedicated mode: anyone can text the boat's number
      // but we still enforce allowlist if configured
      if (this.allowedNumbers.length > 0 && !this.allowedNumbers.includes(senderNumber)) {
        console.log(`⛔ ${senderNumber} not in allowlist`);
        return;
      }
    } else {
      // Bridge mode: only respond to specific trigger words
      // since this is the owner's personal WhatsApp
      const lower = text.toLowerCase();
      const hasTrigger = lower.includes(this.triggerWord)
        || lower.startsWith('/')
        || lower === 'status' || lower === 'engines'
        || lower === 'battery' || lower === 'position'
        || lower === 'tanks' || lower === 'wind'
        || lower === 'anchor' || lower === 'help';

      if (isGroup && !hasTrigger) return;
      if (!isGroup && !hasTrigger) return;  // In bridge mode, non-boat messages pass through
    }

    // ── Group handling ─────────────────────────────────
    if (isGroup && !this.respondToGroups) return;
    if (isGroup) {
      const lower = text.toLowerCase();
      if (!lower.includes(this.triggerWord) && !lower.startsWith('/')) return;
    }

    console.log(`📩 ${senderNumber}${isGroup ? ' (group)' : ''}: ${text.substring(0, 60)}`);

    try {
      await this.sock.readMessages([msg.key]);
      await this.sock.sendPresenceUpdate('composing', jid);

      // Route to handler
      let response = null;
      if (this.onMessage) {
        response = await this.onMessage(text, senderNumber, isGroup);
      }

      if (response) {
        await this.sock.sendMessage(jid, { text: response });
        console.log(`📤 → ${senderNumber}: ${response.substring(0, 60)}...`);
      }

      await this.sock.sendPresenceUpdate('available', jid);
    } catch (err) {
      console.error('Message handler error:', err.message);
      try {
        await this.sock.sendMessage(jid, {
          text: `⚠️ Commander error. Try "status" for a quick report.`,
        });
      } catch {}
    }
  }

  // ── Send alert to admin ────────────────────────────────
  async sendAlert(message) {
    if (!this.connected || !this.sock || !this.adminNumber) return false;
    try {
      const jid = `${this.adminNumber}@s.whatsapp.net`;
      await this.sock.sendMessage(jid, { text: message });
      return true;
    } catch (e) {
      console.error('Alert send failed:', e.message);
      return false;
    }
  }

  // ── Send to specific number ────────────────────────────
  async sendTo(number, message) {
    if (!this.connected || !this.sock) return false;
    try {
      const jid = `${number}@s.whatsapp.net`;
      await this.sock.sendMessage(jid, { text: message });
      return true;
    } catch (e) {
      console.error('Send failed:', e.message);
      return false;
    }
  }
}
