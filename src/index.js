// @jasper/dsh-plugin-notifications
//
// DSH cordis bundle that adds a General-settings "Notifications" card. When the
// user enables it, the client fires a system notification (and an optional
// Web Audio chime) whenever any conversation turn completes (the session's
// running flag flips true -> false).
//
// The host half only registers the durable `notifications` settings namespace
// so the toggle values persist to $DSH_HOME/settings.yaml. The actual
// detection + firing lives on the client (see client/client.js), because the
// completion signal is a browser-side session-state edge.

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

export const apply = (ctx) => {
	// Composition-layer base; the live user value (and host document) override it.
	let source = { enabled: false, sound: true, tone: 'soft' };
	installSettingsSection(ctx, SETTINGS_NS, SETTINGS_SCHEMA, source, {
		setSource: (current) => {
			source = current;
		},
		onChange: () => {},
	});
	ctx.logger?.info?.('[notifications] settings namespace registered');
};

export { name };
