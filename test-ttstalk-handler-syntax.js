'use strict';
const fs = require('fs');
const fragment = fs.readFileSync(__dirname + '/ttstalk-handler-stable.js', 'utf8');
new Function(`async function __caseTest(){ switch ('ttstalk') { ${fragment} } }`);
console.log('ttstalk handler syntax: OK');
