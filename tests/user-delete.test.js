const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

const { boot, shutdown, client, makeUsers } = require('./helpers');
const Exam = require('../src/models/Exam');

let request;
let users;

// كل مجموعة فيها حقل user يشير إلى الطالب
const STUDENT_COLLECTIONS = [
  'attempts',
  'sessions',
  'feedbackratings',
  'postexamsurveys',
  'normalexamresults',
  'surveyresponses',
];

before(async () => {
  request = client(await boot('dq_test_user_delete'));
  users = await makeUsers();
});

after(shutdown);

const countFor = (collection, userId) =>
  mongoose.connection.db.collection(collection).countDocuments({ user: userId });

describe('حذف الطالب يحذف كل بياناته', () => {
  let doomedId;
  let examId;

  before(async () => {
    const created = await request('/users', {
      method: 'POST',
      token: users.adminToken,
      body: { name: 'طالب سيُحذف', nationalId: '55556666', password: 'pass1234', role: 'student' },
    });
    assert.equal(created.status, 201, created.body.message);
    doomedId = new mongoose.Types.ObjectId(created.body.data._id);

    const exam = await Exam.collection.insertOne({
      title: 'اختبار',
      lateAccessUsers: [doomedId, users.student._id],
    });
    examId = exam.insertedId;

    // سجل للطالب المحذوف وآخر لطالب باقٍ في كل مجموعة. لكل سجل معرّفاته
    // الخاصة، لأن بعض المجموعات فيها فهارس فريدة (مثل session في المقياس البعدي)
    const row = (user) => ({
      user,
      exam: examId,
      session: new mongoose.Types.ObjectId(),
      question: new mongoose.Types.ObjectId(),
      survey: new mongoose.Types.ObjectId(),
    });
    for (const name of STUDENT_COLLECTIONS) {
      await mongoose.connection.db
        .collection(name)
        .insertMany([row(doomedId), row(users.student._id)]);
    }
  });

  test('الحذف ينجح', async () => {
    const res = await request(`/users/${doomedId}`, { method: 'DELETE', token: users.adminToken });
    assert.equal(res.status, 200, res.body.message);
  });

  test('لا يبقى للطالب المحذوف أي سجل', async () => {
    for (const name of STUDENT_COLLECTIONS) {
      assert.equal(await countFor(name, doomedId), 0, `بقي سجل في ${name}`);
    }
  });

  test('سجلات الطلاب الآخرين لم تُمس', async () => {
    for (const name of STUDENT_COLLECTIONS) {
      assert.equal(await countFor(name, users.student._id), 1, `حُذف سجل طالب آخر من ${name}`);
    }
  });

  test('يُزال من استثناءات الاختبارات المتأخرة، ويبقى غيره', async () => {
    const exam = await Exam.collection.findOne({ _id: examId });
    assert.deepEqual(
      exam.lateAccessUsers.map(String),
      [String(users.student._id)]
    );
  });
});
