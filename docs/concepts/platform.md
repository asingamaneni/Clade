# Platform Integration

The Platform MCP server gives agents native OS capabilities — notifications, clipboard, URLs, screenshots, and system info.

## Tools

| Tool | Description |
|------|-------------|
| `platform_notify` | Send a native OS notification |
| `platform_clipboard_read` | Read from the system clipboard |
| `platform_clipboard_write` | Write to the system clipboard |
| `platform_open` | Open a URL or file in the default application |
| `platform_screenshot` | Take a screenshot (macOS only) |
| `platform_info` | Get system info (OS, hostname, shell, uptime) |

## Cross-Platform

The Platform MCP auto-detects the operating system and uses the appropriate commands:

| Feature | macOS | Linux |
|---------|-------|-------|
| Notifications | `osascript` (native alert) | `notify-send` |
| Clipboard read | `pbpaste` | `xclip -selection clipboard -o` |
| Clipboard write | `pbcopy` | `xclip -selection clipboard` |
| Open URL/file | `open` | `xdg-open` |
| Screenshot | `screencapture` | Not available |

Commands fail gracefully if the required tool isn't installed — the agent gets an error message but the system doesn't crash.

## Use Cases

- **Notifications**: Agent completes a long task → sends a desktop notification
- **Clipboard**: Agent reads what you've copied → processes it without you pasting
- **Open**: Agent finds a relevant URL → opens it in your browser
- **Screenshot**: Agent takes a screenshot for debugging or documentation
- **System info**: Agent checks your environment before suggesting commands
