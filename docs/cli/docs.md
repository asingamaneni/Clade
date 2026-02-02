# clade docs

Open or serve the Clade documentation locally.

## Usage

```bash
clade docs [options]
```

## Options

| Option | Description | Default |
|--------|-------------|---------|
| `--serve` | Start a local documentation dev server | `false` |
| `-p, --port <port>` | Port for the docs server | `5173` |

## Examples

```bash
# Open docs in browser (served from gateway if running, or static)
clade docs

# Start a local docs dev server with hot-reload
clade docs --serve
```

## Notes

The documentation is built with VitePress. When using `--serve`, you get a full-featured documentation site with search, navigation, and hot-reload for development.
