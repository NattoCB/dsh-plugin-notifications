// dsh-plugin-notifications
//
// DSH cordis bundle that adds a General-settings "Notifications" card. When the
// user enables it, the client fires a system notification (and an optional
// Web Audio chime) whenever the current conversation turn completes (the
// session's running flag flips true -> false).
//
// Persistence path: the Web settings RPC only exposes a fixed allowlist of
// namespaces, so a third-party namespace cannot ride `settings.mutate` from the
// client. This bundle therefore exposes its own HTTP API under
// /notifications/* (like the petdex / wechat-bridge bundles) and writes the
// durable `notifications` settings namespace host-side, which lands in
// $DSH_HOME/settings.yaml.

import z from '@deepseek-ai/schemastery';
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings';

const name = 'notifications';

// kebab-case required by DSH settings namespace validation.
const SETTINGS_NS = settingsNamespace('notifications');

const SETTINGS_SCHEMA = z.object({
	// Pop a system notification when a turn finishes.
	enabled: z.boolean().default(false),
	// Also play a short chime.
	sound: z.boolean().default(true),
	// Chime character: soft / crisp / low.
	tone: z.union(['soft', 'crisp', 'low']).default('soft'),
});

const TONES = ['soft', 'crisp', 'low'];
const DEFAULTS = { enabled: false, sound: true, tone: 'soft' };

export const apply = (ctx) => {
	new NotificationsService(ctx);
};

class NotificationsService {
	constructor(ctx) {
		this.ctx = ctx;
		// Replaced by installSettingsSection with the live settings scope getter.
		this._source = () => DEFAULTS;

		// Canonical DSH settings wiring: registers the `notifications` namespace
		// (writes persist to settings.yaml) and keeps the source current.
		installSettingsSection(ctx, SETTINGS_NS, SETTINGS_SCHEMA, DEFAULTS, {
			setSource: (current) => {
				this._source = current;
			},
			onChange: () => {},
		});

		// HTTP API consumed by the settings card (see client/client.js).
		ctx.inject(['webServer'], (sctx) => {
			sctx.effect(() => sctx.webServer.register({
				kind: 'prefix',
				path: '/notifications',
				handler: (req, res) => this.httpHandler(req, res),
			}), 'notifications: http api route');
		});

		ctx.logger?.info?.('[notifications] settings namespace registered');
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
				return send(200, { ok: true, ...this.getConfig() });
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
