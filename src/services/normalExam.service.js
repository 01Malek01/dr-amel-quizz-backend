const { ApiError } = require('../utils/ApiError');
const { generateExamCode } = require('../utils/code');
const NormalExam = require('../models/NormalExam');
const NormalQuestion = require('../models/NormalQuestion');
const NormalExamResult = require('../models/NormalExamResult');
const { persistQuestions, isObjectId } = require('../utils/persistQuestions');

const RETAKE_COOLDOWN_MS = 2 * 24 * 60 * 60 * 1000;

const isWithinDates = (exam) => {
  const now = Date.now();
  if (exam.startsAt && now < new Date(exam.startsAt).getTime()) return false;
  if (exam.endsAt && now > new Date(exam.endsAt).getTime()) return false;
  return true;
};

const getEffectiveActive = (exam) => !!(exam.isActive && isWithinDates(exam));

const applyScheduledWindow = async (exam) => {
  // النافذة الزمنية تحكم التفعيل للاختبارات المجدولة فقط. أما الاختبار بلا
  // تواريخ فتفعيله قرار المسؤول وحده — وإلا فإن isWithinDates تعيد true
  // فيُفعَّل كل اختبار جديد تلقائيًا قبل أن تُضاف أسئلته.
  if (!exam.startsAt && !exam.endsAt) return;

  const desired = isWithinDates(exam);
  if (exam.isActive !== desired) {
    exam.isActive = desired;
    await exam.save();
  }
};

const startScheduledWindowWatcher = () => {
  setInterval(async () => {
    try {
      const exams = await NormalExam.find({
        $or: [{ startsAt: { $ne: null } }, { endsAt: { $ne: null } }],
      });
      for (const exam of exams) {
        await applyScheduledWindow(exam);
      }
    } catch (err) {
      console.error('normal exam scheduled watcher error:', err.message);
    }
  }, 60 * 1000);
};

const computeGrade = ({ correctCount, questionCount, totalGrade }) => {
  if (!questionCount || !totalGrade) return 0;
  const raw = (correctCount / questionCount) * totalGrade;
  return Math.round(raw * 100) / 100;
};

const ensureCode = async (exam) => {
  if (exam.code) return exam;
  let code = generateExamCode();
  while (await NormalExam.findOne({ code })) code = generateExamCode();
  exam.code = code;
  return exam;
};

const getLastResult = async (exam, user) =>
  NormalExamResult.findOne({ exam: exam._id, user: user._id }).sort({ submittedAt: -1 });

const assertCanTake = async (req, exam) => {
  if (!getEffectiveActive(exam)) {
    throw new ApiError(403, 'هذا الاختبار غير متاح حاليًا. راجع أوقات بدايته/نهايته أو المسؤول.');
  }

  const last = await getLastResult(exam, req.user);
  if (last) {
    const waitMs = RETAKE_COOLDOWN_MS - (Date.now() - new Date(last.submittedAt).getTime());
    if (waitMs > 0) {
      const hours = Math.ceil(waitMs / (60 * 60 * 1000));
      throw new ApiError(409, `أديت هذا الاختبار مؤخرًا. يمكنك إعادته بعد ${hours} ساعة.`);
    }
  }
};

const questionCountFor = async (examId) => NormalQuestion.countDocuments({ exam: examId });

const sanitizeQuestions = (questions) =>
  questions.map((q) => ({
    _id: q._id,
    order: q.order,
    text: q.text,
    image: q.image,
    options: q.options.map((o) => ({
      _id: o._id,
      text: o.text,
      image: o.image,
    })),
  }));

const saveQuestions = async (examId, questions) =>
  persistQuestions({
    Model: NormalQuestion,
    examId,
    questions: Array.isArray(questions) ? questions : [],
    buildDoc: (raw, index) => {
      const number = index + 1;
      const text = String(raw.text || '').trim();
      if (!text) throw new ApiError(400, `السؤال ${number} بدون نص`);

      const seenIds = new Set();
      const options = [];
      (raw.options || []).forEach((o, i) => {
        const optionText = String(o.text || '').trim();
        const image = o.image || null;

        // صندوق إجابة لم يُملأ أصلًا يُهمل، بدل رفض حفظ الاختبار كله
        if (!optionText && !image) return;
        if (!optionText) {
          throw new ApiError(400, `السؤال ${number}: الإجابة ${i + 1} تحتاج إلى نص`);
        }

        const option = { text: optionText, image, isCorrect: !!o.isCorrect };
        const id = String(o._id || '');
        if (isObjectId(id) && !seenIds.has(id)) {
          option._id = id;
          seenIds.add(id);
        }
        options.push(option);
      });

      if (options.length < 2) {
        throw new ApiError(400, `السؤال ${number} يحتاج إلى إجابتين على الأقل`);
      }
      const correctCount = options.filter((o) => o.isCorrect).length;
      if (correctCount !== 1) {
        throw new ApiError(400, `السؤال ${number} يجب أن يحتوي على إجابة صحيحة واحدة فقط`);
      }

      return { exam: examId, order: index, text, image: raw.image || null, options };
    },
  });

const fmtArDate = (d) =>
  new Date(d).toLocaleString('ar-EG', { dateStyle: 'medium', timeStyle: 'short' });

// يرفض التواريخ غير الصالحة ووقت نهاية لا يأتي بعد وقت البداية
const assertValidWindow = (startsAt, endsAt) => {
  const start = startsAt ? new Date(startsAt) : null;
  const end = endsAt ? new Date(endsAt) : null;
  if (start && Number.isNaN(start.getTime())) throw new ApiError(400, 'وقت البداية غير صالح');
  if (end && Number.isNaN(end.getTime())) throw new ApiError(400, 'وقت النهاية غير صالح');
  if (start && end && end.getTime() <= start.getTime()) {
    throw new ApiError(400, 'وقت النهاية يجب أن يكون بعد وقت البداية');
  }
};

// الاختبار المجدول يتحكم جدوله في تفعيله: تفعيله خارج نافذته يُلغى تلقائيًا
// خلال دقيقة، لذا نرفضه برسالة توضّح السبب بدل أن يختفي التفعيل بصمت.
const assertCanActivate = (exam) => {
  if (!exam.startsAt && !exam.endsAt) return;
  const now = Date.now();
  if (exam.endsAt && now > new Date(exam.endsAt).getTime()) {
    throw new ApiError(
      400,
      `لا يمكن تفعيل الاختبار: انتهى وقت نهايته (${fmtArDate(exam.endsAt)}). عدّل وقت النهاية أو امسحه ثم احفظ الإعدادات.`
    );
  }
  if (exam.startsAt && now < new Date(exam.startsAt).getTime()) {
    throw new ApiError(
      400,
      `سيُفعَّل الاختبار تلقائيًا عند وقت بدايته (${fmtArDate(exam.startsAt)}). لتفعيله الآن امسح وقت البداية أو قدّمه ثم احفظ الإعدادات.`
    );
  }
};

module.exports = {
  RETAKE_COOLDOWN_MS,
  isWithinDates,
  assertValidWindow,
  assertCanActivate,
  getEffectiveActive,
  applyScheduledWindow,
  startScheduledWindowWatcher,
  computeGrade,
  ensureCode,
  getLastResult,
  assertCanTake,
  questionCountFor,
  sanitizeQuestions,
  saveQuestions,
};