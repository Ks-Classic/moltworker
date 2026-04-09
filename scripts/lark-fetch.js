const https = require('https');

const appId = process.env.LARK_APP_ID;
const appSecret = process.env.LARK_APP_SECRET;
const baseToken = process.env.LARK_BASE_TOKEN;
const tableId = process.env.LARK_TABLE_ID || '';

if (!appId || !appSecret || !baseToken) {
  console.error("Error: LARK_APP_ID, LARK_APP_SECRET, and LARK_BASE_TOKEN environment variables are required.");
  process.exit(1);
}

// Helper for https requests
function request(url, options, bodyData) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve(parsed);
        } catch (e) {
          resolve(data);
        }
      });
    });
    req.on('error', reject);
    if (bodyData) {
      req.write(typeof bodyData === 'string' ? bodyData : JSON.stringify(bodyData));
    }
    req.end();
  });
}

async function run() {
  try {
    // 1. Authenticate to get tenant_access_token
    const authRes = await request('https://open.larksuite.com/open-apis/auth/v3/tenant_access_token/internal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, {
      app_id: appId,
      app_secret: appSecret
    });

    if (authRes.code !== 0) {
      throw new Error("Lark Auth Error: " + authRes.msg);
    }
    const token = authRes.tenant_access_token;

    // 2. If tableId is not provided, fetch the list of tables to use the first one
    let targetTableId = tableId;
    if (!targetTableId) {
      const tablesRes = await request(`https://open.larksuite.com/open-apis/bitable/v1/apps/${baseToken}/tables`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      if (tablesRes.code !== 0) throw new Error("Fetch tables error: " + tablesRes.msg);
      if (!tablesRes.data || !tablesRes.data.items || tablesRes.data.items.length === 0) {
        throw new Error("No tables found in this base.");
      }
      targetTableId = tablesRes.data.items[0].table_id;
    }

    // 3. Fetch records from the table
    const recordsRes = await request(`https://open.larksuite.com/open-apis/bitable/v1/apps/${baseToken}/tables/${targetTableId}/records?page_size=100`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });

    if (recordsRes.code !== 0) throw new Error("Fetch records error: " + recordsRes.msg);

    const items = recordsRes.data.items || [];
    console.log(`### Lark Bitable 抽出結果 (Base: ${baseToken})`);
    items.forEach(item => {
      const fields = item.fields;
      const keys = Object.keys(fields);
      // Try to find a Title or Name field for the header
      const titleKey = keys.find(k => 
        k.toLowerCase().includes('title') || 
        k.toLowerCase().includes('name') || 
        k.includes('名前') || 
        k.includes('タイトル') ||
        k.includes('案件名')
      ) || keys[0];
      
      console.log(`- **${fields[titleKey]}**`);
      keys.filter(k => k !== titleKey).forEach(k => {
        let val = fields[k];
        if (typeof val === 'object') {
          // Flatten simple objects (like users or links)
          if (val && val.text) val = val.text;
          else if (val && val.name) val = val.name;
          else if (Array.isArray(val)) val = val.map(v => v.name || v.text || v).join(', ');
          else val = JSON.stringify(val);
        }
        console.log(`  - ${k}: ${val}`);
      });
    });

  } catch (error) {
    console.error("Execution Failed: " + error.message);
    process.exit(1);
  }
}

run();
