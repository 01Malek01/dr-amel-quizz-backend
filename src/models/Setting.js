const mongoose = require('mongoose');

const settingSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true },
    value: { type: String, default: '' },
  },
  { timestamps: true }
);

settingSchema.statics.get = async function get(key) {
  const doc = await this.findOne({ key });
  return doc ? doc.value : null;
};

module.exports = mongoose.model('Setting', settingSchema);