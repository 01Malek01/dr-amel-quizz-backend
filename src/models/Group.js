const mongoose = require('mongoose');
const { FEEDBACK_TYPES } = require('../constants');

const groupSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'اسم المجموعة مطلوب'],
      trim: true,
      unique: true,
    },
    description: { type: String, trim: true, default: '' },
    color: { type: String, default: '#1677ff' },
    feedbackType: {
      type: String,
      enum: FEEDBACK_TYPES,
      default: null,
    },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Group', groupSchema);