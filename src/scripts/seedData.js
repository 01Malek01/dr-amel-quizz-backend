require("dotenv").config({
  path: require("path").join(__dirname, "..", "..", ".env"),
});

const User = require("../models/User");

const seedData = async () => {
  try {
    const email = (
      process.env.ADMIN_EMAIL || "admin@dramel-quizzes.com"
    ).toLowerCase();
    const exists = await User.findOne({ email });

    if (!exists) {
      await User.create({
        name: process.env.ADMIN_NAME || "",
        username: (process.env.ADMIN_USERNAME || "admin").toLowerCase(),
        email,
        password: process.env.ADMIN_PASSWORD || "admin123",
        role: "admin",
      });
      console.log(
        "تم إنشاء حساب المسؤول. الدخول:",
        email,
        "| كلمة المرور من .env (الافتراضية: admin123)",
      );
    }
  } catch (error) {
    console.error("تحذير من البذر:", error.message);
  }
};

module.exports = seedData;

if (require.main === module) {
  const mongoose = require("mongoose");
  const connectDB = require("../config/db");
  (async () => {
    await connectDB();
    await seedData();
    await mongoose.disconnect();
    process.exit(0);
  })();
}
