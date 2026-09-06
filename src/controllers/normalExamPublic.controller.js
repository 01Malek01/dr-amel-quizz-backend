const { ApiError } = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const NormalExam = require('../models/NormalExam');
const NormalQuestion = require('../models/NormalQuestion');
const NormalExamResult = require('../models/NormalExamResult');
const {
  getEffectiveActive,
  assertCanTake,
  computeGrade,
  sanitizeQuestions,
  questionCountFor,
} = require('../services/normalExam.service');

const getMeta = asyncHandler(async (req, res) => {
  const exam = await NormalExam.findOne({ code: req.params.code });
  if (!exam) throw new ApiError(404, 'الاختبار غير موجود. تحقق من الرابط أو راجع المسؤول.');

  const questionCount = await questionCountFor(exam._id);

  res.json({
    success: true,
    data: {
      title: exam.title,
      description: exam.description,
      code: exam.code,
      totalGrade: exam.totalGrade,
      questionCount,
      available: getEffectiveActive(exam),
      startsAt: exam.startsAt,
      endsAt: exam.endsAt,
    },
  });
});

const getQuestions = asyncHandler(async (req, res) => {
  const exam = await NormalExam.findOne({ code: req.params.code });
  if (!exam) throw new ApiError(404, 'الاختبار غير موجود');

  if (!getEffectiveActive(exam)) {
    throw new ApiError(403, 'هذا الاختبار غير متاح حاليًا. راجع أوقات بدايته/نهايته أو المسؤول.');
  }

  const questions = await NormalQuestion.find({ exam: exam._id }).sort({ order: 1 });
  const last = await NormalExamResult.findOne({ exam: exam._id, user: req.user._id }).sort({ submittedAt: -1 });

  res.json({
    success: true,
    data: {
      examTitle: exam.title,
      examDescription: exam.description,
      totalGrade: exam.totalGrade,
      questionCount: questions.length,
      questions: sanitizeQuestions(questions),
      lastSubmissionAt: last ? last.submittedAt : null,
    },
  });
});

const submit = asyncHandler(async (req, res) => {
  const exam = await NormalExam.findOne({ code: req.params.code });
  if (!exam) throw new ApiError(404, 'الاختبار غير موجود');

  await assertCanTake(req, exam);

  const questions = await NormalQuestion.find({ exam: exam._id }).sort({ order: 1 });
  if (questions.length === 0) {
    throw new ApiError(400, 'لا توجد أسئلة في هذا الاختبار بعد');
  }

  const answers = Array.isArray(req.body.answers) ? req.body.answers : [];
  if (answers.length !== questions.length) {
    throw new ApiError(400, 'يجب الإجابة على جميع الأسئلة قبل التسليم');
  }

  let correctCount = 0;
  const answerDocs = [];

  for (const q of questions) {
    const chosen = answers.find(
      (a) => a && a.questionId && String(a.questionId) === String(q._id)
    );
    if (!chosen || !chosen.optionId) {
      throw new ApiError(400, 'أجب على جميع الأسئلة قبل التسليم');
    }
    const option = q.options.id(chosen.optionId);
    if (!option) throw new ApiError(400, 'إجابة غير موجودة في أحد الأسئلة');

    const isCorrect = !!option.isCorrect;
    if (isCorrect) correctCount += 1;
    answerDocs.push({
      question: q._id,
      chosenOption: option._id,
      isCorrect,
    });
  }

  const grade = computeGrade({
    correctCount,
    questionCount: questions.length,
    totalGrade: exam.totalGrade,
  });

  const result = await NormalExamResult.create({
    exam: exam._id,
    user: req.user._id,
    answers: answerDocs,
    correctCount,
    questionCount: questions.length,
    grade,
    totalGrade: exam.totalGrade,
    submittedAt: new Date(),
  });

  res.status(201).json({
    success: true,
    data: {
      resultId: result._id,
      examTitle: exam.title,
      correctCount,
      questionCount: questions.length,
      grade,
      totalGrade: exam.totalGrade,
      percentage: exam.totalGrade ? Math.round((grade / exam.totalGrade) * 100) : 0,
      submittedAt: result.submittedAt,
    },
  });
});

module.exports = { getMeta, getQuestions, submit };