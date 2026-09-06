const mongoose = require('mongoose');

const optionSchema = new mongoose.Schema(
  {
    text: {
      type: String,
      required: [true, 'نص الإجابة مطلوب'],
      trim: true,
    },
    image: { type: String, default: null },
    isCorrect: { type: Boolean, default: false },
  },
  { _id: true }
);

const normalQuestionSchema = new mongoose.Schema(
  {
    exam: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'NormalExam',
      required: true,
      index: true,
    },
    order: { type: Number, default: 0 },
    text: {
      type: String,
      required: [true, 'نص السؤال مطلوب'],
      trim: true,
    },
    image: { type: String, default: null },
    options: {
      type: [optionSchema],
      default: [],
      validate: {
        validator: (value) => value.length >= 2,
        message: 'يحتاج كل سؤال إلى إجابتين على الأقل',
      },
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('NormalQuestion', normalQuestionSchema);
