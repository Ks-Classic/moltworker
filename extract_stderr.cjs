const fs = require('fs');
const data = JSON.parse(fs.readFileSync('gateway.log.json', 'utf8'));
console.log(data.stderr);
