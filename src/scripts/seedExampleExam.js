require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });

const mongoose = require('mongoose');
const connectDB = require('../config/db');
const Chapter = require('../models/Chapter');
const Topic = require('../models/Topic');
const Exam = require('../models/Exam');
const Question = require('../models/Question');
const { generateExamCode } = require('../utils/code');

const questions = [
  {
    text: 'كم عدد الكواكب في المجموعة الشمسية؟',
    options: [
      {
        text: '7 كواكب',
        isCorrect: false,
        correctExplanation: '',
        feedback: {
          hint: 'فكّر في أن عطارد هو الأقرب إلى الشمس، وعددها أكبر من 8 أحيانًا في ذاكرتك؟',
          roadmap: 'أولًا اجمع أسماء الكواكب: عطارد، الزهرة، الأرض، المريخ، المشتري، زحل، أورانوس، نبتون. بعدها عُدّها.',
          explanation: 'يوجد 8 كواكب وليس 7، لأن نبتون ما زال يُحسب ضمن الكواكب.',
        },
      },
      {
        text: '8 كواكب',
        isCorrect: true,
        correctExplanation: 'الكواكب الثمانية هي: عطارد، الزهرة، الأرض، المريخ، المشتري، زحل، أورانوس، ونبتون.',
        feedback: {
          hint: '',
          roadmap: '',
          explanation: '',
        },
      },
      {
        text: '9 كواكب',
        isCorrect: false,
        correctExplanation: '',
        feedback: {
          hint: 'بلوتو لم يعد يُعدّ كوكبًا منذ 2006.',
          roadmap: 'لاحظ أن بلوتو صُنّف ككوكب قزم، فالعدد الفعلي أقل من 9.',
          explanation: 'بلوتو كواكب قزمة، لذلك لا يُحسب ضمن الكواكب الثمانية.',
        },
      },
    ],
  },
  {
    text: 'ما هو أكبر كوكب في المجموعة الشمسية؟',
    options: [
      {
        text: 'المشتري',
        isCorrect: true,
        correctExplanation: 'المشتري هو الأكبر حجماً وكتلةً بين جميع الكواكب، ويمكن أن يتسع لأكثر من 1300 أرض.',
        feedback: { hint: '', roadmap: '', explanation: '' },
      },
      {
        text: 'زحل',
        isCorrect: false,
        correctExplanation: '',
        feedback: {
          hint: 'زحل مشهور بحلقاته لكنه ليس الأكبر.',
          roadmap: 'قارن أحجام الكواكب العملاقة: المشتري ثم زحل ثم أورانوس.',
          explanation: 'زحل ثاني أكبر كوكب بعد المشتري.',
        },
      },
      {
        text: 'الأرض',
        isCorrect: false,
        correctExplanation: '',
        feedback: {
          hint: 'الأرض كوكب صخري صغير مقارنةً بالكواكب الغازية.',
          roadmap: 'فكّر في أي كوكب غازي عملاق مثل المشتري أو زحل.',
          explanation: 'الأرض من الكواكب الصخرية الصغيرة ولا تليق بوصف الأكبر.',
        },
      },
    ],
  },
  {
    text: 'ما العنصر الكيميائي الذي رمزه O؟',
    options: [
      {
        text: 'الذهب',
        isCorrect: false,
        correctExplanation: '',
        feedback: {
          hint: 'رمز الذهب Au، والرمز O يدل على غاز نتنفسه.',
          roadmap: 'تذكّر أن O هو الحرف الأول من Oxygen (الأكسجين).',
          explanation: 'الذهب رمزه Au بينما O هو رمز الأكسجين.',
        },
      },
      {
        text: 'الأكسجين',
        isCorrect: true,
        correctExplanation: 'الرمز O يدل على الأكسجين، وهو غاز ضروري للتنفس.',
        feedback: { hint: '', roadmap: '', explanation: '' },
      },
      {
        text: 'الهيدروجين',
        isCorrect: false,
        correctExplanation: '',
        feedback: {
          hint: 'الهيدروجين رمزه H.',
          roadmap: 'ألقِ نظرة على الجدول الدوري: O بجانب N و C.',
          explanation: 'الهيدروجين رمزه H وليس O.',
        },
      },
    ],
  },
  {
    text: 'ما هو مصدر الطاقة الرئيسي للكائنات الحية على الأرض؟',
    options: [
      {
        text: 'القمر',
        isCorrect: false,
        correctExplanation: '',
        feedback: {
          hint: 'القمر يعكس الضوء ولا ينتج طاقة حرارية للكائنات.',
          roadmap: 'فكّر في النجم الأقرب إلى الأرض الذي يمدّ النباتات بالضوء.',
          explanation: 'القمر لا ينتج طاقة، بينما الشمس هي المصدر الرئيسي للطاقة.',
        },
      },
      {
        text: 'الشمس',
        isCorrect: true,
        correctExplanation: 'الشمس تمد الأرض بالضوء والحرارة اللازمين لعملية البناء الضوئي ودعم الحياة.',
        feedback: { hint: '', roadmap: '', explanation: '' },
      },
      {
        text: 'المريخ',
        isCorrect: false,
        correctExplanation: '',
        feedback: {
          hint: 'المريخ كوكب ميت ولا يمد الأرض بالطاقة.',
          roadmap: 'تذكّر أن كل طاقة الأرض تقريبًا مصدرها النجم المركزي للمجموعة.',
          explanation: 'المريخ كوكب ولا يزوّد الأرض بالطاقة.',
        },
      },
    ],
  },
  {
    text: 'كم عدد ألوان قوس قزح الأساسية؟',
    options: [
      {
        text: '5 ألوان',
        isCorrect: false,
        correctExplanation: '',
        feedback: {
          hint: 'تذكّر اختصار ROYGBIV بالإنجليزية.',
          roadmap: 'عد الألوان بالترتيب: أحمر، برتقالي، أصفر، أخضر، أزرق، نيلي، بنفسجي.',
          explanation: 'الألوان سبعة وليست خمسة.',
        },
      },
      {
        text: '6 ألوان',
        isCorrect: false,
        correctExplanation: '',
        feedback: {
          hint: 'عددها فردي ويماثل عدد أيام الأسبوع تقريبًا.',
          roadmap: 'عدّها بالترتيب الأساسي: 7 ألوان.',
          explanation: 'قوس قزح له 7 ألوان، و6 أقل بواحد.',
        },
      },
      {
        text: '7 ألوان',
        isCorrect: true,
        correctExplanation: 'الألوان السبعة هي: أحمر، برتقالي، أصفر، أخضر، أزرق، نيلي، بنفسجي.',
        feedback: { hint: '', roadmap: '', explanation: '' },
      },
    ],
  },
  {
    text: 'ما هو الحيوان الأسرع على اليابسة؟',
    options: [
      {
        text: 'الفهد',
        isCorrect: true,
        correctExplanation: 'الفهد يستطيع الجري بسرعة تصل إلى حوالي 120 كم/ساعة في دفعات قصيرة.',
        feedback: { hint: '', roadmap: '', explanation: '' },
      },
      {
        text: 'الأسد',
        isCorrect: false,
        correctExplanation: '',
        feedback: {
          hint: 'الأسد قوي لكن ليست سرعته القصوى الأعلى.',
          roadmap: 'فكّر في الحيوان النحيل السريع الذي يصطاد بالانقضاض السريع.',
          explanation: 'الأسد أبطأ من الفهد في السباق.',
        },
      },
      {
        text: 'الغزال',
        isCorrect: false,
        correctExplanation: '',
        feedback: {
          hint: 'الغزال سريع لكن الفهد أسرع منه.',
          roadmap: 'قارن: الفهد = أسرع حيوان بري.',
          explanation: 'الغزال سريع لكنه لا يتفوق على الفهد.',
        },
      },
    ],
  },
];

async function findOrCreateChapter() {
  let chapter = await Chapter.findOne({ title: 'الفصل الأول: العلوم' });
  if (!chapter) chapter = await Chapter.create({ title: 'الفصل الأول: العلوم', description: 'مقدمة في العلوم الطبيعية', color: '#722ed1', order: 1 });
  return chapter;
}

async function findOrCreateTopic(chapterId) {
  let topic = await Topic.findOne({ title: 'مثال: أسئلة العلوم العامة' });
  if (!topic) topic = await Topic.create({ chapter: chapterId, title: 'مثال: أسئلة العلوم العامة', description: 'اختبار تجريبي لأساليب التغذية الرجعية', order: 1 });
  return topic;
}

async function main() {
  await connectDB();

  const chapter = await findOrCreateChapter();
  const topic = await findOrCreateTopic(chapter._id);

  let exam = await Exam.findOne({ title: 'الاختبار التجريبي (6 أسئلة)' });
  if (!exam) {
    let code = generateExamCode();
    while (await Exam.findOne({ code })) code = generateExamCode();
    exam = await Exam.create({
      title: 'الاختبار التجريبي (6 أسئلة)',
      description: 'اختبار نموذجي يحوي أسئلة متنوعة مع جميع أنواع التغذية الرجعية. أدّ الاختبار مرة واحدة فقط.',
      topic: topic._id,
      feedbackType: 'hint',
      attemptsPerQuestion: 3,
      isPublished: true,
      code,
      publishedAt: new Date(),
      createdBy: null,
    });
  }

  const existing = await Question.countDocuments({ exam: exam._id });
  if (existing === 0) {
    const docs = questions.map((q, i) => ({
      exam: exam._id,
      order: i,
      text: q.text,
      image: null,
      options: q.options,
    }));
    await Question.insertMany(docs);
    console.log(`أُنشئ الاختبار «${exam.title}» بالرمز ${exam.code} و${questions.length} أسئلة.`);
  } else {
    console.log(`الاختبار موجود مسبقًا بالرمز ${exam.code} و${existing} أسئلة — لم يتم تكرار البيانات.`);
  }

  await mongoose.disconnect();
  process.exit(0);
}

main().catch((err) => {
  console.error('خطأ:', err.message);
  process.exit(1);
});
