# The SayShape MCP server for Google Cloud Run, from the published npm package.
# Cloud Run sets PORT; --trust-proxy lets the rate limit see callers' addresses behind Google's proxy.
# To update, change the version and push.
FROM node:20-slim
RUN npm install -g sayshape-mcp@0.2.0
CMD ["sayshape-mcp", "--http", "--host", "0.0.0.0", "--trust-proxy"]
