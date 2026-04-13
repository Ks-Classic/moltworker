import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = process.cwd();

function readRepoFile(relativePath: string): string {
  return readFileSync(join(repoRoot, relativePath), 'utf8');
}

describe('moltworker architecture boundary', () => {
  it('keeps the top-level design anchored on moltworker as the runtime control plane', () => {
    const runtimePlan = readRepoFile('docs/RUNTIME_REBUILD_PLAN.md');
    const docsMap = readRepoFile('docs/README.md');
    const larkPlan = readRepoFile('docs/LARK_INTEGRATION_PLAN.md');
    const readme = readRepoFile('README.md');

    expect(runtimePlan).toContain(
      'Cloudflare Worker + Sandbox 上の MoltWorker を OpenClaw の単一実行基盤にする',
    );
    expect(docsMap).toContain(
      'Cloudflare Worker + Sandbox 上の MoltWorker を OpenClaw の単一実行基盤として一本化する',
    );
    expect(larkPlan).toContain('Lark は OpenClaw の業務 integration として入れる');
    expect(larkPlan).toContain('OpenClaw 実行基盤の正本を Lark 側へ移さない');
    expect(readme).toContain('`moltworker` acting as the Cloudflare-side control plane');
  });

  it('does not wire Jira into the runtime path', () => {
    const runtimeEntrypoints = [
      'package.json',
      'src/index.ts',
      'src/routes/api.ts',
      'src/routes/public.ts',
      'src/gateway/index.ts',
      'src/gateway/process.ts',
      'scripts/bootstrap-openclaw.sh',
      'scripts/run-openclaw-gateway.sh',
      'scripts/patch-config.cjs',
    ];

    for (const relativePath of runtimeEntrypoints) {
      expect(readRepoFile(relativePath).toLowerCase()).not.toContain('jira');
    }
  });

  it('keeps historical Jira tooling detached from package scripts', () => {
    const packageJson = readRepoFile('package.json');
    expect(packageJson).not.toContain('sync-jira-config');
    expect(packageJson).not.toContain('JIRA_');
  });

  it('keeps historical Jira tooling isolated under legacy/jira', () => {
    const docsMap = readRepoFile('docs/README.md');
    const legacyReadme = readRepoFile('legacy/jira/README.md');
    const legacyScript = readRepoFile('legacy/jira/sync-jira-config.cjs');

    expect(existsSync(join(repoRoot, 'scripts/sync-jira-config.cjs'))).toBe(false);
    expect(docsMap).toContain('legacy/jira/');
    expect(legacyReadme).toContain('runtime 主線から切り離した historical Jira 用');
    expect(legacyScript).toContain('Sync Jira company-managed project config');
  });

  it('keeps daily heartbeat business prompt out of the main worker entrypoint', () => {
    const entrypoint = readRepoFile('src/index.ts');
    expect(entrypoint).not.toContain('HEARTBEAT.mdの指示通り');
    expect(entrypoint).not.toContain('デイリーブリーフィング');
  });
});
