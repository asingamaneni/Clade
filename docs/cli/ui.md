# clade ui

Open the Clade admin dashboard in your browser.

## Usage

```bash
clade ui [options]
```

## Options

| Option | Description | Default |
|--------|-------------|---------|
| `-p, --port <port>` | Gateway port | From config or `7890` |
| `--host <host>` | Gateway host | From config or `127.0.0.1` |
| `--no-browser` | Print the URL without opening a browser | `false` |

## Behavior

1. Checks if the gateway is running (hits `/health`)
2. If running, opens `http://localhost:7890/admin` in your default browser
3. If not running, tells you to start it with `clade start`

## Examples

```bash
# Open the admin dashboard
clade ui

# Just print the URL
clade ui --no-browser

# Use a custom port
clade ui --port 8080
```
