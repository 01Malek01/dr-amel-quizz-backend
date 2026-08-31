const express = require('express');
const upload = require('../middleware/upload');
const { protect, adminOnly } = require('../middleware/auth');

const router = express.Router();

router.post('/', protect, adminOnly, upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ success: false, message: 'لم يتم رفع أي ملف' });
  }
  res.json({ success: true, url: `/uploads/${req.file.filename}` });
});

module.exports = router;