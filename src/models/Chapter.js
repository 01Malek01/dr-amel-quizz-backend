const mongoose = require('mongoose');

const chapterSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: [true, 'عنوان الفصل مطلوب'],
      trim: true,
    },
    description: { type: String, trim: true, default: '' },
    color: { type: String, default: '#722ed1' },
    image: { type: String, default: null },
    order: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Chapter', chapterSchema);