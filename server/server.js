const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const cors = require('cors');

const app = express();
const PORT = 8080;
const rootDir = path.join(__dirname, 'projects');

if (!fs.existsSync(rootDir)) {
  fs.mkdirSync(rootDir, { recursive: true });
}

const upload = multer({ storage: multer.memoryStorage() });

function writeToFile(buffer, filePath) {
  fs.writeFileSync(filePath, buffer);
}

app.use(cors());

app.get('/message', (_, res) => res.send('Hello from express!'));
app.post(
  '/create-dl-repair-project',
  upload.fields([
    { name: 'ontology_file', maxCount: 1 },
    { name: 'interested_axioms_file', maxCount: 1 },
    { name: 'defect_file', maxCount: 1 },
  ]),
  (req, res) => {
    const projectID = req.params.project_id || 'test';
    let output = '';

    try {
      const projectPath = path.join(rootDir, projectID);
      if (fs.existsSync(projectPath)) {
        fs.rmdir(projectPath);
      }

      fs.mkdirSync(projectPath);
      fs.mkdirSync(path.join(projectPath, 'ontology'));
      fs.mkdirSync(path.join(projectPath, 'decision-tree'));

      function upload(fieldName, subDir = 'ontology') {
        const file = req.files[fieldName]?.[0];
        if (file) {
          const filePath = path.join(projectPath, subDir, file.originalname);
          writeToFile(file.buffer, filePath);
          output += `${fieldName} uploaded to ${filePath}\n`;
        }
      }

      upload('ontology_file');
      upload('interested_axioms_file');
      upload('defect_file');

      return res.status(200).send(output);
    } catch (err) {
      console.error(err);
      return res.status(500).send(err.message || 'Internal Server Error');
    }
  },
);

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
