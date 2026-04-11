#!/usr/bin/env node
/**
 * Lark integration patch boundary.
 *
 * This module intentionally keeps MoltWorker-side changes minimal:
 * - validates whether Lark env is configured
 * - provides a single injection point for future OpenClaw-side Lark integration
 * - does not invent OpenClaw config keys before the exact schema is defined
 */

function getLarkIntegrationEnv(env = process.env) {
  return {
    appId: env.LARK_APP_ID || null,
    appSecret: env.LARK_APP_SECRET || null,
    baseToken: env.LARK_BASE_TOKEN || null,
    tableId: env.LARK_TABLE_ID || null,
  };
}

function getLarkIntegrationStatus(env = process.env) {
  const config = getLarkIntegrationEnv(env);
  const configured =
    !!config.appId && !!config.appSecret && !!config.baseToken && !!config.tableId;

  return {
    configured,
    missing: Object.entries({
      LARK_APP_ID: config.appId,
      LARK_APP_SECRET: config.appSecret,
      LARK_BASE_TOKEN: config.baseToken,
      LARK_TABLE_ID: config.tableId,
    })
      .filter(([, value]) => !value)
      .map(([key]) => key),
  };
}

function applyLarkIntegration(config, env = process.env) {
  const status = getLarkIntegrationStatus(env);

  if (!status.configured) {
    if (status.missing.length > 0) {
      console.log(
        `Lark integration not enabled: missing ${status.missing.join(', ')}`,
      );
    }
    return config;
  }

  console.log('Lark integration boundary enabled');
  return config;
}

module.exports = {
  applyLarkIntegration,
  getLarkIntegrationEnv,
  getLarkIntegrationStatus,
};
