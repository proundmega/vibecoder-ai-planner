const multer = require('multer');
const path = require('path');
const fs = require('fs');

const uploadDir = path.join(__dirname, '../../uploads/tickets');

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const ticketId = req.params.ticketId;
    const dir = path.join(uploadDir, String(ticketId));
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}-${file.originalname}`);
  },
});

const fileFilter = (req, file, cb) => {
  const allowed = [
    'image/png', 'image/jpeg', 'image/gif', 'image/webp',
    'application/pdf', 'text/markdown', 'text/plain',
    'application/zip', 'application/json',
  ];
  if (allowed.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('File type not allowed: ' + file.mimetype), false);
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 10 * 1024 * 1024,
    files: 10,
  },
});

module.exports = upload;
