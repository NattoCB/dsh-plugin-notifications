// dsh-plugin-notifications
//
// DSH cordis bundle that adds a General-settings "Notifications" card. When the
// user enables it, a turn completion fires a macOS system notification (and an
// optional system sound) from the HOST process, so it keeps working when the
// Web GUI / PWA is in another window or closed entirely.
//
// Turn-complete signal: the loop driver emits `agent/status` on every
// running <-> idle transition; the idle edge of a root (non-subagent) agent is
// a finished conversation round. The host fires the native notification via
// `osascript display notification` (zero extra dependencies) and a built-in
// macOS system sound.
//
// Persistence path: the Web settings RPC only exposes a fixed allowlist of
// namespaces, so a third-party namespace cannot ride `settings.mutate` from the
// client. This bundle therefore exposes its own HTTP API under
// /notifications/* (like the petdex / wechat-bridge bundles) and writes the
// durable `notifications` settings namespace host-side, which lands in
// $DSH_HOME/settings.yaml.

import { execFile } from 'node:child_process';
import z from '@deepseek-ai/schemastery';
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings';

const name = 'notifications';

// kebab-case required by DSH settings namespace validation.
const SETTINGS_NS = settingsNamespace('notifications');

const SETTINGS_SCHEMA = z.object({
	// Pop a system notification when a turn finishes.
	enabled: z.boolean().default(false),
	// Also play a system sound.
	sound: z.boolean().default(true),
	// Sound character: soft / crisp / low.
	tone: z.union(['soft', 'crisp', 'low']).default('soft'),
});

const TONES = ['soft', 'crisp', 'low'];
const DEFAULTS = { enabled: false, sound: true, tone: 'soft' };

// macOS built-in notification sounds mapped from the tone preference.
const TONE_SOUND = { soft: 'Glass', crisp: 'Ping', low: 'Submarine' };

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
		return event?.data?.message?.source?.kind === 'automation';
	}
	return false;
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
			this.fireTurnComplete();
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

	/** Pop the macOS notification (and optional system sound) for a finished turn. */
	fireTurnComplete() {
		const cfg = this.getConfig();
		if (!cfg.enabled) return;
		if (process.platform !== 'darwin') return;
		const body = '本轮对话已完成。';
		const soundName = cfg.sound ? (TONE_SOUND[cfg.tone] ?? 'Ping') : null;
		const script = `display notification "${body}" with title "DSH"${soundName === null ? '' : ` sound name "${soundName}"`}`;
		execFile('/usr/bin/osascript', ['-e', script], { timeout: 5000 }, (error) => {
			if (error) this.ctx.logger?.warn?.(`[notifications] osascript failed: ${error.message}`);
		});
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
