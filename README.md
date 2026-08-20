# dsh-plugin-notifications

<!-- Hero -->
<div align="center">
  <b style="font-size: 1.15em;">Turn 完成 → macOS 系统通知(可选合成提示音)。即使 Web GUI 已关闭或切到其他窗口,照常提醒。</b><br /><br />
  <a href="https://github.com/NattoCB/dsh-plugin-notifications/blob/main/LICENSE"><img alt="License" src="https://img.shields.io/badge/License-MIT-yellow.svg" /></a>
  <img alt="platform" src="https://img.shields.io/badge/platform-macOS-blue" /><br /><br />
  <img alt="对话完成通知" src="https://img.shields.io/badge/-对话完成通知-4d6bfe" />
  <img alt="macOS系统通知" src="https://img.shields.io/badge/-macOS系统通知-4d6bfe" />
  <img alt="合成提示音" src="https://img.shields.io/badge/-合成提示音-4d6bfe" />
  <img alt="Settings卡片" src="https://img.shields.io/badge/-Settings卡片-4d6bfe" />
  <img alt="离线可用" src="https://img.shields.io/badge/-离线可用-4d6bfe" /><br /><br />
  <b>监听 <code>agent/status</code> 根会话 running→idle 边沿 · 自有 HTTP API <code>/notifications/status|update</code> · 配置落 <code>$DSH_HOME/settings.yaml</code></b> —— <code>ctx.on('agent/status')</code>
</div>

> 一个 DSH bundle 插件:在「设置 → 通用」新增**对话完成通知**卡片。启用后,任意根会话(跳过 subagent 与 automation)一轮对话结束时,由 **host 进程**弹出 macOS 系统通知——标题为会话名、正文为助手回复(过长截断),并可选播放与卡片试听完全一致的合成提示音。接入:在 web profile 声明依赖与 bundle,重启 `dsh web`。
>
> A DSH bundle plugin that adds a **Turn-complete notifications** card to Settings → General. When any root session (subagents and automation runs skipped) finishes a turn, the host process pops a macOS notification — title = session name, body = the assistant reply (truncated) — with an optional chime identical to the in-card preview. Install by declaring it as a dependency and bundle in your web profile, then restart `dsh web`.

## ✨ 功能一览 / Features

- 🔔 **对话完成通知** — host 监听 `agent/status`,在根会话 running→idle 边沿用 `terminal-notifier` 弹系统通知:标题 = 会话名(`session/title` → 首条用户消息 → agent id,UTF-8 安全截断 60B),正文 = 最新助手回复(截断 200B);GUI 关闭也照常。subagent 与 automation 驱动的回合不触发;通知仅提示,点击不打开任何窗口。 / Host fires on the running→idle edge of root sessions; subagent and automation-driven turns are skipped. Clicking the banner does nothing (no `-activate`).
- 🔊 **合成提示音** — 按音调(柔和 / 清脆 / 低沉)进程内合成 16-bit PCM 单声道 WAV(44.1kHz;20ms 线性起音 + 指数衰减;音符间隔 120ms),经 `terminal-notifier -sound` 播放;与卡片「试听」的 Web Audio 波形参数完全一致,听到即所得。无音频资源,离线可用。 / Chime synthesized to WAV with the exact profiles the card previews in Web Audio — no asset files, works offline.
- 🎛️ **Settings 卡片** — 渲染进「设置 → 通用」的 `settings.general.item` 插槽,提供启用 / 提示音开关、音调选择与「试听提示音」按钮(该按钮同时作为用户手势触发浏览器通知授权);UI 中英双语。 / Card in Settings → General (zh/en) with enable, sound, tone and a preview button that doubles as the browser's notification-permission gesture.
- 💾 **持久化与降级** — 配置写入 `$DSH_HOME/settings.yaml`(命名空间 `notifications`),经自有 HTTP API `GET /notifications/status`、`POST /notifications/update`(`settings.mutate` RPC 只放行内置命名空间,第三方走自有路由,与 petdex / wechat-bridge 同模式);host 半未加载时自动降级为浏览器 monitor + localStorage,host 加载后接管,避免双重通知。 / Persists via its own HTTP API into settings.yaml; before the host half loads, the browser monitor + localStorage takes over, then defers to the host.

## Quick Start

### 前置 / Prerequisites

- macOS(host 使用 Homebrew 前缀路径 `/opt/homebrew`)
- [terminal-notifier](https://github.com/julienXX/terminal-notifier):`brew install terminal-notifier`(host 弹通知与播放提示音的二进制,路径硬编码 `/opt/homebrew/bin/terminal-notifier`)
- DSH web profile(`$DSH_HOME/profiles/web`)

### 安装 / Install

1. 在 `$DSH_HOME/profiles/web/package.json`:
   - `dependencies` 增加 `"dsh-plugin-notifications": "file:<本仓库路径>"`;
   - `dsh.profile.bundles` 增加 `"dsh-plugin-notifications"`。
2. 确保 `node_modules/dsh-plugin-notifications` 可解析到本仓库。
3. 重启 web profile(`dsh web`)使 host 半生效——否则只有浏览器侧 monitor,GUI 关闭后收不到通知。

### 启用 / Enable

1. 打开 Web GUI → 设置 → 通用 → **对话完成通知**,开启「启用系统通知」。
2. 可选:开启提示音、选择音调(柔和 / 清脆 / 低沉);点「试听提示音」试听。
3. macOS 首次弹通知时,在系统提示中授予通知权限。

## Configuration

写入 `$DSH_HOME/settings.yaml`(也可直接在设置卡片中修改):

```yaml
notifications:
  enabled: false   # 一轮对话完成后弹系统通知 / pop a system notification on turn completion
  sound: true      # 同时播放提示音 / also play the chime
  tone: soft       # 提示音音调 / chime tone: soft | crisp | low
```

| Key | Default | Meaning |
|:----|:--------|:--------|
| `notifications.enabled` | `false` | 一轮对话完成后弹 macOS 系统通知 |
| `notifications.sound` | `true` | 通知时同时播放合成提示音 |
| `notifications.tone` | `soft` | 音调:`soft` 柔和 / `crisp` 清脆 / `low` 低沉 |

---

<div align="center">

[GitHub](https://github.com/NattoCB/dsh-plugin-notifications) · [Issues](https://github.com/NattoCB/dsh-plugin-notifications/issues) · [Changelog](CHANGELOG.md) · **MIT License**

</div>
