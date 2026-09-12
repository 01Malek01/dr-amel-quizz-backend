/**
 * يُهرّب رموز التعبير النمطي في نص البحث القادم من المستخدم.
 * بدونه يسبّب بحث مثل "(" أو "[" خطأ 500.
 */
const escapeRegex = (value) => String(value).replace(/[-/\\^$*+?.()|[\]{}]/g, (m) => `\\${m}`);

module.exports = { escapeRegex };
