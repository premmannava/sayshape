# The hosted MCP server's address

A Cloudflare Worker that passes MCP requests on to the hosted SayShape MCP server. People add its address to their chat app:

```
https://mcp.sayshape.workers.dev/mcp
```

The address belongs to the Worker, not to wherever the server runs. To move the server (another region, another host), change `UPSTREAM` in `wrangler.toml` and deploy; nobody has to reconnect.

```
chat app ──▶ this Worker ──▶ the MCP server (deploy/cloud-run)
            /mcp and / only
```

What it does, in `src/handler.ts`, tested in `test/mcp-proxy.test.ts`:

- forwards `/mcp` and the health check at `/`, and answers 404 for every other path;
- gives the server's reply back as it is, streamed: status, headers and body;
- limits each caller to 300 requests a minute (`[[ratelimits]]` in `wrangler.toml`), counted by the address Cloudflare saw, which a caller can't choose;
- drops whatever the caller sent as `X-Forwarded-For` and sends the address Cloudflare saw instead;
- reads no bodies and logs nothing.

## Deploy

It uses the `wrangler` already installed for the model proxy in `worker/`:

```bash
npm ci --prefix worker
cd worker
npx wrangler login                                                # once
npx wrangler deploy --config ../deploy/cloudflare/wrangler.toml
```

Check it:

```bash
curl https://mcp.sayshape.workers.dev/               # SayShape MCP server: ok. MCP is at /mcp.
```

## The server's own rate limit

The server behind it still counts calls itself, with one trusted proxy (`--trust-proxy` in `deploy/cloud-run/Dockerfile`). Calls through this Worker reach it from Cloudflare's addresses, so there it counts them by those addresses, not by person: a coarse second limit behind the Worker's per-caller one.

Don't raise it to `--trust-proxy 2` while the server's own address is also public. Two trusted hops is right for calls through the Worker, but a caller going straight to the server would then be counted by whatever `X-Forwarded-For` they send, and could dodge the limit.
