const mongoose = require('mongoose');

const topicSchema = new mongoose.Schema(
  {
    chapter: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Chapter',
      required: true,
      index: true,
    },
    title: {
      type: String,
      required: [true, 'عنوان الموضوع مطلوب'],
      trim: true,
    },
    description: { type: String, trim: true, default: '' },
    order: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Topic', topicSchema);