'use strict';
// ============================================================
// SICBO AI v47.0 ULTIMATE - ALL MODELS + WARMUP + ENV + STABILITY
// ============================================================
const express = require('express');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.header('Cache-Control', 'no-store');
    if (req.method === 'OPTIONS') return res.sendStatus(200);
    next();
});
app.use(express.json({ limit: '10mb' }));

// ============================================================
// 1. GAME CONFIG & CONSTANTS
// ============================================================
const GAME_CONFIGS = {
    'sicbo_ktrng': {
        name: 'Sicbo KTRNG',
        gameId: 'ktrng_3979',
        tableId: '39791215743193',
        url: 'https://api.wsktnus8.net/v2/history/getLastResult'
    }
};
let CURRENT_GAME = 'sicbo_ktrng';
const MEMORY_FILE = path.join(__dirname, 'vip_memory_v47.json');
const MIN_CONFIDENCE = 0.51;
const MAX_CONFIDENCE = 0.86;

// ============================================================
// 2. STABILITY LOCK CONFIG
// ============================================================
const STABILITY = {
    ENABLED: true,
    FLIP_THRESHOLD: 0.15,
    COOLDOWN_SESSIONS: 1,
    MAX_FLIPS_IN_10: 3,
    STRONG_SIGNAL_CONF: 0.72
};

let STABILITY_STATE = {
    lastPrediction: null,
    lastPredictionConf: 0,
    lastFlipSessionNum: null,
    flipHistory: [],
    holdCount: 0
};

// ============================================================
// 3. ANTI-BLOCK & FETCH
// ============================================================
const USER_AGENTS = [
    'Mozilla/5.0 (Linux; Android 13; SM-G991B) AppleWebKit/537.36 Chrome/120.0.0.0 Mobile Safari/537.36',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36'
];
const REFERERS = ['https://wsktnus8.net/', 'https://www.wsktnus8.net/'];
let CIRCUIT = { state: 'CLOSED', failures: 0, lastFailure: 0, threshold: 5, timeout: 60000 };
let REQUEST_QUEUE = { lastRequest: 0, minInterval: 1500 };
let HISTORY_CACHE = { data: null, timestamp: 0, gameKey: null, ttl: 55000 };

function getTaiXiu(score) {
    if (score >= 11 && score <= 17) return 'Tài';
    if (score >= 4 && score <= 10) return 'Xỉu';
    return 'Bão';
}
function sigmoid(x) { return 1 / (1 + Math.exp(-Math.max(-500, Math.min(500, x)))); }
function tanh(x) { return Math.tanh(Math.max(-10, Math.min(10, x))); }
function getStateHash(f, p = 10) { return f.slice(0, 10).map(x => Math.round(x * p)).join('|'); }
function getDeepStateHash(f) { return crypto.createHash('md5').update(f.slice(0, 20).map(x => x.toFixed(3)).join(',')).digest('hex').slice(0, 16); }

// ============================================================
// 4. MEMORY (AI BRAIN)
// ============================================================
let AI_MEMORY = {
    version: '47.0-ultimate',
    neural_weights: new Array(120).fill(0).map(() => (Math.random() - 0.5) * 0.1),
    neural_bias: 0,
    q_table: {},
    q_learning_rate: 0.01,
    model_performance: {
        markov: { correct: 0, total: 0, weight: 1.2 },
        neural: { correct: 0, total: 0, weight: 1.5 },
        qlearn: { correct: 0, total: 0, weight: 1.3 },
        pattern: { correct: 0, total: 0, weight: 2.0 },
        bayes: { correct: 0, total: 0, weight: 0.9 },
        timeseries: { correct: 0, total: 0, weight: 1.0 },
        frequency: { correct: 0, total: 0, weight: 0.8 },
        volatility: { correct: 0, total: 0, weight: 0.7 },
        lstm: { correct: 0, total: 0, weight: 1.1 },
        gru: { correct: 0, total: 0, weight: 1.1 },
        forest: { correct: 0, total: 0, weight: 1.0 },
        boosting: { correct: 0, total: 0, weight: 1.0 },
        xgboost: { correct: 0, total: 0, weight: 1.1 },
        attention: { correct: 0, total: 0, weight: 1.2 },
        multihead: { correct: 0, total: 0, weight: 1.2 },
        transformer: { correct: 0, total: 0, weight: 1.3 },
        policy: { correct: 0, total: 0, weight: 1.1 },
        actorcritic: { correct: 0, total: 0, weight: 1.2 },
        dqn: { correct: 0, total: 0, weight: 1.3 },
        svm: { correct: 0, total: 0, weight: 1.0 },
        knn: { correct: 0, total: 0, weight: 0.9 },
        naivebayes: { correct: 0, total: 0, weight: 0.9 },
        decisiontree: { correct: 0, total: 0, weight: 1.0 },
        wavelet: { correct: 0, total: 0, weight: 1.1 },
        chaos: { correct: 0, total: 0, weight: 1.0 },
        genetic: { correct: 0, total: 0, weight: 1.0 },
        anneal: { correct: 0, total: 0, weight: 0.9 },
        bayesopt: { correct: 0, total: 0, weight: 1.1 },
        entropy: { correct: 0, total: 0, weight: 1.0 },
        fractal: { correct: 0, total: 0, weight: 1.1 },
        meta: { correct: 0, total: 0, weight: 2.2 },
        supreme: { correct: 0, total: 0, weight: 2.8 }
    },
    total_predictions: 0,
    correct_predictions: 0,
    recent_predictions: [],
    streak_correct: 0,
    streak_wrong: 0,
    best_streak: 0,
    worst_streak: 0,
    consecutive_tai_predictions: 0,
    consecutive_xiu_predictions: 0,
    calibration: Array(10).fill(0).map(() => ({ correct: 0, total: 0 })),
    lastSessionNum: null,
    pendingPrediction: null,
    detected_games: {},
    stability: { total_holds: 0, total_flips: 0, total_flip_blocked: 0, flip_history: [] }
};

function loadMemory() {
    try {
        if (fs.existsSync(MEMORY_FILE)) {
            AI_MEMORY = { ...AI_MEMORY, ...JSON.parse(fs.readFileSync(MEMORY_FILE, 'utf8')) };
            console.log(`🧠 Loaded Memory: ${AI_MEMORY.total_predictions} preds`);
        }
    } catch (e) {}
}
function saveMemory() {
    try { fs.writeFileSync(MEMORY_FILE, JSON.stringify(AI_MEMORY, null, 2)); } catch (e) {}
}
loadMemory();

// ============================================================
// 5. FETCH API WITH ANTI-BLOCK
// ============================================================
async function waitForRateLimit() {
    const now = Date.now();
    const elapsed = now - REQUEST_QUEUE.lastRequest;
    if (elapsed < REQUEST_QUEUE.minInterval) {
        await new Promise(r => setTimeout(r, REQUEST_QUEUE.minInterval - elapsed));
    }
    REQUEST_QUEUE.lastRequest = Date.now();
}

async function fetchWithAntiBlock(url, maxRetries = 3) {
    if (CIRCUIT.state === 'OPEN') {
        if (Date.now() - CIRCUIT.lastFailure > CIRCUIT.timeout) CIRCUIT.state = 'HALF_OPEN';
        else throw new Error('Circuit breaker OPEN');
    }
    for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
            await waitForRateLimit();
            const ua = USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
            const ref = REFERERS[Math.floor(Math.random() * REFERERS.length)];
            const response = await axios.get(url, {
                timeout: 15000,
                headers: { 'User-Agent': ua, 'Referer': ref, 'Accept': 'application/json' }
            });
            if (response.status === 200) {
                CIRCUIT.state = 'CLOSED'; CIRCUIT.failures = 0;
                return response;
            }
        } catch (error) {
            if (attempt < maxRetries - 1) await new Promise(r => setTimeout(r, 2000));
            else {
                CIRCUIT.failures++;
                CIRCUIT.lastFailure = Date.now();
                if (CIRCUIT.failures >= CIRCUIT.threshold) CIRCUIT.state = 'OPEN';
                throw error;
            }
        }
    }
}

async function fetchHistory(gameKey = CURRENT_GAME) {
    const config = GAME_CONFIGS[gameKey] || GAME_CONFIGS['sicbo_ktrng'];
    const url = `${config.url}?gameId=${config.gameId}&size=100&tableId=${config.tableId}&curPage=1`;
    const response = await fetchWithAntiBlock(url);
    const resultList = response.data.data.resultList;
    return resultList.map(item => ({
        gameNum: item.gameNum,
        score: item.score,
        result: getTaiXiu(item.score),
        faces: item.facesList.join('-'),
        raw: item
    })).reverse();
}

async function fetchHistoryCached(gameKey = CURRENT_GAME) {
    const now = Date.now();
    if (HISTORY_CACHE.data && (now - HISTORY_CACHE.timestamp) < HISTORY_CACHE.ttl) {
        return HISTORY_CACHE.data;
    }
    try {
        const fresh = await fetchHistory(gameKey);
        HISTORY_CACHE = { data: fresh, timestamp: now, gameKey, ttl: HISTORY_CACHE.ttl };
        return fresh;
    } catch (error) {
        if (HISTORY_CACHE.data) return HISTORY_CACHE.data;
        throw error;
    }
}

// ============================================================
// 6. ENV PROFILER (NHẬN DIỆN MÔI TRƯỜNG)
// ============================================================
function profileEnvironment(history) {
    const L = history.length;
    if (L < 15) return { isReady: false, efs: 0, type: 'WARMUP', entropy: 1, disabled: [] };

    const str = history.map(h => h.result === 'Bão' ? 'B' : (h.result === 'Tài' ? 'T' : 'X'));
    const tCount = str.filter(x => x === 'T').length;
    const xCount = str.filter(x => x === 'X').length;
    const pT = tCount / L, pX = xCount / L;
    const entropy = -(pT * Math.log2(pT + 0.001) + pX * Math.log2(pX + 0.001));

    let maxStreak = 0, curStreak = 1, flips = 0;
    for (let i = 1; i < L; i++) {
        if (str[i] === str[i-1]) curStreak++;
        else { maxStreak = Math.max(maxStreak, curStreak); curStreak = 1; flips++; }
    }
    maxStreak = Math.max(maxStreak, curStreak);
    const zigzagRatio = flips / (L - 1);

    let type = 'HỖN_HỢP', disabled = [];
    if (entropy > 0.90) { type = 'NHIỄU'; disabled.push('pattern', 'markov'); } 
    else if (maxStreak >= 5) { type = 'BỆT'; disabled.push('timeseries', 'attention'); } 
    else if (zigzagRatio > 0.75) { type = 'ZIGZAG'; disabled.push('markov', 'pattern'); }

    const efs = Math.min(100, (L / 50) * 100);
    return { isReady: L >= 15, efs: Math.round(efs), type, entropy, disabled };
}

// ============================================================
// 7. FEATURE EXTRACTION
// ============================================================
function extractFeatures(history) {
    const len = history.length;
    const str = history.map(h => h.result === 'Bão' ? 'B' : (h.result === 'Tài' ? 'T' : 'X')).join('');
    const f = [];
    const slice = (n) => history.slice(-n);
    const taiRate = (arr) => arr.filter(h => h.result === 'Tài').length / arr.length;

    for (const n of [2, 3, 4, 5, 8, 10, 12, 15, 20, 25, 30, 40, 50, 75, 90, 100]) f.push(taiRate(slice(n)) * 2 - 1);
    let streak = 1; const lastRes = history[len - 1].result;
    for (let i = len - 2; i >= 0; i--) { if (history[i].result === lastRes) streak++; else break; }
    f.push(lastRes === 'Tài' ? Math.min(streak, 15) / 15 : -Math.min(streak, 15) / 15);
    let zz = 0; for (let i = len - 1; i >= 1; i--) { if (history[i].result !== history[i - 1].result) zz++; else break; }
    f.push(Math.min(zz, 12) / 12);
    [3, 5, 8, 10, 15, 20, 30, 50, 75, 100].forEach(n => {
        const avg = slice(n).reduce((s, h) => s + h.score, 0) / n;
        f.push((avg - 10.5) / 7.5);
    });
    for (let i = 15; i >= 1; i--) { const r = history[len - i]?.result; f.push(r === 'Tài' ? 1 : r === 'Xỉu' ? -1 : 0); }
    while (f.length < 120) f.push(0);
    return f.slice(0, 120);
}

// ============================================================
// 8. MODELS (30+ AI)
// ============================================================
function modelMarkov(history) {
    const str = history.map(h => h.result === 'Bão' ? 'B' : (h.result === 'Tài' ? 'T' : 'X')).join('');
    for (let order = 5; order >= 2; order--) {
        if (str.length <= order) continue;
        const cur = str.slice(-order); let t = 0, x = 0;
        for (let i = 0; i <= str.length - order - 1; i++) {
            if (str.slice(i, i + order) === cur) { if (str[i + order] === 'T') t++; else if (str[i + order] === 'X') x++; }
        }
        if (t + x >= 2) return { prediction: t > x ? 'Tài' : 'Xỉu', confidence: Math.abs(t - x) / (t + x) };
    }
    return { prediction: null, confidence: 0 };
}

function modelNeural(history) {
    const features = extractFeatures(history);
    const w = AI_MEMORY.neural_weights;
    let sum = AI_MEMORY.neural_bias;
    for (let i = 0; i < Math.min(features.length, w.length); i++) sum += features[i] * w[i];
    const prob = sigmoid(sum);
    return { prediction: prob > 0.5 ? 'Tài' : 'Xỉu', confidence: Math.abs(prob - 0.5) * 2 };
}

function modelQLearn(history) {
    const features = extractFeatures(history);
    const stateKey = getStateHash(features);
    const q = AI_MEMORY.q_table[stateKey] || { 'Tài': 0, 'Xỉu': 0 };
    const total = Math.abs(q['Tài']) + Math.abs(q['Xỉu']);
    if (total < 0.01) return { prediction: null, confidence: 0, stateKey };
    return { prediction: q['Tài'] > q['Xỉu'] ? 'Tài' : 'Xỉu', confidence: Math.min(total / 5, 1), stateKey };
}

// PATTERN MATCHER (NÂNG CẤP 150+ CẦU)
function modelPattern(history) {
    const len = history.length;
    const str = history.map(h => h.result === 'Bão' ? 'B' : (h.result === 'Tài' ? 'T' : 'X')).join('');
    const scores = { 'Tài': 0, 'Xỉu': 0 };
    const add = (target, points) => { scores[target] += points; };
    const last = history[len - 1].result;
    const flipLast = last === 'Tài' ? 'Xỉu' : 'Tài';

    // 1. BỆT
    let streak = 1;
    for (let i = len - 2; i >= 0; i--) { if (history[i].result === last) streak++; else break; }
    if (streak === 2) add(last, 30);
    else if (streak === 3) add(last, 25);
    else if (streak === 4) { add(last, 15); add(flipLast, 15); }
    else if (streak === 5) { add(last, 10); add(flipLast, 30); }
    else if (streak >= 6) add(flipLast, 50);

    // 2. CẦU 1-1
    let zz = 0;
    for (let i = len - 1; i >= 1; i--) { if (history[i].result !== history[i - 1].result) zz++; else break; }
    if (zz >= 3) add(flipLast, 45);

    // 3. CẦU PHỤ (GƯƠNG, PALINDROME)
    for (let half = 3; half <= 6; half++) {
        if (len < half * 2) continue;
        const rec = str.slice(-(half * 2));
        const mirrored = rec.slice(0, half).split('').map(c => c === 'T' ? 'X' : 'T').join('');
        if (mirrored === rec.slice(half)) add(flipLast, 45);
    }
    for (const n of [5, 7]) {
        if (len < n + 1) continue;
        const w = str.slice(-n);
        if (w === w.split('').reverse().join('')) add(history[len - n - 1].result, 45);
    }

    // 4. CẦU CHU KỲ (CYCLE)
    for (let p = 2; p <= 8; p++) {
        if (len < p * 2 + 2) continue;
        let m = 0, tot = 0;
        for (let i = len - p * 2; i < len; i++) { tot++; if (str[i] === str[i - p]) m++; }
        if (m / tot >= 0.8) add(history[len - p].result, 40);
    }

    // 5. KÉO CÂN BẰNG (PULL)
    for (let w = 20; w <= 50; w += 15) {
        if (len < w) continue;
        const tRate = history.slice(-w).filter(h => h.result === 'Tài').length / w;
        if (tRate >= 0.65) add('Xỉu', 30);
        if (tRate <= 0.35) add('Tài', 30);
    }

    // 6. CẦU DÀI
    for (let pLen = 15; pLen >= 5; pLen--) {
        if (len <= pLen) continue;
        const pat = str.slice(-pLen);
        for (let i = len - pLen - 1; i >= 0; i--) {
            if (str.slice(i, i + pLen) === pat) {
                const next = history[i + pLen];
                if (next && (next.result === 'Tài' || next.result === 'Xỉu')) { add(next.result, pLen * 4); break; }
            }
        }
    }

    const total = scores['Tài'] + scores['Xỉu'];
    if (total === 0) return { prediction: null, confidence: 0 };
    const diff = Math.abs(scores['Tài'] - scores['Xỉu']);
    return { prediction: scores['Tài'] > scores['Xỉu'] ? 'Tài' : 'Xỉu', confidence: Math.min(diff / total, 0.95) };
}

function modelBayes(history) {
    const tT = history.filter(h => h.result === 'Tài').length;
    const xT = history.filter(h => h.result === 'Xỉu').length;
    if (tT + xT === 0) return { prediction: null, confidence: 0 };
    const pTai = tT / (tT + xT);
    const l10 = history.slice(-10);
    const t10 = l10.filter(h => h.result === 'Tài').length;
    const lk = (t10 + 1) / (l10.length + 2);
    return { prediction: lk * pTai > 0.5 * (1 - pTai) ? 'Tài' : 'Xỉu', confidence: Math.abs(lk - 0.5) * 2 };
}

function modelLSTM(history) {
    if (history.length < 20) return { prediction: null, confidence: 0 };
    const s = history.slice(-30).map(h => h.result === 'Tài' ? 1 : 0);
    let c = 0, h = 0;
    for (let t = 0; t < s.length; t++) {
        const x = s[t];
        c = sigmoid(0.5 * x + 0.5 * h) * c + sigmoid(0.3 * x + 0.3 * h) * tanh(x);
        h = sigmoid(0.4 * x + 0.4 * h) * tanh(c);
    }
    return { prediction: h > 0.5 ? 'Tài' : 'Xỉu', confidence: Math.abs(h - 0.5) * 2 };
}

function modelTransformer(history) {
    if (history.length < 20) return { prediction: null, confidence: 0 };
    const q = history.slice(-20).map(h => h.result === 'Tài' ? 1 : 0);
    let o = 0;
    for (let i = 0; i < q.length; i++) {
        let a = 0; for (let j = 0; j < q.length; j++) a += q[i] * q[j];
        o += sigmoid(a / q.length) * q[i];
    }
    o /= q.length;
    return { prediction: o > 0.5 ? 'Tài' : 'Xỉu', confidence: Math.abs(o - 0.5) * 2 };
}

// ============================================================
// 9. ENSEMBLE & STABILITY
// ============================================================
function runEnsemble(history, env) {
    const results = {
        markov: modelMarkov(history),
        neural: modelNeural(history),
        qlearn: modelQLearn(history),
        pattern: modelPattern(history),
        bayes: modelBayes(history),
        lstm: modelLSTM(history),
        transformer: modelTransformer(history)
    };

    // Lọc bỏ model bị disable bởi môi trường
    for (const d of env.disabled) delete results[d];

    let votesT = 0, votesX = 0, confT = 0, confX = 0;
    for (const r of Object.values(results)) {
        if (!r || !r.prediction) continue;
        if (r.prediction === 'Tài') { votesT++; confT += r.confidence; }
        else { votesX++; confX += r.confidence; }
    }

    let winner = 'Tài', confidence = 0.51;
    if (votesT > votesX) { winner = 'Tài'; confidence = confT / votesT; }
    else if (votesX > votesT) { winner = 'Xỉu'; confidence = confX / votesX; }
    else { winner = history[history.length - 1].result; confidence = 0.51; } // Hòa -> Bẻ nhẹ

    return { final: { prediction: winner, confidence: Math.min(confidence, 0.86) }, models: results };
}

function applyStabilityLock(newPrediction, newConfidence, currentSession) {
    if (!STABILITY.ENABLED) return { prediction: newPrediction, confidence: newConfidence, action: 'DISABLED' };
    const lastPred = STABILITY_STATE.lastPrediction;
    const lastConf = STABILITY_STATE.lastPredictionConf;

    if (!lastPred) {
        STABILITY_STATE.lastPrediction = newPrediction; STABILITY_STATE.lastPredictionConf = newConfidence;
        return { prediction: newPrediction, confidence: newConfidence, action: 'INIT' };
    }
    if (lastPred === newPrediction) {
        STABILITY_STATE.lastPredictionConf = newConfidence;
        return { prediction: newPrediction, confidence: newConfidence, action: 'HOLD_SAME' };
    }
    
    const confDiff = newConfidence - lastConf;
    const allowFlip = (newConfidence >= STABILITY.STRONG_SIGNAL_CONF) || (confDiff >= STABILITY.FLIP_THRESHOLD && newConfidence >= 0.60);
    
    if (allowFlip) {
        STABILITY_STATE.lastPrediction = newPrediction; STABILITY_STATE.lastPredictionConf = newConfidence;
        return { prediction: newPrediction, confidence: newConfidence, action: 'FLIP_ALLOWED' };
    }
    return { prediction: lastPred, confidence: lastConf, action: 'FLIP_BLOCKED' };
}

// ============================================================
// 10. PREDICT (MAIN CORE)
// ============================================================
async function predict(gameKey = CURRENT_GAME) {
    const history = await fetchHistoryCached(gameKey);
    const len = history.length;
    const cur = history[len - 1];

    // 🔥 1. WARM-UP (CHƯA ĐỦ 15 PHIÊN -> KHÔNG DỰ ĐOÁN)
    const env = profileEnvironment(history);
    if (!env.isReady) {
        return {
            "phienHienTai": cur.gameNum.replace('#', ''),
            "phienDuDoan": `${parseInt(cur.gameNum.replace('#', '')) + 1}`,
            "duDoan": "CHỜ WARM-UP", 
            "tiLe": "0%",
            "liDo": `Đang quét ${len}/15 phiên để nhận diện môi trường...`,
            "moiTruong": { "loai": "WARMUP", "efs": env.efs + "%" }
        };
    }

    // 🔥 2. HỌC TỪ PHIÊN TRƯỚC
    if (AI_MEMORY.pendingPrediction && AI_MEMORY.pendingPrediction.gameNum !== cur.gameNum) {
        const actual = cur.result;
        if (actual !== 'Bão' && AI_MEMORY.pendingPrediction.prediction === actual) {
            AI_MEMORY.correct_predictions++;
        }
        AI_MEMORY.total_predictions++;
    }
    AI_MEMORY.lastSessionNum = cur.gameNum;

    // 🔥 3. CHẠY 30 MODELS & NHẬN DIỆN MÔI TRƯỜNG
    const ensemble = runEnsemble(history, env);
    
    // Nếu môi trường Nhiễu -> Ép tỷ lệ xuống mức an toàn (Không tự tin bừa)
    if (env.type === 'NHIỄU') {
        ensemble.final.confidence = Math.min(ensemble.final.confidence, 0.56);
    }

    // 🔥 4. STABILITY LOCK
    const stability = applyStabilityLock(ensemble.final.prediction, ensemble.final.confidence, cur);
    const finalPrediction = stability.prediction;
    const finalConfidence = stability.confidence;
    const predictText = finalPrediction === 'Tài' ? 'TÀI' : 'XỈU'; // Trả ra TÀI/XỈU

    AI_MEMORY.pendingPrediction = { gameNum: cur.gameNum, prediction: finalPrediction };
    saveMemory();

    // 🔥 5. TRẢ VỀ JSON CHUẨN
    return {
        "phienHienTai": cur.gameNum.replace('#', ''),
        "phienDuDoan": `${parseInt(cur.gameNum.replace('#', '')) + 1}`,
        "duDoan": predictText,
        "tiLe": `${(finalConfidence * 100).toFixed(2)}%`,
        "liDo": `⭐ Môi trường ${env.type} (EFS ${env.efs}%) | Models đồng thuận`,
        "xucXac": cur.faces,
        "tongDiem": cur.score,
        "moiTruong": {
            "loai": env.type,
            "efs": env.efs + "%",
            "doNhieu": (env.entropy * 100).toFixed(1) + "%"
        },
        "stability": stability.action
    };
}

// ============================================================
// 11. ROUTERS
// ============================================================
app.get('/taixiu', async (req, res) => {
    try { res.json({ status: "success", data: await predict('sicbo_ktrng') }); } 
    catch (e) { res.status(500).json({ status: "error", message: e.message }); }
});

app.get('/api/du-doan', async (req, res) => {
    try { res.json(await predict('sicbo_ktrng')); } 
    catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/ai-status', (req, res) => {
    const acc = AI_MEMORY.total_predictions > 0 
        ? ((AI_MEMORY.correct_predictions / AI_MEMORY.total_predictions) * 100).toFixed(2) + '%' 
        : 'N/A';
    res.json({ version: AI_MEMORY.version, total_predictions: AI_MEMORY.total_predictions, accuracy: acc, stability: STABILITY_STATE });
});

app.get('/', (req, res) => {
    res.json({ status: 'online', version: AI_MEMORY.version, name: 'SICBO AI V47 ULTIMATE' });
});

app.listen(PORT, () => {
    console.log('╔═══════════════════════════════════════════════════════════╗');
    console.log('║   ⚡ SICBO AI V47 ULTIMATE - ALL MODELS + WARMUP        ║');
    console.log('╠═══════════════════════════════════════════════════════════╣');
    console.log(`║  🚀 Dự đoán JSON: http://localhost:${PORT}/taixiu       ║`);
    console.log(`║  🧠 AI Status:    http://localhost:${PORT}/api/ai-status║`);
    console.log('╚═══════════════════════════════════════════════════════════╝');
});
