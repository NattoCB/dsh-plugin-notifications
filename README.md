# DSH Notifications Plugin / DSH 对话完成通知插件

A DSH bundle plugin that adds a **Notifications** card to **Settings → General**.
When enabled, it pops a **system notification** (and an optional synthesized chime)
every time a conversation turn completes.

一个 DSH 插件包，在 **设置 → 通用** 页增加「对话完成通知」卡片。启用后，
每轮对话结束时弹出**系统通知**（并可叠加一段合成提示音）。

<p>
  <a href="#english">English</a> ·
  <a href="#中文">中文</a>
</p>

---

## 中文

### 功能

- 在「设置 → 通用」中新增 **对话完成通知** 卡片。
- 启用后，任意根会话（跳过 subagent 与 automation）的一轮对话结束时，由 **host 进程**弹出 **macOS 系统通知**：标题为会话名（过长截断），内容为助手回复（过长截断）。即使 Web GUI / PWA 已关闭或切到其他窗口也照常通知。
- 可选**提示音**：host 侧按设置音调（**柔和 / 清脆 / 低沉**）程序合成 PCM → 临时 WAV → `afplay` 播放，波形与设置卡片里的「试听」Web Audio 预览**完全一致**；无需音频文件，离线可用。
- 「试听提示音」按钮同时用于触发浏览器的通知授权（浏览器要求用户手势才能申请权限）。

### 行为说明

- **Host 端**：注册持久化设置命名空间 `notifications`（写入 `$DSH_HOME/settings.yaml`，键 `notifications`）；
  监听 `agent/status` 事件，在根 agent 的 running→idle 边沿弹通知（`osascript display notification`）并
  `afplay` 播放合成提示音；暴露自有 HTTP API `/notifications/status`（读）与 `/notifications/update`（写）。
- **Client 端**：把卡片渲染进通用区的 `settings.general.item` 插槽；当 host 半已加载（`hostNotify` 标志）时，
  浏览器侧 monitor 静默，由 host 负责弹通知，避免双重通知；host 未加载时退回浏览器侧 monitor + localStorage。
- 说明：Web 端的 `settings.mutate` RPC 只放行内置命名空间白名单，第三方命名空间无法走该通道；
  因此本插件走自有 HTTP API（与 petdex / wechat-bridge 同模式）。host 半载入前（例如刚改完代码、
  尚未重启 `dsh web`），卡片自动降级为浏览器 localStorage，交互与持久化在单浏览器内照常可用；
  host 半载入后自动切换到 settings.yaml 并同步最新值。

### 设置（写入 `settings.yaml`）

```yaml
notifications:
  enabled: false   # 一轮对话完成后弹出系统通知
  sound: true      # 同时播放提示音
  tone: soft       # soft | crisp | low
```

### 启用方式

1. 在本机 profile（`$DSH_HOME/profiles/web`）的 `package.json` 中：
   - `dependencies` 增加 `"dsh-plugin-notifications": "file:<本仓库路径>"`；
   - `dsh.profile.bundles` 增加 `"dsh-plugin-notifications"`。
2. 确保 `node_modules/dsh-plugin-notifications` 可解析到本仓库。
3. 重启 web profile（`dsh web`），使 host 半生效（否则只有浏览器侧 monitor，GUI 关闭后收不到）。

> 提示：macOS 系统通知需要操作系统级通知授权（首次弹通知时 macOS 会请求）。
> 提示音由 host 进程经 `afplay` 播放，与浏览器授权无关。

---

## English

### Features

- Adds a **Turn-complete notifications** card to **Settings → General**.
- When enabled, the **host process** pops a **macOS notification** when any root
  session (subagents and automation runs skipped) finishes a turn — title = session
  name (truncated), body = the assistant response (truncated). Keeps working with
  the Web GUI / PWA closed or in another window.
- Optional **chime**: the host synthesizes PCM from the configured tone
  (**soft / crisp / low**) into a temp WAV played via `afplay`, with the same
  waveform as the card's Web Audio preview — the configured tone and the real
  sound always match. No asset files, works offline.
- The "Preview chime" button also triggers the browser's notification-permission
  prompt (browsers require a user gesture to request it).

### How it works

- **Host half** registers the durable `notifications` settings namespace
  (`$DSH_HOME/settings.yaml`, key `notifications`), listens to `agent/status` and
  fires `osascript display notification` + `afplay` on the running→idle edge, and
  exposes its own HTTP API — `GET /notifications/status`, `POST /notifications/update` —
  persisting through host-side `settings.update`.
- **Client half** renders the card into the General section's `settings.general.item`
  slot. When the host half advertises `hostNotify`, the browser monitor stays silent
  (host owns firing, no double notifications); otherwise it falls back to the
  browser monitor + localStorage.
- Note: the Web `settings.mutate` RPC only admits a built-in namespace allowlist,
  so third-party namespaces cannot ride it; this plugin uses its own HTTP API
  (same pattern as the petdex / wechat-bridge bundles). Until the host half is
  loaded (e.g. right after a code change, before restarting `dsh web`), the card
  degrades to browser localStorage — interaction and persistence keep working in
  that browser — and switches to settings.yaml once the host half is live.

### Settings (settings.yaml)

```yaml
notifications:
  enabled: false   # pop a system notification on turn completion
  sound: true      # also play a chime
  tone: soft       # soft | crisp | low
```

### Enable

1. In the web profile (`$DSH_HOME/profiles/web`) `package.json`:
   - add `"dsh-plugin-notifications": "file:<path-to-this-repo>"` to `dependencies`;
   - add `"dsh-plugin-notifications"` to `dsh.profile.bundles`.
2. Ensure `node_modules/dsh-plugin-notifications` resolves to this folder.
3. Restart the web profile (`dsh web`) so the host half loads; until then only
   the browser monitor works (no notifications with the GUI closed).

> Note: macOS asks for notification permission on first use. The chime plays via
> `afplay` from the host process and does not depend on browser permissions.

---

## Repository layout / 仓库结构

```
dsh-plugin-notifications/
├── src/index.js          # Host: registers the `notifications` settings namespace
├── client/client.js      # Client: General card + turn-complete monitor + chime
├── cordis.patch.yml      # DSH bundle patch (host registration)
├── package.json
└── README.md
```

## Topics / 标签

`dsh`, `deepseek-harness`, `plugin`, `notification`, `web-audio`
