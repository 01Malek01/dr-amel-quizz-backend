const { ApiError } = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const { escapeRegex } = require('../utils/escapeRegex');
const NormalExam = require('../models/NormalExam');
const NormalQuestion = require('../models/NormalQuestion');
const NormalExamResult = require('../models/NormalExamResult');
const {
  getEffectiveActive,
  ensureCode,
  applyScheduledWindow,
  assertValidWindow,
  assertCanActivate,
  questionCountFor,
  saveQuestions,
} = require('../services/normalExam.service');

const listNormalExams = asyncHandler(async (req, res) => {
  const { search = '', status = '' } = req.query;

  const filter = {};
  if (search.trim()) filter.title = { $regex: escapeRegex(search.trim()), $options: 'i' };

  const exams = await NormalExam.find(filter).sort({ createdAt: -1 });

  const data = await Promise.all(
    exams.map(async (exam) => {
      const questionCount = await questionCountFor(exam._id);
      return {
        ...exam.toObject(),
        questionCount,
        effectiveActive: getEffectiveActive(exam),
        link: exam.code ? `/nexam/${exam.code}` : null,
      };
    })
  );

  const filtered = status === 'active' ? data.filter((e) => e.effectiveActive)
    : status === 'inactive' ? data.filter((e) => !e.effectiveActive)
    : data;

  res.json({ success: true, data: filtered });
});

const getNormalExam = asyncHandler(async (req, res) => {
  const exam = await NormalExam.findById(req.params.id);
  if (!exam) throw new ApiError(404, 'الاختبار غير موجود');

  const questions = await NormalQuestion.find({ exam: exam._id }).sort({ order: 1 });
  const resultCount = await NormalExamResult.countDocuments({ exam: exam._id });

  res.json({
    success: true,
    data: {
      ...exam.toObject(),
      questionCount: questions.length,
      effectiveActive: getEffectiveActive(exam),
      link: exam.code ? `/nexam/${exam.code}` : null,
      resultCount,
      questions,
    },
  });
});

const createNormalExam = asyncHandler(async (req, res) => {
  const { title, description, totalGrade, startsAt, endsAt, allowSkip } = req.body;

  if (!title) throw new ApiError(400, 'عنوان الاختبار مطلوب');
  const grade = Number(totalGrade);
  if (!grade || grade <= 0) throw new ApiError(400, 'أدخل درجة الاختبار الكلية (مثال: 100)');
  assertValidWindow(startsAt, endsAt);

  let exam = await NormalExam.create({
    title,
    description: description || '',
    totalGrade: grade,
    startsAt: startsAt || null,
    endsAt: endsAt || null,
    allowSkip: !!allowSkip,
    createdBy: req.user._id,
  });

  exam = await ensureCode(exam);
  await exam.save();
  await applyScheduledWindow(exam);

  res.status(201).json({ success: true, data: exam });
});

const updateNormalExam = asyncHandler(async (req, res) => {
  let exam = await NormalExam.findById(req.params.id);
  if (!exam) throw new ApiError(404, 'الاختبار غير موجود');

  const { title, description, totalGrade, startsAt, endsAt, allowSkip } = req.body;

  if (title !== undefined) exam.title = String(title).trim();
  if (description !== undefined) exam.description = description;
  if (totalGrade !== undefined) {
    const grade = Number(totalGrade);
    if (!grade || grade <= 0) throw new ApiError(400, 'أدخل درجة الاختبار الكلية (مثال: 100)');
    exam.totalGrade = grade;
  }
  if (allowSkip !== undefined) exam.allowSkip = !!allowSkip;
  if (startsAt !== undefined) exam.startsAt = startsAt || null;
  if (endsAt !== undefined) exam.endsAt = endsAt || null;
  assertValidWindow(exam.startsAt, exam.endsAt);

  exam = await ensureCode(exam);
  await exam.save();
  await applyScheduledWindow(exam);

  res.json({ success: true, data: exam });
});

const setActive = asyncHandler(async (req, res) => {
  const exam = await NormalExam.findById(req.params.id);
  if (!exam) throw new ApiError(404, 'الاختبار غير موجود');

  const { active } = req.body;
  if (active) assertCanActivate(exam);
  exam.isActive = !!active;
  await exam.save();

  res.json({ success: true, data: { ...exam.toObject(), effectiveActive: getEffectiveActive(exam) } });
});

const deleteNormalExam = asyncHandler(async (req, res) => {
  const exam = await NormalExam.findById(req.params.id);
  if (!exam) throw new ApiError(404, 'الاختبار غير موجود');

  await NormalExamResult.deleteMany({ exam: exam._id });
  await NormalQuestion.deleteMany({ exam: exam._id });
  await exam.deleteOne();

  res.json({ success: true, message: 'تم حذف الاختبار ونتائجه' });
});

const getNormalQuestions = asyncHandler(async (req, res) => {
  const exam = await NormalExam.findById(req.params.id);
  if (!exam) throw new ApiError(404, 'الاختبار غير موجود');

  const questions = await NormalQuestion.find({ exam: exam._id }).sort({ order: 1 });
  res.json({ success: true, data: questions });
});

const setNormalQuestions = asyncHandler(async (req, res) => {
  const exam = await NormalExam.findById(req.params.id);
  if (!exam) throw new ApiError(404, 'الاختبار غير موجود');

  const questions = Array.isArray(req.body.questions) ? req.body.questions : [];
  const saved = await saveQuestions(exam._id, questions);
  res.json({ success: true, data: saved });
});

const getNormalResults = asyncHandler(async (req, res) => {
  const exam = await NormalExam.findById(req.params.id);
  if (!exam) throw new ApiError(404, 'الاختبار غير موجود');

  const [results, questions] = await Promise.all([
    NormalExamResult.find({ exam: exam._id })
      .populate('user', 'name username nationalId group')
      .sort({ grade: -1, submittedAt: -1 }),
    NormalQuestion.find({ exam: exam._id }).sort({ order: 1 }),
  ]);

  // إجابة كل طالب عن كل سؤال، مرتبة كترتيب الأسئلة — لملف الإكسيل
  const LETTERS = ['أ', 'ب', 'ج', 'د', 'هـ', 'و', 'ز', 'ح'];
  const answersFor = (r) =>
    questions.map((q) => {
      const a = (r.answers || []).find((x) => String(x.question) === String(q._id));
      if (!a || a.skipped || !a.chosenOption) return { status: 'skipped', choice: '' };
      const index = q.options.findIndex((o) => String(o._id) === String(a.chosenOption));
      return {
        status: a.isCorrect ? 'correct' : 'wrong',
        choice: index >= 0 ? LETTERS[index] || String(index + 1) : '?',
      };
    });

  const data = results.map((r) => ({
    _id: r._id,
    userId: r.user?._id,
    studentName: r.user?.name || 'محذوف',
    username: r.user?.username || '',
    nationalId: r.user?.nationalId || '',
    answers: answersFor(r),
    correctCount: r.correctCount,
    skippedCount: r.skippedCount || 0,
    questionCount: r.questionCount,
    grade: r.grade,
    totalGrade: r.totalGrade,
    percentage: r.totalGrade ? Math.round((r.grade / r.totalGrade) * 100) : 0,
    submittedAt: r.submittedAt,
  }));

  res.json({
    success: true,
    data: {
      exam: { ...exam.toObject(), questionCount: questions.length, resultCount: data.length },
      questions: questions.map((q) => ({ _id: q._id, order: q.order, text: q.text })),
      results: data,
    },
  });
});

// حذف نتيجة طالب واحدة. تسقط معها مهلة إعادة الاختبار المحسوبة من آخر نتيجة،
// فيستطيع الطالب أداءه من جديد فورًا.
const deleteNormalResult = asyncHandler(async (req, res) => {
  const result = await NormalExamResult.findOne({ _id: req.params.resultId, exam: req.params.id });
  if (!result) throw new ApiError(404, 'النتيجة غير موجودة في هذا الاختبار');
  await result.deleteOne();
  res.json({ success: true, message: 'تم حذف النتيجة. يستطيع الطالب أداء الاختبار من جديد.' });
});

module.exports = {
  listNormalExams,
  getNormalExam,
  createNormalExam,
  updateNormalExam,
  setActive,
  deleteNormalExam,
  getNormalQuestions,
  setNormalQuestions,
  getNormalResults,
  deleteNormalResult,
};