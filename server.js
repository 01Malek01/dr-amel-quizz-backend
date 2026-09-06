require('dotenv').config();

const connectDB = require('./src/config/db');
const seedData = require('./src/scripts/seedData');
const app = require('./src/app');
const { startScheduledWindowWatcher } = require('./src/services/normalExam.service');

const PORT = process.env.PORT || 5007;

(async () => {
  await connectDB();
  await seedData();
  startScheduledWindowWatcher();
  app.listen(PORT, () => {
    console.log(`API listening on http://localhost:${PORT}`);
  });
})();