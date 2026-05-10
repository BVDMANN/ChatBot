import express from 'express';
import dotenv from 'dotenv';
import cors from 'cors';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

// --- 1. FONCTIONS DE DONNÉES (DÉFINIES EN PREMIER) ---

async function loadConfigs() {
    try {
        const settingsData = await fs.readFile(path.join(__dirname, 'config/settings.json'), 'utf8');
        const clientData = await fs.readFile(path.join(__dirname, 'config/client-actif.json'), 'utf8');
        const analyticsData = await fs.readFile(path.join(__dirname, 'data/analytics.json'), 'utf8');
        return {
            settings: JSON.parse(settingsData),
            clientActif: JSON.parse(clientData),
            analytics: JSON.parse(analyticsData)
        };
    } catch (e) {
        console.error('[ERROR] Failed to load configs:', e);
        return { settings: {}, clientActif: {}, analytics: {} };
    }
}

async function getClients() {
    const data = await fs.readFile(path.join(__dirname, 'data/clients.json'), 'utf8');
    return JSON.parse(data);
}

async function saveClients(clients) {
    await fs.writeFile(path.join(__dirname, 'data/clients.json'), JSON.stringify(clients, null, 2));
}

async function getAnalytics() {
    const data = await fs.readFile(path.join(__dirname, 'data/analytics.json'), 'utf8');
    return JSON.parse(data);
}

async function saveAnalytics(analytics) {
    await fs.writeFile(path.join(__dirname, 'data/analytics.json'), JSON.stringify(analytics, null, 2));
}

async function saveConversation(entry) {
    try {
        const filePath = path.join(__dirname, 'data/conversations.json');
        const data = JSON.parse(await fs.readFile(filePath, 'utf8'));
        data.push(entry);
        if (data.length > 1000) data.splice(0, 100);
        await fs.writeFile(filePath, JSON.stringify(data, null, 2));
    } catch (e) {
        console.error('[ERROR] Conv save failed:', e);
    }
}

async function saveReservation(resv) {
    const filePath = path.join(__dirname, 'data/reservations.json');
    const data = JSON.parse(await fs.readFile(filePath, 'utf8'));
    data.push({ ...resv, timestamp: new Date().toISOString() });
    await fs.writeFile(filePath, JSON.stringify(data, null, 2));
}

// --- 2. LOGIQUE EMAIL (RESEND) ---
async function sendConfirmationEmail(resv, client) {
    const API_KEY = process.env.RESEND_API_KEY;
    if (!API_KEY) return;

    try {
        await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${API_KEY}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                from: 'Assistant <onboarding@resend.dev>',
                to: resv.email || 'client@example.com',
                subject: `Confirmation de réservation - ${client.nom}`,
                html: `<div style="font-family:sans-serif; max-width:500px; margin:auto; border:1px solid #eee; padding:20px; border-radius:20px;">
                        <h2 style="text-align:center">Confirmation de Réservation</h2>
                        <p>Bonjour <strong>${resv.name}</strong>,</p>
                        <p>Votre réservation chez <strong>${client.nom}</strong> est enregistrée.</p>
                        <div style="background:#f9f9f9; padding:15px; border-radius:15px; margin:20px 0;">
                            <p>📅 ${resv.date} à ${resv.time}</p>
                            <p>👥 ${resv.guests} personnes</p>
                        </div >
                        <p>À très bientôt !</p>
                    </div >`
            })
        });
    } catch (e) { console.error('[EMAIL ERROR]', e); }
}

// --- 3. LOGIQUE IA (GROQ) ---
async function callGroq(messages) {
    const API_KEY = process.env.GROQ_API_KEY;
    if (!API_KEY) throw new Error('NO_API_KEY');
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
            model: 'llama-3.3-70b-versatile',
            messages: messages,
            temperature: 0.7,
            max_tokens: 300
        })
    });
    if (!response.ok) throw new Error(`GROQ_ERROR_${response.status}`);
    const data = await response.json();
    return data.choices[0].message.content;
}

// --- 4. MIDDLEWARES & CONFIG ---
app.use(cors());
app.use(express.json());
app.use(express.static('public'));
app.use(express.static('admin'));
app.use(express.static('embed'));

// --- 5. ROUTES ---

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public/widget.html'));
});

app.get('/health', async (req, res) => {
    res.json({ status: 'ok', uptime: process.uptime() });
});

app.get('/config/public', async (req, res) => {
    const { clientId } = req.query;
    const clients = await getClients();
    const client = clients.find(c => c.id === clientId) || clients[0];
    res.json({
        id: client.id,
        nom: client.nom,
        ville: client.ville,
        horaires: client.horaires,
        services: client.services,
        telephone: client.telephone,
        welcomeMsg: client.welcomeMsg || `Bonjour ! Je suis l'assistant de ${client.nom}.`,
        suggestions: client.services ? client.services.slice(0, 3) : ["Horaires", "Services", "Contact"],
        colors: client.colors || { primary: "#000000", accent: "#B8860B" }
    });
});

app.post('/chat', async (req, res) => {
    const { message, sessionId, clientId } = req.body;
    if (!message) return res.status(400).json({ error: 'Invalid message' });

    const clients = await getClients();
    const client = clients.find(c => c.id === clientId) || clients[0];
    const id = sessionId || `sess_${Date.now()}`;
    const mode = process.env.GROQ_API_KEY ? 'real' : 'demo';

    const systemPrompt = `Tu es l'Expert Commercial de ${client.nom}.
    INFO: ${client.type_commerce} à ${client.adresse}, ${client.ville}.
    Horaires: ${client.horaires}.
    Knowledge: ${client.knowledgeBase || ''}.
    Règles: Style Apple, concis, chaleureux, termine toujours par un CTA.`;

    let reply;
    try {
        if (mode === 'real') {
            reply = await callGroq([{ role: 'system', content: systemPrompt }, { role: 'user', content: message }]);
        } else {
            reply = "Mode démo: Configurez GROQ_API_KEY pour m'activer !";
        }
    } catch (e) {
        reply = "Désolé, petit souci technique. Appelez-nous au " + client.telephone;
    }

    const analytics = await getAnalytics();
    analytics.messages_total++;
    analytics.messages_today++;
    const hour = new Date().getHours().toString().padStart(2, '0');
    analytics.heures_de_pointe[hour] = (analytics.heures_de_pointe[hour] || 0) + 1;
    await saveAnalytics(analytics);
    await saveConversation({ clientId: client.id, id: Date.now(), sessionId: id, timestamp: new Date().toISOString(), question: message, reponse: reply });
    res.json({ reply, sessionId: id, timestamp: new Date().toISOString(), mode });
});

app.post('/chat/reserve', async (req, res) => {
    const { name, date, time, guests, phone, email, clientId } = req.body;
    const clients = await getClients();
    const client = clients.find(c => c.id === clientId) || clients[0];
    await saveReservation({ clientId, name, date, time, guests, phone, email });
    if (email) await sendConfirmationEmail({ name, date, time, guests, email }, client);
    res.json({ status: 'ok' });
});

app.get('/admin/login', (req, res) => res.sendFile(path.join(__dirname, 'admin/login.html')));
app.post('/admin/auth', (req, res) => {
    const { password } = req.body;
    if (password === process.env.ADMIN_PASSWORD) res.json({ token: 'admin-session-valid' });
    else res.status(401).json({ error: 'Incorrect' });
});
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'admin/dashboard.html')));

app.get('/admin/api/clients', async (req, res) => res.json(await getClients()));
app.post('/admin/api/clients', async (req, res) => {
    const clients = await getClients();
    const newClient = { id: `client_${Date.now()}`, ...req.body, active: true };
    clients.push(newClient);
    await saveClients(clients);
    res.json(newClient);
});
app.post('/admin/api/clients/update', async (req, res) => {
    const { id, updates } = req.body;
    const clients = await getClients();
    const idx = clients.findIndex(c => c.id === id);
    if (idx !== -1) {
        clients[idx] = { ...clients[idx], ...updates };
        await saveClients(clients);
        res.json({ status: 'ok' });
    } else res.status(404).send('Not found');
});
app.get('/admin/api/conversations', async (req, res) => {
    const data = JSON.parse(await fs.readFile(path.join(__dirname, 'data/conversations.json'), 'utf8'));
    res.json(data.reverse());
});
app.get('/admin/api/reservations', async (req, res) => {
    const data = JSON.parse(await fs.readFile(path.join(__dirname, 'data/reservations.json'), 'utf8'));
    res.json(data.reverse());
});

app.get('/embed/chatbot.js', (req, res) => {
    res.send(`(function(){const s=document.createElement('script');const p=new URLSearchParams(window.location.search);s.src=window.location.origin+'/widget.js?id='+ (p.get('id')||'client_default');document.head.appendChild(s);})();`);
});

// --- LANCEMENT FINAL ---
(async () => {
    await loadConfigs();
    app.listen(PORT, () => {
        console.log(`--------------------------------------------------`);
        console.log(`🚀 CHATBOT PME SAAS STARTED ON PORT ${PORT}`);
        console.log(`URL: http://localhost:${PORT}`);
        console.log(`--------------------------------------------------`);
    });
})();
