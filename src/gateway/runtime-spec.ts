import type { MoltbotEnv } from '../types';

export interface DesiredRuntimeSpec {
  primaryModel: string | null;
  gatewayToken: string | null;
  gatewayTokenConfigured: boolean;
  fingerprint: string;
}

export function createDesiredRuntimeFingerprint(input: {
  primaryModel: string | null;
  gatewayTokenConfigured: boolean;
}): string {
  return JSON.stringify({
    primaryModel: input.primaryModel,
    gatewayTokenConfigured: input.gatewayTokenConfigured,
  });
}

export function getDesiredPrimaryModel(env: MoltbotEnv): string | null {
  const raw = env.CF_AI_GATEWAY_MODEL;
  if (!raw) return null;

  const slashIdx = raw.indexOf('/');
  if (slashIdx <= 0) return null;

  const provider = raw.substring(0, slashIdx);
  const modelId = raw.substring(slashIdx + 1);

  if (provider === 'google-ai-studio') {
    return `google/${modelId}`;
  }

  return `cf-ai-gw-${provider}/${modelId}`;
}

export function buildDesiredRuntimeSpec(env: MoltbotEnv): DesiredRuntimeSpec {
  const gatewayToken = env.MOLTBOT_GATEWAY_TOKEN || null;
  const primaryModel = getDesiredPrimaryModel(env);
  const gatewayTokenConfigured = gatewayToken !== null;

  return {
    primaryModel,
    gatewayToken,
    gatewayTokenConfigured,
    fingerprint: createDesiredRuntimeFingerprint({
      primaryModel,
      gatewayTokenConfigured,
    }),
  };
}
