const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const sqlite3 = require('sqlite3').verbose();
const bcryptjs = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');
const { randomUUID } = require('crypto');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const JWT_SECRET = 'your-secret-key-change-in-production';
const DB_PATH = path.join(__dirname, 'therealm.db');

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, '../frontend')));

// Database setup
const db = new sqlite3.Database(DB_PATH, (err) => {
  if (err) console.error('Database error:', err);
  else console.log('Connected to SQLite database');
});

// Promisify database operations
const dbRun = (sql, params = []) => new Promise((resolve, reject) => {
  db.run(sql, params, function(err) {
    if (err) reject(err);
    else resolve(this);
  });
});

const dbGet = (sql, params = []) => new Promise((resolve, reject) => {
  db.get(sql, params, (err, row) => {
    if (err) reject(err);
    else resolve(row);
  });
});

const dbAll = (sql, params = []) => new Promise((resolve, reject) => {
  db.all(sql, params, (err, rows) => {
    if (err) reject(err);
    else resolve(rows || []);
  });
});

// Initialize database tables
async function initDB() {
  try {
    await dbRun(`CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      avatar TEXT DEFAULT '',
      createdAt INTEGER
    )`);

    await dbRun(`CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      ownerId TEXT NOT NULL,
      createdAt INTEGER,
      FOREIGN KEY(ownerId) REFERENCES users(id)
    )`);

    await dbRun(`CREATE TABLE IF NOT EXISTS project_members (
      id TEXT PRIMARY KEY,
      projectId TEXT NOT NULL,
      userId TEXT NOT NULL,
      role TEXT DEFAULT 'member',
      joinedAt INTEGER,
      UNIQUE(projectId, userId),
      FOREIGN KEY(projectId) REFERENCES projects(id),
      FOREIGN KEY(userId) REFERENCES users(id)
    )`);

    await dbRun(`CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      projectId TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT DEFAULT '',
      status TEXT DEFAULT 'todo',
      priority TEXT DEFAULT 'medium',
      assigneeId TEXT,
      createdBy TEXT NOT NULL,
      createdAt INTEGER,
      dueDate INTEGER,
      FOREIGN KEY(projectId) REFERENCES projects(id),
      FOREIGN KEY(assigneeId) REFERENCES users(id),
      FOREIGN KEY(createdBy) REFERENCES users(id)
    )`);

    await dbRun(`CREATE TABLE IF NOT EXISTS comments (
      id TEXT PRIMARY KEY,
      taskId TEXT NOT NULL,
      userId TEXT NOT NULL,
      content TEXT NOT NULL,
      createdAt INTEGER,
      FOREIGN KEY(taskId) REFERENCES tasks(id),
      FOREIGN KEY(userId) REFERENCES users(id)
    )`);

    await dbRun(`CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      userId TEXT NOT NULL,
      type TEXT NOT NULL,
      content TEXT NOT NULL,
      projectId TEXT,
      taskId TEXT,
      read INTEGER DEFAULT 0,
      createdAt INTEGER,
      FOREIGN KEY(userId) REFERENCES users(id)
    )`);

    console.log('Database tables initialized');
  } catch (err) {
    console.error('Database initialization error:', err);
  }
}

initDB();

// Auth middleware
const authenticate = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token' });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.userId = decoded.id;
    next();
  } catch (err) {
    res.status(401).json({ error: 'Invalid token' });
  }
};

// ===== AUTH ENDPOINTS =====

app.post('/api/auth/register', async (req, res) => {
  try {
    const { name, email, password } = req.body;
    if (!name || !email || !password) {
      return res.status(400).json({ error: 'Missing fields' });
    }

    const id = randomUUID();
    const hashedPw = bcryptjs.hashSync(password, 10);
    
    await dbRun(
      'INSERT INTO users (id, name, email, password, createdAt) VALUES (?, ?, ?, ?, ?)',
      [id, name, email, hashedPw, Date.now()]
    );

    const token = jwt.sign({ id }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, user: { id, name, email } });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await dbGet('SELECT * FROM users WHERE email = ?', [email]);

    if (!user || !bcryptjs.compareSync(password, user.password)) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = jwt.sign({ id: user.id }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, user: { id: user.id, name: user.name, email: user.email } });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/me', authenticate, async (req, res) => {
  try {
    const user = await dbGet('SELECT id, name, email, avatar FROM users WHERE id = ?', [req.userId]);
    res.json(user);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ===== PROJECT ENDPOINTS =====

app.post('/api/projects', authenticate, async (req, res) => {
  try {
    const { name, description } = req.body;
    const id = randomUUID();

    await dbRun(
      'INSERT INTO projects (id, name, description, ownerId, createdAt) VALUES (?, ?, ?, ?, ?)',
      [id, name, description || '', req.userId, Date.now()]
    );

    // Add owner as member
    await dbRun(
      'INSERT INTO project_members (id, projectId, userId, role, joinedAt) VALUES (?, ?, ?, ?, ?)',
      [randomUUID(), id, req.userId, 'owner', Date.now()]
    );

    broadcastNotification({
      userId: req.userId,
      type: 'project_created',
      content: `You created project "${name}"`,
      projectId: id
    });

    res.json({ id, name, description, ownerId: req.userId });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/projects', authenticate, async (req, res) => {
  try {
    const projects = await dbAll(
      `SELECT p.* FROM projects p 
       JOIN project_members pm ON p.id = pm.projectId 
       WHERE pm.userId = ? ORDER BY p.createdAt DESC`,
      [req.userId]
    );
    res.json(projects);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/projects/:projectId', authenticate, async (req, res) => {
  try {
    const project = await dbGet('SELECT * FROM projects WHERE id = ?', [req.params.projectId]);
    if (!project) return res.status(404).json({ error: 'Project not found' });

    // Check if user is member
    const member = await dbGet(
      'SELECT * FROM project_members WHERE projectId = ? AND userId = ?',
      [req.params.projectId, req.userId]
    );
    if (!member) return res.status(403).json({ error: 'Not a member' });

    res.json(project);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/projects/:projectId/members', authenticate, async (req, res) => {
  try {
    const { userId } = req.body;
    const project = await dbGet('SELECT * FROM projects WHERE id = ?', [req.params.projectId]);
    
    if (!project) return res.status(404).json({ error: 'Project not found' });
    if (project.ownerId !== req.userId) return res.status(403).json({ error: 'Only owner can add members' });

    const id = randomUUID();
    await dbRun(
      'INSERT INTO project_members (id, projectId, userId, role, joinedAt) VALUES (?, ?, ?, ?, ?)',
      [id, req.params.projectId, userId, 'member', Date.now()]
    );

    broadcastNotification({
      userId: userId,
      type: 'added_to_project',
      content: `Added to project "${project.name}"`,
      projectId: req.params.projectId
    });

    res.json({ id, projectId: req.params.projectId, userId, role: 'member' });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/projects/:projectId/members', authenticate, async (req, res) => {
  try {
    const members = await dbAll(
      `SELECT u.id, u.name, u.email, u.avatar, pm.role, pm.joinedAt 
       FROM project_members pm
       JOIN users u ON pm.userId = u.id
       WHERE pm.projectId = ?`,
      [req.params.projectId]
    );
    res.json(members);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ===== TASK ENDPOINTS =====

app.post('/api/projects/:projectId/tasks', authenticate, async (req, res) => {
  try {
    const { title, description, priority, assigneeId, dueDate } = req.body;
    const id = randomUUID();

    await dbRun(
      `INSERT INTO tasks (id, projectId, title, description, priority, assigneeId, createdBy, createdAt, dueDate)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, req.params.projectId, title, description || '', priority || 'medium', assigneeId, req.userId, Date.now(), dueDate]
    );

    const task = await dbGet('SELECT * FROM tasks WHERE id = ?', [id]);
    
    // Broadcast to project members
    const members = await dbAll(
      'SELECT userId FROM project_members WHERE projectId = ?',
      [req.params.projectId]
    );

    members.forEach(m => {
      broadcastNotification({
        userId: m.userId,
        type: 'task_created',
        content: `New task: "${title}"`,
        projectId: req.params.projectId,
        taskId: id
      });
    });

    broadcastEvent('task_created', { projectId: req.params.projectId, task });
    res.json(task);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/projects/:projectId/tasks', authenticate, async (req, res) => {
  try {
    const tasks = await dbAll(
      `SELECT t.*, u.name as assigneeName FROM tasks t
       LEFT JOIN users u ON t.assigneeId = u.id
       WHERE t.projectId = ? ORDER BY t.createdAt DESC`,
      [req.params.projectId]
    );
    res.json(tasks);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/tasks/:taskId', authenticate, async (req, res) => {
  try {
    const task = await dbGet(
      `SELECT t.*, u.name as assigneeName FROM tasks t
       LEFT JOIN users u ON t.assigneeId = u.id
       WHERE t.id = ?`,
      [req.params.taskId]
    );
    if (!task) return res.status(404).json({ error: 'Task not found' });
    res.json(task);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.put('/api/tasks/:taskId', authenticate, async (req, res) => {
  try {
    const { title, description, status, priority, assigneeId, dueDate } = req.body;
    const task = await dbGet('SELECT * FROM tasks WHERE id = ?', [req.params.taskId]);
    
    if (!task) return res.status(404).json({ error: 'Task not found' });

    await dbRun(
      `UPDATE tasks SET title = ?, description = ?, status = ?, priority = ?, assigneeId = ?, dueDate = ?
       WHERE id = ?`,
      [title || task.title, description !== undefined ? description : task.description, status || task.status, priority || task.priority, assigneeId || task.assigneeId, dueDate || task.dueDate, req.params.taskId]
    );

    const updated = await dbGet('SELECT * FROM tasks WHERE id = ?', [req.params.taskId]);
    broadcastEvent('task_updated', { projectId: task.projectId, task: updated });
    res.json(updated);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete('/api/tasks/:taskId', authenticate, async (req, res) => {
  try {
    const task = await dbGet('SELECT * FROM tasks WHERE id = ?', [req.params.taskId]);
    if (!task) return res.status(404).json({ error: 'Task not found' });

    await dbRun('DELETE FROM tasks WHERE id = ?', [req.params.taskId]);
    broadcastEvent('task_deleted', { projectId: task.projectId, taskId: req.params.taskId });
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ===== COMMENT ENDPOINTS =====

app.post('/api/tasks/:taskId/comments', authenticate, async (req, res) => {
  try {
    const { content } = req.body;
    const id = randomUUID();

    await dbRun(
      'INSERT INTO comments (id, taskId, userId, content, createdAt) VALUES (?, ?, ?, ?, ?)',
      [id, req.params.taskId, req.userId, content, Date.now()]
    );

    const comment = await dbGet(
      `SELECT c.*, u.name FROM comments c
       JOIN users u ON c.userId = u.id
       WHERE c.id = ?`,
      [id]
    );

    const task = await dbGet('SELECT projectId FROM tasks WHERE id = ?', [req.params.taskId]);
    broadcastEvent('comment_added', { projectId: task.projectId, taskId: req.params.taskId, comment });

    res.json(comment);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/tasks/:taskId/comments', authenticate, async (req, res) => {
  try {
    const comments = await dbAll(
      `SELECT c.*, u.name FROM comments c
       JOIN users u ON c.userId = u.id
       WHERE c.taskId = ? ORDER BY c.createdAt ASC`,
      [req.params.taskId]
    );
    res.json(comments);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ===== NOTIFICATION ENDPOINTS =====

app.get('/api/notifications', authenticate, async (req, res) => {
  try {
    const notifications = await dbAll(
      'SELECT * FROM notifications WHERE userId = ? ORDER BY createdAt DESC LIMIT 20',
      [req.userId]
    );
    res.json(notifications);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.put('/api/notifications/:notificationId/read', authenticate, async (req, res) => {
  try {
    await dbRun('UPDATE notifications SET read = 1 WHERE id = ?', [req.params.notificationId]);
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ===== WEBSOCKET & REAL-TIME =====

// Map to track WebSocket connections per user
const userConnections = new Map();

wss.on('connection', (ws) => {
  let userId = null;

  ws.on('message', async (data) => {
    try {
      const message = JSON.parse(data);

      if (message.type === 'auth') {
        const token = message.token;
        const decoded = jwt.verify(token, JWT_SECRET);
        userId = decoded.id;

        if (!userConnections.has(userId)) {
          userConnections.set(userId, []);
        }
        userConnections.get(userId).push(ws);

        ws.send(JSON.stringify({ type: 'auth_success' }));
      }

      if (message.type === 'ping') {
        ws.send(JSON.stringify({ type: 'pong' }));
      }
    } catch (err) {
      console.error('WebSocket error:', err);
    }
  });

  ws.on('close', () => {
    if (userId && userConnections.has(userId)) {
      const connections = userConnections.get(userId);
      const index = connections.indexOf(ws);
      if (index > -1) connections.splice(index, 1);
      if (connections.length === 0) userConnections.delete(userId);
    }
  });
});

// Helper to broadcast events to all users in a project
async function broadcastEvent(eventType, data) {
  const projectId = data.projectId;
  const members = await dbAll(
    'SELECT userId FROM project_members WHERE projectId = ?',
    [projectId]
  );

  const message = JSON.stringify({ type: eventType, data });
  members.forEach(m => {
    if (userConnections.has(m.userId)) {
      userConnections.get(m.userId).forEach(ws => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(message);
        }
      });
    }
  });
}

// Helper to send notifications to specific user
async function broadcastNotification(notification) {
  const id = randomUUID();
  await dbRun(
    'INSERT INTO notifications (id, userId, type, content, projectId, taskId, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [id, notification.userId, notification.type, notification.content, notification.projectId || null, notification.taskId || null, Date.now()]
  );

  const message = JSON.stringify({
    type: 'notification',
    data: { id, ...notification, createdAt: Date.now() }
  });

  if (userConnections.has(notification.userId)) {
    userConnections.get(notification.userId).forEach(ws => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(message);
      }
    });
  }
}

// Start server
server.listen(3000, () => {
  console.log('Server running on http://localhost:3000');
});
