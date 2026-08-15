// dsh-plugin-notifications
//
// DSH cordis bundle that adds a General-settings "Notifications" card. When the
// user enables it, a turn completion fires a macOS notification (title =
// session name, body = the assistant's response, both truncated) and an
// optional chime from the HOST process, so it keeps working when the Web GUI /
// PWA is in another window or closed entirely.
//
// Turn-complete signal: the loop driver emits `agent/status` on every
// running <-> idle transition; the idle edge of a root (non-subagent) agent is
// a finished conversation round.
//
// The chime is synthesized to PCM in-process with the SAME profiles the
// settings card previews in Web Audio (same frequencies, waveforms, envelope),
// written to a temp WAV and played with `afplay` — so the configured tone and
// the real sound always match.
//
// Persistence path: the Web settings RPC only exposes a fixed allowlist of
// namespaces, so a third-party namespace cannot ride `settings.mutate` from the
// client. This bundle therefore exposes its own HTTP API under
// /notifications/* (like the petdex / wechat-bridge bundles) and writes the
// durable `notifications` settings namespace host-side, which lands in
// $DSH_HOME/settings.yaml.

import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import z from '@deepseek-ai/schemastery';
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings';

const name = 'notifications';

// kebab-case required by DSH settings namespace validation.
const SETTINGS_NS = settingsNamespace('notifications');

const SETTINGS_SCHEMA = z.object({
	// Pop a system notification when a turn finishes.
	enabled: z.boolean().default(false),
	// Also play the chime.
	sound: z.boolean().default(true),
	// Chime character: soft / crisp / low.
	tone: z.union(['soft', 'crisp', 'low']).default('soft'),
});

const TONES = ['soft', 'crisp', 'low'];
const DEFAULTS = { enabled: false, sound: true, tone: 'soft' };

// Chime profiles — must match client/client.js playChime() exactly so the
// notification sound equals the settings-card preview.
const CHIME_PROFILES = {
	soft: { freqs: [523.25, 783.99], type: 'sine', gain: 0.18, dur: 0.9 },
	crisp: { freqs: [659.25, 987.77], type: 'triangle', gain: 0.16, dur: 0.7 },
	low: { freqs: [261.63, 392.0], type: 'sine', gain: 0.22, dur: 1.1 },
};
const SAMPLE_RATE = 44100;

/** Collapse to one line and strip control characters (terminal-safe). */
function cleanOneLine(input) {
	return String(input).replace(/[\u0000-\u001f\u007f]/gu, ' ').replace(/\s+/gu, ' ').trim();
}

/** Truncate to a UTF-8 byte budget without splitting code points; adds ellipsis. */
function truncateUtf8(input, maxBytes) {
	if (Buffer.byteLength(input, 'utf8') <= maxBytes) return input;
	let used = 0;
	let output = '';
	for (const character of input) {
		const bytes = Buffer.byteLength(character, 'utf8');
		if (used + bytes > maxBytes) break;
		output += character;
		used += bytes;
	}
	return `${output.trimEnd()}…`;
}

/** Session display title: durable title, first user prompt, else the id. */
function sessionTitleOf(agent) {
	const events = agent?.session?.events ?? [];
	const titled = events.findLast((event) => event?.type === 'session/title');
	if (titled?.data?.title !== undefined && titled.data.title !== '') return truncateUtf8(cleanOneLine(titled.data.title), 60);
	for (const event of events) {
		if (event?.type !== 'user/message') continue;
		if (event?.data?.source?.kind !== 'user') continue;
		const text = (event.data.content ?? [])
			.filter((block) => block?.type === 'text')
			.map((block) => block.text)
			.join(' ');
		if (cleanOneLine(text).length > 0) return truncateUtf8(cleanOneLine(text), 60);
	}
	return truncateUtf8(cleanOneLine(agent?.id ?? 'DSH'), 60);
}

/** Latest assistant response text, truncated. */
function responseTextOf(agent) {
	const events = agent?.session?.events ?? [];
	for (let index = events.length - 1; index >= 0; index -= 1) {
		const event = events[index];
		if (event?.type !== 'assistant/message') continue;
		const text = (event?.data?.message?.content ?? [])
			.filter((block) => block?.type === 'text')
			.map((block) => block.text)
			.join(' ');
		const cleaned = cleanOneLine(text);
		if (cleaned.length > 0) return truncateUtf8(cleaned, 200);
	}
	return '本轮对话已完成。';
}

/**
 * Whether the session's last user message came from an unattended automation
 * run. Automation-driven turns (e.g. hourly workspaces) must not pop a system
 * notification; only interactive conversations should.
 * @param agent - the loop driver that just finished a turn.
 * @returns true when the latest user message carries source kind "automation".
 */
function isAutomationDriven(agent) {
	const events = agent?.session?.events;
	if (!Array.isArray(events)) return false;
	for (let index = events.length - 1; index >= 0; index -= 1) {
		const event = events[index];
		if (event?.type !== 'user/message') continue;
		return event?.data?.source?.kind === 'automation';
	}
	return false;
}

/** Escape a string for embedding inside a double-quoted AppleScript literal. */
function appleScriptQuote(input) {
	return String(input).replace(/\\/gu, '').replace(/"/gu, '');
}

/**
 * Synthesize one chime into a 16-bit PCM mono WAV and return its bytes.
 * Mirrors the Web Audio envelope: linear attack to gain over 20ms, then an
 * exponential decay to 0.0001 at note end; notes start 120ms apart.
 * @param tone - chime key in {@link CHIME_PROFILES}.
 * @returns the WAV file bytes.
 */
function synthesizeChimeWav(tone) {
	const profile = CHIME_PROFILES[tone] ?? CHIME_PROFILES.soft;
	const stagger = 0.12;
	const tail = 0.05;
	const totalSeconds = stagger + profile.dur + tail;
	const totalSamples = Math.ceil(totalSeconds * SAMPLE_RATE);
	const samples = new Float64Array(totalSamples);
	for (let noteIndex = 0; noteIndex < profile.freqs.length; noteIndex += 1) {
		const freq = profile.freqs[noteIndex];
		const startSample = Math.floor(noteIndex * stagger * SAMPLE_RATE);
		const endSample = startSample + Math.ceil(profile.dur * SAMPLE_RATE);
		for (let sample = startSample; sample < endSample && sample < totalSamples; sample += 1) {
			const t = (sample - startSample) / SAMPLE_RATE;
			let envelope;
			if (t < 0.02) {
				envelope = profile.gain * (t / 0.02);
			} else {
				envelope = profile.gain * Math.exp(Math.log(0.0001 / profile.gain) * (t - 0.02) / (profile.dur - 0.02));
			}
			const phase = 2 * Math.PI * freq * t;
			const wave = profile.type === 'triangle' ? (2 / Math.PI) * Math.asin(Math.sin(phase)) : Math.sin(phase);
			samples[sample] += envelope * wave;
		}
	}
	const buffer = Buffer.alloc(44 + totalSamples * 2);
	buffer.write('RIFF', 0);
	buffer.writeUInt32LE(36 + totalSamples * 2, 4);
	buffer.write('WAVE', 8);
	buffer.write('fmt ', 12);
	buffer.writeUInt32LE(16, 16);
	buffer.writeUInt16LE(1, 20); // PCM
	buffer.writeUInt16LE(1, 22); // mono
	buffer.writeUInt32LE(SAMPLE_RATE, 24);
	buffer.writeUInt32LE(SAMPLE_RATE * 2, 28); // byte rate
	buffer.writeUInt16LE(2, 32); // block align
	buffer.writeUInt16LE(16, 34); // bits per sample
	buffer.write('data', 36);
	buffer.writeUInt32LE(totalSamples * 2, 40);
	for (let sample = 0; sample < totalSamples; sample += 1) {
		const clamped = Math.max(-1, Math.min(1, samples[sample]));
		buffer.writeInt16LE(Math.round(clamped * 32767), 44 + sample * 2);
	}
	return buffer;
}

/** Cached temp WAV path per tone; regenerated lazily. */
function chimeWavPath(tone) {
	const dir = join(tmpdir(), 'dsh-plugin-notifications');
	mkdirSync(dir, { recursive: true });
	const path = join(dir, `chime-${tone}.wav`);
	if (!existsSync(path)) writeFileSync(path, synthesizeChimeWav(tone));
	return path;
}

export const apply = (ctx) => {
	new NotificationsService(ctx);
};

class NotificationsService {
	constructor(ctx) {
		this.ctx = ctx;
		// Replaced by installSettingsSection with the live settings scope getter.
		this._source = () => DEFAULTS;
		// Root agents currently running a turn (agent -> true).
		this._running = new Set();

		// Canonical DSH settings wiring: registers the `notifications` namespace
		// (writes persist to settings.yaml) and keeps the source current.
		installSettingsSection(ctx, SETTINGS_NS, SETTINGS_SCHEMA, DEFAULTS, {
			setSource: (current) => {
				this._source = current;
			},
			onChange: () => {},
		});

		// Host-side turn-complete monitor: survives GUI close, fires the macOS
		// notification from this process.
		ctx.on('agent/status', ({ agent, status }) => {
			const header = agent?.session?.header;
			if (header !== undefined && (header.parentSession !== undefined || header.origin === 'subagent')) return;
			if (status === 'running') {
				this._running.add(agent);
				return;
			}
			if (!this._running.has(agent)) return;
			this._running.delete(agent);
			if (isAutomationDriven(agent)) return;
			this.fireTurnComplete(agent);
		});
		ctx.on('agent/disposed', ({ agent }) => {
			this._running.delete(agent);
		});

		// HTTP API consumed by the settings card (see client/client.js).
		ctx.inject(['webServer'], (sctx) => {
			sctx.effect(() => sctx.webServer.register({
				kind: 'prefix',
				path: '/notifications',
				handler: (req, res) => this.httpHandler(req, res),
			}), 'notifications: http api route');
		});

		ctx.logger?.info?.('[notifications] host-side turn-complete notifications armed');
	}

	/** Resolved current config, coerced to the schema's shape. */
	getConfig() {
		const c = this._source() || DEFAULTS;
		return {
			enabled: !!c.enabled,
			sound: c.sound !== false,
			tone: TONES.includes(c.tone) ? c.tone : 'soft',
		};
	}

	/** Pop the macOS notification (session title + response) and optional chime. */
	fireTurnComplete(agent) {
		const cfg = this.getConfig();
		if (!cfg.enabled) return;
		if (process.platform !== 'darwin') return;
		const title = appleScriptQuote(sessionTitleOf(agent));
		const body = appleScriptQuote(responseTextOf(agent));
		const script = `display notification "${body}" with title "${title}"`;
		execFile('/usr/bin/osascript', ['-e', script], { timeout: 5000 }, (error) => {
			if (error) this.ctx.logger?.warn?.(`[notifications] osascript failed: ${error.message}`);
		});
		if (cfg.sound) {
			execFile('/usr/bin/afplay', [chimeWavPath(cfg.tone)], { timeout: 10000 }, (error) => {
				if (error) this.ctx.logger?.warn?.(`[notifications] afplay failed: ${error.message}`);
			});
		}
	}

	/** Merge a client patch into the durable namespace and return the new view. */
	async applyUpdate(body) {
		const current = this.getConfig();
		const next = {
			enabled: typeof body.enabled === 'boolean' ? body.enabled : current.enabled,
			sound: typeof body.sound === 'boolean' ? body.sound : current.sound,
			tone: TONES.includes(body.tone) ? body.tone : current.tone,
		};
		const settings = this.ctx.get('settings');
		if (settings === undefined) throw new Error('settings service unavailable');
		await settings.update(SETTINGS_NS, next);
		return next;
	}

	async httpHandler(req, res) {
		const send = (code, obj) => {
			res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' });
			res.end(JSON.stringify(obj));
		};
		const readBody = () => new Promise((resolve) => {
			let data = '';
			req.on('data', (c) => { data += c; });
			req.on('end', () => {
				try { resolve(data ? JSON.parse(data) : {}); } catch { resolve({}); }
			});
		});
		try {
			const url = new URL(req.url, 'http://x');
			const path = url.pathname.replace(/^\/notifications\/?/, '');
			if (req.method === 'GET' && path === 'status') {
				// `hostNotify` advertises that THIS loaded host half owns
				// notification firing (agent/status -> osascript); the client
				// defers to the host only when this flag is present, so a stale
				// host without the listener does not silence notifications.
				return send(200, { ok: true, hostNotify: true, ...this.getConfig() });
			}
			if (req.method === 'POST' && path === 'update') {
				const body = await readBody();
				const next = await this.applyUpdate(body);
				return send(200, { ok: true, ...next });
			}
			return send(404, { ok: false, error: 'unknown endpoint' });
		} catch (err) {
			return send(500, { ok: false, error: err instanceof Error ? err.message : String(err) });
		}
	}
}

export { name };
