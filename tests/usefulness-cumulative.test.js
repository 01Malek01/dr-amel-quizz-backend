const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

const { boot, shutdown, client, makeUsers, makeFeedbackExam } = require('./helpers');
const { USEFULNESS_SURVEY } = require('../src/constants');
const UsefulnessSurvey = require('../src/models/UsefulnessSurvey');

let request;
let users;
let other;
let exam1;
let exam2;
let exam3;

const N = USEFULNESS_SURVEY.items.length;

// إجابة كاملة عن المقياس بدرجة واحدة لكل العبارات
const respond = (user, exam, score, texts = USEFULNESS_SURVEY.items) =>
  UsefulnessSurvey.create({
    user,
    exam: exam._id,
    session: new mongoose.Types.ObjectId(),
    answers: texts.map((text, item) => ({ item, text, score, label: '' })),
    totalScore: score * texts.length,
    itemCount: texts.length,
    result: score,
  });

before(async () => {
  request = client(await boot('dq_test_usefulness_cumulative'));
  users = await makeUsers();

  const created = await request('/users', {
    method: 'POST',
    token: users.adminToken,
    body: { name: 'ب طالب ثانٍ', nationalId: '99990000', password: 'pass1234', role: 'student' },
  });
  assert.equal(created.status, 201, created.body.message);
  other = created.body.data._id;

  exam1 = (await makeFeedbackExam({ questionCount: 1, code: 'CUMEX01' })).exam;
  exam2 = (await makeFeedbackExam({ questionCount: 1, code: 'CUMEX02' })).exam;
  exam3 = (await makeFeedbackExam({ questionCount: 1, code: 'CUMEX03' })).exam;

  // الطالب الأول: 5 في الاختبار الأول و3 في الثاني ← تراكمي 4
  await respond(users.student._id, exam1, 5);
  await respond(users.student._id, exam2, 3);
  // وإجابة عن نسخة أخرى من المقياس في الاختبار الثالث: لا تدخل في الحساب
  await respond(users.student._id, exam3, 1, ['عبارة من نسخة سابقة']);
  // الطالب الثاني: 2 في الاختبار الأول فقط ← تراكمي 2
  await respond(other, exam1, 2);
});

after(shutdown);

const fetchCumulative = () =>
  request('/stats/usefulness-cumulative', { token: users.adminToken });

describe('النتيجة التراكمية لمقياس الفائدة المدركة', () => {
  test('عمود لكل اختبار أجاب فيه الطلاب عن المقياس الحالي', async () => {
    const res = await fetchCumulative();
    assert.equal(res.status, 200, res.body.message);
    assert.equal(res.body.data.itemCount, N);
    assert.deepEqual(
      res.body.data.exams.map((e) => String(e._id)),
      [String(exam1._id), String(exam2._id)],
      'الاختبار الثالث فيه إجابة بنسخة سابقة فقط'
    );
  });

  test('نتيجة كل طالب في كل اختبار، ونتيجته التراكمية = متوسطها', async () => {
    const { students } = (await fetchCumulative()).body.data;
    assert.equal(students.length, 2);

    const first = students.find((s) => String(s.studentId) === String(users.student._id));
    assert.equal(first.perExam[String(exam1._id)], 5);
    assert.equal(first.perExam[String(exam2._id)], 3);
    assert.equal(first.perExam[String(exam3._id)], undefined);
    assert.equal(first.examCount, 2);
    assert.equal(first.cumulative, 4);

    const second = students.find((s) => String(s.studentId) === String(other));
    assert.equal(second.examCount, 1);
    assert.equal(second.cumulative, 2);
    assert.equal(second.nationalId, '99990000');
  });

  test('متوسط كل اختبار والمتوسط العام', async () => {
    const data = (await fetchCumulative()).body.data;
    const byExam = Object.fromEntries(data.examAverages.map((a) => [String(a.examId), a]));
    assert.equal(byExam[String(exam1._id)].avg, 3.5);
    assert.equal(byExam[String(exam1._id)].count, 2);
    assert.equal(byExam[String(exam2._id)].avg, 3);
    assert.equal(data.overallCumulative, 3, 'متوسط النتيجتين التراكميتين 4 و2');
  });

  test('للمسؤول فقط', async () => {
    const res = await request('/stats/usefulness-cumulative', { token: users.studentToken });
    assert.equal(res.status, 403);
  });
});
