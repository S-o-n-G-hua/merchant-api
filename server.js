const express = require('express');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'merchant-app-secret-2026';

// Use /tmp for Render (ephemeral filesystem)
const USERS_FILE = process.env.NODE_ENV === 'production'
    ? '/tmp/users.json'
    : path.join(__dirname, 'users.json');

app.use(cors());
app.use(bodyParser.json({ limit: '10mb' }));

// Initialize users file
if (!fs.existsSync(USERS_FILE)) {
    fs.writeFileSync(USERS_FILE, JSON.stringify({ users: [] }, null, 2));
}

function readUsers() {
    try {
        return JSON.parse(fs.readFileSync(USERS_FILE, 'utf-8'));
    } catch {
        return { users: [] };
    }
}

function writeUsers(data) {
    fs.writeFileSync(USERS_FILE, JSON.stringify(data, null, 2));
}

// Register
app.post('/api/register', async (req, res) => {
    const { username, password, phone } = req.body;
    if (!username || !password) return res.status(400).json({ error: '用户名和密码必填' });

    const data = readUsers();
    if (data.users.find(u => u.username === username)) {
        return res.status(400).json({ error: '用户名已存在' });
    }

    const hash = await bcrypt.hash(password, 10);
    const user = {
        id: Date.now().toString(),
        username,
        password: hash,
        phone: phone || '',
        createdAt: new Date().toISOString()
    };
    data.users.push(user);
    writeUsers(data);

    const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ success: true, token, user: { id: user.id, username: user.username, phone: user.phone } });
});

// Login
app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: '用户名和密码必填' });

    const data = readUsers();
    const user = data.users.find(u => u.username === username);
    if (!user) return res.status(400).json({ error: '用户不存在' });

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return res.status(400).json({ error: '密码错误' });

    const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ success: true, token, user: { id: user.id, username: user.username, phone: user.phone } });
});

// Get current user
app.get('/api/me', (req, res) => {
    const auth = req.headers.authorization;
    if (!auth) return res.status(401).json({ error: '未登录' });

    try {
        const token = auth.replace('Bearer ', '');
        const decoded = jwt.verify(token, JWT_SECRET);
        const data = readUsers();
        const user = data.users.find(u => u.id === decoded.id);
        if (!user) return res.status(401).json({ error: '用户不存在' });
        res.json({ success: true, user: { id: user.id, username: user.username, phone: user.phone } });
    } catch {
        res.status(401).json({ error: '登录已过期' });
    }
});

// Health check
app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
