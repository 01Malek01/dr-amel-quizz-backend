const crypto = require('crypto');

const generateExamCode = () =>
  crypto.randomBytes(4).toString('hex').toUpperCase();

const generateId = () => crypto.randomBytes(12).toString('hex');

module.exports = { generateExamCode, generateId };