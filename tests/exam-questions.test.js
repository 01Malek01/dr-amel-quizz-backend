const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');

const { boot, shutdown, client, makeUsers, MISSING_ID } = require('./helpers');

let request;
let users;
let examId;
let otherExamId;

before(async () => {
  request = client(await boot('dq_test_exam_questions'));
  users = await makeUsers();

  const chapter = await request('/chapters', {
    method: 'POST',
    token: users.adminToken,
    body: { title: 'موديول الأسئلة' },
  });
  const topic = await request('/topics', {
    method: 'POST',
    token: users.adminToken,
    body: { title: 'موضوع الأسئلة', chapter: chapter.body.data._id },
  });
  const exam = await request('/exams', {
    method: 'POST',
    token: users.adminToken,
    body: { title: 'اختبار حفظ الأسئلة', topic: topic.body.data._id },
  });
  examId = exam.body.data._id;

  const other = await request('/exams', {
    method: 'POST',
    token: users.adminToken,
    body: { title: 'اختبار آخر', topic: topic.body.data._id },
  });
  otherExamId = other.body.data._id;
});

after(shutdown);

const asAdmin = (path, opts = {}) => request(path, { ...opts, token: users.adminToken });

/** سؤال بسيط: إجابة صحيحة بتعليق، وإجابة خاطئة بتغذية رجعية */
const makeQuestion = (n, extra = {}) => ({
  _id: null,
  text: `سؤال رقم ${n}`,
  options: [
    {
      text: 'الإجابة الصحيحة',
      isCorrect: true,
      correctExplanation: `تعليق على الإجابة الصحيحة للسؤال ${n}`,
      feedback: { hint: '', roadmap: '', explanation: '', custom: '' },
    },
    {
      text: 'إجابة خاطئة',
      isCorrect: false,
      correctExplanation: '',
      feedback: { hint: 'تلميح', roadmap: '', explanation: '', custom: '' },
    },
  ],
  ...extra,
});

const save = (questions) =>
  asAdmin(`/exams/${examId}/questions`, { method: 'PUT', body: { questions } });

describe('تعليق الإجابة الصحيحة', () => {
  test('يُحفظ ويعود كما هو', async () => {
    const res = await save([makeQuestion(1), makeQuestion(2)]);
    assert.equal(res.status, 200, res.body.message);

    const correct = res.body.data[0].options.find((o) => o.isCorrect);
    assert.equal(correct.correctExplanation, 'تعليق على الإجابة الصحيحة للسؤال 1');

    const reloaded = await asAdmin(`/exams/${examId}/questions`);
    const stored = reloaded.body.data[0].options.find((o) => o.isCorrect);
    assert.equal(stored.correctExplanation, 'تعليق على الإجابة الصحيحة للسؤال 1');
  });

  test('التعديل على سؤال موجود يحفظ التعليق الجديد', async () => {
    const current = (await asAdmin(`/exams/${examId}/questions`)).body.data;
    const edited = current.map((q) => ({
      _id: String(q._id),
      text: q.text,
      options: q.options.map((o) => ({
        _id: String(o._id),
        text: o.text,
        isCorrect: o.isCorrect,
        correctExplanation: o.isCorrect ? 'تعليق معدّل' : '',
        feedback: o.feedback,
      })),
    }));

    const res = await save(edited);
    assert.equal(res.status, 200, res.body.message);
    const stored = (await asAdmin(`/exams/${examId}/questions`)).body.data;
    for (const q of stored) {
      assert.equal(q.options.find((o) => o.isCorrect).correctExplanation, 'تعليق معدّل');
    }
  });

  test('معرّفات الإجابات لا تتغيّر عند إعادة الحفظ', async () => {
    const before = (await asAdmin(`/exams/${examId}/questions`)).body.data;
    const ids = before.map((q) => q.options.map((o) => String(o._id)));

    const payload = before.map((q) => ({
      _id: String(q._id),
      text: q.text,
      options: q.options.map((o) => ({
        _id: String(o._id),
        text: o.text,
        isCorrect: o.isCorrect,
        correctExplanation: o.correctExplanation,
        feedback: o.feedback,
      })),
    }));
    assert.equal((await save(payload)).status, 200);

    const after2 = (await asAdmin(`/exams/${examId}/questions`)).body.data;
    assert.deepEqual(
      after2.map((q) => q.options.map((o) => String(o._id))),
      ids,
      'إعادة توليد المعرّفات تقطع صلة محاولات الطلاب السابقة بالإجابة المختارة'
    );
  });
});

describe('لا يُفقد أي سؤال عند الحفظ', () => {
  test('عدد الأسئلة المحفوظة يساوي عدد المُرسلة دائمًا', async () => {
    const sixteen = Array.from({ length: 16 }, (_, i) => makeQuestion(i + 1));
    const res = await save(sixteen);
    assert.equal(res.status, 200, res.body.message);
    assert.equal(res.body.data.length, 16, 'أُرسل 16 سؤالًا');

    const stored = await asAdmin(`/exams/${examId}/questions`);
    assert.equal(stored.body.data.length, 16, 'وبقي 16 سؤالًا بعد إعادة التحميل');
  });

  test('معرّف مكرّر في نفس الطلب لا يُلغي سؤالًا', async () => {
    const saved = (await save([makeQuestion(1), makeQuestion(2)])).body.data;
    const duplicated = [
      { _id: String(saved[0]._id), text: 'الأول', options: makeQuestion(1).options },
      { _id: String(saved[1]._id), text: 'الثاني', options: makeQuestion(2).options },
      // نفس معرّف السؤال الأول مرة أخرى — يجب أن يصبح سؤالًا جديدًا لا أن يحلّ مكانه
      { _id: String(saved[0]._id), text: 'الثالث', options: makeQuestion(3).options },
    ];

    const res = await save(duplicated);
    assert.equal(res.status, 200, res.body.message);
    assert.equal(res.body.data.length, 3);
    assert.deepEqual(
      res.body.data.map((q) => q.text),
      ['الأول', 'الثاني', 'الثالث']
    );
  });

  test('معرّف محذوف أو غير معروف يُنشئ سؤالًا جديدًا ولا يسبب 500', async () => {
    const res = await save([
      { _id: String(MISSING_ID), text: 'سؤال بمعرّف قديم', options: makeQuestion(1).options },
      makeQuestion(2),
    ]);
    assert.equal(res.status, 200, res.body.message);
    assert.equal(res.body.data.length, 2);
    assert.equal(res.body.data[0].text, 'سؤال بمعرّف قديم');
  });

  test('معرّف سؤال من اختبار آخر لا يسرقه ولا يُفقد السؤال', async () => {
    const otherSaved = await asAdmin(`/exams/${otherExamId}/questions`, {
      method: 'PUT',
      body: { questions: [makeQuestion(99)] },
    });
    assert.equal(otherSaved.status, 200, otherSaved.body.message);
    const foreignId = String(otherSaved.body.data[0]._id);

    const res = await save([
      { _id: foreignId, text: 'سؤال بمعرّف من اختبار آخر', options: makeQuestion(1).options },
    ]);
    assert.equal(res.status, 200, res.body.message);
    assert.equal(res.body.data.length, 1);
    assert.equal(res.body.data[0].text, 'سؤال بمعرّف من اختبار آخر');
    assert.notEqual(String(res.body.data[0]._id), foreignId);

    const other = await asAdmin(`/exams/${otherExamId}/questions`);
    assert.equal(other.body.data.length, 1, 'أسئلة الاختبار الآخر سليمة');
    assert.equal(other.body.data[0].text, 'سؤال رقم 99');
  });

  test('سؤال بلا نص يرفض الطلب كاملًا برسالة تحدد رقمه', async () => {
    const before = (await asAdmin(`/exams/${examId}/questions`)).body.data;
    const res = await save([makeQuestion(1), { ...makeQuestion(2), text: '   ' }]);
    assert.equal(res.status, 400);
    assert.match(res.body.message, /السؤال 2/);

    const after2 = (await asAdmin(`/exams/${examId}/questions`)).body.data;
    assert.equal(after2.length, before.length, 'الرفض لا يغيّر الأسئلة المحفوظة');
  });
});
