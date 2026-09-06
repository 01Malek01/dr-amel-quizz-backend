const mongoose = require('mongoose');

const surveyQuestionSchema = new mongoose.Schema(
  {
    survey: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Survey',
      required: true,
      index: true,
    },
    order: { type: Number, default: 0 },
    text: {
      type: String,
      required: [true, 'نص البند مطلوب'],
      trim: true,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('SurveyQuestion', surveyQuestionSchema);