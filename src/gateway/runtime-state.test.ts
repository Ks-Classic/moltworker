import { describe, expect, it } from 'vitest';
import {
  extractDiscordReadiness,
  extractLatestDiscordSignal,
  getRuntimeStateAgeMs,
  getGatewayLifecycleState,
  hasExplicitDiscordRuntimeState,
  isRuntimeStateFresh,
  isRuntimeStateStarting,
} from './runtime-state';

describe('extractLatestDiscordSignal', () => {
  it('returns disconnected when no metrics line exists', () => {
    expect(extractLatestDiscordSignal('hello')).toEqual({
      connected: false,
      lastEventAt: null,
      latencyMs: null,
      reconnects: null,
      messagesReceived: null,
    });
  });

  it('parses the latest discord metrics line', () => {
    const signal = extractLatestDiscordSignal(
      [
        '2026-04-09T09:27:46.914+00:00 discord gateway metrics: {"latency":222,"uptime":60002,"reconnects":0,"messagesReceived":7}',
        '2026-04-09T09:28:46.913+00:00 discord gateway metrics: {"latency":220,"uptime":120003,"reconnects":1,"messagesReceived":8}',
      ].join('\n'),
    );

    expect(signal).toEqual({
      connected: true,
      lastEventAt: '2026-04-09T09:28:46.913+00:00',
      latencyMs: 220,
      reconnects: 1,
      messagesReceived: 8,
    });
  });
});

describe('extractDiscordReadiness', () => {
  it('marks discord ready when websocket open and heartbeat logs exist', () => {
    expect(
      extractDiscordReadiness(
        [
          '2026-04-09T09:25:46.000+00:00 Gateway websocket opened',
          '2026-04-09T09:27:46.914+00:00 discord gateway metrics: {"latency":222,"uptime":60002,"reconnects":0,"messagesReceived":7}',
        ].join('\n'),
      ),
    ).toEqual({
      discordReady: true,
      lastDiscordReadyAt: '2026-04-09T09:25:46.000+00:00',
      lastDiscordHeartbeatAt: '2026-04-09T09:27:46.914+00:00',
      lastDiscordError: null,
    });
  });

  it('captures the latest discord error line', () => {
    expect(
      extractDiscordReadiness(
        [
          '2026-04-09T09:25:46.000+00:00 Gateway websocket opened',
          '2026-04-09T09:29:46.914+00:00 discord provider error: Unauthorized',
        ].join('\n'),
      ),
    ).toEqual({
      discordReady: true,
      lastDiscordReadyAt: '2026-04-09T09:25:46.000+00:00',
      lastDiscordHeartbeatAt: null,
      lastDiscordError: 'discord provider error: Unauthorized',
    });
  });
});

describe('getGatewayLifecycleState', () => {
  const freshUpdatedAt = new Date().toISOString();

  it('returns running when gateway is HTTP-ready', () => {
    expect(
      getGatewayLifecycleState({
        gatewayHttpOk: true,
        runtime: { status: 'ready' },
      }),
    ).toBe('running');
  });

  it('returns starting when runtime-state says startup is in progress', () => {
    expect(
      getGatewayLifecycleState({
        gatewayHttpOk: false,
        runtime: {
          status: 'starting',
          phase: 'gateway-starting',
          updatedAt: freshUpdatedAt,
        },
      }),
    ).toBe('starting');
  });

  it('returns degraded when runtime exists but is not healthy', () => {
    expect(
      getGatewayLifecycleState({
        gatewayHttpOk: false,
        runtime: {
          status: 'degraded',
          phase: 'gateway-exited',
          updatedAt: freshUpdatedAt,
        },
      }),
    ).toBe('degraded');
  });

  it('returns not_running when runtime-state is stale and HTTP is down', () => {
    expect(
      getGatewayLifecycleState({
        gatewayHttpOk: false,
        runtime: {
          status: 'starting',
          phase: 'gateway-starting',
          updatedAt: '2026-04-09T09:20:46.913+00:00',
        },
      }),
    ).toBe('not_running');
  });
});

describe('hasExplicitDiscordRuntimeState', () => {
  it('returns false for bootstrap placeholders without real discord signals', () => {
    expect(
      hasExplicitDiscordRuntimeState({
        discordReady: false,
        lastDiscordReadyAt: null,
        lastDiscordHeartbeatAt: null,
        lastDiscordError: null,
      }),
    ).toBe(false);
  });

  it('returns true once runtime-state has a real discord heartbeat', () => {
    expect(
      hasExplicitDiscordRuntimeState({
        discordReady: true,
        lastDiscordReadyAt: null,
        lastDiscordHeartbeatAt: '2026-04-09T09:27:46.914+00:00',
        lastDiscordError: null,
      }),
    ).toBe(true);
  });
});

describe('runtime-state freshness', () => {
  it('computes runtime-state age from updatedAt', () => {
    expect(
      getRuntimeStateAgeMs(
        { updatedAt: '2026-04-09T09:28:46.913+00:00' },
        Date.parse('2026-04-09T09:29:16.913+00:00'),
      ),
    ).toBe(30000);
  });

  it('treats recent runtime-state as fresh', () => {
    expect(
      isRuntimeStateFresh(
        { updatedAt: '2026-04-09T09:28:46.913+00:00' },
        Date.parse('2026-04-09T09:29:16.913+00:00'),
      ),
    ).toBe(true);
  });

  it('treats old runtime-state as stale', () => {
    expect(
      isRuntimeStateFresh(
        { updatedAt: '2026-04-09T09:20:46.913+00:00' },
        Date.parse('2026-04-09T09:29:16.913+00:00'),
      ),
    ).toBe(false);
  });

  it('requires fresh runtime-state before treating startup as active', () => {
    expect(
      isRuntimeStateStarting(
        {
          status: 'starting',
          phase: 'gateway-starting',
          updatedAt: '2026-04-09T09:28:46.913+00:00',
        },
        Date.parse('2026-04-09T09:29:16.913+00:00'),
      ),
    ).toBe(true);

    expect(
      isRuntimeStateStarting(
        {
          status: 'starting',
          phase: 'gateway-starting',
          updatedAt: '2026-04-09T09:20:46.913+00:00',
        },
        Date.parse('2026-04-09T09:29:16.913+00:00'),
      ),
    ).toBe(false);
  });
});
