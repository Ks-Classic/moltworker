/**
 * Configuration constants for the MoltWorker control plane.
 *
 * `moltbot` identifiers remain only where we need wire compatibility with
 * existing container or worker naming.
 */

/** Public name of the Cloudflare Worker control plane */
export const WORKER_RUNTIME_NAME = 'moltworker';

/** Runtime inside the container that this worker supervises */
export const GATEWAY_RUNTIME_NAME = 'openclaw';

/** Legacy Worker script/service name kept for compatibility */
export const LEGACY_WORKER_SERVICE_NAME = 'moltbot-sandbox';

/** Legacy sandbox instance name kept stable to avoid changing container identity */
export const LEGACY_SANDBOX_INSTANCE_NAME = 'moltbot';

/** Port that the Moltbot gateway listens on inside the container */
export const MOLTBOT_PORT = 18789;

/** Single runtime truth written by container scripts and read by the worker */
export const RUNTIME_STATE_FILE = '/tmp/openclaw-runtime-state.json';

/** Maximum time to wait for Moltbot to start (3 minutes) */
export const STARTUP_TIMEOUT_MS = 180_000;

/**
 * Runtime-state is produced by the container scripts, not the worker.
 * If it stops updating for longer than a full startup window, treat it as stale.
 */
export const RUNTIME_STATE_STALE_AFTER_MS = STARTUP_TIMEOUT_MS + 30_000;

/**
 * R2 bucket name for persistent storage.
 * Can be overridden via R2_BUCKET_NAME env var for test isolation.
 */
export function getR2BucketName(env?: { R2_BUCKET_NAME?: string }): string {
  return env?.R2_BUCKET_NAME || 'openclaw-data';
}
