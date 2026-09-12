const Setting = require('../models/Setting');
const asyncHandler = require('../utils/asyncHandler');

const getSetting = asyncHandler(async (req, res) => {
  const doc = await Setting.findOne({ key: req.params.key });
  res.json({ success: true, data: { key: req.params.key, value: doc ? doc.value : '' } });
});

const setSetting = asyncHandler(async (req, res) => {
  const value = typeof req.body.value === 'string' ? req.body.value : '';
  await Setting.updateOne(
    { key: req.params.key },
    { $set: { value } },
    { upsert: true }
  );
  res.json({ success: true, data: { key: req.params.key, value } });
});

module.exports = { getSetting, setSetting };