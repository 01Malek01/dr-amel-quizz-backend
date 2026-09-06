const { ApiError } = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const NormalExam = require('../models/NormalExam');
const NormalQuestion = require('../models/NormalQuestion');
const NormalExamResult = require('../models/NormalExamResult');
const {
  getEffectiveActive,
  ensureCode,
  applyScheduledWindow,
  questionCountFor,
  saveQuestions,
} = require('../services/normalExam.service');

const listNormalExams = asyncHandler(async (req, res) => {
  const { search = '', status = '' } = req.query;

  const filter = {};
  if (search.trim()) filter.title = { $regex: search.trim(), $options: 'i' };

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
  const { title, description, totalGrade, startsAt, endsAt } = req.body;

  if (!title) throw new ApiError(400, 'عنوان الاختبار مطلوب');
  const grade = Number(totalGrade);
  if (!grade || grade <= 0) throw new ApiError(400, 'أدخل درجة الاختبار الكلية (مثال: 100)');

  let exam = await NormalExam.create({
    title,
    description: description || '',
    totalGrade: grade,
    startsAt: startsAt || null,
    endsAt: endsAt || null,
    createdBy: req.user._id,
  });

  exam = await ensureCode(exam);
  await exam.save();
  await applyScheduledWindow(exam);

  res.status(201).json({ success: true, data: exam });
});

const updateNormalExam = asyncHandler(async (req, res) => {
  const exam = await NormalExam.findById(req.params.id);
  if (!exam) throw new ApiError(404, 'الاختبار غير موجود');

  const { title, description, totalGrade, startsAt, endsAt } = req.body;

  if (title !== undefined) exam.title = String(title).trim();
  if (description !== undefined) exam.description = description;
  if (totalGrade !== undefined) {
    const grade = Number(totalGrade);
    if (!grade || grade <= 0) throw new ApiError(400, 'أدخل درجة الاختبار الكلية (مثال: 100)');
    exam.totalGrade = grade;
  }
  if (startsAt !== undefined) exam.startsAt = startsAt || null;
  if (endsAt !== undefined) exam.endsAt = endsAt || null;

  exam = await ensureCode(exam);
  await exam.save();
  await applyScheduledWindow(exam);

  res.json({ success: true, data: exam });
});

const setActive = asyncHandler(async (req, res) => {
  const exam = await NormalExam.findById(req.params.id);
  if (!exam) throw new ApiError(404, 'الاختبار غير موجود');

  const { active } = req.body;
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

  const results = await NormalExamResult.find({ exam: exam._id })
    .populate('user', 'name username group')
    .sort({ grade: -1, submittedAt: -1 });

  const data = results.map((r) => ({
    _id: r._id,
    userId: r.user?._id,
    studentName: r.user?.name || 'محذوف',
    username: r.user?.username || '',
    correctCount: r.correctCount,
    questionCount: r.questionCount,
    grade: r.grade,
    totalGrade: r.totalGrade,
    percentage: r.totalGrade ? Math.round((r.grade / r.totalGrade) * 100) : 0,
    submittedAt: r.submittedAt,
  }));

  res.json({
    success: true,
    data: {
      exam: { ...exam.toObject(), questionCount: await questionCountFor(exam._id), resultCount: data.length },
      results: data,
    },
  });
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
};