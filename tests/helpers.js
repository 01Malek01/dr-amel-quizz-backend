/*
 * أدوات مشتركة لاختبارات التكامل.
 * كل ملف اختبار يستخدم قاعدة بيانات خاصة به ومنفذًا حرًّا، فلا تتعارض الملفات.
 */
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'integration-test-secret';

const mongoose = require('mongoose');

const app = require('../src/app');
const User = require('../src/models/User');
const Group = require('../src/models/Group');
const Chapter = require('../src/models/Chapter');
const Topic = require('../src/models/Topic');
const Exam = require('../src/models/Exam');
const Question = require('../src/models/Question');
const { signToken } = require('../src/utils/jwt');

const MONGO_BASE = process.env.TEST_MONGO_BASE || 'mongodb://127.0.0.1:27017';

/** معرّف صحيح الشكل لكنه غير موجود — لاختبار 404 */
const MISSING_ID = '0123456789abcdef01234567';
/** معرّف غير صالح الشكل — لاختبار 400 بدل 500 */
const BAD_ID = 'not-a-valid-object-id';

let server = null;

async function boot(dbName) {
  await mongoose.connect(`${MONGO_BASE}/${dbName}`, { serverSelectionTimeoutMS: 10000 });
  await mongoose.connection.dropDatabase();
  // dropDatabase يمحو الفهارس أيضًا — نعيد بناءها لتطابق بيئة الإنتاج
  // (وإلا لن تُكتشف قيود التفرّد في الاختبارات)
  await Promise.all(Object.values(mongoose.models).map((model) => model.syncIndexes()));
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const { port } = server.address();
  return `http://127.0.0.1:${port}/api`;
}

async function shutdown() {
  if (mongoose.connection.readyState === 1) {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }
  if (server) await new Promise((resolve) => server.close(resolve));
  server = null;
}

/** طلب HTTP يعيد دائمًا { status, body } ولا يرمي استثناءً */
function client(baseUrl) {
  return async function request(path, { method = 'GET', body, token, raw } = {}) {
    const headers = {};
    if (body !== undefined && !raw) headers['Content-Type'] = 'application/json';
    if (token) headers.Authorization = `Bearer ${token}`;

    const res = await fetch(baseUrl + path, {
      method,
      headers,
      body: body === undefined ? undefined : raw ? body : JSON.stringify(body),
    });

    const text = await res.text();
    let parsed;
    try {
      parsed = text ? JSON.parse(text) : {};
    } catch {
      parsed = { __unparsed: text.slice(0, 400) };
    }
    return { status: res.status, body: parsed };
  };
}

/** مسؤول + طالب جاهزان مع رموزهما */
async function makeUsers({ groupFeedbackType = null } = {}) {
  const admin = await User.create({
    name: 'مسؤول الاختبار',
    email: 'admin@test.local',
    username: 'testadmin',
    password: 'pass1234',
    role: 'admin',
  });

  let group = null;
  if (groupFeedbackType) {
    group = await Group.create({
      name: 'مجموعة الاختبار',
      feedbackType: groupFeedbackType,
      isActive: true,
    });
  }

  const student = await User.create({
    name: 'طالب الاختبار',
    email: 'student@test.local',
    username: 'teststudent',
    password: 'pass1234',
    role: 'student',
    group: group ? group._id : null,
  });

  return {
    admin,
    student,
    group,
    adminToken: signToken(admin),
    studentToken: signToken(student),
  };
}

/** اختبار تغذية راجعة منشور مع أسئلته */
async function makeFeedbackExam({
  questionCount = 3,
  attemptsPerQuestion = 3,
  questionTimeSeconds = 0,
  showScoreHistory = false,
  code = 'TESTEX1',
  isPublished = true,
} = {}) {
  const chapter = await Chapter.create({ title: 'فصل الاختبار' });
  const topic = await Topic.create({ title: 'موضوع الاختبار', chapter: chapter._id });
  const exam = await Exam.create({
    title: 'اختبار تغذية راجعة للفحص',
    topic: topic._id,
    code,
    isPublished,
    attemptsPerQuestion,
    questionTimeSeconds,
    showScoreHistory,
    feedbackType: 'hint',
  });

  const questions = [];
  for (let i = 0; i < questionCount; i++) {
    questions.push(
      await Question.create({
        exam: exam._id,
        order: i,
        text: `سؤال الفحص رقم ${i + 1}`,
        options: [
          {
            text: 'الإجابة الصحيحة',
            isCorrect: true,
            correctExplanation: 'لأنها تطابق التعريف.',
            feedback: {},
          },
          {
            text: 'إجابة خاطئة أولى',
            isCorrect: false,
            feedback: {
              hint: 'تلميح للمحاولة مرة أخرى',
              roadmap: 'الاستجابة المتوقعة',
              explanation: 'شرح الموضوع',
              custom: 'نص المسؤول',
            },
          },
          {
            text: 'إجابة خاطئة ثانية',
            isCorrect: false,
            feedback: { hint: 'تلميح آخر' },
          },
        ],
      })
    );
  }

  return { chapter, topic, exam, questions };
}

module.exports = {
  boot,
  shutdown,
  client,
  makeUsers,
  makeFeedbackExam,
  MISSING_ID,
  BAD_ID,
};
