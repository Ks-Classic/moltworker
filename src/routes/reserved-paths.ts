const RESERVED_WORKER_PREFIXES = ['/api', '/_admin', '/debug', '/sandbox-health', '/cdp'] as const;

export function isReservedWorkerPath(pathname: string): boolean {
  return RESERVED_WORKER_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}
