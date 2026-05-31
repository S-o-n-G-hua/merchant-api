const express = require('express');
const bodyParser = require('body-parser');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const app = express();
const JWT_SECRET = process.env.JWT_SECRET || 'merchant-app-secret-2026';

// GitHub config
const GITHUB_TOKEN_DEFAULT = process.env.GITHUB_TOKEN || '';
const GITHUB_OWNER = process.env.GITHUB_OWNER || 'S-o-n-G-hua';
const GITHUB_REPO = process.env.GITHUB_REPO || 'merchant-app';
const GITHUB_BRANCH = process.env.GITHUB_BRANCH || 'main';
const GITHUB_PATH = process.env.GITHUB_PATH || 'index.html';

// Admin session (in-memory per function instance)
let adminSession = null;

// Simple in-memory user store (for Vercel serverless - use JSON in /tmp if available)
let usersData = null;

function getUsers() {
    if (usersData) return usersData;
    try {
        const fs = require('fs');
        if (typeof process !== 'undefined' && process.cwd) {
            try { usersData = JSON.parse(fs.readFileSync('/tmp/users.json', 'utf-8')); } catch(e) {}
        }
    } catch(e) {}
    if (!usersData) usersData = { users: [] };
    return usersData;
}

function saveUsers(data) {
    usersData = data;
    try {
        const fs = require('fs');
        if (typeof process !== 'undefined' && process.cwd()) {
            try { fs.writeFileSync('/tmp/users.json', JSON.stringify(data, null, 2)); } catch(e) {}
        }
    } catch(e) {}
}

app.use(bodyParser.json({ limit: '10mb' }));

// Register
app.post('/api/register', async (req, res) => {
    const { username, password, phone } = req.body;
    if (!username || !password) return res.status(400).json({ error: '用户名和密码必填' });

    const data = getUsers();
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
    saveUsers(data);

    const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ success: true, token, user: { id: user.id, username: user.username, phone: user.phone } });
});

// Login
app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: '用户名和密码必填' });

    const data = getUsers();
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
        const data = getUsers();
        const user = data.users.find(u => u.id === decoded.id);
        if (!user) return res.status(401).json({ error: '用户不存在' });
        res.json({ success: true, user: { id: user.id, username: user.username, phone: user.phone } });
    } catch {
        res.status(401).json({ error: '登录已过期' });
    }
});

// ===== Admin Panel Routes =====

// Admin auth - simple password auth for Vercel deployment
app.post('/api/auth', (req, res) => {
    const { password } = req.body;
    // Fixed admin password: 123456
    if (password === '123456') {
        const ghToken = process.env.GITHUB_TOKEN || GITHUB_TOKEN_DEFAULT;
        if (!ghToken) return res.status(500).json({ success: false, error: '未配置GITHUB_TOKEN' });
        adminSession = { token: ghToken, createdAt: Date.now() };
        res.json({ success: true });
    } else {
        res.status(401).json({ success: false, error: '密码错误' });
    }
});

// Get current content from GitHub
app.get('/api/content', async (req, res) => {
    if (!adminSession) return res.status(401).json({ success: false, error: '未登录后台' });
    
    try {
        const ghRes = await fetch(
            `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${GITHUB_PATH}?ref=${GITHUB_BRANCH}`,
            { headers: { 'Authorization': `token ${adminSession.token}`, 'User-Agent': 'merchant-app-admin' } }
        );
        if (!ghRes.ok) throw new Error('获取文件失败');
        
        const fileData = await ghRes.json();
        const content = Buffer.from(fileData.content, 'base64').toString('utf-8');
        
        res.json({
            success: true,
            data: {
                title: '联合收单商户服务中心',
                heroTitle: '联合收单商户服务中心',
                depositNumber: 'YYF00059484449',
                depositReceiver: '商户服务中心',
                products: [
                    { icon: '💳', name: '聚合收款', desc: '多码合一，一码付全' },
                    { icon: '📊', name: '交易查询', desc: '实时查看交易明细' },
                    { icon: '🔔', name: '消息通知', desc: '到账提醒即时推送' }
                ],
                depositQR: null,
                serviceQR: null,
                sha: fileData.sha,
                html: content
            }
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Save content to GitHub
app.post('/api/content', async (req, res) => {
    if (!adminSession) return res.status(401).json({ success: false, error: '未登录后台' });
    
    const { html, message } = req.body;
    if (!html) return res.status(400).json({ success: false, error: '内容不能为空' });
    
    try {
        const fileRes = await fetch(
            `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${GITHUB_PATH}?ref=${GITHUB_BRANCH}`,
            { headers: { 'Authorization': `token ${adminSession.token}`, 'User-Agent': 'merchant-app-admin' } }
        );
        if (!fileRes.ok) throw new Error('获取文件信息失败');
        const fileData = await fileRes.json();
        
        const b64content = Buffer.from(html).toString('base64');
        const ghRes = await fetch(
            `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${GITHUB_PATH}`,
            {
                method: 'PUT',
                headers: {
                    'Authorization': `token ${adminSession.token}`,
                    'User-Agent': 'merchant-app-admin'
                },
                body: JSON.stringify({ 
                    message: message || 'Update from admin panel', 
                    content: b64content, 
                    sha: fileData.sha, 
                    branch: GITHUB_BRANCH 
                })
            }
        );
        if (!ghRes.ok) {
            const errData = await ghRes.json();
            throw new Error(errData.message || '保存失败');
        }
        
        const result = await ghRes.json();
        res.json({ success: true, message: '已推送到 GitHub Pages', sha: result.content.sha });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.post('/api/logout', (req, res) => {
    adminSession = null;
    res.json({ success: true });
});

// Health check
app.get('/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

module.exports = app;
