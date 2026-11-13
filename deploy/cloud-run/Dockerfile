# The SayShape MCP server for Google Cloud Run, from the published npm package.
# Cloud Run sets PORT; --trust-proxy lets the rate limit see callers' addresses behind Google's proxy.
# --scene and --behavior turn on the experimental scenes and rules for everyone using this address.
# To update: change the version, merge, and once that version is on npm press Run on the Cloud Build
# trigger (docs/releasing.md). The trigger is manual: nothing deploys on a push.
FROM node:20-slim
RUN npm install -g sayshape-mcp@0.2.1
CMD ["sayshape-mcp", "--http", "--host", "0.0.0.0", "--trust-proxy", "--scene", "--behavior"]
