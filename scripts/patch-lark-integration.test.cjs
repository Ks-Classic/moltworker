#!/usr/bin/env node
const {
  applyLarkIntegration,
  getLarkIntegrationStatus,
} = require('./patch-lark-integration.cjs');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✅ ${name}`);
    passed++;
  } catch (e) {
    console.error(`  ❌ ${name}`);
    console.error(`     ${e.message}`);
    failed++;
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

console.log('\n🧪 patch-lark-integration tests\n');

test('reports missing env when Lark is not fully configured', () => {
  const status = getLarkIntegrationStatus({
    LARK_APP_ID: 'app',
    LARK_APP_SECRET: '',
    LARK_BASE_TOKEN: 'base',
    LARK_TABLE_ID: '',
  });

  assert(status.configured === false, 'Expected configured=false');
  assert(
    JSON.stringify(status.missing) === JSON.stringify(['LARK_APP_SECRET', 'LARK_TABLE_ID']),
    `Unexpected missing env list: ${JSON.stringify(status.missing)}`,
  );
});

test('reports configured when all required Lark env exists', () => {
  const status = getLarkIntegrationStatus({
    LARK_APP_ID: 'app',
    LARK_APP_SECRET: 'secret',
    LARK_BASE_TOKEN: 'base',
    LARK_TABLE_ID: 'table',
  });

  assert(status.configured === true, 'Expected configured=true');
  assert(status.missing.length === 0, 'Expected no missing env vars');
});

test('does not mutate config when schema is not yet defined', () => {
  const input = {
    plugins: { entries: { discord: { enabled: true } } },
  };

  const result = applyLarkIntegration(
    JSON.parse(JSON.stringify(input)),
    {
      LARK_APP_ID: 'app',
      LARK_APP_SECRET: 'secret',
      LARK_BASE_TOKEN: 'base',
      LARK_TABLE_ID: 'table',
    },
  );

  assert(
    JSON.stringify(result) === JSON.stringify(input),
    'Expected Lark boundary patch to be a no-op until schema is defined',
  );
});

console.log(`\nResults: ${passed} passed, ${failed} failed`);

if (failed > 0) {
  process.exit(1);
}
