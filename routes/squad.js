const express = require('express');
const multer = require('multer');
const { matchSquad } = require('../services/geminiMatcher');

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { files: 13, fileSize: 12 * 1024 * 1024 },
  fileFilter(_req, file, callback) {
    if (!file.mimetype || !file.mimetype.toLowerCase().startsWith('image/')) {
      const error = new Error('Every upload must be an image file.');
      error.status = 400;
      return callback(error);
    }
    return callback(null, true);
  },
});

router.post('/register-squad', (req, res, next) => {
  upload.array('screenshots', 13)(req, res, async (error) => {
    if (error) {
      for (const file of req.files || []) file.buffer = null;
      req.files = null;
      const tooMany = error instanceof multer.MulterError && error.code === 'LIMIT_UNEXPECTED_FILE';
      const tooLarge = error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE';
      return res.status(400).json({
        error: tooMany
          ? 'Upload no more than 13 screenshots.'
          : tooLarge
            ? 'Each image must be 12 MB or smaller.'
            : error.message || 'The uploaded files could not be accepted.',
      });
    }

    const files = req.files || [];
    if (files.length < 1) return res.status(400).json({ error: 'Upload at least one screenshot.' });

    try {
      const squad = await matchSquad(files);
      return res.json(squad);
    } catch (matchError) {
      const status = matchError.status || 502;
      return res.status(status).json({ error: matchError.message || 'Squad matching failed.' });
    } finally {
      // Drop references as soon as processing finishes; Multer used RAM only.
      for (const file of files) file.buffer = null;
      req.files = null;
    }
  });
});

module.exports = router;
