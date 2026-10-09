const { ApiError } = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const { persistQuestions, isObjectId } = require('../utils/persistQuestions');
const Exam = require('../models/Exam');
const Question = require('../models/Question');

const getQuestions = asyncHandler(async (req, res) => {
  const exam = await Exam.findById(req.params.id);
  if (!exam) throw new ApiError(404, 'الاختبار غير موجود');

  const questions = await Question.find({ exam: exam._id }).sort({ order: 1 });
  res.json({ success: true, data: questions });
});

const buildOptions = (raw, questionNumber) => {
  const seenIds = new Set();
  const options = [];

  (raw.options || []).forEach((o, i) => {
    const text = String(o.text || '').trim();
    const image = o.image || null;

    // صندوق إجابة لم يُملأ أصلًا: يُهمل بهدوء بدل رفض حفظ الاختبار كله
    if (!text && !image) return;
    if (!text) {
      throw new ApiError(400, `السؤال ${questionNumber}: الإجابة ${i + 1} تحتاج إلى نص`);
    }

    const option = {
      text,
      image,
      isCorrect: !!o.isCorrect,
      correctExplanation: o.correctExplanation ? String(o.correctExplanation).trim() : '',
      feedback: {
        hint: o.feedback?.hint || '',
        roadmap: o.feedback?.roadmap || '',
        explanation: o.feedback?.explanation || '',
        custom: o.feedback?.custom || '',
      },
    };

    // الإبقاء على معرّف الإجابة يحفظ صلة محاولات الطلاب السابقة بما اختاروه
    const id = String(o._id || '');
    if (isObjectId(id) && !seenIds.has(id)) {
      option._id = id;
      seenIds.add(id);
    }

    options.push(option);
  });

  return options;
};

const setQuestions = asyncHandler(async (req, res) => {
  const exam = await Exam.findById(req.params.id);
  if (!exam) throw new ApiError(404, 'الاختبار غير موجود');

  const questions = Array.isArray(req.body.questions) ? req.body.questions : [];

  const data = await persistQuestions({
    Model: Question,
    examId: exam._id,
    questions,
    buildDoc: (raw, index) => {
      const number = index + 1;
      const text = String(raw.text || '').trim();
      if (!text) throw new ApiError(400, `السؤال ${number} بدون نص`);

      const options = buildOptions(raw, number);
      if (options.length < 2) {
        throw new ApiError(400, `السؤال ${number} يحتاج إلى إجابتين على الأقل`);
      }
      const correctCount = options.filter((o) => o.isCorrect).length;
      if (correctCount !== 1) {
        throw new ApiError(400, `السؤال ${number} يجب أن يحتوي على إجابة صحيحة واحدة فقط`);
      }

      return { exam: exam._id, order: index, text, image: raw.image || null, options };
    },
  });

  res.json({ success: true, data });
});

module.exports = { getQuestions, setQuestions };
