const fs = require('fs');
const data = JSON.parse(fs.readFileSync('gateway.log.json', 'utf8'));
console.log('--- STDOUT ---');
console.log(data.stdout);
console.log('--- STDERR ---');
console.log(data.stderr);
