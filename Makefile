.PHONY: install build dev test test-unit test-integration lint clean start docs docs-build docs-preview check deploy-docs help

# Default target
help: ## Show this help message
	@echo ""
	@echo "  Clade — Makefile targets"
	@echo ""
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-18s\033[0m %s\n", $$1, $$2}'
	@echo ""

# ── Setup ──────────────────────────────────────────────────────

install: ## Install dependencies
	npm install

# ── Build ──────────────────────────────────────────────────────

build: ## Build TypeScript (tsup)
	npm run build

dev: ## Start dev mode with watch
	npm run dev

clean: ## Remove build artifacts
	rm -rf dist docs/.vitepress/dist docs/.vitepress/cache

# ── Test ───────────────────────────────────────────────────────

test: ## Run all tests
	npm test

test-unit: ## Run unit tests only
	npm run test:unit

test-integration: ## Run integration tests only
	npm run test:integration

lint: ## Type-check with tsc --noEmit
	npm run lint

# ── Run ────────────────────────────────────────────────────────

start: build ## Build and start the gateway
	node dist/bin/clade.js start

# ── Docs ───────────────────────────────────────────────────────

docs: ## Start local docs dev server (VitePress)
	npm run docs:dev

docs-build: ## Build docs for production
	npm run docs:build

docs-preview: docs-build ## Build and preview docs locally
	npm run docs:preview

# ── CI / Quality ───────────────────────────────────────────────

check: lint build test ## Run lint + build + tests (CI gate)

# ── Deploy ─────────────────────────────────────────────────────

deploy-docs: ## Build docs for GitHub Pages (base=/Clade/)
	DOCS_BASE=/Clade/ npm run docs:build
