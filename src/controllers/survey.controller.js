const { ApiError } = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const Survey = require('../models/Survey');
const SurveyQuestion = require('../models/SurveyQuestion');
const SurveyResponse = require('../models/SurveyResponse');
const Exam = require('../models/Exam');
const User = require('../models/User');
const {
  ensureCode,
  questionCountFor,
  saveQuestions,
} = require('../services/survey.service');

const listSurveys = asyncHandler(async (req, res) => {
  const { search = '', status = '' } = req.query;

  const filter = {};
  if (search.trim()) filter.title = { $regex: search.trim(), $options: 'i' };

  const surveys = await Survey.find(filter)
    .populate('exam', 'title')
    .sort({ createdAt: -1 });

  const data = await Promise.all(
    surveys.map(async (survey) => {
      const questionCount = await questionCountFor(survey._id);
      const responseCount = await SurveyResponse.countDocuments({ survey: survey._id });
      return {
        ...survey.toObject(),
        questionCount,
        responseCount,
        examTitle: survey.exam?.title || 'محذوف',
        link: survey.code ? `/survey/${survey.code}` : null,
      };
    })
  );

  const filtered =
    status === 'active' ? data.filter((s) => s.isActive)
    : status === 'inactive' ? data.filter((s) => !s.isActive)
    : data;

  res.json({ success: true, data: filtered });
});

const getSurvey = asyncHandler(async (req, res) => {
  const survey = await Survey.findById(req.params.id).populate('exam', 'title');
  if (!survey) throw new ApiError(404, 'المقياس غير موجود');

  const questions = await SurveyQuestion.find({ survey: survey._id }).sort({ order: 1 });
  const responseCount = await SurveyResponse.countDocuments({ survey: survey._id });

  res.json({
    success: true,
    data: {
      ...survey.toObject(),
      examTitle: survey.exam?.title || 'محذوف',
      questionCount: questions.length,
      responseCount,
      link: survey.code ? `/survey/${survey.code}` : null,
      questions,
    },
  });
});

const createSurvey = asyncHandler(async (req, res) => {
  const { title, intro, exam, choices } = req.body;

  if (!title) throw new ApiError(400, 'عنوان المقياس مطلوب');
  if (!exam) throw new ApiError(400, 'اختر الاختبار المرتبط بهذا المقياس');

  const examDoc = await Exam.findById(exam);
  if (!examDoc) throw new ApiError(404, 'الاختبار غير موجود');

  const cleanChoices = (Array.isArray(choices) ? choices : []).map((c) => ({
    label: String(c.label || '').trim(),
    score: Number(c.score) || 0,
  }));
  if (cleanChoices.length < 2) {
    throw new ApiError(400, 'أضف اختيارين على الأقل مع درجاتها');
  }

  let survey = await Survey.create({
    title,
    intro: intro || '',
    exam,
    choices: cleanChoices,
    createdBy: req.user._id,
  });

  survey = await ensureCode(survey);
  await survey.save();

  res.status(201).json({ success: true, data: survey });
});

const updateSurvey = asyncHandler(async (req, res) => {
  const survey = await Survey.findById(req.params.id);
  if (!survey) throw new ApiError(404, 'المقياس غير موجود');

  const { title, intro, exam, choices } = req.body;

  if (title !== undefined) survey.title = String(title).trim();
  if (intro !== undefined) survey.intro = intro;
  if (exam !== undefined) {
    const examDoc = await Exam.findById(exam);
    if (!examDoc) throw new ApiError(404, 'الاختبار غير موجود');
    survey.exam = exam;
  }
  if (choices !== undefined) {
    const cleanChoices = (Array.isArray(choices) ? choices : []).map((c) => ({
      label: String(c.label || '').trim(),
      score: Number(c.score) || 0,
    }));
    if (cleanChoices.length < 2) {
      throw new ApiError(400, 'أضف اختيارين على الأقل مع درجاتها');
    }
    survey.choices = cleanChoices;
  }

  survey = await ensureCode(survey);
  await survey.save();

  res.json({ success: true, data: survey });
});

const setActive = asyncHandler(async (req, res) => {
  const survey = await Survey.findById(req.params.id);
  if (!survey) throw new ApiError(404, 'المقياس غير موجود');

  const { active } = req.body;
  survey.isActive = !!active;
  await survey.save();

  res.json({ success: true, data: survey });
});

const deleteSurvey = asyncHandler(async (req, res) => {
  const survey = await Survey.findById(req.params.id);
  if (!survey) throw new ApiError(404, 'المقياس غير موجود');

  await SurveyResponse.deleteMany({ survey: survey._id });
  await SurveyQuestion.deleteMany({ survey: survey._id });
  await survey.deleteOne();

  res.json({ success: true, message: 'تم حذف المقياس ونتائجه' });
});

const setQuestions = asyncHandler(async (req, res) => {
  const survey = await Survey.findById(req.params.id);
  if (!survey) throw new ApiError(404, 'المقياس غير موجود');

  const questions = Array.isArray(req.body.questions) ? req.body.questions : [];
  const saved = await saveQuestions(survey._id, questions);
  res.json({ success: true, data: saved });
});

const getResults = asyncHandler(async (req, res) => {
  const survey = await Survey.findById(req.params.id).populate('exam', 'title');
  if (!survey) throw new ApiError(404, 'المقياس غير موجود');

  const { student = '', group = '' } = req.query;

  const match = { survey: survey._id };

  if (student) {
    match.user = student;
  }
  if (group) {
    const members = await User.find({ group }).select('_id');
    match.user = { $in: members.map((m) => m._id) };
  }

  const responses = await SurveyResponse.find(match)
    .populate('user', 'name username group')
    .sort({ submittedAt: -1 });

  const data = responses.map((r) => ({
    _id: r._id,
    userId: r.user?._id,
    studentName: r.user?.name || 'محذوف',
    username: r.user?.username || '',
    totalScore: r.totalScore,
    questionCount: r.questionCount,
    result: r.result,
    submittedAt: r.submittedAt,
  }));

  const allResponses = await SurveyResponse.find({ survey: survey._id });
  const avgResult = allResponses.length
    ? allResponses.reduce((sum, r) => sum + (r.result || 0), 0) / allResponses.length
    : 0;

  res.json({
    success: true,
    data: {
      survey: {
        ...survey.toObject(),
        examTitle: survey.exam?.title || 'محذوف',
        questionCount: await questionCountFor(survey._id),
        responseCount: allResponses.length,
      },
      results: data,
      avgResult: Math.round(avgResult * 100) / 100,
    },
  });
});

module.exports = {
  listSurveys,
  getSurvey,
  createSurvey,
  updateSurvey,
  setActive,
  deleteSurvey,
  setQuestions,
  getResults,
};