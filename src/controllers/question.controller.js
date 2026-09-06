const { ApiError } = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const Exam = require('../models/Exam');
const Question = require('../models/Question');

const getQuestions = asyncHandler(async (req, res) => {
  const exam = await Exam.findById(req.params.id);
  if (!exam) throw new ApiError(404, 'الاختبار غير موجود');

  const questions = await Question.find({ exam: exam._id }).sort({ order: 1 });
  res.json({ success: true, data: questions });
});

const setQuestions = asyncHandler(async (req, res) => {
  const exam = await Exam.findById(req.params.id);
  if (!exam) throw new ApiError(404, 'الاختبار غير موجود');

  const questions = Array.isArray(req.body.questions) ? req.body.questions : [];

  if (questions.length === 0) {
    await Question.deleteMany({ exam: exam._id });
    return res.json({ success: true, data: [] });
  }

  const saved = [];

  for (const [index, raw] of questions.entries()) {
    const text = String(raw.text || '').trim();
    if (!text) throw new ApiError(400, `السؤال ${index + 1} بدون نص`);

    const options = (raw.options || []).map((o) => ({
      text: String(o.text || '').trim(),
      image: o.image || null,
      isCorrect: !!o.isCorrect,
      correctExplanation: o.correctExplanation ? String(o.correctExplanation).trim() : '',
      feedback: {
        hint: o.feedback?.hint || '',
        roadmap: o.feedback?.roadmap || '',
        link: o.feedback?.link || '',
        explanation: o.feedback?.explanation || '',
      },
    }));

    if (options.length < 2) {
      throw new ApiError(400, `السؤال ${index + 1} يحتاج إلى إجابتين على الأقل`);
    }
    const correctCount = options.filter((o) => o.isCorrect).length;
    if (correctCount !== 1) {
      throw new ApiError(400, `السؤال ${index + 1} يجب أن يحتوي على إجابة صحيحة واحدة فقط`);
    }

    const doc = {
      exam: exam._id,
      order: index,
      text,
      image: raw.image || null,
      options,
    };

    if (raw._id) {
      if (String(raw._id).length === 24) {
        await Question.updateOne({ _id: raw._id, exam: exam._id }, doc);
        saved.push(await Question.findById(raw._id));
        continue;
      }
    }
    const created = await Question.create(doc);
    saved.push(created);
  }

  const keptIds = saved.map((q) => q._id);
  await Question.deleteMany({ exam: exam._id, _id: { $nin: keptIds } });

  const ordered = await Question.find({ exam: exam._id }).sort({ order: 1 });
  res.json({ success: true, data: ordered });
});

module.exports = { getQuestions, setQuestions };