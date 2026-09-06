const mongoose = require('mongoose');

const normalExamSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: [true, 'عنوان الاختبار مطلوب'],
      trim: true,
    },
    description: { type: String, trim: true, default: '' },
    totalGrade: { type: Number, required: [true, 'درجة الاختبار مطلوبة'], min: 1 },
    isActive: { type: Boolean, default: false },
    startsAt: { type: Date, default: null },
    endsAt: { type: Date, default: null },
    code: { type: String, unique: true, sparse: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.model('NormalExam', normalExamSchema);
