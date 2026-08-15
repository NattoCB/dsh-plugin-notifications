window.__ModuleLoader__.load({
	id: "dsh-plugin-notifications",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react_jsx_runtime = require("react/jsx-runtime");
		let react = require("react");

		const { jsx, jsxs, Fragment } = react_jsx_runtime;
		const { useState, useEffect, useCallback, useRef } = react;

		//#region CSS (scoped to the notification card)
		const css = ".ntf_card{border-bottom:1px solid var(--dsw-alias-border-l2);flex-direction:column;gap:14px;padding:16px 0;display:flex}.ntf_head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}.ntf_title{color:var(--dsw-alias-label-primary);font-size:14px;font-weight:500;line-height:22px}.ntf_desc{color:var(--dsw-alias-label-tertiary);margin-top:2px;font-size:12px;line-height:18px}.ntf_row{display:flex;align-items:center;justify-content:space-between;gap:12px}.ntf_label{color:var(--dsw-alias-label-primary);font-size:13px;line-height:20px}.ntf_hint{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}.ntf_sub{display:flex;flex-direction:column;gap:6px;padding-left:2px}.ntf_select{appearance:none;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary);font:inherit;height:34px;border-radius:8px;padding:0 30px 0 12px;font-size:13px;line-height:1.5;background-image:linear-gradient(45deg,transparent 50%,var(--dsw-alias-label-tertiary) 50%),linear-gradient(135deg,var(--dsw-alias-label-tertiary) 50%,transparent 50%);background-position:calc(100% - 16px) 14px,calc(100% - 11px) 14px;background-size:5px 5px,5px 5px;background-repeat:no-repeat;cursor:pointer}.ntf_select:focus-visible{outline:none;border-color:var(--dsw-alias-brand-primary)}.ntf_select:disabled{color:var(--dsw-alias-label-tertiary);cursor:default}.ntf_test{font:inherit;color:var(--dsw-alias-label-secondary);cursor:pointer;background:0 0;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;padding:4px 12px;font-size:12px;line-height:1.5}.ntf_test:hover:not(:disabled){color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover)}.ntf_test:disabled{cursor:default;opacity:.45}";
		const tagId = "dsh-plugin-notifications/card.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-plugin-notifications";
			tag.dataset.pluginCss = tagId;
			tag.textContent = css;
			document.head.appendChild(tag);
		}
		//#endregion

		//#region Locales
		const NS = "notifications";
		const zh = {
			"card.title": "对话完成通知",
			"card.desc": "每轮对话完成后弹出系统通知，可选提示音。",
			"row.enabled": "启用系统通知",
			"row.enabled.hint": "当一轮对话结束（agent 停止运行）时弹出桌面通知。",
			"row.sound": "启用提示音",
			"row.sound.hint": "除通知外，额外播放一段合成提示音。",
			"row.tone": "提示音音调",
			"row.tone.hint": "柔和 / 清脆 / 低沉。",
			"tone.soft": "柔和",
			"tone.crisp": "清脆",
			"tone.low": "低沉",
			"test": "试听提示音",
			"err.load": "读取通知配置失败"
		};
		const en = {
			"card.title": "Turn-complete notifications",
			"card.desc": "Show a system notification when a conversation turn finishes, with an optional chime.",
			"row.enabled": "Enable system notification",
			"row.enabled.hint": "Pop a desktop notification when a turn ends (agent stops running).",
			"row.sound": "Enable sound",
			"row.sound.hint": "Also play a short synthesized chime on completion.",
			"row.tone": "Chime tone",
			"row.tone.hint": "Soft / crisp / low.",
			"tone.soft": "Soft",
			"tone.crisp": "Crisp",
			"tone.low": "Low",
			"test": "Preview chime",
			"err.load": "Could not read notification settings"
		};
		//#endregion

		//#region Web Audio chime (no asset files, works offline)
		function playChime(tone) {
			try {
				const Ctx = typeof window !== "undefined" && (window.AudioContext || window.webkitAudioContext);
				if (!Ctx) return;
				const ctx = new Ctx();
				const profiles = {
					soft: { freqs: [523.25, 783.99], type: "sine", gain: 0.18, dur: 0.9 },
					crisp: { freqs: [659.25, 987.77], type: "triangle", gain: 0.16, dur: 0.7 },
					low: { freqs: [261.63, 392.0], type: "sine", gain: 0.22, dur: 1.1 }
				};
				const p = profiles[tone] || profiles.soft;
				const now = ctx.currentTime;
				p.freqs.forEach((f, i) => {
					const osc = ctx.createOscillator();
					const g = ctx.createGain();
					osc.type = p.type;
					osc.frequency.value = f;
					const start = now + i * 0.12;
					g.gain.setValueAtTime(0, start);
					g.gain.linearRampToValueAtTime(p.gain, start + 0.02);
					g.gain.exponentialRampToValueAtTime(0.0001, start + p.dur);
					osc.connect(g).connect(ctx.destination);
					osc.start(start);
					osc.stop(start + p.dur + 0.05);
				});
				setTimeout(() => { try { ctx.close(); } catch (_) {} }, (p.dur + 0.4) * 1000);
			} catch (_) { /* audio unavailable — ignore */ }
		}
		//#endregion

		//#region Config store: host HTTP API when available, localStorage fallback
		// The Web settings RPC only exposes an allowlisted set of namespaces, so
		// this plugin persists through its own host route (/notifications/*).
		// Until the host half is (re)loaded — it needs a dsh restart — the card
		// keeps working on localStorage, and adopts the host value when the API
		// becomes reachable.
		const LS_KEY = "dsh-plugin-notifications.config";
		const TONES = ["soft", "crisp", "low"];
		const DEFAULTS = { enabled: false, sound: true, tone: "soft" };

		function normalize(v) {
			return {
				enabled: !!v.enabled,
				sound: v.sound !== false,
				tone: TONES.includes(v.tone) ? v.tone : "soft"
			};
		}
		function readLocal() {
			try {
				const raw = window.localStorage.getItem(LS_KEY);
				if (!raw) return null;
				return normalize(JSON.parse(raw));
			} catch (_) { return null; }
		}
		function writeLocal(cfg) {
			try { window.localStorage.setItem(LS_KEY, JSON.stringify(cfg)); } catch (_) {}
		}
		async function apiStatus() {
			const res = await fetch("/notifications/status", { headers: { accept: "application/json" } });
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			const json = await res.json().catch(() => { throw new Error("bad response"); });
			if (!json || json.ok === false) throw new Error(json && json.error ? json.error : "unknown");
			return normalize(json);
		}
		async function apiUpdate(patch) {
			const res = await fetch("/notifications/update", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(patch)
			});
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			const json = await res.json().catch(() => { throw new Error("bad response"); });
			if (!json || json.ok === false) throw new Error(json && json.error ? json.error : "unknown");
			return normalize(json);
		}
		//#endregion

		//#region Turn-complete monitor (browser-side running edge)
		// Watches the current session's `running` flag via the runtime sessions
		// list. The true -> false edge is a turn completing. `getConfig` is read
		// through a ref so the effect never captures stale config.
		function useTurnCompleteMonitor(sessions, getConfig, enabled) {
			const cfgRef = useRef(getConfig);
			cfgRef.current = getConfig;
			useEffect(() => {
				if (!enabled || !sessions) return;
				const list = sessions.list;
				if (!list || typeof list.subscribe !== "function") return;
				let prevRunning = false;
				const fire = () => {
					const { enabled: on, sound, tone } = cfgRef.current();
					if (!on) return;
					try {
						if ("Notification" in window && Notification.permission === "granted") {
							new Notification("DSH", { body: "本轮对话已完成。" });
						}
					} catch (_) {}
					if (sound) playChime(tone);
				};
				const check = () => {
					const snap = list.getSnapshot();
					const id = snap.current;
					if (id === void 0) { prevRunning = false; return; }
					const entry = snap.byId && snap.byId[id];
					const running = !!(entry && entry.running);
					if (prevRunning && !running) fire();
					prevRunning = running;
				};
				check();
				const off = list.subscribe(check);
				return off;
			}, [enabled, sessions]);
		}
		//#endregion

		//#region Card component
		function NotificationsCard(props) {
			const { t, enabled, sound, tone, error, onEnabled, onSound, onTone } = props;
			const [previewing, setPreviewing] = useState(false);

			const requestAndPreview = useCallback(() => {
				setPreviewing(true);
				const done = () => { playChime(tone); setPreviewing(false); };
				try {
					if ("Notification" in window && Notification.permission === "default") {
						Notification.requestPermission().then(done, done);
					} else {
						done();
					}
				} catch (_) { done(); }
			}, [tone]);

			return jsxs("div", { className: "ntf_card", children: [
				jsxs("div", { className: "ntf_head", children: [
					jsxs("div", { children: [
						jsx("div", { className: "ntf_title", children: t("card.title") }),
						jsx("div", { className: "ntf_desc", children: t("card.desc") })
					] }),
					jsx(Toggle, { checked: enabled, onChange: onEnabled })
				] }),
				jsxs("div", { className: "ntf_row", children: [
					jsxs("div", { className: "ntf_sub", children: [
						jsx("span", { className: "ntf_label", children: t("row.sound") }),
						jsx("span", { className: "ntf_hint", children: t("row.sound.hint") })
					] }),
					jsx(Toggle, { checked: sound, onChange: onSound, disabled: !enabled })
				] }),
				jsxs("div", { className: "ntf_row", children: [
					jsxs("div", { className: "ntf_sub", children: [
						jsx("span", { className: "ntf_label", children: t("row.tone") }),
						jsx("span", { className: "ntf_hint", children: t("row.tone.hint") })
					] }),
					jsxs("div", { style: { display: "flex", alignItems: "center", gap: 8 }, children: [
						jsx("select", {
							className: "ntf_select",
							value: tone,
							disabled: !enabled,
							onChange: (e) => onTone(e.target.value),
							children: [
								jsx("option", { key: "soft", value: "soft", children: t("tone.soft") }),
								jsx("option", { key: "crisp", value: "crisp", children: t("tone.crisp") }),
								jsx("option", { key: "low", value: "low", children: t("tone.low") })
							]
						}),
						jsx("button", {
							type: "button",
							className: "ntf_test",
							disabled: !enabled || previewing,
							onClick: requestAndPreview,
							children: t("test")
						})
					] })
				] }),
				error ? jsx("div", { className: "ntf_hint", style: { color: "var(--dsw-alias-state-error-primary)" }, children: error }) : null,
				!enabled ? jsx("div", { className: "ntf_hint", children: t("row.enabled.hint") }) : null
			] });
		}

		function Toggle({ checked, onChange, disabled }) {
			return jsx("button", {
				type: "button",
				role: "switch",
				"aria-checked": checked ? "true" : "false",
				disabled: disabled,
				onClick: () => { if (!disabled) onChange(!checked); },
				style: {
					appearance: "none",
					border: "none",
					cursor: disabled ? "default" : "pointer",
					width: 40,
					height: 24,
					borderRadius: 999,
					padding: 2,
					background: checked ? "var(--dsw-alias-brand-primary)" : "var(--dsw-alias-bg-module-platform)",
					opacity: disabled ? 0.5 : 1,
					position: "relative",
					flex: "none",
					transition: "background .16s"
				},
				children: jsx("span", {
					style: {
						position: "absolute",
						top: 2,
						left: checked ? 18 : 2,
						width: 20,
						height: 20,
						borderRadius: "50%",
						background: "#fff",
						transition: "left .16s"
					}
				})
			});
		}
		//#endregion

		//#region Client plugin body
		const inject = ["slots", "locale", "sessions"];

		function apply(ctx) {
			const t = ctx.locale.bind(NS);
			ctx.effect(() => ctx.locale.register(NS, { zh, en }), "notifications: dictionaries");

			const sessions = ctx.get("sessions");

			const NotificationsEntry = (props) => {
				const [cfg, setCfg] = useState(() => readLocal() || DEFAULTS);
				const [error, setError] = useState(null);
				const cfgRef = useRef(cfg);
				cfgRef.current = cfg;

				// Prefer the host value when the host API is reachable (after the
				// host half is loaded); otherwise keep the localStorage snapshot.
				useEffect(() => {
					let live = true;
					apiStatus().then((v) => {
						if (!live) return;
						setCfg(v);
						writeLocal(v);
						setError(null);
					}).catch(() => { /* host route absent — localStorage only */ });
					return () => { live = false; };
				}, []);

				useTurnCompleteMonitor(sessions, () => cfgRef.current, cfg.enabled);

				const update = useCallback((patch) => {
					const optimistic = normalize(Object.assign({}, cfgRef.current, patch));
					setCfg(optimistic);
					writeLocal(optimistic);
					setError(null);
					// Best effort: persist to the host when its API is loaded.
					apiUpdate(patch).then((v) => {
						setCfg(v);
						writeLocal(v);
					}).catch(() => {});
				}, []);

				return jsx(NotificationsCard, Object.assign({}, props, {
					t,
					enabled: cfg.enabled,
					sound: cfg.sound,
					tone: cfg.tone,
					error,
					onEnabled: (v) => update({ enabled: v }),
					onSound: (v) => update({ sound: v }),
					onTone: (v) => update({ tone: v })
				}));
			};

			ctx.slots.inject("settings.general.item", () => ctx.slots.register({
				name: "settings.general.item",
				id: "notifications",
				order: 15,
				locale: NS
			}, NotificationsEntry));
		}
		//#endregion

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
