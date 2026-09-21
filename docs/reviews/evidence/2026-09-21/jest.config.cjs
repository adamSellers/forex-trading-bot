const path = require('node:path');
module.exports = {
  rootDir: __dirname,
  testMatch: ['**/reentry-review.test.js'],
  testEnvironment: 'node',
  moduleDirectories: [path.resolve(__dirname, '../../../../backend/node_modules'), 'node_modules'],
};
