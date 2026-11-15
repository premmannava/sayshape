/** Cloudflare Worker entry point. The logic is in handler.ts. */
import { handle, type Env } from "./handler";
import { deleteOld } from "./records";

interface Context { waitUntil(p: Promise<unknown>): void }

export default {
  fetch(req: Request, env: Env, ctx: Context): Promise<Response> {
    return handle(req, env, { waitUntil: (p) => ctx.waitUntil(p) });
  },
  /** The daily cron (wrangler.toml): saved answers past their RETENTION_DAYS are deleted. */
  scheduled(_event: unknown, env: Env, ctx: Context): void {
    if (env.RECORDS) ctx.waitUntil(deleteOld(env.RECORDS, new Date()));
  },
};
