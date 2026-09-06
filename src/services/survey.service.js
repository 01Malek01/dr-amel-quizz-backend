const { ApiError } = require('../utils/ApiError');
const { generateExamCode } = require('../utils/code');
const Survey = require('../models/Survey');
const SurveyQuestion = require('../models/SurveyQuestion');
const SurveyResponse = require('../models/SurveyResponse');

const computeResult = ({ totalScore, questionCount }) => {
  if (!questionCount) return 0;
  return Math.round((totalScore / questionCount) * 100) / 100;
};

const ensureCode = async (survey) => {
  if (survey.code) return survey;
  let code = generateExamCode();
  while (await Survey.findOne({ code })) code = generateExamCode();
  survey.code = code;
  return survey;
};

const assertCanAnswer = async (req, survey) => {
  if (!survey.isActive) {
    throw new ApiError(403, 'هذا المقياس غير متاح حاليًا.');
  }
  const existing = await SurveyResponse.findOne({
    survey: survey._id,
    user: req.user._id,
  });
  if (existing) {
    throw new ApiError(409, 'لقد أجبت على هذا المقياس من قبل.');
  }
};

const questionCountFor = async (surveyId) => SurveyQuestion.countDocuments({ survey: surveyId });

const sanitizeQuestions = (questions, choices) =>
  questions.map((q) => ({
    _id: q._id,
    order: q.order,
    text: q.text,
    choices: choices.map((c) => ({
      _id: c._id,
      label: c.label,
      score: c.score,
    })),
  }));

const saveQuestions = async (surveyId, questions) => {
  if (!Array.isArray(questions) || questions.length === 0) {
    await SurveyQuestion.deleteMany({ survey: surveyId });
    return [];
  }

  const saved = [];
  for (const [index, raw] of questions.entries()) {
    const text = String(raw.text || '').trim();
    if (!text) throw new ApiError(400, `البند ${index + 1} بدون نص`);

    if (raw._id && String(raw._id).length === 24) {
      await SurveyQuestion.updateOne({ _id: raw._id, survey: surveyId }, { order: index, text });
      saved.push(await SurveyQuestion.findById(raw._id));
      continue;
    }
    saved.push(await SurveyQuestion.create({ survey: surveyId, order: index, text }));
  }

  const keptIds = saved.map((q) => q._id);
  await SurveyQuestion.deleteMany({ survey: surveyId, _id: { $nin: keptIds } });
  return SurveyQuestion.find({ survey: surveyId }).sort({ order: 1 });
};

module.exports = {
  computeResult,
  ensureCode,
  assertCanAnswer,
  questionCountFor,
  sanitizeQuestions,
  saveQuestions,
};