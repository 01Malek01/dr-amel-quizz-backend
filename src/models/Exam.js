const mongoose = require('mongoose');
const { FEEDBACK_TYPES } = require('../constants');

const examSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: [true, 'عنوان الاختبار مطلوب'],
      trim: true,
    },
    description: { type: String, trim: true, default: '' },
    topic: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Topic',
      required: true,
      index: true,
    },
    feedbackType: {
      type: String,
      enum: FEEDBACK_TYPES,
      default: 'hint',
    },
    attemptsPerQuestion: { type: Number, default: 3, min: 1, max: 10 },
    questionTimeSeconds: { type: Number, default: 90, min: 0 },
    showScoreHistory: { type: Boolean, default: false },
    isPublished: { type: Boolean, default: false },
    code: { type: String, unique: true, sparse: true },
    publishedAt: { type: Date, default: null },
    completions: { type: Number, default: 0 },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Exam', examSchema);