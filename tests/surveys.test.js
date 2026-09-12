const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');

const { boot, shutdown, client, makeUsers, makeFeedbackExam, MISSING_ID } = require('./helpers');
const SurveyResponse = require('../src/models/SurveyResponse');

let request;
let users;
let fixture;
let surveyId;
let surveyCode;
let itemIds = [];
let choiceIds = [];

before(async () => {
  request = client(await boot('dq_test_surveys'));
  users = await makeUsers();
  fixture = await makeFeedbackExam({ questionCount: 2, code: 'SVEXAM1' });
});

after(shutdown);

const asAdmin = (path, opts = {}) => request(path, { ...opts, token: users.adminToken });

describe('إدارة المقاييس', () => {
  test('إنشاء مقياس مرتبط باختبار', async () => {
    const res = await asAdmin('/surveys', {
      method: 'POST',
      body: {
        title: 'مقياس الفحص',
        exam: String(fixture.exam._id),
        intro: 'تعليمات',
        choices: [
          { label: 'موافق تمامًا', score: 5 },
          { label: 'محايد', score: 3 },
          { label: 'غير موافق', score: 1 },
        ],
      },
    });
    assert.equal(res.status, 201, res.body.message);
    surveyId = res.body.data._id;
    surveyCode = res.body.data.code;
    assert.ok(surveyCode, 'يجب توليد رمز للمقياس');
  });

  test('مقياس باختبار غير موجود يرفض بـ404', async () => {
    const res = await asAdmin('/surveys', {
      method: 'POST',
      body: {
        title: 'مقياس يتيم',
        exam: MISSING_ID,
        choices: [
          { label: 'أ', score: 1 },
          { label: 'ب', score: 2 },
        ],
      },
    });
    assert.equal(res.status, 404);
  });

  test('مقياس بأقل من اختيارين يرفض بـ400', async () => {
    const res = await asAdmin('/surveys', {
      method: 'POST',
      body: { title: 'ناقص', exam: String(fixture.exam._id), choices: [{ label: 'أ', score: 1 }] },
    });
    assert.equal(res.status, 400);
  });

  test('مقياس بلا عنوان أو بلا اختبار يرفض بـ400', async () => {
    for (const body of [{ exam: String(fixture.exam._id) }, { title: 'بلا اختبار' }]) {
      const res = await asAdmin('/surveys', { method: 'POST', body });
      assert.equal(res.status, 400, JSON.stringify(body));
    }
  });

  test('حفظ البنود', async () => {
    const res = await asAdmin(`/surveys/${surveyId}/questions`, {
      method: 'PUT',
      body: {
        questions: [
          { _id: null, text: 'البند الأول' },
          { _id: null, text: 'البند الثاني' },
        ],
      },
    });
    assert.equal(res.status, 200, res.body.message);
    assert.equal(res.body.data.length, 2);
    itemIds = res.body.data.map((q) => String(q._id));
  });

  test('بند بلا نص يرفض بـ400', async () => {
    const res = await asAdmin(`/surveys/${surveyId}/questions`, {
      method: 'PUT',
      body: { questions: [{ _id: null, text: '   ' }] },
    });
    assert.equal(res.status, 400);
  });

  test('حفظ البنود لا يكرّرها عند الحفظ المتكرر', async () => {
    const body = {
      questions: [
        { _id: itemIds[0], text: 'البند الأول' },
        { _id: itemIds[1], text: 'البند الثاني' },
      ],
    };
    await asAdmin(`/surveys/${surveyId}/questions`, { method: 'PUT', body });
    const res = await asAdmin(`/surveys/${surveyId}/questions`, { method: 'PUT', body });
    assert.equal(res.body.data.length, 2);
  });

  test('جلب المقياس يعيد بنوده', async () => {
    const res = await asAdmin(`/surveys/${surveyId}`);
    assert.equal(res.status, 200);
    assert.equal(res.body.data.questions.length, 2);
    choiceIds = res.body.data.choices.map((c) => String(c._id));
  });

  test('تفعيل المقياس', async () => {
    const res = await asAdmin(`/surveys/${surveyId}/active`, {
      method: 'POST',
      body: { active: true },
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.data.isActive, true);
  });
});

describe('المقياس عبر الرابط المستقل', () => {
  test('بيانات المقياس متاحة بدون تسجيل دخول', async () => {
    const res = await request(`/survey/${surveyCode}`);
    assert.equal(res.status, 200);
    assert.equal(res.body.data.questionCount, 2);
  });

  test('رمز غير موجود يعيد 404', async () => {
    assert.equal((await request('/survey/NOPE0000')).status, 404);
  });

  test('البنود تحتاج تسجيل دخول', async () => {
    assert.equal((await request(`/survey/${surveyCode}/questions`)).status, 401);
  });

  test('الطالب يجيب على المقياس', async () => {
    const res = await request(`/survey/${surveyCode}/submit`, {
      method: 'POST',
      token: users.studentToken,
      body: {
        answers: itemIds.map((id) => ({ questionId: id, choiceId: choiceIds[0] })),
      },
    });
    assert.equal(res.status, 201, res.body.message);
    assert.equal(res.body.data.totalScore, 10);
    assert.equal(res.body.data.result, 5);
  });

  test('لا يمكن الإجابة مرتين عبر الرابط (409)', async () => {
    const res = await request(`/survey/${surveyCode}/submit`, {
      method: 'POST',
      token: users.studentToken,
      body: { answers: itemIds.map((id) => ({ questionId: id, choiceId: choiceIds[0] })) },
    });
    assert.equal(res.status, 409);
  });

  test('إجابات ناقصة أو خيارات غير صالحة ترفض بـ400', async () => {
    const other = await request('/auth/login', {
      method: 'POST',
      body: { identifier: 'teststudent', password: 'pass1234' },
    });
    const token = other.body.token;

    for (const answers of [
      [],
      [{ questionId: itemIds[0], choiceId: choiceIds[0] }],
      itemIds.map((id) => ({ questionId: id, choiceId: MISSING_ID })),
      itemIds.map((id) => ({ questionId: id })),
      'nonsense',
    ]) {
      const res = await request(`/survey/${surveyCode}/submit`, {
        method: 'POST',
        token,
        body: { answers },
      });
      assert.ok(res.status >= 400 && res.status < 500, `${JSON.stringify(answers)} -> ${res.status}`);
    }
  });
});

describe('نتائج المقياس منفصلة عن نتائج داخل الاختبار', () => {
  before(async () => {
    // تسليم داخل الاختبار لنفس المقياس
    await request('/exam/SVEXAM1/start', { method: 'POST', token: users.studentToken });
    const res = await request('/exam/SVEXAM1/survey-submit', {
      method: 'POST',
      token: users.studentToken,
      body: {
        questionOrder: 0,
        answers: itemIds.map((id) => ({ questionId: id, choiceId: choiceIds[2] })),
      },
    });
    assert.equal(res.status, 201, res.body.message);
  });

  test('صفحة المقاييس القبلية تعرض تسليم الرابط فقط', async () => {
    const res = await asAdmin(`/surveys/${surveyId}/results`);
    assert.equal(res.status, 200);
    assert.equal(res.body.data.source, 'standalone');
    assert.equal(res.body.data.results.length, 1);
    assert.equal(
      res.body.data.results.some((r) => r.source === 'in-test'),
      false
    );
    assert.equal(res.body.data.summary.finalResult, 5);
  });

  test('نتائج داخل الاختبار تُعرض في مسار الإحصائيات', async () => {
    const res = await asAdmin(`/stats/in-test-survey?exam=${fixture.exam._id}`);
    assert.equal(res.status, 200);
    assert.equal(res.body.data.responseCount, 1);
    assert.equal(res.body.data.students.length, 1);
    assert.equal(res.body.data.overallAvg, 1);
  });

  test('التسليم داخل الاختبار لا يمنع التسليم عبر الرابط لطالب آخر', async () => {
    const fresh = await asAdmin('/users', {
      method: 'POST',
      body: { name: 'طالب ثانٍ', username: 'stu2', password: 'pass1234', role: 'student' },
    });
    assert.equal(fresh.status, 201, fresh.body.message);

    const login = await request('/auth/login', {
      method: 'POST',
      body: { identifier: 'stu2', password: 'pass1234' },
    });
    assert.equal(login.status, 200);

    await request('/exam/SVEXAM1/start', { method: 'POST', token: login.body.token });
    const inTest = await request('/exam/SVEXAM1/survey-submit', {
      method: 'POST',
      token: login.body.token,
      body: {
        questionOrder: 0,
        answers: itemIds.map((id) => ({ questionId: id, choiceId: choiceIds[0] })),
      },
    });
    assert.equal(inTest.status, 201, inTest.body.message);

    const viaLink = await request(`/survey/${surveyCode}/submit`, {
      method: 'POST',
      token: login.body.token,
      body: { answers: itemIds.map((id) => ({ questionId: id, choiceId: choiceIds[0] })) },
    });
    assert.equal(viaLink.status, 201, 'التسليم داخل الاختبار لا يجب أن يحجب الرابط');
  });

  test('تصفية النتائج باسم الطالب لا تسبب 500', async () => {
    for (const q of ['طالب', 'stu2', '((', 'no-such-name', MISSING_ID]) {
      const res = await asAdmin(`/surveys/${surveyId}/results?student=${encodeURIComponent(q)}`);
      assert.ok(res.status < 500, `${q} -> ${res.status} ${res.body.message}`);
    }
  });
});

describe('إيقاف المقياس وحذفه', () => {
  test('المقياس المعطّل يرفض الإجابة', async () => {
    await asAdmin(`/surveys/${surveyId}/active`, { method: 'POST', body: { active: false } });
    const res = await request(`/survey/${surveyCode}/questions`, { token: users.studentToken });
    assert.equal(res.status, 403);
  });

  test('الحذف يزيل المقياس ونتائجه', async () => {
    const res = await asAdmin(`/surveys/${surveyId}`, { method: 'DELETE' });
    assert.equal(res.status, 200);
    assert.equal(await SurveyResponse.countDocuments({ survey: surveyId }), 0);
    assert.equal((await asAdmin(`/surveys/${surveyId}`)).status, 404);
  });
});
