const express = require('express');
const path = require('path');
const fs = require('fs');
const initSqlJs = require('sql.js');
const multer = require('multer');
const bcrypt = require('bcryptjs');
const session = require('express-session');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = process.env.PORT || 3000;

let db;
const DB_DIR = process.env.RENDER ? '/opt/render/project/src/database' : path.join(__dirname, 'database');
const DB_PATH = path.join(DB_DIR, 'data.db');

async function initDB() {
  const SQL = await initSqlJs();
  
  if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });
  
  if (fs.existsSync(DB_PATH)) {
    const fileBuffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(fileBuffer);
  } else {
    db = new SQL.Database();
  }
  
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      phone TEXT DEFAULT '',
      role TEXT DEFAULT 'user',
      status TEXT DEFAULT 'active',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS posts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      category TEXT DEFAULT '其他',
      location TEXT DEFAULT '',
      post_date TEXT DEFAULT '',
      description TEXT DEFAULT '',
      contact TEXT DEFAULT '',
      images TEXT DEFAULT '[]',
      status TEXT DEFAULT 'pending',
      is_top INTEGER DEFAULT 0,
      views INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS favorites (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      post_id INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, post_id)
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      post_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      content TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT DEFAULT ''
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS carousel (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      image TEXT DEFAULT '',
      link TEXT DEFAULT '',
      sort_order INTEGER DEFAULT 0
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS announcements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      content TEXT NOT NULL,
      is_active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  
  // Init default settings
  const settings = [
    ['site_title', '失物招领平台'],
    ['site_slogan', '让每一件失物找到回家的路'],
    ['footer_copyright', '© 2024 失物招领平台 版权所有']
  ];
  settings.forEach(([k, v]) => {
    const exist = db.exec(`SELECT key FROM settings WHERE key='${k}'`);
    if (exist.length === 0 || exist[0].values.length === 0) {
      db.run(`INSERT INTO settings (key, value) VALUES (?, ?)`, [k, v]);
    }
  });
  
  // Init default admin
  const adminExist = db.exec("SELECT id FROM users WHERE role='admin'");
  if (adminExist.length === 0 || adminExist[0].values.length === 0) {
    const hash = bcrypt.hashSync('123456', 10);
    db.run('INSERT INTO users (username, password, role) VALUES (?, ?, ?)', ['admin', hash, 'admin']);
  }
  
  saveDB();
}

function saveDB() {
  const data = db.export();
  const buffer = Buffer.from(data);
  fs.writeFileSync(DB_PATH, buffer);
}

// === Middleware ===
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: 'lost-found-secret-2024-' + uuidv4(),
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 7 * 24 * 60 * 60 * 1000 }
}));

app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// === Multer ===
const storage = multer.diskStorage({
  destination: path.join(__dirname, 'uploads'),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, Date.now() + '-' + Math.random().toString(36).slice(2) + ext);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];
    cb(null, allowed.includes(path.extname(file.originalname).toLowerCase()));
  }
});

// === DB Helpers ===
function run(sql, params = []) {
  db.run(sql, params);
  saveDB();
  return { lastInsertRowid: db.exec("SELECT last_insert_rowid() as id")[0].values[0][0] };
}

function get(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  if (stmt.step()) {
    const row = stmt.getAsObject();
    stmt.free();
    return row;
  }
  stmt.free();
  return null;
}

function all(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const results = [];
  while (stmt.step()) {
    results.push(stmt.getAsObject());
  }
  stmt.free();
  return results;
}

// === Auth Helpers ===
function requireAuth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: '请先登录' });
  next();
}
function requireAdmin(req, res, next) {
  if (!req.session.isAdmin) return res.status(403).json({ error: '无权限' });
  next();
}

// === API: Auth ===
app.post('/api/register', (req, res) => {
  const { username, password, phone } = req.body;
  if (!username || !password) return res.status(400).json({ error: '用户名和密码不能为空' });
  if (password.length < 6) return res.status(400).json({ error: '密码至少6位' });
  const exist = get('SELECT id FROM users WHERE username=?', [username]);
  if (exist) return res.status(409).json({ error: '用户名已存在' });
  const hash = bcrypt.hashSync(password, 10);
  const result = run('INSERT INTO users (username,password,phone) VALUES (?,?,?)', [username, hash, phone || '']);
  req.session.userId = result.lastInsertRowid;
  req.session.isAdmin = false;
  res.json({ id: result.lastInsertRowid, username, role: 'user' });
});

app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  const user = get('SELECT * FROM users WHERE username=?', [username]);
  if (!user || !bcrypt.compareSync(password, user.password)) return res.status(401).json({ error: '用户名或密码错误' });
  if (user.status === 'banned') return res.status(403).json({ error: '账号已被封禁' });
  req.session.userId = user.id;
  req.session.isAdmin = user.role === 'admin';
  res.json({ id: user.id, username: user.username, phone: user.phone, role: user.role });
});

app.post('/api/logout', (req, res) => { req.session.destroy(); res.json({ ok: true }); });

app.get('/api/user', (req, res) => {
  if (!req.session.userId) return res.json(null);
  const user = get('SELECT id,username,phone,role FROM users WHERE id=?', [req.session.userId]);
  res.json(user || null);
});

app.put('/api/user', requireAuth, (req, res) => {
  const { phone } = req.body;
  run('UPDATE users SET phone=? WHERE id=?', [phone || '', req.session.userId]);
  res.json({ ok: true });
});

app.put('/api/user/password', requireAuth, (req, res) => {
  const { oldPassword, newPassword } = req.body;
  const user = get('SELECT password FROM users WHERE id=?', [req.session.userId]);
  if (!bcrypt.compareSync(oldPassword, user.password)) return res.status(400).json({ error: '原密码错误' });
  if (newPassword.length < 6) return res.status(400).json({ error: '新密码至少6位' });
  run('UPDATE users SET password=? WHERE id=?', [bcrypt.hashSync(newPassword, 10), req.session.userId]);
  res.json({ ok: true });
});

// === API: Posts ===
app.get('/api/posts', (req, res) => {
  const { type, category, keyword, status, page = 1, limit = 12 } = req.query;
  const offset = (page - 1) * limit;
  let where = ['p.status = ?'];
  let params = ['approved'];
  if (type && type !== 'all') { where.push('p.type = ?'); params.push(type); }
  if (category && category !== 'all') { where.push('p.category = ?'); params.push(category); }
  if (keyword) { where.push('(p.title LIKE ? OR p.description LIKE ?)'); params.push('%' + keyword + '%', '%' + keyword + '%'); }
  if (status === 'mine') { where.push('p.user_id = ?'); params.push(req.session.userId || 0); }
  const whereStr = where.join(' AND ');
  const posts = all(`SELECT p.*, u.username FROM posts p LEFT JOIN users u ON p.user_id = u.id WHERE ${whereStr} ORDER BY is_top DESC, created_at DESC LIMIT ? OFFSET ?`, [...params, Number(limit), Number(offset)]);
  const totalResult = get(`SELECT COUNT(*) as c FROM posts p WHERE ${whereStr}`, params);
  posts.forEach(p => p.images = JSON.parse(p.images || '[]'));
  res.json({ posts, total: totalResult.c, page: Number(page), limit: Number(limit) });
});

app.get('/api/posts/:id', (req, res) => {
  const post = get('SELECT p.*, u.username FROM posts p LEFT JOIN users u ON p.user_id = u.id WHERE p.id=?', [req.params.id]);
  if (!post) return res.status(404).json({ error: '不存在' });
  run('UPDATE posts SET views=views+1 WHERE id=?', [req.params.id]);
  post.images = JSON.parse(post.images || '[]');
  post.isFavorited = req.session.userId ? !!get('SELECT id FROM favorites WHERE user_id=? AND post_id=?', [req.session.userId, post.id]) : false;
  res.json(post);
});

app.post('/api/posts', requireAuth, upload.array('images', 6), (req, res) => {
  const { type, title, category, location, post_date, description, contact } = req.body;
  if (!title) return res.status(400).json({ error: '标题不能为空' });
  const images = (req.files || []).map(f => '/uploads/' + f.filename);
  const result = run('INSERT INTO posts (user_id,type,title,category,location,post_date,description,contact,images,status) VALUES (?,?,?,?,?,?,?,?,?,?)', [
    req.session.userId, type || 'lost', title, category || '其他', location || '', post_date || '', description || '', contact || '', JSON.stringify(images), 'pending'
  ]);
  res.json({ id: result.lastInsertRowid });
});

app.put('/api/posts/:id', requireAuth, upload.array('images', 6), (req, res) => {
  const post = get('SELECT * FROM posts WHERE id=? AND user_id=?', [req.params.id, req.session.userId]);
  if (!post) return res.status(404).json({ error: '无权修改' });
  const { title, category, location, post_date, description, contact } = req.body;
  let images = JSON.parse(post.images || '[]');
  if (req.files && req.files.length > 0) images = images.concat(req.files.map(f => '/uploads/' + f.filename));
  run('UPDATE posts SET title=?,category=?,location=?,post_date=?,description=?,contact=?,images=? WHERE id=?', [
    title, category || '其他', location || '', post_date || '', description || '', contact || '', JSON.stringify(images), req.params.id
  ]);
  res.json({ ok: true });
});

app.delete('/api/posts/:id', requireAuth, (req, res) => {
  const post = get('SELECT * FROM posts WHERE id=?', [req.params.id]);
  if (!post && !req.session.isAdmin) return res.status(404).json({ error: '无权删除' });
  run('DELETE FROM posts WHERE id=?', [req.params.id]);
  res.json({ ok: true });
});

app.patch('/api/posts/:id/status', requireAuth, (req, res) => {
  if (!req.session.isAdmin) return res.status(403).json({ error: '无权限' });
  const { status } = req.body;
  if (!['pending', 'approved', 'rejected', 'claimed', 'returned'].includes(status)) return res.status(400).json({ error: '状态无效' });
  run('UPDATE posts SET status=? WHERE id=?', [status, req.params.id]);
  res.json({ ok: true });
});

app.patch('/api/posts/:id/top', requireAdmin, (req, res) => {
  const post = get('SELECT is_top FROM posts WHERE id=?', [req.params.id]);
  if (!post) return res.status(404).json({ error: '不存在' });
  run('UPDATE posts SET is_top=? WHERE id=?', [post.is_top ? 0 : 1, req.params.id]);
  res.json({ ok: true, is_top: post.is_top ? 0 : 1 });
});

// === API: Favorites ===
app.post('/api/favorites/:postId', requireAuth, (req, res) => {
  const exist = get('SELECT id FROM favorites WHERE user_id=? AND post_id=?', [req.session.userId, req.params.postId]);
  if (exist) {
    run('DELETE FROM favorites WHERE id=?', [exist.id]);
    res.json({ favorited: false });
  } else {
    run('INSERT INTO favorites (user_id,post_id) VALUES (?,?)', [req.session.userId, req.params.postId]);
    res.json({ favorited: true });
  }
});

app.get('/api/favorites', requireAuth, (req, res) => {
  const posts = all('SELECT p.*, u.username FROM posts p LEFT JOIN users u ON p.user_id = u.id WHERE p.id IN (SELECT post_id FROM favorites WHERE user_id=?) ORDER BY p.created_at DESC', [req.session.userId]);
  posts.forEach(p => p.images = JSON.parse(p.images || '[]'));
  res.json(posts);
});

// === API: Comments ===
app.get('/api/posts/:id/comments', (req, res) => {
  const comments = all('SELECT c.*, u.username FROM comments c LEFT JOIN users u ON c.user_id = u.id WHERE c.post_id=? ORDER BY c.created_at ASC', [req.params.id]);
  res.json(comments);
});

app.post('/api/posts/:id/comments', requireAuth, (req, res) => {
  const { content } = req.body;
  if (!content || !content.trim()) return res.status(400).json({ error: '内容不能为空' });
  const result = run('INSERT INTO comments (post_id,user_id,content) VALUES (?,?,?)', [req.params.id, req.session.userId, content.trim()]);
  const comment = get('SELECT c.*, u.username FROM comments c LEFT JOIN users u ON c.user_id = u.id WHERE c.id=?', [result.lastInsertRowid]);
  res.json(comment);
});

// === API: Admin ===
app.post('/api/admin/login', (req, res) => {
  const { username, password } = req.body;
  const user = get('SELECT * FROM users WHERE username=? AND role=?', [username, 'admin']);
  if (!user || !bcrypt.compareSync(password, user.password)) return res.status(401).json({ error: '账户或密码错误' });
  req.session.userId = user.id;
  req.session.isAdmin = true;
  res.json({ id: user.id, username: user.username, role: user.role });
});

app.get('/api/admin/logout', (req, res) => { req.session.isAdmin = false; req.session.destroy(); res.json({ ok: true }); });

app.get('/api/admin/stats', requireAdmin, (req, res) => {
  const total = get('SELECT COUNT(*) as c FROM posts').c;
  const pending = get("SELECT COUNT(*) as c FROM posts WHERE status='pending'").c;
  const claimed = get("SELECT COUNT(*) as c FROM posts WHERE status IN ('claimed','returned')").c;
  const users = get('SELECT COUNT(*) as c FROM users').c;
  const today = new Date().toISOString().slice(0, 10);
  const todayNew = get('SELECT COUNT(*) as c FROM posts WHERE date(created_at) = ?', [today]).c;
  res.json({ total, pending, claimed, users, todayNew });
});

app.get('/api/admin/users', requireAdmin, (req, res) => {
  const { page = 1, limit = 20 } = req.query;
  const offset = (page - 1) * limit;
  const users = all('SELECT id,username,phone,role,status,created_at FROM users ORDER BY created_at DESC LIMIT ? OFFSET ?', [Number(limit), Number(offset)]);
  const total = get('SELECT COUNT(*) as c FROM users').c;
  res.json({ users, total });
});

app.patch('/api/admin/users/:id', requireAdmin, (req, res) => {
  const { status, role } = req.body;
  if (status) run('UPDATE users SET status=? WHERE id=? AND role!=?', [status, req.params.id, 'admin']);
  if (role) run('UPDATE users SET role=? WHERE id=? AND role!=?', [role, req.params.id, 'admin']);
  res.json({ ok: true });
});

app.get('/api/admin/posts', requireAdmin, (req, res) => {
  const { status, page = 1, limit = 20 } = req.query;
  const offset = (page - 1) * limit;
  let where = [];
  let params = [];
  if (status && status !== 'all') { where.push('p.status = ?'); params.push(status); }
  const whereStr = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const posts = all(`SELECT p.*, u.username FROM posts p LEFT JOIN users u ON p.user_id = u.id ${whereStr} ORDER BY p.created_at DESC LIMIT ? OFFSET ?`, [...params, Number(limit), Number(offset)]);
  posts.forEach(p => p.images = JSON.parse(p.images || '[]'));
  const total = get(`SELECT COUNT(*) as c FROM posts p ${whereStr}`, params).c;
  res.json({ posts, total });
});

app.delete('/api/admin/posts/:id', requireAdmin, (req, res) => {
  run('DELETE FROM posts WHERE id=?', [req.params.id]);
  res.json({ ok: true });
});

app.get('/api/admin/settings', requireAdmin, (req, res) => {
  const rows = all('SELECT * FROM settings');
  const settings = {};
  rows.forEach(r => settings[r.key] = r.value);
  const carousel = all('SELECT * FROM carousel ORDER BY sort_order ASC');
  const announcements = all('SELECT * FROM announcements WHERE is_active=1 ORDER BY created_at DESC');
  res.json({ settings, carousel, announcements });
});

app.put('/api/admin/settings', requireAdmin, (req, res) => {
  const { settings } = req.body;
  Object.entries(settings || {}).forEach(([k, v]) => {
    run('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', [k, v]);
  });
  res.json({ ok: true });
});

app.post('/api/admin/carousel', requireAdmin, upload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: '请上传图片' });
  const result = run('INSERT INTO carousel (image, sort_order) VALUES (?, ?)', ['/uploads/' + req.file.filename, 0]);
  res.json({ id: result.lastInsertRowid });
});

app.delete('/api/admin/carousel/:id', requireAdmin, (req, res) => {
  run('DELETE FROM carousel WHERE id=?', [req.params.id]);
  res.json({ ok: true });
});

app.post('/api/admin/announcements', requireAdmin, (req, res) => {
  const { content } = req.body;
  if (!content) return res.status(400).json({ error: '公告内容不能为空' });
  const result = run('INSERT INTO announcements (content) VALUES (?)', [content]);
  res.json({ id: result.lastInsertRowid });
});

app.delete('/api/admin/announcements/:id', requireAdmin, (req, res) => {
  run('UPDATE announcements SET is_active=0 WHERE id=?', [req.params.id]);
  res.json({ ok: true });
});

// === API: Public ===
app.get('/api/categories', (req, res) => {
  res.json(['手机数码', '证件卡片', '钱包背包', '衣物饰品', '钥匙锁具', '书籍文具', '运动用品', '电子配件', '生活用品', '其他']);
});

// === Error Handler ===
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: '服务器错误' });
});

// === Start ===
initDB().then(() => {
  app.listen(PORT, () => {
    console.log(`服务器已启动: http://localhost:${PORT}`);
  });
}).catch(err => {
  console.error('数据库初始化失败:', err);
  process.exit(1);
});
