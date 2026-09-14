const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');

const { boot, shutdown, client, makeUsers, makeFeedbackExam, MISSING_ID } = require('./helpers');
const SurveyResponse = require('../src/models/SurveyResponse');
const { PREBUILT_SURVEY } = require('../src/constants');

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

const choiceIdForScore = (score) =>
  choiceIds[PREBUILT_SURVEY.choices.findIndex((c) => c.score === score)];

describe('المقياس المحدد مسبقًا', () => {
  test('قالب المقياس متاح للمسؤول', async () => {
    const res = await asAdmin('/surveys/template');
    assert.equal(res.status, 200, res.body.message);
    assert.equal(res.body.data.title, 'مقياس الانفعالات المرتبط بأداء الاختبار');
    assert.equal(res.body.data.items.length, 8);
    assert.deepEqual(
      res.body.data.choices.map((c) => c.score),
      [5, 4, 3, 2, 1]
    );
  });

  test('القالب محمي عن الطلاب', async () => {
    assert.equal((await request('/surveys/template', { token: users.studentToken })).status, 403);
  });

  test('إنشاء الرابط يحتاج الاختبار فقط', async () => {
    const res = await asAdmin('/surveys', {
      method: 'POST',
      body: { exam: String(fixture.exam._id) },
    });
    assert.equal(res.status, 201, res.body.message);
    surveyId = res.body.data._id;
    surveyCode = res.body.data.code;

    assert.ok(surveyCode, 'يجب توليد رمز للرابط');
    assert.equal(res.body.data.link, `/survey/${surveyCode}`);
    assert.equal(res.body.data.title, PREBUILT_SURVEY.title);
    assert.equal(res.body.data.intro, PREBUILT_SURVEY.intro);
    assert.equal(res.body.data.isActive, true, 'الرابط يعمل فور إنشائه');
    assert.equal(res.body.data.questionCount, 8);
  });

  test('المقياس المُنشأ يطابق القالب حرفيًا', async () => {
    const res = await asAdmin(`/surveys/${surveyId}`);
    assert.equal(res.status, 200);
    assert.deepEqual(
      res.body.data.questions.map((q) => q.text),
      PREBUILT_SURVEY.items
    );
    assert.deepEqual(
      res.body.data.choices.map((c) => [c.label, c.score]),
      PREBUILT_SURVEY.choices.map((c) => [c.label, c.score])
    );
    itemIds = res.body.data.questions.map((q) => String(q._id));
    choiceIds = res.body.data.choices.map((c) => String(c._id));
  });

  test('لا يمكن تغيير العنوان أو الاختيارات عند الإنشاء', async () => {
    const other = await makeFeedbackExam({ questionCount: 1, code: 'SVEXAMX' });
    const res = await asAdmin('/surveys', {
      method: 'POST',
      body: {
        exam: String(other.exam._id),
        title: 'عنوان مخصص',
        intro: 'تعليمات مخصصة',
        choices: [
          { label: 'أ', score: 9 },
          { label: 'ب', score: 8 },
        ],
      },
    });
    assert.equal(res.status, 201, res.body.message);
    assert.equal(res.body.data.title, PREBUILT_SURVEY.title);
    assert.equal(res.body.data.intro, PREBUILT_SURVEY.intro);
    assert.equal(res.body.data.choices.length, 5);
    await asAdmin(`/surveys/${res.body.data._id}`, { method: 'DELETE' });
  });

  test('بدون اختبار يرفض بـ400', async () => {
    const res = await asAdmin('/surveys', { method: 'POST', body: {} });
    assert.equal(res.status, 400);
  });

  test('اختبار غير موجود يرفض بـ404', async () => {
    const res = await asAdmin('/surveys', { method: 'POST', body: { exam: MISSING_ID } });
    assert.equal(res.status, 404);
  });

  test('رابط ثانٍ لنفس الاختبار يرفض بـ409', async () => {
    const res = await asAdmin('/surveys', {
      method: 'POST',
      body: { exam: String(fixture.exam._id) },
    });
    assert.equal(res.status, 409);
  });

  test('تعديل البنود لم يعد متاحًا', async () => {
    const res = await asAdmin(`/surveys/${surveyId}/questions`, {
      method: 'PUT',
      body: { questions: [{ _id: null, text: 'بند دخيل' }] },
    });
    assert.equal(res.status, 404);
  });

  test('تغيير الاختبار المرتبط', async () => {
    const second = await makeFeedbackExam({ questionCount: 1, code: 'SVEXAM2' });

    const moved = await asAdmin(`/surveys/${surveyId}`, {
      method: 'PUT',
      body: { exam: String(second.exam._id), title: 'محاولة تغيير العنوان' },
    });
    assert.equal(moved.status, 200, moved.body.message);
    assert.equal(String(moved.body.data.exam), String(second.exam._id));
    assert.equal(moved.body.data.title, PREBUILT_SURVEY.title, 'العنوان لا يتغير');

    const back = await asAdmin(`/surveys/${surveyId}`, {
      method: 'PUT',
      body: { exam: String(fixture.exam._id) },
    });
    assert.equal(back.status, 200, back.body.message);
  });

  test('نقل الرابط إلى اختبار له رابط يرفض بـ409', async () => {
    const third = await makeFeedbackExam({ questionCount: 1, code: 'SVEXAM3' });
    const taken = await asAdmin('/surveys', {
      method: 'POST',
      body: { exam: String(third.exam._id) },
    });
    assert.equal(taken.status, 201, taken.body.message);

    const res = await asAdmin(`/surveys/${surveyId}`, {
      method: 'PUT',
      body: { exam: String(third.exam._id) },
    });
    assert.equal(res.status, 409);

    await asAdmin(`/surveys/${taken.body.data._id}`, { method: 'DELETE' });
  });
});

describe('المقياس عبر الرابط المستقل', () => {
  test('بيانات المقياس متاحة بدون تسجيل دخول', async () => {
    const res = await request(`/survey/${surveyCode}`);
    assert.equal(res.status, 200);
    assert.equal(res.body.data.questionCount, 8);
    assert.equal(res.body.data.title, PREBUILT_SURVEY.title);
  });

  test('رمز غير موجود يعيد 404', async () => {
    assert.equal((await request('/survey/NOPE0000')).status, 404);
  });

  test('البنود تحتاج تسجيل دخول', async () => {
    assert.equal((await request(`/survey/${surveyCode}/questions`)).status, 401);
  });

  test('الطالب يجيب على البنود الثمانية', async () => {
    const res = await request(`/survey/${surveyCode}/submit`, {
      method: 'POST',
      token: users.studentToken,
      body: {
        answers: itemIds.map((id) => ({ questionId: id, choiceId: choiceIdForScore(5) })),
      },
    });
    assert.equal(res.status, 201, res.body.message);
    assert.equal(res.body.data.totalScore, 40);
    assert.equal(res.body.data.questionCount, 8);
    assert.equal(res.body.data.result, 5);
  });

  test('لا يمكن الإجابة مرتين عبر الرابط (409)', async () => {
    const res = await request(`/survey/${surveyCode}/submit`, {
      method: 'POST',
      token: users.studentToken,
      body: { answers: itemIds.map((id) => ({ questionId: id, choiceId: choiceIdForScore(5) })) },
    });
    assert.equal(res.status, 409);
  });

  test('إجابات ناقصة أو خيارات غير صالحة ترفض', async () => {
    const created = await asAdmin('/users', {
      method: 'POST',
      body: { name: 'طالب للتحقق', username: 'svcheck', password: 'pass1234', role: 'student' },
    });
    assert.equal(created.status, 201, created.body.message);
    const token = (
      await request('/auth/login', {
        method: 'POST',
        body: { identifier: 'svcheck', password: 'pass1234' },
      })
    ).body.token;

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

describe('نتائج الرابط', () => {
  test('صفحة المقاييس القبلية تعرض إجابة الرابط', async () => {
    const res = await asAdmin(`/surveys/${surveyId}/results`);
    assert.equal(res.status, 200);
    assert.equal(res.body.data.results.length, 1);
    assert.equal(res.body.data.summary.totalScore, 40);
    assert.equal(res.body.data.summary.itemCount, 8);
    assert.equal(res.body.data.summary.finalResult, 5);
  });

  test('طالب آخر يجيب على الرابط نفسه', async () => {
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

    const viaLink = await request(`/survey/${surveyCode}/submit`, {
      method: 'POST',
      token: login.body.token,
      body: { answers: itemIds.map((id) => ({ questionId: id, choiceId: choiceIdForScore(4) })) },
    });
    assert.equal(viaLink.status, 201, viaLink.body.message);
  });

  test('تصفية النتائج باسم الطالب لا تسبب 500', async () => {
    for (const q of ['طالب', 'stu2', '((', 'no-such-name', MISSING_ID]) {
      const res = await asAdmin(`/surveys/${surveyId}/results?student=${encodeURIComponent(q)}`);
      assert.ok(res.status < 500, `${q} -> ${res.status} ${res.body.message}`);
    }
  });
});

describe('إيقاف الرابط وحذفه', () => {
  test('الرابط المعطّل يرفض الإجابة', async () => {
    await asAdmin(`/surveys/${surveyId}/active`, { method: 'POST', body: { active: false } });
    const res = await request(`/survey/${surveyCode}/questions`, { token: users.studentToken });
    assert.equal(res.status, 403);
  });

  test('الحذف يزيل المقياس ونتائجه ويحرّر الاختبار لرابط جديد', async () => {
    const res = await asAdmin(`/surveys/${surveyId}`, { method: 'DELETE' });
    assert.equal(res.status, 200);
    assert.equal(await SurveyResponse.countDocuments({ survey: surveyId }), 0);
    assert.equal((await asAdmin(`/surveys/${surveyId}`)).status, 404);

    const again = await asAdmin('/surveys', {
      method: 'POST',
      body: { exam: String(fixture.exam._id) },
    });
    assert.equal(again.status, 201, 'بعد الحذف يمكن إنشاء رابط جديد للاختبار نفسه');
  });
});
