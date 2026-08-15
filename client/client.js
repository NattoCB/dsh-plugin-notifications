window.__ModuleLoader__.load({
	id: "dsh-plugin-notifications",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react_jsx_runtime = require("react/jsx-runtime");
		let react = require("react");

		const { jsx, jsxs, Fragment } = react_jsx_runtime;
		const { useState, useEffect, useCallback, useSyncExternalStore } = react;

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

		//#region Config store (module-level, survives settings-panel unmount)
		// The monitor lives at the plugin level (see apply), so it must read
		// config from a store that outlives the settings card. The card renders
		// from the same store via useSyncExternalStore.
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

		const configStore = {
			value: readLocal() || DEFAULTS,
			listeners: new Set(),
			getSnapshot() {
				return this.value;
			},
			subscribe(listener) {
				this.listeners.add(listener);
				return () => { this.listeners.delete(listener); };
			},
			set(next) {
				this.value = normalize(next);
				writeLocal(this.value);
				for (const listener of this.listeners) listener();
			}
		};
		// Bound faces: useSyncExternalStore loses `this` on bare method refs.
		const configSubscribe = (listener) => configStore.subscribe(listener);
		const configSnapshot = () => configStore.getSnapshot();
		//#endregion

		//#region Host HTTP API (settings RPC is allowlisted; use our own route)
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

		//#region Web Audio chime (no asset files, works offline)
		// One shared AudioContext: browsers suspend contexts created without a
		// user gesture, so the preview button (a gesture) warms it up; the
		// monitor reuses it and resumes before playing.
		let sharedAudio = null;
		function getAudioContext() {
			try {
				const Ctx = typeof window !== "undefined" && (window.AudioContext || window.webkitAudioContext);
				if (!Ctx) return null;
				if (sharedAudio === null) sharedAudio = new Ctx();
				if (sharedAudio.state === "suspended") sharedAudio.resume().catch(() => {});
				return sharedAudio;
			} catch (_) { return null; }
		}
		function playChime(tone) {
			try {
				const ctx = getAudioContext();
				if (!ctx) return;
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
			} catch (_) { /* audio unavailable — ignore */ }
		}
		//#endregion

		//#region Turn-complete firing (shared by monitor and preview)
		// `hostActive` is set once the host HTTP API answers: from then on the
		// HOST fires the macOS notification (works with the GUI closed), so the
		// browser-side monitor must stay silent to avoid double notifications.
		let hostActive = false;
		function fireNotification() {
			if (hostActive) return;
			const cfg = configStore.getSnapshot();
			if (!cfg.enabled) return;
			try {
				if ("Notification" in window && Notification.permission === "granted") {
					new Notification("DSH", { body: "本轮对话已完成。" });
				}
			} catch (_) {}
			if (cfg.sound) playChime(cfg.tone);
		}
		//#endregion

		//#region Card component
		function NotificationsCard(props) {
			const { t, cfg, error, onEnabled, onSound, onTone } = props;
			const [previewing, setPreviewing] = useState(false);

			const requestAndPreview = useCallback(() => {
				setPreviewing(true);
				const done = () => { playChime(cfg.tone); setPreviewing(false); };
				try {
					if ("Notification" in window && Notification.permission === "default") {
						Notification.requestPermission().then(done, done);
					} else {
						done();
					}
				} catch (_) { done(); }
			}, [cfg.tone]);

			return jsxs("div", { className: "ntf_card", children: [
				jsxs("div", { className: "ntf_head", children: [
					jsxs("div", { children: [
						jsx("div", { className: "ntf_title", children: t("card.title") }),
						jsx("div", { className: "ntf_desc", children: t("card.desc") })
					] }),
					jsx(Toggle, { checked: cfg.enabled, onChange: onEnabled })
				] }),
				jsxs("div", { className: "ntf_row", children: [
					jsxs("div", { className: "ntf_sub", children: [
						jsx("span", { className: "ntf_label", children: t("row.sound") }),
						jsx("span", { className: "ntf_hint", children: t("row.sound.hint") })
					] }),
					jsx(Toggle, { checked: cfg.sound, onChange: onSound, disabled: !cfg.enabled })
				] }),
				jsxs("div", { className: "ntf_row", children: [
					jsxs("div", { className: "ntf_sub", children: [
						jsx("span", { className: "ntf_label", children: t("row.tone") }),
						jsx("span", { className: "ntf_hint", children: t("row.tone.hint") })
					] }),
					jsxs("div", { style: { display: "flex", alignItems: "center", gap: 8 }, children: [
						jsx("select", {
							className: "ntf_select",
							value: cfg.tone,
							disabled: !cfg.enabled,
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
							disabled: !cfg.enabled || previewing,
							onClick: requestAndPreview,
							children: t("test")
						})
					] })
				] }),
				error ? jsx("div", { className: "ntf_hint", style: { color: "var(--dsw-alias-state-error-primary)" }, children: error }) : null,
				!cfg.enabled ? jsx("div", { className: "ntf_hint", children: t("row.enabled.hint") }) : null
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

			// Plugin-lifetime host probe: once the host API answers, the host owns
			// notification firing (macOS notification even with the GUI closed)
			// and the browser monitor must defer to it.
			ctx.effect(() => {
				let cancelled = false;
				apiStatus().then((v) => {
					if (cancelled) return;
					hostActive = true;
					configStore.set(v);
				}).catch(() => {});
				return () => { cancelled = true; };
			}, "notifications: host-ownership probe");

			// Plugin-lifetime turn-complete monitor: lives in apply, NOT in the
			// settings card, so it keeps watching after the settings panel closes.
			ctx.effect(() => {
				const list = sessions && sessions.list;
				if (!list || typeof list.subscribe !== "function") return;
				let prevRunning = false;
				const check = () => {
					const snap = list.getSnapshot();
					const id = snap.current;
					if (id === void 0) { prevRunning = false; return; }
					const entry = snap.byId && snap.byId[id];
					const running = !!(entry && entry.running);
					if (prevRunning && !running) fireNotification();
					prevRunning = running;
				};
				check();
				const off = list.subscribe(check);
				return off;
			}, "notifications: turn-complete monitor");

			const NotificationsEntry = (props) => {
				const cfg = useSyncExternalStore(configSubscribe, configSnapshot);
				const [error, setError] = useState(null);

				// Prefer the host value when the host API is reachable (after the
				// host half is loaded); otherwise keep the localStorage snapshot.
				// A reachable API also marks the host as the notification owner.
				useEffect(() => {
					let live = true;
					apiStatus().then((v) => {
						if (!live) return;
						hostActive = true;
						configStore.set(v);
						setError(null);
					}).catch(() => { /* host route absent — localStorage only */ });
					return () => { live = false; };
				}, []);

				const update = useCallback((patch) => {
					const optimistic = normalize(Object.assign({}, configStore.getSnapshot(), patch));
					configStore.set(optimistic);
					setError(null);
					// Best effort: persist to the host when its API is loaded.
					apiUpdate(patch).then((v) => {
						configStore.set(v);
					}).catch(() => {});
				}, []);

				return jsx(NotificationsCard, Object.assign({}, props, {
					t,
					cfg,
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
