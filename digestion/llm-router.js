// ============================================================
// LLM ROUTER — Configurable AI backend
// ============================================================
// Supports: 'local' (Ollama), 'cloud' (Claude CLI), 'auto'
// Auto mode: tries Claude, falls back to local on timeout/error
// Local mode: always Ollama, works fully offline
// ============================================================

import { execSync } from 'child_process';

export class LLMRouter {
  constructor(config = {}) {
    // 'local' | 'cloud' | 'auto'
    this.mode = config.provider || 'local';
    this.ollamaModel = config.ollamaModel || 'qwen2.5:14b';
    this.ollamaUrl = config.ollamaUrl || 'http://localhost:11434';
    this.claudePath = config.claudePath || 'claude';
    this.timeout = config.timeout || 30000;
  }

  async ask(question, boatContext) {
    const systemPrompt = this._buildPrompt(boatContext);

    if (this.mode === 'local') {
      return await this._askOllama(question, systemPrompt);
    }
    if (this.mode === 'cloud') {
      return await this._askClaude(question, systemPrompt);
    }
    // auto: try cloud, fall back to local
    try {
      return await this._askClaude(question, systemPrompt);
    } catch {
      console.log('☁️ Cloud unavailable, falling back to local LLM');
      return await this._askOllama(question, systemPrompt);
    }
  }

  _buildPrompt(boatContext) {
    const boatName = boatContext._config?.boat?.name || 'the boat';
    const boatType = boatContext._config?.boat?.type || 'vessel';
    return `You are Commander, the AI system monitoring ${boatName} (${boatType}).

CURRENT SENSOR DATA (live):
${JSON.stringify(boatContext, null, 2)}

RULES:
- Keep answers concise — this goes to WhatsApp
- Reference specific sensor values
- If something looks concerning, say so directly
- Engines off → oil pressure 0 is normal, don't flag it
- Use relevant emojis sparingly
- Answer in plain English, avoid jargon`;
  }

  async _askOllama(question, systemPrompt) {
    try {
      const res = await fetch(`${this.ollamaUrl}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.ollamaModel,
          system: systemPrompt,
          prompt: question,
          stream: false,
          options: { num_predict: 500 },
        }),
        signal: AbortSignal.timeout(this.timeout),
      });
      const data = await res.json();
      return data.response?.trim() || '⚠️ No response from local LLM';
    } catch (e) {
      throw new Error(`Local LLM error: ${e.message}`);
    }
  }

  async _askClaude(question, systemPrompt) {
    try {
      const prompt = `${systemPrompt}\n\nCAPTAIN'S QUESTION: ${question}`;
      const result = execSync(
        `echo ${JSON.stringify(prompt)} | ${this.claudePath} -p --max-turns 1`,
        { encoding: 'utf8', timeout: this.timeout }
      );
      return result.trim();
    } catch (e) {
      throw new Error(`Claude error: ${e.message}`);
    }
  }
}
