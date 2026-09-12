const { ApiError } = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const Survey = require('../models/Survey');
const SurveyQuestion = require('../models/SurveyQuestion');
const SurveyResponse = require('../models/SurveyResponse');
const Exam = require('../models/Exam');
const User = require('../models/User');
const { PREBUILT_SURVEY } = require('../constants');
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
  const { title, intro, exam, choices, predefined } = req.body;

  if (!title) throw new ApiError(400, 'عنوان المقياس مطلوب');
  if (!exam) throw new ApiError(400, 'اختر الاختبار المرتبط بهذا المقياس');

  const examDoc = await Exam.findById(exam);
  if (!examDoc) throw new ApiError(404, 'الاختبار غير موجود');

  const usePredefined = !!predefined;
  const cleanChoices = usePredefined
    ? PREBUILT_SURVEY.choices.map((c) => ({ label: c.label, score: c.score }))
    : (Array.isArray(choices) ? choices : []).map((c) => ({
        label: String(c.label || '').trim(),
        score: Number(c.score) || 0,
      }));
  if (!usePredefined && cleanChoices.length < 2) {
    throw new ApiError(400, 'أضف اختيارين على الأقل مع درجاتها');
  }

  let survey = await Survey.create({
    title,
    intro: intro && intro.trim() ? intro : usePredefined ? PREBUILT_SURVEY.intro : '',
    exam,
    choices: cleanChoices,
    isPredefined: usePredefined,
    isActive: usePredefined,
    createdBy: req.user._id,
  });

  survey = await ensureCode(survey);
  await survey.save();

  if (usePredefined) {
    await saveQuestions(survey._id, PREBUILT_SURVEY.items.map((text) => ({ _id: null, text })));
  }

  const questionCount = await questionCountFor(survey._id);
  res.status(201).json({ success: true, data: { ...survey.toObject(), questionCount } });
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

const escapeRegex = (value) => String(value).replace(/[-/\\^$*+?.()|[\]{}]/g, (m) => `\\${m}`);

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

const getResults = asyncHandler(async (req, res) => {
  const survey = await Survey.findById(req.params.id).populate('exam', 'title');
  if (!survey) throw new ApiError(404, 'المقياس غير موجود');

  // نتائج هذه الصفحة للمقياس المُشارَك عبر رابط مستقل فقط.
  // المقياس الذي يظهر بين أسئلة الاختبار له صفحته الخاصة داخل إدارة الاختبار
  // (GET /api/stats/in-test-survey).
  const { student = '', group = '', source = 'standalone' } = req.query;

  const match = { survey: survey._id };

  // The student box is a free-text search (name or username); an id also works.
  let userIds = null;
  if (group) {
    const members = await User.find({ group }).select('_id');
    userIds = members.map((m) => String(m._id));
  }
  if (String(student).trim()) {
    const term = String(student).trim();
    let matched;
    if (/^[0-9a-fA-F]{24}$/.test(term)) {
      matched = [term];
    } else {
      const regex = { $regex: escapeRegex(term), $options: 'i' };
      const found = await User.find({ $or: [{ name: regex }, { username: regex }] }).select('_id');
      matched = found.map((m) => String(m._id));
    }
    userIds = userIds ? userIds.filter((id) => matched.includes(id)) : matched;
  }
  if (userIds) match.user = { $in: userIds };

  const sourceScope =
    source === 'in-test' || source === 'standalone' || source === 'all' ? source : 'standalone';
  if (sourceScope !== 'all') match.source = sourceScope;

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
    source: r.source || 'standalone',
    questionOrder: r.questionOrder ?? null,
    session: r.session ?? null,
    submittedAt: r.submittedAt,
  }));

  // النتيجة النهائية = مجموع الدرجات ÷ عدد البنود المُجاب عنها
  const sumOf = (rows, key) => rows.reduce((acc, row) => acc + (Number(row[key]) || 0), 0);

  const filteredTotalScore = sumOf(data, 'totalScore');
  const filteredItemCount = sumOf(data, 'questionCount');

  // ملخص لكل طالب: يجمع كل تسليماته (خصوصًا مقاييس «داخل الاختبار» المتكررة)
  const perStudent = new Map();
  for (const row of data) {
    const key = String(row.userId || row.studentName);
    const entry = perStudent.get(key) || {
      key,
      userId: row.userId,
      studentName: row.studentName,
      username: row.username,
      responseCount: 0,
      totalScore: 0,
      itemCount: 0,
      lastSubmittedAt: row.submittedAt,
    };
    entry.responseCount += 1;
    entry.totalScore += Number(row.totalScore) || 0;
    entry.itemCount += Number(row.questionCount) || 0;
    if (new Date(row.submittedAt) > new Date(entry.lastSubmittedAt)) {
      entry.lastSubmittedAt = row.submittedAt;
    }
    perStudent.set(key, entry);
  }

  const byStudent = [...perStudent.values()]
    .map((entry) => ({
      ...entry,
      result: entry.itemCount ? round2(entry.totalScore / entry.itemCount) : 0,
    }))
    .sort((a, b) => b.result - a.result);

  const overallMatch = { survey: survey._id };
  if (sourceScope !== 'all') overallMatch.source = sourceScope;
  const allResponses = await SurveyResponse.find(overallMatch);
  const avgResult = allResponses.length
    ? allResponses.reduce((sum, r) => sum + (r.result || 0), 0) / allResponses.length
    : 0;

  const scores = (survey.choices || []).map((c) => Number(c.score) || 0);
  const itemCount = await questionCountFor(survey._id);

  res.json({
    success: true,
    data: {
      survey: {
        ...survey.toObject(),
        examTitle: survey.exam?.title || 'محذوف',
        questionCount: itemCount,
        responseCount: allResponses.length,
      },
      results: data,
      byStudent,
      source: sourceScope,
      // مفاتيح مختصرة تستخدمها الواجهة مباشرة
      responseCount: allResponses.length,
      avgResult: round2(avgResult),
      scale: {
        min: scores.length ? Math.min(...scores) : 1,
        max: scores.length ? Math.max(...scores) : 5,
        itemCount,
      },
      summary: {
        responseCount: data.length,
        studentCount: byStudent.length,
        totalScore: filteredTotalScore,
        itemCount: filteredItemCount,
        // هذه هي نتيجة المعادلة النهائية: المجموع ÷ عدد البنود
        finalResult: filteredItemCount ? round2(filteredTotalScore / filteredItemCount) : 0,
      },
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