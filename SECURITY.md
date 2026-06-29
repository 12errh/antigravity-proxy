# Security Policy

## Scope

This project is a **local proxy** that runs on your own machine. It is not a cloud service.
The attack surface is your local network — port 443 (TLS proxy) and port 4000 (HTTP dashboard).

---

## Known Security Considerations

### 1. Dashboard has no auth by default

The dashboard on port 4000 is open to anyone on your local network unless you configure credentials.
Set `DASHBOARD_USER` and `DASHBOARD_PASSWORD` in `.env` (or via the Config tab) to enable basic auth.

### 2. Port 443 binds to all interfaces (`0.0.0.0`)

By default the proxy listens on `0.0.0.0:443`, not just `127.0.0.1:443`. This means it is reachable from your LAN.
If you only need local access, add a firewall rule to block external access to port 443.

### 3. API keys are stored in `.env` on disk

Your provider API keys live in `proxy/.env` in plaintext. The file is gitignored but exists unencrypted on disk.
Do not store this on shared or untrusted machines.

### 4. Self-signed TLS certificate

The proxy uses a self-signed cert that must be trusted by your OS/browser. The trust is install-time only — it cannot intercept other HTTPS traffic on your machine.

### 5. Context strip mode

When `CONTEXT_STRIP_MODE=passthrough`, the full Antigravity request body (including your prompts, skills, and rules) is forwarded verbatim to the configured AI provider. In `lite` mode (recommended), the native context is stripped and replaced with a compressed operating manual (~3.5K tokens). In `strip` mode, the full `agent-context.md` (~10K tokens) is injected instead. Lite and strip modes reduce the data forwarded to external providers while maintaining full tool coverage.

---

## Reporting a Vulnerability

This is a personal/community tool, not a commercial product.

If you find a genuine security issue (e.g., the proxy can be exploited to exfiltrate API keys, or a dependency has a known CVE):

1. **Do not open a public GitHub issue.**
2. Open a [GitHub Security Advisory](https://github.com/12errh/antigravity-proxy/security/advisories/new) on this repo (private by default).
3. Include a clear description of the vulnerability, reproduction steps, and potential impact.

I'll respond within 7 days. If the issue is valid, I'll fix it and coordinate a disclosure timeline with you.

---

## Out of Scope

- Issues requiring physical access to your machine
- Issues in Antigravity Desktop itself (not this project)
- Rate-limiting or quota abuse of AI providers (that is between you and the provider)
