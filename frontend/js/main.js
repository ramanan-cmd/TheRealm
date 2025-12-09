let token = localStorage.getItem('token');
let currentUser = JSON.parse(localStorage.getItem('user')) || null;
let currentProject = null;
let ws = null;
let allTasks = [];
let allProjects = [];

// Theme management
function initTheme() {
  const theme = localStorage.getItem('therealm-theme') || 'light';
  if (theme === 'dark') {
    document.body.classList.add('dark-mode');
  }
}

function toggleTheme() {
  document.body.classList.toggle('dark-mode');
  const theme = document.body.classList.contains('dark-mode') ? 'dark' : 'light';
  localStorage.setItem('therealm-theme', theme);
}

initTheme();

// API helper with auth
async function api(path, options = {}) {
  const opts = {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers
    }
  };

  if (token) {
    opts.headers['Authorization'] = `Bearer ${token}`;
  }

  const res = await fetch(path, opts);
  if (res.status === 401) {
    logout();
    return null;
  }

  return res.json();
}

// WebSocket connection
function connectWebSocket() {
  if (!token) return;

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${protocol}//${window.location.host}`);

  ws.onopen = () => {
    ws.send(JSON.stringify({ type: 'auth', token }));
  };

  ws.onmessage = (event) => {
    const message = JSON.parse(event.data);

    if (message.type === 'auth_success') {
      console.log('✓ Connected to real-time updates');
    }

    if (message.type === 'notification') {
      showNotification(message.data.content, 'info');
      updateNotifications();
    }

    if (message.type === 'task_created' || message.type === 'task_updated' || message.type === 'task_deleted') {
      if (currentProject && message.data.projectId === currentProject) {
        loadTasks();
      }
    }

    if (message.type === 'comment_added') {
      const taskDetailsModal = document.getElementById('taskDetailsModal');
      if (taskDetailsModal && taskDetailsModal.classList.contains('active')) {
        loadComments(message.data.taskId);
      }
    }
  };

  ws.onerror = (err) => {
    console.error('WebSocket error:', err);
  };

  setInterval(() => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'ping' }));
    }
  }, 30000);
}

// Notifications
function showNotification(message, type = 'info', title = '') {
  const notification = document.createElement('div');
  notification.className = `notification ${type}`;
  notification.innerHTML = `
    ${title ? `<div class="notification-title">${title}</div>` : ''}
    <div class="notification-message">${escapeHtml(message)}</div>
  `;
  document.body.appendChild(notification);

  setTimeout(() => {
    notification.remove();
  }, 4000);
}

async function updateNotifications() {
  if (!token) return;

  const notifications = await api('/api/notifications');
  const unreadCount = notifications.filter(n => !n.read).length;

  const badge = document.getElementById('notificationBadge');
  if (badge) {
    if (unreadCount > 0) {
      badge.classList.remove('hidden');
      badge.textContent = unreadCount;
    } else {
      badge.classList.add('hidden');
    }
  }
}

// Auth functions
async function register() {
  const name = document.getElementById('registerName').value;
  const email = document.getElementById('registerEmail').value;
  const password = document.getElementById('registerPassword').value;

  if (!name || !email || !password) {
    showNotification('All fields required', 'error', '⚠️ Missing Information');
    return;
  }

  if (password.length < 6) {
    showNotification('Password must be at least 6 characters', 'error', '⚠️ Weak Password');
    return;
  }

  const data = await api('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({ name, email, password })
  });

  if (data.token) {
    token = data.token;
    currentUser = data.user;
    localStorage.setItem('token', token);
    localStorage.setItem('user', JSON.stringify(currentUser));
    connectWebSocket();
    showNotification(`Welcome, ${name}!`, 'success', '🎉 Account Created');
    loadDashboard();
  } else {
    showNotification(data.error || 'Registration failed', 'error', '❌ Registration Failed');
  }
}

async function login() {
  const email = document.getElementById('loginEmail').value;
  const password = document.getElementById('loginPassword').value;

  if (!email || !password) {
    showNotification('Email and password required', 'error', '⚠️ Missing Fields');
    return;
  }

  const data = await api('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password })
  });

  if (data.token) {
    token = data.token;
    currentUser = data.user;
    localStorage.setItem('token', token);
    localStorage.setItem('user', JSON.stringify(currentUser));
    connectWebSocket();
    showNotification(`Welcome back, ${currentUser.name}!`, 'success', '👋 Welcome');
    loadDashboard();
  } else {
    showNotification(data.error || 'Login failed', 'error', '❌ Login Failed');
  }
}

function logout() {
  token = null;
  currentUser = null;
  localStorage.removeItem('token');
  localStorage.removeItem('user');
  if (ws) ws.close();
  loadAuth();
  showNotification('You have been logged out', 'info', '👋 See You Soon');
}

function loadAuth() {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="header">
      <div class="logo">📊 TheRealm</div>
      <div class="header-actions">
        <button class="theme-toggle" onclick="toggleTheme()">
          <div class="dot"></div>
        </button>
      </div>
    </div>

    <div class="auth-container">
      <div class="auth-form" id="loginForm">
        <div class="auth-title">🚀 TheRealm</div>
        <div class="auth-subtitle">Collaborative Task Management Platform</div>
        <div class="form-group">
          <label>Email Address</label>
          <input type="email" id="loginEmail" placeholder="you@example.com" autocomplete="email">
        </div>
        <div class="form-group">
          <label>Password</label>
          <input type="password" id="loginPassword" placeholder="••••••••" autocomplete="current-password">
        </div>
        <button class="btn primary lg" onclick="login()" style="width: 100%; margin-top: 1rem;">Sign In</button>
        <div class="divider"></div>
        <div class="auth-toggle">
          Don't have an account? <a onclick="toggleAuthForm()">Create one</a>
        </div>
      </div>

      <div class="auth-form" id="registerForm" style="display: none;">
        <div class="auth-title">🚀 TheRealm</div>
        <div class="auth-subtitle">Create Your Account</div>
        <div class="form-group">
          <label>Full Name</label>
          <input type="text" id="registerName" placeholder="John Doe" autocomplete="name">
        </div>
        <div class="form-group">
          <label>Email Address</label>
          <input type="email" id="registerEmail" placeholder="you@example.com" autocomplete="email">
        </div>
        <div class="form-group">
          <label>Password</label>
          <input type="password" id="registerPassword" placeholder="••••••••" autocomplete="new-password">
        </div>
        <button class="btn primary lg" onclick="register()" style="width: 100%; margin-top: 1rem;">Create Account</button>
        <div class="divider"></div>
        <div class="auth-toggle">
          Already have an account? <a onclick="toggleAuthForm()">Sign In</a>
        </div>
      </div>
    </div>
  `;
}

function toggleAuthForm() {
  document.getElementById('loginForm').style.display = 
    document.getElementById('loginForm').style.display === 'none' ? 'block' : 'none';
  document.getElementById('registerForm').style.display = 
    document.getElementById('registerForm').style.display === 'none' ? 'block' : 'none';
}

// === Menu Bar ===
function renderMenuBar() {
  return `<button class="menu-toggle-btn" onclick="showMenuDropdown()">☰</button>`;
}

function showMenuDropdown() {
  const menu = document.getElementById('menuDropdown');
  if (menu) menu.classList.toggle('show');
}

function toggleMenu() {
  const dropdown = document.getElementById('menuDropdown');
  dropdown.classList.toggle('active');
}

function handleCommandSearch(e) {
  if (e.key === 'Enter') {
    const val = e.target.value.trim();
    if (val) {
      showNotification(`Command: ${val}`, 'info', '🔍 Command Palette');
      // Add command handling logic here
    }
  }
}

// Dashboard
async function loadDashboard() {
  if (!token) {
    loadAuth();
    return;
  }

  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="header">
      <div class="header-left">
        <div class="logo">📊 TheRealm</div>
        <nav class="header-nav">
          <a onclick="loadProjectsView()">📁 Projects</a>
          <a onclick="loadActivityView()">📋 Activity</a>
          <a style="color:#fff;" onclick="openCollabWith()">🤝 Collab</a>
        </nav>
      </div>
      <div class="header-actions">
        ${renderMenuBar()}
        <button class="theme-toggle" onclick="toggleTheme()">
          <div class="dot"></div>
        </button>
        <button class="btn secondary sm" onclick="logout()">Logout</button>
      </div>
      <div class="menu-dropdown" id="menuDropdown">
        <a onclick="openSettings()">⚙️ Settings</a>
        <a onclick="openIssues()">🪲 Issues</a>
        <a onclick="loadProjectsView()">📁 Projects</a>
        <a onclick="openCodespaces()">💻 Codespaces</a>
        <a onclick="openNewRepository()">📦 New Repository</a>
        <a onclick="openNewCodespace()">🚀 New Codespace</a>
      </div>
    </div>
    <div class="container">
      <div id="mainContent"></div>
    </div>

    <div id="createProjectModal" class="modal">
      <div class="modal-content">
        <div class="modal-header">
          <div class="modal-title">📁 New Project</div>
          <button class="close-btn" onclick="closeModal('createProjectModal')">×</button>
        </div>
        <div class="form-group">
          <label>Project Name *</label>
          <input type="text" id="projectNameInput" placeholder="My awesome project" autofocus>
        </div>
        <div class="form-group">
          <label>Description</label>
          <textarea id="projectDescInput" placeholder="What's this project about?"></textarea>
        </div>
        <div class="form-group">
          <button class="btn primary" onclick="createProject()" style="width: 100%;">✨ Create Project</button>
        </div>
      </div>
    </div>

    <div id="taskDetailsModal" class="modal">
      <div class="modal-content" style="max-width: 700px;">
        <div class="modal-header">
          <div class="modal-title" id="taskDetailsTitle">Task Details</div>
          <button class="close-btn" onclick="closeModal('taskDetailsModal')">×</button>
        </div>
        <div id="taskDetailsContent"></div>
      </div>
    </div>

    <div id="addTaskModal" class="modal">
      <div class="modal-content">
        <div class="modal-header">
          <div class="modal-title">✏️ New Task</div>
          <button class="close-btn" onclick="closeModal('addTaskModal')">×</button>
        </div>
        <div class="form-group">
          <label>Task Title *</label>
          <input type="text" id="taskTitleInput" placeholder="What needs to be done?" autofocus>
        </div>
        <div class="form-group">
          <label>Description</label>
          <textarea id="taskDescInput" placeholder="Add more details..."></textarea>
        </div>
        <div class="grid-2">
          <div>
            <label>Priority</label>
            <select id="taskPrioritySelect">
              <option value="low">🔵 Low</option>
              <option value="medium" selected>🟡 Medium</option>
              <option value="high">🔴 High</option>
            </select>
          </div>
          <div>
            <label>Assign To</label>
            <select id="taskAssigneeSelect">
              <option value="">👤 Unassigned</option>
            </select>
          </div>
        </div>
        <button class="btn primary" onclick="createTask()" style="width: 100%;">🚀 Create Task</button>
      </div>
    </div>
  `;

  loadProjectsView();
  updateNotifications();
  connectWebSocket();
}

async function loadProjectsView() {
  const projects = await api('/api/projects');
  allProjects = projects;
  
  const mainContent = document.getElementById('mainContent');
  mainContent.innerHTML = `
    <div style="margin-bottom: 2rem;">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 2rem;">
        <div>
          <h1 style="font-size: 1.75rem; font-weight: 700; margin-bottom: 0.5rem;">📊 Your Projects</h1>
          <p style="color: var(--text-light);">Manage your team's work in one place</p>
        </div>
        <button class="btn primary lg" onclick="showModal('createProjectModal')">+ New Project</button>
      </div>

      ${projects.length === 0 ? `
        <div style="text-align: center; padding: 3rem; background-color: var(--surface); border-radius: var(--radius-md); border: 1px dashed var(--border);">
          <div style="font-size: 3rem; margin-bottom: 1rem;">📭</div>
          <p style="color: var(--text-light); margin-bottom: 1rem;">No projects yet. Start by creating one!</p>
          <button class="btn primary" onclick="showModal('createProjectModal')">Create Your First Project</button>
        </div>
      ` : `
        <div class="grid">
          ${projects.map(p => `
            <div class="card" style="cursor: pointer;" onclick="selectProject('${p.id}')">
              <div class="card-header" style="border: none; margin-bottom: 0;">
                <div>
                  <div class="card-title" style="margin: 0;">📁 ${escapeHtml(p.name)}</div>
                </div>
              </div>
              <p style="color: var(--text-light); margin-top: 0.75rem; line-height: 1.5;">${escapeHtml(p.description) || 'No description'}</p>
              <div style="margin-top: 1rem; padding-top: 1rem; border-top: 1px solid var(--border); display: flex; gap: 1rem; font-size: 0.85rem;">
                <span style="color: var(--text-light);">Created recently</span>
              </div>
            </div>
          `).join('')}
        </div>
      `}
    </div>
  `;
}

async function loadActivityView() {
  const mainContent = document.getElementById('mainContent');
  mainContent.innerHTML = `
    <div>
      <h1 style="font-size: 1.75rem; font-weight: 700; margin-bottom: 2rem;">📋 Activity Feed</h1>
      <div class="activity-feed">
        <div style="text-align: center; padding: 2rem; color: var(--text-light);">
          <div style="font-size: 2rem; margin-bottom: 1rem;">📭</div>
          <p>No activity yet</p>
        </div>
      </div>
    </div>
  `;
}

async function selectProject(projectId) {
  currentProject = projectId;
  const project = await api(`/api/projects/${projectId}`);
  
  const mainContent = document.getElementById('mainContent');
  
  mainContent.innerHTML = `
    <div>
      <div style="margin-bottom: 2rem;">
        <div style="display: flex; align-items: center; gap: 1rem; margin-bottom: 1rem;">
          <button class="btn ghost" onclick="loadProjectsView()">← Back</button>
          <span style="color: var(--text-light);">Projects</span>
        </div>
        <div style="display: flex; justify-content: space-between; align-items: start;">
          <div>
            <h1 style="font-size: 1.75rem; font-weight: 700; margin-bottom: 0.5rem;">📁 ${escapeHtml(project.name)}</h1>
            <p style="color: var(--text-light);">${escapeHtml(project.description)}</p>
          </div>
          <div class="btn-group">
            <button class="btn primary" onclick="showModal('addTaskModal')">+ Add Task</button>
            <button class="btn secondary" onclick="showProjectMembers()">👥 Members</button>
          </div>
        </div>
      </div>

      <div class="tab-buttons">
        <button class="tab-button active" onclick="switchView(event, 'board')">📊 Board</button>
        <button class="tab-button" onclick="switchView(event, 'list')">📝 List</button>
        <button class="tab-button" onclick="switchView(event, 'timeline')">📅 Timeline</button>
      </div>

      <div id="boardView" class="board"></div>
      <div id="listView" style="display: none;"></div>
      <div id="timelineView" style="display: none;"></div>
    </div>
  `;

  loadTasks();
  loadTaskMembers();
}

async function loadTasks() {
  const tasks = await api(`/api/projects/${currentProject}/tasks`);
  allTasks = tasks;
  
  const boardView = document.getElementById('boardView');
  const listView = document.getElementById('listView');
  const timelineView = document.getElementById('timelineView');

  // Board view
  const statuses = ['todo', 'in-progress', 'done'];
  const statusLabels = { 'todo': 'To Do', 'in-progress': 'In Progress', 'done': '✅ Done' };
  const statusIcons = { 'todo': '📋', 'in-progress': '⚡', 'done': '✅' };
  
  boardView.innerHTML = statuses.map(status => {
    const statusTasks = tasks.filter(t => t.status === status);
    return `
      <div class="board-column">
        <h3>
          ${statusIcons[status]} ${statusLabels[status]}
          <span class="board-column-count">${statusTasks.length}</span>
        </h3>
        <div class="board-cards">
          ${statusTasks.map(t => `
            <div class="board-card" onclick="openTaskDetails('${t.id}')">
              <div class="board-card-title">${escapeHtml(t.title)}</div>
              <div class="board-card-meta">
                <span class="badge badge-${t.priority}">${t.priority.toUpperCase()}</span>
                ${t.assigneeName ? `<span class="tag">${escapeHtml(t.assigneeName)}</span>` : ''}
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }).join('');

  // List view
  listView.innerHTML = `
    <div style="overflow-x: auto;">
      <table style="width: 100%; border-collapse: collapse;">
        <thead>
          <tr style="border-bottom: 2px solid var(--border); background-color: var(--surface-2);">
            <th style="padding: 1rem; text-align: left; color: var(--text); font-weight: 700;">Title</th>
            <th style="padding: 1rem; text-align: left; color: var(--text); font-weight: 700;">Status</th>
            <th style="padding: 1rem; text-align: left; color: var(--text); font-weight: 700;">Priority</th>
            <th style="padding: 1rem; text-align: left; color: var(--text); font-weight: 700;">Assignee</th>
            <th style="padding: 1rem; text-align: center; color: var(--text); font-weight: 700;">Actions</th>
          </tr>
        </thead>
        <tbody>
          ${tasks.map(t => `
            <tr style="border-bottom: 1px solid var(--border); hover-background: var(--surface-2);">
              <td style="padding: 1rem; color: var(--text);">${escapeHtml(t.title)}</td>
              <td style="padding: 1rem;"><span class="badge badge-${t.status}">${t.status.toUpperCase()}</span></td>
              <td style="padding: 1rem;"><span class="badge badge-${t.priority}">${t.priority.toUpperCase()}</span></td>
              <td style="padding: 1rem; color: var(--text);">${t.assigneeName ? `👤 ${escapeHtml(t.assigneeName)}` : '-'}</td>
              <td style="padding: 1rem; text-align: center;">
                <button class="btn ghost sm" onclick="openTaskDetails('${t.id}')">View</button>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;

  // Timeline view (placeholder)
  timelineView.innerHTML = `
    <div style="padding: 2rem; background-color: var(--surface); border-radius: var(--radius-md); text-align: center; color: var(--text-light);">
      📅 Timeline view coming soon...
    </div>
  `;
}

async function openTaskDetails(taskId) {
  const task = await api(`/api/tasks/${taskId}`);
  const modal = document.getElementById('taskDetailsModal');
  const content = document.getElementById('taskDetailsContent');

  const priorityEmoji = { 'low': '🔵', 'medium': '🟡', 'high': '🔴' };
  const statusEmoji = { 'todo': '📋', 'in-progress': '⚡', 'done': '✅' };

  content.innerHTML = `
    <div style="display: flex; gap: 2rem;">
      <div style="flex: 1;">
        <div class="form-group">
          <label>Title</label>
          <input type="text" id="detailTitle" value="${escapeHtml(task.title)}" placeholder="Task title">
        </div>
        <div class="form-group">
          <label>Description</label>
          <textarea id="detailDesc" placeholder="Add task description...">${escapeHtml(task.description)}</textarea>
        </div>
        <div class="grid-2">
          <div>
            <label>Status</label>
            <select id="detailStatus">
              <option value="todo" ${task.status === 'todo' ? 'selected' : ''}>📋 To Do</option>
              <option value="in-progress" ${task.status === 'in-progress' ? 'selected' : ''}>⚡ In Progress</option>
              <option value="done" ${task.status === 'done' ? 'selected' : ''}>✅ Done</option>
            </select>
          </div>
          <div>
            <label>Priority</label>
            <select id="detailPriority">
              <option value="low" ${task.priority === 'low' ? 'selected' : ''}>🔵 Low</option>
              <option value="medium" ${task.priority === 'medium' ? 'selected' : ''}>🟡 Medium</option>
              <option value="high" ${task.priority === 'high' ? 'selected' : ''}>🔴 High</option>
            </select>
          </div>
        </div>
        <div class="form-group">
          <button class="btn primary" onclick="updateTask('${taskId}')" style="width: 100%;">💾 Save Changes</button>
          <button class="btn danger" onclick="deleteTask('${taskId}')" style="width: 100%; margin-top: 0.5rem;">🗑️ Delete Task</button>
        </div>
      </div>
    </div>

    <div class="comments-section">
      <h4>💬 Comments</h4>
      <div id="commentsList" style="margin-bottom: 1.5rem; max-height: 300px; overflow-y: auto;"></div>
      <div style="display: flex; gap: 0.5rem;">
        <input type="text" id="commentInput" placeholder="Add a comment..." style="flex: 1;">
        <button class="btn primary sm" onclick="addComment('${taskId}')">Post</button>
      </div>
    </div>
  `;

  modal.classList.add('active');
  loadComments(taskId);
}

async function loadComments(taskId) {
  const comments = await api(`/api/tasks/${taskId}/comments`);
  const list = document.getElementById('commentsList');
  
  if (comments.length === 0) {
    list.innerHTML = '<p style="color: var(--text-light); text-align: center; padding: 1rem;">No comments yet</p>';
    return;
  }

  list.innerHTML = comments.map(c => `
    <div class="comment">
      <div>
        <span class="comment-author">👤 ${escapeHtml(c.name)}</span>
        <span class="comment-time">${new Date(c.createdAt).toLocaleString()}</span>
      </div>
      <div class="comment-content">${escapeHtml(c.content)}</div>
    </div>
  `).join('');
}

async function addComment(taskId) {
  const content = document.getElementById('commentInput').value;
  if (!content.trim()) return;

  await api(`/api/tasks/${taskId}/comments`, {
    method: 'POST',
    body: JSON.stringify({ content })
  });

  document.getElementById('commentInput').value = '';
  loadComments(taskId);
  showNotification('Comment added', 'success', '✅ Success');
}

async function updateTask(taskId) {
  const title = document.getElementById('detailTitle').value;
  const description = document.getElementById('detailDesc').value;
  const status = document.getElementById('detailStatus').value;
  const priority = document.getElementById('detailPriority').value;

  if (!title.trim()) {
    showNotification('Title is required', 'error', '⚠️ Missing Field');
    return;
  }

  const result = await api(`/api/tasks/${taskId}`, {
    method: 'PUT',
    body: JSON.stringify({ title, description, status, priority })
  });

  if (result && result.id) {
    showNotification('Task updated successfully', 'success', '✅ Updated');
    loadTasks();
    closeModal('taskDetailsModal');
  }
}

async function deleteTask(taskId) {
  if (!confirm('🗑️ Are you sure you want to delete this task?')) return;

  await api(`/api/tasks/${taskId}`, { method: 'DELETE' });
  showNotification('Task deleted', 'success', '✅ Deleted');
  loadTasks();
  closeModal('taskDetailsModal');
}

async function showProjectMembers() {
  const members = await api(`/api/projects/${currentProject}/members`);
  
  const mainContent = document.getElementById('mainContent');
  const currentContent = mainContent.innerHTML;
  
  mainContent.innerHTML = `
    <div>
      <div style="margin-bottom: 2rem;">
        <button class="btn ghost" onclick="scrollBack()" style="margin-bottom: 1rem;">← Back</button>
        <h1 style="font-size: 1.75rem; font-weight: 700;">👥 Team Members</h1>
      </div>

      <div class="grid-2">
        ${members.map(m => `
          <div class="member-card">
            <div class="member-avatar" style="width: 48px; height: 48px; font-size: 1rem; margin: 0 auto;">
              ${m.name.substring(0, 1).toUpperCase()}
            </div>
            <div class="member-name">${escapeHtml(m.name)}</div>
            <div class="member-role">${m.role}</div>
            <div style="color: var(--text-lighter); font-size: 0.8rem; margin-top: 0.5rem;">${escapeHtml(m.email)}</div>
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

async function loadTaskMembers() {
  const members = await api(`/api/projects/${currentProject}/members`);
  const select = document.getElementById('taskAssigneeSelect');
  if (select) {
    select.innerHTML = '<option value="">👤 Unassigned</option>' + 
      members.map(m => `<option value="${m.id}">${escapeHtml(m.name)}</option>`).join('');
  }
}

async function createProject() {
  const name = document.getElementById('projectNameInput').value;
  const description = document.getElementById('projectDescInput').value;

  if (!name.trim()) {
    showNotification('Project name is required', 'error', '⚠️ Missing Name');
    return;
  }

  const result = await api('/api/projects', {
    method: 'POST',
    body: JSON.stringify({ name, description })
  });

  if (result && result.id) {
    showNotification('Project created successfully', 'success', '✅ Created');
    closeModal('createProjectModal');
    loadProjectsView();
    selectProject(result.id);
  }
}

async function createTask() {
  const title = document.getElementById('taskTitleInput').value;
  const description = document.getElementById('taskDescInput').value;
  const priority = document.getElementById('taskPrioritySelect').value;
  const assigneeId = document.getElementById('taskAssigneeSelect').value;

  if (!title.trim()) {
    showNotification('Task title is required', 'error', '⚠️ Missing Title');
    return;
  }

  const result = await api(`/api/projects/${currentProject}/tasks`, {
    method: 'POST',
    body: JSON.stringify({ title, description, priority, assigneeId: assigneeId || null })
  });

  if (result && result.id) {
    showNotification('Task created successfully', 'success', '✅ Created');
    closeModal('addTaskModal');
    loadTasks();
    document.getElementById('taskTitleInput').value = '';
    document.getElementById('taskDescInput').value = '';
  }
}

function switchView(event, view) {
  document.getElementById('boardView').style.display = view === 'board' ? 'grid' : 'none';
  document.getElementById('listView').style.display = view === 'list' ? 'block' : 'none';
  document.getElementById('timelineView').style.display = view === 'timeline' ? 'block' : 'none';
  
  document.querySelectorAll('.tab-button').forEach(btn => btn.classList.remove('active'));
  event.currentTarget.classList.add('active');
}

function closeModal(modalId) {
  document.getElementById(modalId).classList.remove('active');
}

function showModal(modalId) {
  document.getElementById(modalId).classList.add('active');
}

function showNotificationPanel() {
  alert('🔔 Notification Center\n\nYou have new updates in your projects. Check back soon!');
}

function showTeam() {
  alert(`👤 ${escapeHtml(currentUser.name)}\n✉️ ${escapeHtml(currentUser.email)}`);
}

function scrollBack() {
  loadProjectsView();
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Load dashboard on page load
// === Horizontal Menu Button Handlers ===
function openSettings() {
  const mainContent = document.getElementById('mainContent');
  mainContent.innerHTML = `
    <div style="padding:2rem;">
      <h1 style="font-size:1.5rem;">⚙️ Settings</h1>
      <p>Update your profile, theme, and notification preferences here.</p>
      <div style="margin-top:2rem;">
        <button class="btn" onclick="showTeam()">Show My Profile</button>
        <button class="btn" onclick="toggleTheme()">Toggle Theme</button>
      </div>
    </div>
  `;
}

function openIssues() {
  const mainContent = document.getElementById('mainContent');
  mainContent.innerHTML = `
    <div style="padding:2rem;">
      <h1 style="font-size:1.5rem;">🪲 Issues</h1>
      <p>Track bugs and feature requests for your projects.</p>
      <div style="margin-top:2rem;">
        <button class="btn primary" onclick="alert('Create new issue (coming soon)')">+ New Issue</button>
      </div>
      <div style="margin-top:2rem; color:var(--text-light);">No issues yet.</div>
    </div>
  `;
}

function openCodespaces() {
  const mainContent = document.getElementById('mainContent');
  mainContent.innerHTML = `
    <div style="padding:2rem;">
      <h1 style="font-size:1.5rem;">💻 Codespaces</h1>
      <p>Manage your development environments.</p>
      <div style="margin-top:2rem; color:var(--text-light);">No codespaces available. (Feature coming soon)</div>
    </div>
  `;
}

function openNewRepository() {
  const mainContent = document.getElementById('mainContent');
  mainContent.innerHTML = `
    <div style="padding:2rem;">
      <h1 style="font-size:1.5rem;">📦 New Repository</h1>
      <p>Create a new code repository for your team.</p>
      <div style="margin-top:2rem;">
        <input type="text" id="newRepoName" placeholder="Repository name" style="padding:0.5rem; width:200px;">
        <button class="btn primary" onclick="alert('Repository creation coming soon')">Create</button>
      </div>
    </div>
  `;
}

function openNewCodespace() {
  const mainContent = document.getElementById('mainContent');
  mainContent.innerHTML = `
    <div style="padding:2rem;">
      <h1 style="font-size:1.5rem;">🚀 New Codespace</h1>
      <p>Spin up a new development environment instantly.</p>
      <div style="margin-top:2rem;">
        <input type="text" id="newCodespaceName" placeholder="Codespace name" style="padding:0.5rem; width:200px;">
        <button class="btn primary" onclick="alert('Codespace creation coming soon')">Create</button>
      </div>
    </div>
  `;
}

// === Collaboration ===
function openCollabWith() {
  const mainContent = document.getElementById('mainContent');
  mainContent.innerHTML = `
    <div style="padding:2rem; max-width:600px;">
      <h1 style="font-size:1.75rem; font-weight:700; margin-bottom:1rem;">🤝 Collaborate</h1>
      <p style="color:var(--text-light); margin-bottom:2rem;">Invite collaborators to work with you on projects.</p>
      
      <div style="background-color:var(--surface); border-radius:var(--radius-md); padding:2rem; border:1px solid var(--border);">
        <div class="form-group">
          <label style="font-weight:600;">Collaborator Username</label>
          <input type="text" id="collabUsername" placeholder="Enter username to invite" style="padding:0.75rem; width:100%; border:1px solid var(--border); border-radius:var(--radius-md); background-color:var(--bg); color:var(--text);">
        </div>
        
        <div class="form-group">
          <label style="font-weight:600;">Repository Clone Link</label>
          <textarea id="collabRepoLink" placeholder="Paste the repository clone link (HTTPS or SSH)" style="padding:0.75rem; width:100%; height:80px; border:1px solid var(--border); border-radius:var(--radius-md); background-color:var(--bg); color:var(--text); font-family:monospace; font-size:0.85rem;"></textarea>
        </div>
        
        <div class="form-group">
          <label style="font-weight:600;">Access Level</label>
          <select id="collabAccessLevel" style="padding:0.75rem; width:100%; border:1px solid var(--border); border-radius:var(--radius-md); background-color:var(--bg); color:var(--text);">
            <option value="view">👁️ View Only</option>
            <option value="comment" selected>💬 Comment</option>
            <option value="edit">✏️ Edit</option>
            <option value="admin">👨‍💼 Admin</option>
          </select>
        </div>
        
        <div class="form-group">
          <label style="font-weight:600;">Message</label>
          <textarea id="collabMessage" placeholder="Add a personal message..." style="padding:0.75rem; width:100%; height:60px; border:1px solid var(--border); border-radius:var(--radius-md); background-color:var(--bg); color:var(--text);"></textarea>
        </div>
        
        <button class="btn primary" onclick="sendCollabInvite()" style="width:100%; margin-top:1rem;">📤 Send Collaboration Invite</button>
      </div>
      
      <div style="margin-top:2rem;">
        <h3 style="margin-bottom:1rem;">📋 Active Collaborations</h3>
        <div id="activeCollabs" style="color:var(--text-light); text-align:center; padding:1rem;">Loading collaborations...</div>
      </div>
    </div>
  `;
  loadActiveCollaborations();
}

function sendCollabInvite() {
  const username = document.getElementById('collabUsername').value.trim();
  const repoLink = document.getElementById('collabRepoLink').value.trim();
  const accessLevel = document.getElementById('collabAccessLevel').value;
  const message = document.getElementById('collabMessage').value.trim();
  
  if (!username) {
    showNotification('Please enter a username', 'error', '⚠️ Missing Username');
    return;
  }
  
  if (!repoLink) {
    showNotification('Please provide a repository link', 'error', '⚠️ Missing Repository Link');
    return;
  }
  
  // Clear form
  document.getElementById('collabUsername').value = '';
  document.getElementById('collabRepoLink').value = '';
  document.getElementById('collabMessage').value = '';
  
  showNotification(`Collaboration invite sent to ${username} with ${accessLevel} access!`, 'success', '✅ Invite Sent');
  loadActiveCollaborations();
}

function loadActiveCollaborations() {
  const collabsDiv = document.getElementById('activeCollabs');
  if (!collabsDiv) return;
  
  // Mock data - in production, fetch from API
  const activeCollabs = [
    { username: 'alice_dev', accessLevel: 'Edit', status: 'Active' },
    { username: 'bob_code', accessLevel: 'Comment', status: 'Pending' }
  ];
  
  if (activeCollabs.length === 0) {
    collabsDiv.innerHTML = '<p style="color:var(--text-light);">No active collaborations yet.</p>';
    return;
  }
  
  collabsDiv.innerHTML = activeCollabs.map(c => `
    <div style="background-color:var(--surface); padding:1rem; border-radius:var(--radius-md); margin-bottom:0.75rem; text-align:left; border:1px solid var(--border);">
      <div style="display:flex; justify-content:space-between; align-items:center;">
        <div>
          <div style="font-weight:600; color:var(--text);">👤 ${escapeHtml(c.username)}</div>
          <div style="font-size:0.85rem; color:var(--text-lighter);">${c.accessLevel} access • ${c.status}</div>
        </div>
        <button class="btn ghost sm" onclick="alert('Remove collaboration')">Remove</button>
      </div>
    </div>
  `).join('');
}

document.addEventListener('DOMContentLoaded', () => {
  if (token) {
    loadDashboard();
  } else {
    loadAuth();
  }
});
