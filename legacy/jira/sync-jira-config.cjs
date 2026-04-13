#!/usr/bin/env node
/**
 * Sync Jira company-managed project config for OpenClaw CRM usage.
 *
 * Scope:
 * - Ensure issue types exist.
 * - Ensure the project's issue type scheme contains those issue types.
 * - Ensure custom fields exist.
 * - Ensure project-scoped field contexts exist for the target issue types.
 *
 * Out of scope:
 * - Workflow creation and workflow scheme assignment
 * - Screen / screen scheme wiring
 * - Board creation and filter setup
 */
const DEFAULT_CONFIG = {
  issueTypes: [
    {
      name: '商談',
      description: '受注前の営業案件を管理する作業タイプ。顧客名、金額、期日、進捗メモを記録し、提案中から受注または失注までを追跡する。',
      type: 'standard',
    },
    {
      name: '案件',
      description: '受注後に実行する仕事本体を管理する作業タイプ。納品や進行状況を追い、関連するタスクやメモの親となる。',
      type: 'standard',
    },
    {
      name: 'アイデア',
      description: 'まだ案件化していない提案、改善案、新規企画の種を管理する作業タイプ。検討、保留、採用判断の対象とする。',
      type: 'standard',
    },
    {
      name: 'タスク',
      description: '案件や日常業務に紐づく具体的な作業項目を管理する作業タイプ。担当、期日、進捗を明確にして実行する。',
      type: 'standard',
    },
    {
      name: 'サブタスク',
      description: 'タスクをさらに分解した小さな作業単位を管理する作業タイプ。タスク配下の細かな実行項目を追跡する。',
      type: 'subtask',
    },
  ],
  customFields: [
    {
      name: '顧客名',
      description: '商談や案件に紐づく顧客名。',
      type: 'com.atlassian.jira.plugin.system.customfieldtypes:textfield',
      searcherKey: 'com.atlassian.jira.plugin.system.customfieldtypes:textsearcher',
    },
    {
      name: '金額',
      description: '商談や案件の予定金額または受注金額。',
      type: 'com.atlassian.jira.plugin.system.customfieldtypes:float',
      searcherKey: 'com.atlassian.jira.plugin.system.customfieldtypes:exactnumber',
    },
    {
      name: '期日',
      description: '商談や案件、タスクの期日。',
      type: 'com.atlassian.jira.plugin.system.customfieldtypes:datepicker',
      searcherKey: 'com.atlassian.jira.plugin.system.customfieldtypes:daterange',
    },
  ],
};

function parseArgs(argv) {
  const parsed = {
    apply: false,
    projectKey: process.env.JIRA_ADMIN_PROJECT_KEY || process.env.JIRA_PROJECT_KEY || '',
  };

  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--apply') {
      parsed.apply = true;
      continue;
    }
    if (arg === '--project') {
      parsed.projectKey = argv[index + 1] || '';
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return parsed;
}

function readRequiredEnv(name) {
  const value = process.env[name];
  if (!value || !value.trim()) {
    throw new Error(`Missing required env: ${name}`);
  }
  return value.trim();
}

function buildAuthHeaders(email, apiToken) {
  const basic = Buffer.from(`${email}:${apiToken}`).toString('base64');
  return {
    Accept: 'application/json',
    Authorization: `Basic ${basic}`,
    'Content-Type': 'application/json',
  };
}

function normalizeBaseUrl(baseUrl) {
  return baseUrl.replace(/\/+$/, '');
}

class JiraAdminClient {
  constructor(baseUrl, headers, apply) {
    this.baseUrl = normalizeBaseUrl(baseUrl);
    this.headers = headers;
    this.apply = apply;
  }

  async request(path, options = {}) {
    const method = options.method || 'GET';
    const url = `${this.baseUrl}${path}`;
    const response = await fetch(url, {
      method,
      headers: {
        ...this.headers,
        ...(options.headers || {}),
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`${method} ${path} failed: ${response.status} ${text}`);
    }

    if (response.status === 204) {
      return undefined;
    }

    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
      return undefined;
    }

    return response.json();
  }

  async getProject(projectKey) {
    return this.request(`/rest/api/3/project/${encodeURIComponent(projectKey)}`);
  }

  async getIssueTypes() {
    return this.request('/rest/api/3/issuetype');
  }

  async createIssueType(issueType) {
    if (!this.apply) {
      return { id: `dry-run:${issueType.name}`, name: issueType.name };
    }
    return this.request('/rest/api/3/issuetype', {
      method: 'POST',
      body: issueType,
    });
  }

  async getProjectIssueTypeScheme(projectId) {
    const result = await this.request(`/rest/api/3/issuetypescheme/project?projectId=${encodeURIComponent(projectId)}`);
    const values = Array.isArray(result?.values) ? result.values : [];
    if (values.length === 0) {
      throw new Error(`No issue type scheme found for projectId=${projectId}`);
    }
    return values[0];
  }

  async addIssueTypesToScheme(issueTypeSchemeId, issueTypeIds) {
    if (issueTypeIds.length === 0) {
      return;
    }
    if (!this.apply) {
      return;
    }
    await this.request(`/rest/api/3/issuetypescheme/${encodeURIComponent(issueTypeSchemeId)}/issuetype`, {
      method: 'PUT',
      body: { issueTypeIds },
    });
  }

  async getFields() {
    return this.request('/rest/api/3/field');
  }

  async createField(field) {
    if (!this.apply) {
      return { id: `dry-run:${field.name}`, name: field.name };
    }
    return this.request('/rest/api/3/field', {
      method: 'POST',
      body: field,
    });
  }

  async getFieldContexts(fieldId) {
    const result = await this.request(`/rest/api/3/field/${encodeURIComponent(fieldId)}/context`);
    return Array.isArray(result?.values) ? result.values : [];
  }

  async createFieldContext(fieldId, context) {
    if (!this.apply) {
      return { id: `dry-run:${fieldId}:${context.name}`, ...context };
    }
    return this.request(`/rest/api/3/field/${encodeURIComponent(fieldId)}/context`, {
      method: 'POST',
      body: context,
    });
  }
}

function findByName(items, name) {
  return items.find((item) => item.name === name);
}

function buildIssueTypePayload(issueType) {
  return {
    description: issueType.description,
    name: issueType.name,
    type: issueType.type,
  };
}

function buildFieldPayload(field) {
  return {
    description: field.description,
    name: field.name,
    searcherKey: field.searcherKey,
    type: field.type,
  };
}

async function ensureIssueTypes(client, config, log) {
  const existing = await client.getIssueTypes();
  const resolved = new Map();

  for (const issueType of config.issueTypes) {
    const found = findByName(existing, issueType.name);
    if (found) {
      resolved.set(issueType.name, found);
      log.push(`Issue type exists: ${issueType.name}`);
      continue;
    }

    const created = await client.createIssueType(buildIssueTypePayload(issueType));
    resolved.set(issueType.name, created);
    log.push(`Issue type ${client.apply ? 'created' : 'planned'}: ${issueType.name}`);
  }

  return resolved;
}

async function ensureIssueTypeScheme(client, project, issueTypes, log) {
  const scheme = await client.getProjectIssueTypeScheme(project.id);
  const mapping = await client.request(`/rest/api/3/issuetypescheme/mapping?issueTypeSchemeId=${encodeURIComponent(scheme.issueTypeSchemeId)}`);
  const mappedIds = new Set((mapping.values || []).map((item) => item.issueTypeId));
  const missingIds = [];

  for (const issueType of issueTypes.values()) {
    if (!mappedIds.has(issueType.id) && !String(issueType.id).startsWith('dry-run:')) {
      missingIds.push(issueType.id);
    }
  }

  if (missingIds.length === 0) {
    log.push(`Issue type scheme already contains all target issue types: ${scheme.issueTypeSchemeId}`);
    return scheme;
  }

  await client.addIssueTypesToScheme(scheme.issueTypeSchemeId, missingIds);
  log.push(`Issue type scheme ${client.apply ? 'updated' : 'planned'}: ${scheme.issueTypeSchemeId}`);
  return scheme;
}

async function ensureFields(client, config, project, issueTypes, log) {
  const fields = await client.getFields();
  const targetIssueTypeIds = Array.from(issueTypes.values())
    .filter((issueType) => issueType.type !== 'subtask')
    .map((issueType) => issueType.id)
    .filter((value) => !String(value).startsWith('dry-run:'));

  for (const field of config.customFields) {
    const existing = findByName(fields, field.name);
    const resolved = existing || await client.createField(buildFieldPayload(field));
    log.push(`Field ${existing ? 'exists' : client.apply ? 'created' : 'planned'}: ${field.name}`);

    if (String(resolved.id).startsWith('dry-run:')) {
      continue;
    }

    const contexts = await client.getFieldContexts(resolved.id);
    const contextName = `${project.key} CRM`;
    const hasProjectContext = contexts.some((context) => {
      const projectIds = Array.isArray(context.projectIds) ? context.projectIds.map(String) : [];
      return context.name === contextName || projectIds.includes(String(project.id));
    });

    if (hasProjectContext) {
      log.push(`Field context exists: ${field.name} -> ${project.key}`);
      continue;
    }

    await client.createFieldContext(resolved.id, {
      description: `${project.key} project-specific context for ${field.name}`,
      issueTypeIds: targetIssueTypeIds,
      name: contextName,
      projectIds: [String(project.id)],
    });
    log.push(`Field context ${client.apply ? 'created' : 'planned'}: ${field.name} -> ${project.key}`);
  }
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args.projectKey) {
    throw new Error('Missing project key. Pass --project <KEY> or set JIRA_ADMIN_PROJECT_KEY/JIRA_PROJECT_KEY.');
  }

  const baseUrl = readRequiredEnv('JIRA_BASE_URL');
  const email = readRequiredEnv('JIRA_EMAIL');
  const apiToken = readRequiredEnv('JIRA_API_TOKEN');
  const client = new JiraAdminClient(baseUrl, buildAuthHeaders(email, apiToken), args.apply);
  const log = [];

  const project = await client.getProject(args.projectKey);
  log.push(`Project resolved: ${project.key} (${project.id})`);

  const issueTypes = await ensureIssueTypes(client, DEFAULT_CONFIG, log);
  await ensureIssueTypeScheme(client, project, issueTypes, log);
  await ensureFields(client, DEFAULT_CONFIG, project, issueTypes, log);

  console.log(`Mode: ${args.apply ? 'apply' : 'dry-run'}`);
  for (const line of log) {
    console.log(`- ${line}`);
  }
  console.log('- Remaining manual steps: workflow scheme, statuses, screen wiring, board filters');
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}

module.exports = {
  DEFAULT_CONFIG,
  buildAuthHeaders,
  buildFieldPayload,
  buildIssueTypePayload,
  normalizeBaseUrl,
  parseArgs,
};
