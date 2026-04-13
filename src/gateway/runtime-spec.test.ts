import { describe, expect, it } from 'vitest';
import {
  buildDesiredRuntimeSpec,
  createDesiredRuntimeFingerprint,
  getDesiredPrimaryModel,
} from './runtime-spec';
import { createMockEnv } from '../test-utils';

describe('getDesiredPrimaryModel', () => {
  it('maps google-ai-studio models to google provider ids', () => {
    expect(
      getDesiredPrimaryModel(
        createMockEnv({ CF_AI_GATEWAY_MODEL: 'google-ai-studio/gemini-3.1-flash-lite-preview' }),
      ),
    ).toBe('google/gemini-3.1-flash-lite-preview');
  });

  it('maps other providers to Cloudflare AI Gateway provider ids', () => {
    expect(
      getDesiredPrimaryModel(createMockEnv({ CF_AI_GATEWAY_MODEL: 'openai/gpt-5-mini' })),
    ).toBe('cf-ai-gw-openai/gpt-5-mini');
  });
});

describe('buildDesiredRuntimeSpec', () => {
  it('captures model and token configuration', () => {
    expect(
      buildDesiredRuntimeSpec(
        createMockEnv({
          CF_AI_GATEWAY_MODEL: 'google-ai-studio/gemini-3.1-flash-lite-preview',
          MOLTBOT_GATEWAY_TOKEN: 'secret',
        }),
      ),
    ).toEqual({
      primaryModel: 'google/gemini-3.1-flash-lite-preview',
      gatewayToken: 'secret',
      gatewayTokenConfigured: true,
      fingerprint:
        '{"primaryModel":"google/gemini-3.1-flash-lite-preview","gatewayTokenConfigured":true}',
    });
  });
});

describe('createDesiredRuntimeFingerprint', () => {
  it('serializes runtime-relevant desired state', () => {
    expect(
      createDesiredRuntimeFingerprint({
        primaryModel: 'google/gemini-3.1-flash-lite-preview',
        gatewayTokenConfigured: true,
      }),
    ).toBe('{"primaryModel":"google/gemini-3.1-flash-lite-preview","gatewayTokenConfigured":true}');
  });
});
