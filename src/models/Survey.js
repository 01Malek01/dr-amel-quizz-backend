const mongoose = require('mongoose');

const choiceSchema = new mongoose.Schema(
  {
    label: {
      type: String,
      required: [true, 'نص الاختيار مطلوب'],
      trim: true,
    },
    score: { type: Number, required: true },
  },
  { _id: true }
);

const surveySchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: [true, 'عنوان المقياس مطلوب'],
      trim: true,
    },
    intro: { type: String, trim: true, default: '' },
    exam: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Exam',
      required: true,
      index: true,
    },
    choices: {
      type: [choiceSchema],
      default: [],
      validate: {
        validator: (v) => v.length >= 2,
        message: 'أضف اختيارين على الأقل',
      },
    },
    isActive: { type: Boolean, default: false },
    code: { type: String, unique: true, sparse: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Survey', surveySchema);