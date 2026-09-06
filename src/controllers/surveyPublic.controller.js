const { ApiError } = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const Survey = require('../models/Survey');
const SurveyQuestion = require('../models/SurveyQuestion');
const SurveyResponse = require('../models/SurveyResponse');
const {
  computeResult,
  assertCanAnswer,
  questionCountFor,
  sanitizeQuestions,
} = require('../services/survey.service');

const getMeta = asyncHandler(async (req, res) => {
  const survey = await Survey.findOne({ code: req.params.code }).populate('exam', 'title');
  if (!survey) throw new ApiError(404, 'المقياس غير موجود. تحقق من الرابط أو راجع المسؤول.');

  const questionCount = await questionCountFor(survey._id);

  res.json({
    success: true,
    data: {
      title: survey.title,
      intro: survey.intro,
      code: survey.code,
      examTitle: survey.exam?.title || '',
      questionCount,
      available: survey.isActive,
    },
  });
});

const getQuestions = asyncHandler(async (req, res) => {
  const survey = await Survey.findOne({ code: req.params.code });
  if (!survey) throw new ApiError(404, 'المقياس غير موجود');

  if (!survey.isActive) {
    throw new ApiError(403, 'هذا المقياس غير متاح حاليًا.');
  }

  const questions = await SurveyQuestion.find({ survey: survey._id }).sort({ order: 1 });
  const existing = await SurveyResponse.findOne({ survey: survey._id, user: req.user._id });

  res.json({
    success: true,
    data: {
      title: survey.title,
      intro: survey.intro,
      questionCount: questions.length,
      questions: sanitizeQuestions(questions, survey.choices),
      alreadyAnswered: !!existing,
    },
  });
});

const submit = asyncHandler(async (req, res) => {
  const survey = await Survey.findOne({ code: req.params.code });
  if (!survey) throw new ApiError(404, 'المقياس غير موجود');

  await assertCanAnswer(req, survey);

  const questions = await SurveyQuestion.find({ survey: survey._id }).sort({ order: 1 });
  if (questions.length === 0) {
    throw new ApiError(400, 'لا توجد بنود في هذا المقياس بعد');
  }

  const answers = Array.isArray(req.body.answers) ? req.body.answers : [];
  if (answers.length !== questions.length) {
    throw new ApiError(400, 'يجب الإجابة على جميع البنود قبل التسليم');
  }

  const choicesMap = new Map(survey.choices.map((c) => [String(c._id), c]));

  let totalScore = 0;
  const answerDocs = [];

  for (const q of questions) {
    const chosen = answers.find(
      (a) => a && a.questionId && String(a.questionId) === String(q._id)
    );
    if (!chosen || !chosen.choiceId) {
      throw new ApiError(400, 'أجب على جميع البنود قبل التسليم');
    }
    const choice = choicesMap.get(String(chosen.choiceId));
    if (!choice) throw new ApiError(400, 'اختيار غير موجود في أحد البنود');

    totalScore += choice.score;
    answerDocs.push({
      question: q._id,
      choiceLabel: choice.label,
      score: choice.score,
    });
  }

  const result = computeResult({ totalScore, questionCount: questions.length });

  const response = await SurveyResponse.create({
    survey: survey._id,
    user: req.user._id,
    answers: answerDocs,
    totalScore,
    questionCount: questions.length,
    result,
    submittedAt: new Date(),
  });

  res.status(201).json({
    success: true,
    data: {
      responseId: response._id,
      totalScore,
      questionCount: questions.length,
      result,
      submittedAt: response.submittedAt,
    },
  });
});

module.exports = { getMeta, getQuestions, submit };