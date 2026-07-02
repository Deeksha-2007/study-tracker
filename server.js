const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/studytracker';

// Middleware Configuration
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Connect to MongoDB
mongoose.connect(MONGODB_URI)
  .then(() => console.log('Successfully connected to MongoDB database.'))
  .catch(err => console.error('Database connection failed:', err));

// Schema Option Configuration to guarantee 'id' maps cleanly from MongoDB '_id'
const baseSchemaOpts = {
  toJSON: { virtuals: true },
  toObject: { virtuals: true },
  timestamps: true
};

// Mongoose Models
const UserSettingsSchema = new mongoose.Schema({
  userName: { type: String, default: '' },
  theme: { type: String, default: 'lavender' },
  weeklyGoal: { type: Number, default: 20 },
  streak: { type: Number, default: 0 }
}, baseSchemaOpts);

const SubjectSchema = new mongoose.Schema({
  name: { type: String, required: true },
  color: { type: String, default: '#a78bfa' },
  topics: { type: [String], default: [] }
}, baseSchemaOpts);

const SessionSchema = new mongoose.Schema({
  subjectId: { type: mongoose.Schema.Types.ObjectId, ref: 'Subject', required: true },
  topic: { type: String, default: '' },
  timestamp: { type: Number, default: () => Date.now() },
  duration: { type: Number, required: true } // in seconds
}, baseSchemaOpts);

const TaskSchema = new mongoose.Schema({
  text: { type: String, required: true },
  subjectId: { type: mongoose.Schema.Types.ObjectId, ref: 'Subject', default: null },
  priority: { type: String, default: 'low' },
  completed: { type: Boolean, default: false },
  status: { type: String, default: 'Not Started' },
  dueDate: { type: String, default: '' },
  duration: { type: String, default: '45m' },
  dateAdded: { type: Number, default: () => Date.now() }
}, baseSchemaOpts);

const UserSettings = mongoose.model('UserSettings', UserSettingsSchema);
const Subject = mongoose.model('Subject', SubjectSchema);
const Session = mongoose.model('Session', SessionSchema);
const Task = mongoose.model('Task', TaskSchema);

// ==================== REST API ENDPOINTS ====================

// Retrieve unified system state
app.get('/api/state', async (req, res) => {
  try {
    const user = await UserSettings.findOne();
    if (!user || !user.userName) {
      return res.json({ setupRequired: true });
    }

    const subjects = await Subject.find();
    const sessions = await Session.find();
    const tasks = await Task.find();

    res.json({
      setupRequired: false,
      user,
      subjects,
      sessions,
      tasks
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Post onboarding transaction (Multi-Step Creation)
app.post('/api/onboard', async (req, res) => {
  try {
    const { userName, firstSubjectName, firstSubjectColor, firstSubjectTopics, weeklyGoal } = req.body;

    if (!userName) {
      return res.status(400).json({ error: 'Profile name parameter is required.' });
    }

    // Upsert User settings Document
    let user = await UserSettings.findOne();
    if (!user) {
      user = new UserSettings();
    }
    user.userName = userName;
    user.weeklyGoal = Number(weeklyGoal) || 20;
    user.streak = 0;
    user.theme = 'lavender';
    await user.save();

    // Create Initial Subject if provided
    let subject = null;
    if (firstSubjectName) {
      subject = new Subject({
        name: firstSubjectName,
        color: firstSubjectColor || '#a78bfa',
        topics: firstSubjectTopics || []
      });
      await subject.save();
    }

    res.status(201).json({ success: true, user, subject });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update profile parameters (theme, streak, goal, name)
app.put('/api/user/settings', async (req, res) => {
  try {
    let user = await UserSettings.findOne();
    if (!user) {
      user = new UserSettings();
    }
    
    const { userName, theme, weeklyGoal, streak } = req.body;
    if (userName !== undefined) user.userName = userName;
    if (theme !== undefined) user.theme = theme;
    if (weeklyGoal !== undefined) user.weeklyGoal = Number(weeklyGoal);
    if (streak !== undefined) user.streak = Number(streak);

    await user.save();
    res.json({ success: true, user });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// CRUD: Subjects
app.post('/api/subjects', async (req, res) => {
  try {
    const { name, color, topics } = req.body;
    const subject = new Subject({ name, color, topics });
    await subject.save();
    res.status(201).json(subject);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/subjects/:id', async (req, res) => {
  try {
    const subjectId = req.params.id;
    await Subject.findByIdAndDelete(subjectId);
    // Cascade deletions to maintain database integrity
    await Session.deleteMany({ subjectId });
    await Task.deleteMany({ subjectId });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// CRUD: Study Sessions
app.post('/api/sessions', async (req, res) => {
  try {
    const { subjectId, topic, timestamp, duration } = req.body;
    const session = new Session({ subjectId, topic, timestamp, duration });
    await session.save();

    // Increment profile streak for activity logs
    const user = await UserSettings.findOne();
    if (user) {
      user.streak = Math.min(30, user.streak + 1);
      await user.save();
    }

    res.status(201).json(session);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/sessions/:id', async (req, res) => {
  try {
    await Session.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// CRUD: Tasks
app.post('/api/tasks', async (req, res) => {
  try {
    const { text, subjectId, priority, completed, status, dueDate, duration } = req.body;
    const task = new Task({ text, subjectId: subjectId || null, priority, completed, status, dueDate, duration });
    await task.save();
    res.status(201).json(task);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/tasks/:id', async (req, res) => {
  try {
    const { text, completed, status, priority, dueDate, duration } = req.body;
    const updated = await Task.findByIdAndUpdate(
      req.params.id,
      { text, completed, status, priority, dueDate, duration },
      { new: true }
    );
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/tasks/:id', async (req, res) => {
  try {
    await Task.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Wipe and reset the entire database
app.post('/api/reset', async (req, res) => {
  try {
    await UserSettings.deleteMany({});
    await Subject.deleteMany({});
    await Session.deleteMany({});
    await Task.deleteMany({});
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Fallback to static client routing
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Server environment active on HTTP port ${PORT}`);
});