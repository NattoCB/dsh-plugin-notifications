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
- 启用后，当前会话从「运行中」变为「空闲」（即本轮对话完成）时，弹出**系统通知**。
- 可选**提示音**：用 Web Audio 程序合成，无需音频文件，离线可用；音调可选 **柔和 / 清脆 / 低沉**。
- 「试听提示音」按钮同时用于触发浏览器的通知授权（浏览器要求用户手势才能申请权限）。

### 行为说明

- **Host 端**：注册持久化设置命名空间 `notifications`，并暴露自有 HTTP API
  `/notifications/status`（读）与 `/notifications/update`（写）；写入经 host 侧
  `settings.update` 落到 `$DSH_HOME/settings.yaml`（键 `notifications`）。
- **Client 端**：把卡片渲染进通用区的 `settings.general.item` 插槽，并订阅运行时 `sessions` 列表，
  监听当前会话 `running` 的「true → false」边沿（即一轮对话结束）。
- 检测发生在浏览器侧：触发的是「停止运行时正在选中」的那个会话。
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
3. 重启 web profile（`dsh web`）。

> 提示：实际弹出系统通知依赖操作系统的通知授权；建议先点一次「试听提示音」以完成授权。

---

## English

### Features

- Adds a **Turn-complete notifications** card to **Settings → General**.
- When enabled, pops a **system notification** whenever the current session flips
  from *running* to *idle* (i.e. a conversation turn finishes).
- Optional **chime**: synthesized with the Web Audio API (no asset files, works
  offline); tone selectable as **soft / crisp / low**.
- The "Preview chime" button also triggers the browser's notification-permission
  prompt (browsers require a user gesture to request it).

### How it works

- **Host half** registers the durable `notifications` settings namespace and
  exposes its own HTTP API — `GET /notifications/status`, `POST /notifications/update` —
  persisting through host-side `settings.update` into `$DSH_HOME/settings.yaml`
  (key `notifications`).
- **Client half** renders the card into the General section's `settings.general.item`
  slot and watches the runtime `sessions` list for the running→idle edge.
- Detection is browser-side: it fires for whichever session is currently selected
  when it stops running.
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
3. Restart the web profile (`dsh web`).

> Note: a real system notification depends on OS notification permission; click
> "Preview chime" once to grant it.

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
