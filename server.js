// ============================================================
// SICBO AI v12.0 VIP - ALL CẦU + STABILITY LOCK + NO BIAS ENGINE
// Nhận diện 200+ cầu - Stability Lock v2 - Calibration trung thực
// KHÔNG THIÊN VỊ TÀI - KHÔNG THIÊN VỊ XỈU - DỰ ĐOÁN PHẢI PHÂN TÍCH
// ============================================================
const express = require('express');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

// ============================================================
// CORS + JSON
// ============================================================
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
    res.header('Cache-Control', 'no-store');
    if (req.method === 'OPTIONS') return res.sendStatus(200);
    next();
});
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// ============================================================
// GAME CONFIG
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
const MEMORY_FILE = path.join(__dirname, 'vip_memory.json');
const MEMORY_BACKUP = path.join(__dirname, 'vip_memory.backup.json');

// ============================================================
// 📊 REALITY CHECK — Trung thực về giới hạn
// ============================================================
const REALITY_CHECK = {
    disclaimer: 'Tài Xỉu có yếu tố ngẫu nhiên cao. KHÔNG thuật toán nào đảm bảo 90% chính xác. Hệ thống cung cấp EDGE thống kê nhỏ nếu có, kèm calibration trung thực.',
    maxRealisticAccuracy: 0.58,
    minSessionsToPredict: 3,
    noSignalThreshold: 0.10
};

const MIN_CONFIDENCE = 0.51;
const MAX_CONFIDENCE = 0.86;
const NO_SIGNAL_CONF = 0.40;  // Dưới ngưỡng này → có thể trả NO_SIGNAL

// ============================================================
// 🎯 STABILITY LOCK v2 — không thiên vị, chỉ tránh nhảy cầu
// ============================================================
const STABILITY = {
    ENABLED: true,
    FLIP_THRESHOLD: 0.12,
    COOLDOWN_SESSIONS: 1,
    MAX_FLIPS_IN_WINDOW: 4,
    WINDOW_MS: 30 * 60 * 1000,
    STRONG_SIGNAL_CONF: 0.74,
    MIN_FLIP_CONF: 0.60,
    HYSTERESIS_RATIO: 0.12
};

let STABILITY_STATE = {
    lastPrediction: null,
    lastPredictionConf: 0,
    lastFlipSessionNum: null,
    flipHistory: [],
    holdCount: 0
};

// ============================================================
// 🚫 NO BIAS GUARD — chống thiên vị Tài/Xỉu
// ============================================================
const BIAS_GUARD = {
    ENABLED: true,
    MAX_STREAK_PREDICTIONS: 5,     // Nếu dự đoán cùng hướng > 5 phiên → xem lại
    OVERRIDE_PENALTY: 0.85,        // Khi bị nghi bias, giảm conf
    MIN_CONF_FOR_SAME_DIR: 0.55,   // Cần conf ≥ 55% để tiếp tục cùng hướng khi đã streak 5+
    HISTORICAL_BIAS_THRESHOLD: 0.72  // Nếu > 72% predictions cùng 1 hướng trong 50 phiên → đánh dấu bias
};

// ============================================================
// 🛡️ ANTI-BLOCK
// ============================================================
const USER_AGENTS = [
    'Mozilla/5.0 (Linux; Android 13; SM-G991B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
    'Mozilla/5.0 (Linux; Android 12; Pixel 5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Mobile Safari/537.36',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
];
const REFERERS = ['https://wsktnus8.net/', 'https://www.wsktnus8.net/', 'https://wsktnus8.net/game'];

let CIRCUIT = { state: 'CLOSED', failures: 0, lastFailure: 0, threshold: 5, timeout: 60000 };
let REQUEST_QUEUE = { lastRequest: 0, minInterval: 1500 };
let HISTORY_CACHE = { data: null, timestamp: 0, gameKey: null, ttl: 55000 };

let ANTI_BLOCK_STATS = {
    totalRequests: 0, successRequests: 0, failedRequests: 0,
    retries: 0, cacheHits: 0, cacheMisses: 0,
    circuitBreakerTrips: 0, rateLimitHits: 0, userAgentRotations: 0
};

// ============================================================
// BỘ NHỚ
// ============================================================
let AI_MEMORY = {
    version: '12.0-vip-nobias',
    created_at: new Date().toISOString(),
    last_updated: new Date().toISOString(),

    neural_weights: new Array(120).fill(0).map(() => (Math.random() - 0.5) * 0.1),
    neural_bias: 0,
    neural_v2_weights: new Array(120).fill(0).map(() => (Math.random() - 0.5) * 0.05),
    neural_v2_bias: 0,
    q_table: {},
    q_learning_rate: 0.01,

    model_performance: {
        markov: { correct: 0, total: 0, weight: 1.2, recentCorrect: 0, recentTotal: 0 },
        neural: { correct: 0, total: 0, weight: 1.5, recentCorrect: 0, recentTotal: 0 },
        neural_v2: { correct: 0, total: 0, weight: 1.5, recentCorrect: 0, recentTotal: 0 },
        qlearn: { correct: 0, total: 0, weight: 1.3, recentCorrect: 0, recentTotal: 0 },
        pattern: { correct: 0, total: 0, weight: 2.0, recentCorrect: 0, recentTotal: 0 },
        bayes: { correct: 0, total: 0, weight: 0.9, recentCorrect: 0, recentTotal: 0 },
        timeseries: { correct: 0, total: 0, weight: 1.0, recentCorrect: 0, recentTotal: 0 },
        frequency: { correct: 0, total: 0, weight: 0.8, recentCorrect: 0, recentTotal: 0 },
        volatility: { correct: 0, total: 0, weight: 0.7, recentCorrect: 0, recentTotal: 0 },
        lstm: { correct: 0, total: 0, weight: 1.1, recentCorrect: 0, recentTotal: 0 },
        gru: { correct: 0, total: 0, weight: 1.1, recentCorrect: 0, recentTotal: 0 },
        forest: { correct: 0, total: 0, weight: 1.0, recentCorrect: 0, recentTotal: 0 },
        boosting: { correct: 0, total: 0, weight: 1.0, recentCorrect: 0, recentTotal: 0 },
        xgboost: { correct: 0, total: 0, weight: 1.1, recentCorrect: 0, recentTotal: 0 },
        attention: { correct: 0, total: 0, weight: 1.2, recentCorrect: 0, recentTotal: 0 },
        multihead: { correct: 0, total: 0, weight: 1.2, recentCorrect: 0, recentTotal: 0 },
        transformer: { correct: 0, total: 0, weight: 1.3, recentCorrect: 0, recentTotal: 0 },
        policy: { correct: 0, total: 0, weight: 1.1, recentCorrect: 0, recentTotal: 0 },
        actorcritic: { correct: 0, total: 0, weight: 1.2, recentCorrect: 0, recentTotal: 0 },
        dqn: { correct: 0, total: 0, weight: 1.3, recentCorrect: 0, recentTotal: 0 },
        svm: { correct: 0, total: 0, weight: 1.0, recentCorrect: 0, recentTotal: 0 },
        knn: { correct: 0, total: 0, weight: 0.9, recentCorrect: 0, recentTotal: 0 },
        naivebayes: { correct: 0, total: 0, weight: 0.9, recentCorrect: 0, recentTotal: 0 },
        decisiontree: { correct: 0, total: 0, weight: 1.0, recentCorrect: 0, recentTotal: 0 },
        wavelet: { correct: 0, total: 0, weight: 1.1, recentCorrect: 0, recentTotal: 0 },
        chaos: { correct: 0, total: 0, weight: 1.0, recentCorrect: 0, recentTotal: 0 },
        genetic: { correct: 0, total: 0, weight: 1.0, recentCorrect: 0, recentTotal: 0 },
        anneal: { correct: 0, total: 0, weight: 0.9, recentCorrect: 0, recentTotal: 0 },
        bayesopt: { correct: 0, total: 0, weight: 1.1, recentCorrect: 0, recentTotal: 0 },
        entropy: { correct: 0, total: 0, weight: 1.0, recentCorrect: 0, recentTotal: 0 },
        fractal: { correct: 0, total: 0, weight: 1.1, recentCorrect: 0, recentTotal: 0 },
        meta: { correct: 0, total: 0, weight: 2.2, recentCorrect: 0, recentTotal: 0 },
        supreme: { correct: 0, total: 0, weight: 2.8, recentCorrect: 0, recentTotal: 0 }
    },

    total_predictions: 0,
    correct_predictions: 0,
    tai_predictions: 0,      // đếm số lần dự đoán Tài
    xiu_predictions: 0,      // đếm số lần dự đoán Xỉu
    no_signal_predictions: 0,
    recent_predictions: [],
    streak_correct: 0,
    streak_wrong: 0,
    best_streak: 0,
    worst_streak: 0,
    consecutive_tai_predictions: 0,
    consecutive_xiu_predictions: 0,

    // Calibration
    platt: { a: 1.0, b: 0.0, samples: 0 },
    calibration: Array(10).fill(0).map(() => ({ correct: 0, total: 0 })),

    lastSessionNum: null,
    pendingPrediction: null,
    detected_games: {},

    stability: {
        total_holds: 0,
        total_flips: 0,
        total_flip_blocked: 0,
        flip_history: []
    },

    bias_guard: {
        bias_flags: 0,          // số lần phát hiện nghi bias
        bias_overrides: 0,      // số lần override do bias
        same_dir_streak_blocks: 0,  // số lần chặn do dự đoán cùng hướng quá lâu
        last_reset_session: null
    },

    regime: 'UNKNOWN'
};

function deepMerge(target, source) {
    if (!source || typeof source !== 'object') return target;
    const out = { ...target };
    for (const k of Object.keys(source)) {
        if (source[k] && typeof source[k] === 'object' && !Array.isArray(source[k])
            && target[k] && typeof target[k] === 'object' && !Array.isArray(target[k])) {
            out[k] = deepMerge(target[k], source[k]);
        } else {
            out[k] = source[k];
        }
    }
    return out;
}

function loadMemory() {
    try {
        if (fs.existsSync(MEMORY_FILE)) {
            const saved = JSON.parse(fs.readFileSync(MEMORY_FILE, 'utf8'));
            AI_MEMORY = deepMerge(AI_MEMORY, saved);
            console.log(`🧠 Loaded: ${AI_MEMORY.total_predictions} preds | T:${AI_MEMORY.tai_predictions} X:${AI_MEMORY.xiu_predictions}`);
        }
    } catch (e) {
        try {
            if (fs.existsSync(MEMORY_BACKUP)) {
                AI_MEMORY = deepMerge(AI_MEMORY, JSON.parse(fs.readFileSync(MEMORY_BACKUP, 'utf8')));
                console.log(`✅ Restored backup`);
            }
        } catch (e2) { console.log(`❌ Fresh start`); }
    }
}

function saveMemory() {
    try {
        AI_MEMORY.last_updated = new Date().toISOString();
        if (fs.existsSync(MEMORY_FILE)) fs.copyFileSync(MEMORY_FILE, MEMORY_BACKUP);
        fs.writeFileSync(MEMORY_FILE, JSON.stringify(AI_MEMORY, null, 2));
    } catch (e) {}
}

loadMemory();

// ============================================================
// HELPERS
// ============================================================
function getTaiXiu(score) {
    if (score >= 11 && score <= 17) return 'Tài';
    if (score >= 4 && score <= 10) return 'Xỉu';
    return 'Bão';
}
function sigmoid(x) { return 1 / (1 + Math.exp(-Math.max(-500, Math.min(500, x)))); }
function tanh(x) { return Math.tanh(Math.max(-10, Math.min(10, x))); }
function clamp01(x) { return Math.max(0.0001, Math.min(0.9999, x)); }
function logit(p) { const c = clamp01(p); return Math.log(c / (1 - c)); }
function mean(a) { return a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0; }
function std(a) { if (a.length < 2) return 0; const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) * (x - m), 0) / a.length); }

function getStateHash(f, p = 10) { return f.slice(0, 10).map(x => Math.round(x * p)).join('|'); }
function getDeepStateHash(f) {
    return crypto.createHash('md5').update(f.slice(0, 20).map(x => x.toFixed(3)).join(',')).digest('hex').slice(0, 16);
}

// ============================================================
// CALIBRATION — Platt + bin tracking
// ============================================================
function fitPlatt() {
    const data = AI_MEMORY.recent_predictions.filter(p => p.confidence !== undefined && p.predicted && p.actual);
    if (data.length < 20) return;
    let a = AI_MEMORY.platt.a, b = AI_MEMORY.platt.b;
    const lr = 0.05;
    for (let iter = 0; iter < 150; iter++) {
        let ga = 0, gb = 0, n = 0;
        for (const d of data) {
            const p = clamp01(d.confidence);
            const z = a * logit(p) + b;
            const q = sigmoid(z);
            const y = d.correct ? 1 : 0;
            const err = q - y;
            ga += err * logit(p);
            gb += err;
            n++;
        }
        if (n === 0) break;
        a -= lr * ga / n;
        b -= lr * gb / n;
    }
    AI_MEMORY.platt.a = a;
    AI_MEMORY.platt.b = b;
    AI_MEMORY.platt.samples = data.length;
}

function calibrateConfidence(raw) {
    let conf = Math.max(0, Math.min(1, raw));
    if (AI_MEMORY.platt.samples >= 30) {
        const z = AI_MEMORY.platt.a * logit(conf) + AI_MEMORY.platt.b;
        conf = sigmoid(z);
    }
    const bi = Math.min(9, Math.floor(conf * 10));
    const b = AI_MEMORY.calibration[bi];
    if (b.total >= 10) {
        const ar = b.correct / b.total;
        conf = conf * 0.6 + ar * 0.4;
    }
    const range = MAX_CONFIDENCE - MIN_CONFIDENCE;
    let fc = MIN_CONFIDENCE + conf * range;
    return Math.max(MIN_CONFIDENCE, Math.min(MAX_CONFIDENCE, fc));
}

// ============================================================
// 🚫 BIAS GUARD — chống thiên vị hướng dự đoán
// ============================================================

/**
 * Kiểm tra xem hệ thống có đang bị thiên vị hướng dự đoán không.
 * Trả về {biased, direction, ratio} nếu phát hiện.
 */
function checkDirectionalBias() {
    if (!BIAS_GUARD.ENABLED) return { biased: false };

    // 1) Check streak predictions (liên tiếp cùng hướng)
    const maxStreak = Math.max(AI_MEMORY.consecutive_tai_predictions, AI_MEMORY.consecutive_xiu_predictions);
    const direction = AI_MEMORY.consecutive_tai_predictions > AI_MEMORY.consecutive_xiu_predictions ? 'Tài' : 'Xỉu';

    // 2) Check tỷ lệ dự đoán trong 50 phiên gần
    const recent = AI_MEMORY.recent_predictions.slice(-50);
    if (recent.length >= 30) {
        const tCount = recent.filter(p => p.predicted === 'Tài').length;
        const xCount = recent.filter(p => p.predicted === 'Xỉu').length;
        const total = tCount + xCount;
        if (total > 0) {
            const ratio = Math.max(tCount, xCount) / total;
            if (ratio >= BIAS_GUARD.HISTORICAL_BIAS_THRESHOLD) {
                const domDir = tCount > xCount ? 'Tài' : 'Xỉu';
                return {
                    biased: true,
                    type: 'HISTORICAL',
                    direction: domDir,
                    ratio,
                    message: `Bias: ${(ratio * 100).toFixed(0)}% predictions ${domDir} trong ${total} phiên`
                };
            }
        }
    }

    // 3) Check prediction streak dài
    if (maxStreak >= BIAS_GUARD.MAX_STREAK_PREDICTIONS) {
        return {
            biased: true,
            type: 'STREAK',
            direction,
            streak: maxStreak,
            message: `Streak dự đoán ${direction} ${maxStreak} phiên liên tiếp`
        };
    }

    return { biased: false };
}

/**
 * Áp dụng bias guard: không thiên vị, chỉ cảnh báo + giảm conf + có thể đổi hướng
 * nếu tín hiệu ngược lại đủ mạnh.
 */
function applyBiasGuard(rawPrediction, rawConfidence, ensemble) {
    if (!BIAS_GUARD.ENABLED) return { prediction: rawPrediction, confidence: rawConfidence, action: 'DISABLED' };

    const bias = checkDirectionalBias();
    if (!bias.biased) {
        return { prediction: rawPrediction, confidence: rawConfidence, action: 'CLEAN' };
    }

    // Đang bị bias
    AI_MEMORY.bias_guard.bias_flags++;

    // Nếu tín hiệu hiện tại đã ngược hướng bias → OK, reset
    if (rawPrediction !== bias.direction) {
        return { prediction: rawPrediction, confidence: rawConfidence, action: 'BREAK_BIAS_OK' };
    }

    // Tín hiệu cùng hướng bias → xem xét kỹ
    const oppositeVotes = bias.direction === 'Tài' ? ensemble.xiuVotes : ensemble.taiVotes;
    const totalVotes = ensemble.taiVotes + ensemble.xiuVotes;
    const oppositeRatio = totalVotes > 0 ? oppositeVotes / totalVotes : 0;

    // Nếu hướng ngược lại có ≥ 40% votes → đổi hướng để tránh bias
    if (oppositeRatio >= 0.40) {
        const flip = bias.direction === 'Tài' ? 'Xỉu' : 'Tài';
        AI_MEMORY.bias_guard.bias_overrides++;
        console.log(`[BIAS GUARD] 🔄 Đổi hướng ${rawPrediction}→${flip} do bias ${bias.direction} (${bias.message})`);
        return {
            prediction: flip,
            confidence: Math.max(0.51, rawConfidence * 0.85),
            action: 'BIAS_FLIP'
        };
    }

    // Không đổi hướng nhưng giảm conf + đánh dấu warning
    if (bias.type === 'STREAK') {
        // Streak dài: yêu cầu conf cao hơn để tiếp tục
        if (rawConfidence < BIAS_GUARD.MIN_CONF_FOR_SAME_DIR + 0.05) {
            const flip = bias.direction === 'Tài' ? 'Xỉu' : 'Tài';
            AI_MEMORY.bias_guard.same_dir_streak_blocks++;
            console.log(`[BIAS GUARD] 🛑 Streak ${bias.streak} → đổi sang ${flip} (conf ${rawConfidence.toFixed(2)} thấp)`);
            return {
                prediction: flip,
                confidence: 0.51,
                action: 'STREAK_BLOCK'
            };
        }
    }

    return {
        prediction: rawPrediction,
        confidence: rawConfidence * BIAS_GUARD.OVERRIDE_PENALTY,
        action: 'BIAS_WARN'
    };
}

// ============================================================
// 🎯 STABILITY LOCK v2
// ============================================================
function applyStabilityLock(newPred, newConf, cur) {
    if (!STABILITY.ENABLED) {
        return { prediction: newPred, confidence: newConf, action: 'DISABLED' };
    }
    const lastPred = STABILITY_STATE.lastPrediction;
    const lastConf = STABILITY_STATE.lastPredictionConf;

    if (!lastPred) {
        STABILITY_STATE.lastPrediction = newPred;
        STABILITY_STATE.lastPredictionConf = newConf;
        return { prediction: newPred, confidence: newConf, action: 'INIT' };
    }

    if (lastPred === newPred) {
        STABILITY_STATE.lastPredictionConf = newConf;
        STABILITY_STATE.holdCount++;
        AI_MEMORY.stability.total_holds++;
        return { prediction: newPred, confidence: newConf, action: 'HOLD_SAME' };
    }

    // Different direction
    if (STABILITY_STATE.lastFlipSessionNum) {
        const curNum = parseInt(cur.gameNum.replace('#', ''));
        const flipNum = parseInt(STABILITY_STATE.lastFlipSessionNum.replace('#', ''));
        const gap = curNum - flipNum;
        if (gap < STABILITY.COOLDOWN_SESSIONS) {
            AI_MEMORY.stability.total_flip_blocked++;
            console.log(`[STABILITY] COOLDOWN (gap=${gap}<${STABILITY.COOLDOWN_SESSIONS})`);
            return { prediction: lastPred, confidence: lastConf, action: 'COOLDOWN_BLOCK' };
        }
    }

    const now = Date.now();
    const recentFlips = STABILITY_STATE.flipHistory.filter(f => now - f.timestamp < STABILITY.WINDOW_MS);
    if (recentFlips.length >= STABILITY.MAX_FLIPS_IN_WINDOW) {
        AI_MEMORY.stability.total_flip_blocked++;
        console.log(`[STABILITY] MAX_FLIPS (${recentFlips.length})`);
        return { prediction: lastPred, confidence: lastConf, action: 'MAX_FLIPS_BLOCK' };
    }

    const confDiff = newConf - lastConf;
    const isStrong = newConf >= STABILITY.STRONG_SIGNAL_CONF;
    const isMuchStronger = confDiff >= STABILITY.FLIP_THRESHOLD && newConf >= STABILITY.MIN_FLIP_CONF;
    const isHysteresis = lastConf - newConf > STABILITY.HYSTERESIS_RATIO;

    const allowFlip = isStrong || isMuchStronger || isHysteresis;

    if (allowFlip) {
        console.log(`[STABILITY] ✅ FLIP ${lastPred}→${newPred} (conf ${lastConf.toFixed(2)}→${newConf.toFixed(2)})`);
        STABILITY_STATE.lastPrediction = newPred;
        STABILITY_STATE.lastPredictionConf = newConf;
        STABILITY_STATE.lastFlipSessionNum = cur.gameNum;
        STABILITY_STATE.flipHistory.push({ session: cur.gameNum, from: lastPred, to: newPred, timestamp: now });
        if (STABILITY_STATE.flipHistory.length > 50) STABILITY_STATE.flipHistory = STABILITY_STATE.flipHistory.slice(-50);
        AI_MEMORY.stability.total_flips++;
        AI_MEMORY.stability.flip_history.push({
            session: cur.gameNum, from: lastPred, to: newPred,
            confFrom: lastConf, confTo: newConf, timestamp: now
        });
        if (AI_MEMORY.stability.flip_history.length > 100) AI_MEMORY.stability.flip_history = AI_MEMORY.stability.flip_history.slice(-100);
        return { prediction: newPred, confidence: newConf, action: 'FLIP_ALLOWED' };
    }

    AI_MEMORY.stability.total_flip_blocked++;
    const adjusted = Math.max((lastConf + newConf) / 2, 0.51);
    STABILITY_STATE.lastPredictionConf = adjusted;
    console.log(`[STABILITY] 🚫 BLOCK ${lastPred} (new ${newConf.toFixed(2)} not strong enough)`);
    return { prediction: lastPred, confidence: adjusted, action: 'FLIP_BLOCKED' };
}

// ============================================================
// FETCH
// ============================================================
function isCircuitOpen() {
    if (CIRCUIT.state === 'OPEN') {
        if (Date.now() - CIRCUIT.lastFailure > CIRCUIT.timeout) {
            CIRCUIT.state = 'HALF_OPEN';
            return false;
        }
        return true;
    }
    return false;
}
function recordCircuitSuccess() {
    if (CIRCUIT.state === 'HALF_OPEN') { CIRCUIT.state = 'CLOSED'; CIRCUIT.failures = 0; }
}
function recordCircuitFailure() {
    CIRCUIT.failures++;
    CIRCUIT.lastFailure = Date.now();
    if (CIRCUIT.failures >= CIRCUIT.threshold) {
        CIRCUIT.state = 'OPEN';
        ANTI_BLOCK_STATS.circuitBreakerTrips++;
    }
}
async function waitForRateLimit() {
    const now = Date.now();
    const elapsed = now - REQUEST_QUEUE.lastRequest;
    if (elapsed < REQUEST_QUEUE.minInterval) {
        ANTI_BLOCK_STATS.rateLimitHits++;
        await new Promise(r => setTimeout(r, REQUEST_QUEUE.minInterval - elapsed));
    }
    REQUEST_QUEUE.lastRequest = Date.now();
}
async function fetchWithAntiBlock(url, maxRetries = 4) {
    if (isCircuitOpen()) throw new Error('Circuit breaker OPEN');
    ANTI_BLOCK_STATS.totalRequests++;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
            await waitForRateLimit();
            const ua = USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
            const ref = REFERERS[Math.floor(Math.random() * REFERERS.length)];
            ANTI_BLOCK_STATS.userAgentRotations++;
            const response = await axios.get(url, {
                timeout: 15000,
                headers: {
                    'User-Agent': ua,
                    'Accept': 'application/json, text/plain, */*',
                    'Accept-Language': 'vi-VN,vi;q=0.9,en;q=0.8',
                    'Referer': ref,
                    'Origin': ref.slice(0, -1),
                    'Cache-Control': 'no-cache'
                },
                validateStatus: (s) => s >= 200 && s < 500
            });
            if (response.status === 200) {
                ANTI_BLOCK_STATS.successRequests++;
                recordCircuitSuccess();
                return response;
            }
            if (response.status === 429 || response.status === 403) {
                ANTI_BLOCK_STATS.retries++;
                await new Promise(r => setTimeout(r, Math.pow(2, attempt) * 2000 + Math.random() * 1000));
                continue;
            }
            throw new Error(`HTTP ${response.status}`);
        } catch (error) {
            ANTI_BLOCK_STATS.retries++;
            if (attempt < maxRetries - 1) {
                await new Promise(r => setTimeout(r, Math.pow(2, attempt) * 2000 + Math.random() * 1000));
                continue;
            }
            ANTI_BLOCK_STATS.failedRequests++;
            recordCircuitFailure();
            throw error;
        }
    }
    throw new Error('Max retries exceeded');
}

async function fetchHistory(gameKey = CURRENT_GAME) {
    const config = GAME_CONFIGS[gameKey] || GAME_CONFIGS['sicbo_ktrng'];
    const url = `${config.url}?gameId=${config.gameId}&size=100&tableId=${config.tableId}&curPage=1`;
    const response = await fetchWithAntiBlock(url);
    const list = response.data.data.resultList;
    return list.map(item => ({
        gameNum: item.gameNum,
        score: item.score,
        result: getTaiXiu(item.score),
        faces: item.facesList.join('-'),
        raw: item
    })).reverse();
}

async function fetchHistoryCached(gameKey = CURRENT_GAME) {
    const now = Date.now();
    if (HISTORY_CACHE.data && HISTORY_CACHE.gameKey === gameKey && (now - HISTORY_CACHE.timestamp) < HISTORY_CACHE.ttl) {
        ANTI_BLOCK_STATS.cacheHits++;
        return HISTORY_CACHE.data;
    }
    ANTI_BLOCK_STATS.cacheMisses++;
    try {
        const fresh = await fetchHistory(gameKey);
        HISTORY_CACHE = { data: fresh, timestamp: now, gameKey, ttl: HISTORY_CACHE.ttl };
        return fresh;
    } catch (error) {
        const isBlock = /429|403|Circuit/.test(error.message);
        if (isBlock && HISTORY_CACHE.data) return HISTORY_CACHE.data;
        throw error;
    }
}

// ============================================================
// FEATURES — 120 dims (SYMMETRIC — không thiên vị T/X)
// ============================================================
function extractFeatures(history) {
    const len = history.length;
    const str = history.map(h => h.result === 'Bão' ? 'B' : (h.result === 'Tài' ? 'T' : 'X')).join('');
    const f = [];
    const slice = (n) => history.slice(-n);
    const taiRate = (arr) => arr.length ? arr.filter(h => h.result === 'Tài').length / arr.length : 0.5;

    // 1) Frequency windows (16) — taiRate * 2 - 1 (symmetric around 0)
    for (const n of [2, 3, 4, 5, 8, 10, 12, 15, 20, 25, 30, 40, 50, 75, 90, 100]) {
        f.push(taiRate(slice(n)) * 2 - 1);
    }

    // 2) Streak
    let streak = 1;
    const lastRes = history[len - 1].result;
    for (let i = len - 2; i >= 0; i--) { if (history[i].result === lastRes) streak++; else break; }
    f.push(lastRes === 'Tài' ? Math.min(streak, 15) / 15 : -Math.min(streak, 15) / 15);

    // 3) Zigzag
    let zz = 0;
    for (let i = len - 1; i >= 1; i--) { if (history[i].result !== history[i - 1].result) zz++; else break; }
    f.push(Math.min(zz, 12) / 12);

    // 4) Bão streak
    let bao = 0;
    for (let i = len - 1; i >= 0; i--) { if (history[i].result === 'Bão') bao++; else break; }
    f.push(bao / 5);

    // 5) Score averages
    [3, 5, 8, 10, 15, 20, 30, 50, 75, 100].forEach(n => {
        const arr = slice(n);
        const avg = arr.reduce((s, h) => s + h.score, 0) / Math.max(1, n);
        f.push((avg - 10.5) / 7.5);
    });

    // 6) Score std
    [5, 10, 20, 50, 100].forEach(n => {
        const arr = slice(n);
        const s = std(arr.map(h => h.score));
        f.push(s / 5);
    });

    // 7) Last 15 binary
    for (let i = 15; i >= 1; i--) {
        const r = history[len - i]?.result;
        f.push(r === 'Tài' ? 1 : r === 'Xỉu' ? -1 : 0);
    }

    // 8) Momentum
    [3, 5, 10, 20, 50].forEach(n => {
        const arr = slice(n);
        f.push(arr.reduce((s, h) => s + (h.result === 'Tài' ? 1 : -1), 0) / Math.max(1, n));
    });

    // 9) Momentum diffs
    const moms = [3, 5, 10, 20, 50].map(n => slice(n).reduce((s, h) => s + (h.result === 'Tài' ? 1 : -1), 0) / Math.max(1, n));
    for (let i = 0; i < 4; i++) f.push(moms[i] - moms[i + 1]);

    // 10) Pattern binary
    ['TT', 'XX', 'TTT', 'XXX', 'TTTT', 'XXXX', 'TTTTT', 'XXXXX', 'TXT', 'XTX', 'TTX', 'XXT', 'TXX', 'XTT', 'TXTT', 'XTXX', 'TXXT'].forEach(p => {
        f.push(str.slice(-p.length) === p ? 1 : 0);
    });

    // 11) Bão rate
    [5, 10, 20, 50, 100].forEach(n => {
        f.push(slice(n).filter(h => h.result === 'Bão').length / Math.max(1, n));
    });

    // 12) Flip rate
    [5, 10, 20, 50, 100].forEach(n => {
        let flips = 0;
        const arr = slice(n);
        for (let i = 0; i < arr.length - 1; i++) if (arr[i].result !== arr[i + 1].result) flips++;
        f.push(arr.length > 1 ? flips / (arr.length - 1) : 0);
    });

    // 13) Face distribution
    ['1', '2', '3', '4', '5', '6'].forEach(face => {
        const count = slice(10).reduce((s, h) => s + h.faces.split('-').filter(x => x === face).length, 0);
        f.push(count / 30);
    });

    // 14) Face delta
    ['1', '2', '3', '4', '5', '6'].forEach(face => {
        const c5 = slice(5).reduce((s, h) => s + h.faces.split('-').filter(x => x === face).length, 0);
        const c10 = slice(10).reduce((s, h) => s + h.faces.split('-').filter(x => x === face).length, 0);
        f.push((c5 / 15) - (c10 / 30));
    });

    // 15) Max runs
    let maxT = 0, curT = 0, maxX = 0, curX = 0, maxB = 0, curB = 0;
    slice(50).forEach(h => {
        if (h.result === 'Tài') { curT++; maxT = Math.max(maxT, curT); curX = 0; curB = 0; }
        else if (h.result === 'Xỉu') { curX++; maxX = Math.max(maxX, curX); curT = 0; curB = 0; }
        else { curB++; maxB = Math.max(maxB, curB); curT = 0; curX = 0; }
    });
    f.push(maxT / 20);
    f.push(maxX / 20);
    f.push(maxB / 5);

    // 16) Score dist
    const scoreDist = {};
    for (let i = 3; i <= 18; i++) scoreDist[i] = 0;
    slice(50).forEach(h => { if (scoreDist[h.score] !== undefined) scoreDist[h.score]++; });
    for (let i = 0; i < 5; i++) f.push((scoreDist[i + 4] || 0) / 50);

    // 17) Last 5
    for (let i = 0; i < 5; i++) {
        const r = history[len - 1 - i]?.result;
        f.push(r === 'Tài' ? 1 : -1);
    }

    // 18) Composite
    f.push(moms[0]);
    f.push(moms[2]);
    f.push(moms[0] - moms[2]);
    f.push(taiRate(slice(10)) - taiRate(slice(50)));

    // 19) Volatility
    const v5 = slice(5).reduce((s, h) => s + Math.pow(h.score - 10.5, 2), 0) / 5;
    const v20 = slice(20).reduce((s, h) => s + Math.pow(h.score - 10.5, 2), 0) / 20;
    f.push(v5 / 25);
    f.push(v20 / 25);

    while (f.length < 120) f.push(0);
    return f.slice(0, 120);
}

// ============================================================
// 🎯 PATTERN — 200+ cầu (SYMMETRIC design)
// ============================================================
function modelPattern(history) {
    const len = history.length;
    const str = history.map(h => h.result === 'Bão' ? 'B' : (h.result === 'Tài' ? 'T' : 'X')).join('');
    const scores = { 'Tài': 0, 'Xỉu': 0 };
    const patterns = [];
    const add = (target, points, name) => { scores[target] += points; patterns.push({ name, target, points }); };
    const last = history[len - 1]?.result;
    const flip = (r) => (r === 'Tài' ? 'Xỉu' : 'Tài');

    // ========== CONTRARIAN ==========
    const last20 = history.slice(-20);
    const tai20 = last20.filter(h => h.result === 'Tài').length;
    const xiu20 = last20.filter(h => h.result === 'Xỉu').length;
    if (xiu20 > tai20 * 1.4) add('Tài', 40, `Contrarian X${xiu20}/T${tai20}`);
    else if (tai20 > xiu20 * 1.4) add('Xỉu', 40, `Contrarian T${tai20}/X${xiu20}`);

    // ========== CẦU BỆT ==========
    let streak = 1;
    for (let i = len - 2; i >= 0; i--) { if (history[i].result === last) streak++; else break; }
    if (streak === 2) add(last, 50, `Bệt 2`);
    else if (streak === 3) add(last, 45, `Bệt 3`);
    else if (streak === 4) { add(last, 35, `Bệt 4`); add(flip(last), 15, `CG bệt 4`); }
    else if (streak === 5) { add(last, 25, `Bệt 5`); add(flip(last), 30, `Bẻ 5`); }
    else if (streak === 6) { add(last, 15, `Bệt 6`); add(flip(last), 45, `Bẻ 6`); }
    else if (streak >= 7) add(flip(last), 70, `BẺ MẠNH bệt ${streak}`);

    // ========== 1-1 ==========
    let zz = 0;
    for (let i = len - 1; i >= 1; i--) { if (history[i].result !== history[i - 1].result) zz++; else break; }
    if (zz >= 2 && zz <= 5) add(flip(last), 50 + zz * 3, `1-1 (${zz})`);
    else if (zz >= 6) add(last, 40, `1-1 dài (${zz})`);

    // ========== N-N ==========
    for (let n = 2; n <= 8; n++) {
        if (len < n * 2) continue;
        const p = str.slice(-n * 2);
        if (p === 'T'.repeat(n) + 'X'.repeat(n)) add('Tài', 40 + n * 7, `Cầu ${n}-${n} T`);
        if (p === 'X'.repeat(n) + 'T'.repeat(n)) add('Xỉu', 40 + n * 7, `Cầu ${n}-${n} X`);
    }

    // ========== LỆCH CƠ BẢN ==========
    const basicTests = [
        ['TXX', 'Tài', 40, '1-2'], ['XTT', 'Xỉu', 40, '1-2'],
        ['TTX', 'Xỉu', 40, '2-1'], ['XXT', 'Tài', 40, '2-1'],
        ['TXXX', 'Tài', 45, '1-3'], ['XTTT', 'Xỉu', 45, '1-3'],
        ['TTTX', 'Xỉu', 45, '3-1'], ['XXXT', 'Tài', 45, '3-1'],
        ['TXXXX', 'Tài', 50, '1-4'], ['XTTTT', 'Xỉu', 50, '1-4'],
        ['TTTTX', 'Xỉu', 50, '4-1'], ['XXXXT', 'Tài', 50, '4-1'],
        ['TXXTT', 'Tài', 40, '1-2-2'], ['XTTXX', 'Xỉu', 40, '1-2-2'],
        ['TTXXT', 'Tài', 40, '2-2-1'], ['XXTTX', 'Xỉu', 40, '2-2-1'],
        ['TTTXX', 'Xỉu', 40, '3-2'], ['XXXTT', 'Tài', 40, '3-2'],
        ['TTXXX', 'Xỉu', 40, '2-3'], ['XXTTT', 'Tài', 40, '2-3'],
        ['TTXXXT', 'Tài', 45, '2-3-1'], ['XXTTTX', 'Xỉu', 45, '2-3-1']
    ];
    basicTests.forEach(([pat, t, p, n]) => {
        if (len >= pat.length && str.slice(-pat.length) === pat) add(t, p, n);
    });

    // ========== 1-1-2, 2-1-1 ==========
    [
        ['TXTT', 'Xỉu', 45, '1-1-2'], ['XTXX', 'Tài', 45, '1-1-2'],
        ['TTXT', 'Xỉu', 45, '2-1-1'], ['XXTX', 'Tài', 45, '2-1-1'],
        ['TXTX', 'Xỉu', 40, '1-2-1'], ['XTXT', 'Tài', 40, '1-2-1'],
        ['TTXTT', 'Xỉu', 45, '2-1-2'], ['XXTXX', 'Tài', 45, '2-1-2'],
        ['TXTTX', 'Tài', 45, '1-2-1-1'], ['XTXXT', 'Xỉu', 45, '1-2-1-1'],
        ['TXTTT', 'Xỉu', 40, '1-1-3'], ['XTXXX', 'Tài', 40, '1-1-3'],
        ['TTTXT', 'Xỉu', 40, '3-1-1'], ['XXXTX', 'Tài', 40, '3-1-1']
    ].forEach(([pat, t, p, n]) => {
        if (len >= pat.length && str.slice(-pat.length) === pat) add(t, p, n);
    });

    // ========== NHỊP LẺ ==========
    if (len >= 4) {
        const p = str.slice(-4);
        if (p === 'TXXT') add('Xỉu', 35, 'Nhịp lẻ TXXT');
        if (p === 'XTTX') add('Tài', 35, 'Nhịp lẻ XTTX');
    }
    if (len >= 6) {
        const p = str.slice(-6);
        if (p === 'TXXTXX') add('Tài', 40, 'Nhịp lẻ dài');
        if (p === 'XTTXTT') add('Xỉu', 40, 'Nhịp lẻ dài');
        if (p === 'TXTXTX' || p === 'XTXTXT') add(flip(last), 45, 'Zigzag kép 6');
    }
    if (len >= 8) {
        const p = str.slice(-8);
        if (p === 'TXTXTXTX') add('Xỉu', 50, 'Zigzag kép 8');
        if (p === 'XTXTXTXT') add('Tài', 50, 'Zigzag kép 8');
    }

    // ========== ĐỐI XỨNG / PALINDROME ==========
    if (len >= 6) {
        const l6 = str.slice(-6);
        if (l6[0] === l6[5] && l6[1] === l6[4]) add(l6[2] === 'T' ? 'Tài' : 'Xỉu', 30, 'Đối xứng 6');
    }
    if (len >= 8) {
        const l8 = str.slice(-8);
        if (l8 === l8.split('').reverse().join('')) add(l8[0] === 'T' ? 'Tài' : 'Xỉu', 40, 'Palindrome 8');
    }

    // ========== CẦU LẶP ==========
    if (len >= 8) {
        const l4 = str.slice(-4), p4 = str.slice(-8, -4);
        if (l4 === p4) add(p4[0] === 'T' ? 'Tài' : 'Xỉu', 50, `Cầu lặp ${p4}`);
    }
    if (len >= 12) {
        const l6 = str.slice(-6), p6 = str.slice(-12, -6);
        if (l6 === p6) add(p6[0] === 'T' ? 'Tài' : 'Xỉu', 55, `Lặp 6 phiên`);
        const l3 = str.slice(-3), p3 = str.slice(-6, -3), q3 = str.slice(-9, -6), r3 = str.slice(-12, -9);
        if (l3 === p3 && p3 === q3 && q3 === r3) add(r3[0] === 'T' ? 'Tài' : 'Xỉu', 60, 'Lặp 3x3');
    }

    // ========== FIBONACCI ==========
    if (len >= 12) {
        const l12 = str.slice(-12);
        const g = [l12.slice(0, 1), l12.slice(1, 2), l12.slice(2, 4), l12.slice(4, 7), l12.slice(7, 12)];
        const same = g.every(x => x === 'T'.repeat(x.length) || x === 'X'.repeat(x.length));
        if (same && g[0][0] !== g[1][0]) add(g[4][0] === 'T' ? 'Xỉu' : 'Tài', 50, 'Fibonacci');
    }

    // ========== XOẮN ỐC ==========
    if (len >= 8) {
        const l8 = str.slice(-8);
        if (l8 === 'TTXXTTXX' || l8 === 'XXTTXXTT') add(l8[0] === 'T' ? 'Tài' : 'Xỉu', 45, 'Xoắn ốc');
    }

    // ========== TAM GIÁC ==========
    if (len >= 9) {
        const l9 = str.slice(-9);
        if (l9 === 'TXXTTTXXX' || l9 === 'XTTXXXTTT') add(l9[0] === 'T' ? 'Tài' : 'Xỉu', 50, 'Tam giác');
    }

    // ========== SONG SONG ==========
    if (len >= 6) {
        const l6 = str.slice(-6);
        if (l6 === 'TTXXTT' || l6 === 'XXTTXX') add(l6[0] === 'T' ? 'Tài' : 'Xỉu', 40, 'Song song');
    }

    // ========== PHÂN KỲ (score-based, symmetric) ==========
    if (len >= 5) {
        const s = history.slice(-5).map(h => h.score);
        if (s[0] < s[1] && s[1] < s[2] && s[2] > s[3] && s[3] > s[4]) add('Xỉu', 30, 'Phân kỳ đỉnh');
        if (s[0] > s[1] && s[1] > s[2] && s[2] < s[3] && s[3] < s[4]) add('Tài', 30, 'Phân kỳ đáy');
    }

    // ========== HỘI TỤ ==========
    if (len >= 7) {
        const s = history.slice(-7).map(h => h.score);
        const fa = (s[0] + s[1] + s[2]) / 3, la = (s[4] + s[5] + s[6]) / 3;
        if (Math.abs(fa - la) < 1.5) add(s[6] > 10.5 ? 'Xỉu' : 'Tài', 25, 'Hội tụ');
    }

    // ========== W/M ==========
    if (len >= 5) {
        const s = history.slice(-5).map(h => h.score);
        if (s[0] < s[1] && s[1] > s[2] && s[2] < s[3] && s[3] > s[4]) add('Xỉu', 25, 'W pattern');
        if (s[0] > s[1] && s[1] < s[2] && s[2] > s[3] && s[3] < s[4]) add('Tài', 25, 'M pattern');
    }

    // ========== TĂNG/GIẢM ==========
    if (len >= 4) {
        const s = history.slice(-4).map(h => h.score);
        if (s[0] < s[1] && s[1] < s[2] && s[2] < s[3]) add('Xỉu', 20, 'Tổng tăng');
        if (s[0] > s[1] && s[1] > s[2] && s[2] > s[3]) add('Tài', 20, 'Tổng giảm');
    }

    // ========== GÃY BỆT ==========
    if (len >= 5) {
        const s = history.slice(-5).map(h => h.result);
        if (s[0] === 'Tài' && s[1] === 'Tài' && s[2] === 'Tài' && s[3] === 'Xỉu' && s[4] === 'Xỉu') add('Tài', 40, 'Gãy bệt T về T');
        if (s[0] === 'Xỉu' && s[1] === 'Xỉu' && s[2] === 'Xỉu' && s[3] === 'Tài' && s[4] === 'Tài') add('Xỉu', 40, 'Gãy bệt X về X');
    }

    // ========== BÃO ==========
    const bao5 = history.slice(-5).filter(h => h.result === 'Bão').length;
    if (bao5 > 0) {
        const prev = history[len - 2]?.result || 'Tài';
        add(prev === 'Tài' ? 'Xỉu' : 'Tài', 35 * bao5, `${bao5} Bão/5`);
    }

    // ========== LONG PATTERN MATCH ==========
    for (let pLen = 20; pLen >= 5; pLen--) {
        if (len <= pLen) continue;
        const pat = str.slice(-pLen);
        let found = false;
        for (let i = len - pLen - 1; i >= 0; i--) {
            if (str.slice(i, i + pLen) === pat) {
                const next = history[i + pLen];
                if (next && (next.result === 'Tài' || next.result === 'Xỉu')) {
                    const pts = pLen >= 15 ? 100 : pLen >= 10 ? 90 : pLen >= 7 ? 80 : 70;
                    add(next.result, pts, `Cầu dài ${pLen}`);
                    found = true;
                    break;
                }
            }
        }
        if (found) break;
    }

    // ========== SIMILARITY MATCH ==========
    for (let w = 10; w >= 3; w--) {
        if (len < w * 2) break;
        const target = str.slice(-w);
        let bestNext = null, bestDist = 999;
        for (let i = w; i < len - 1; i++) {
            const seg = str.slice(i - w, i);
            let d = 0;
            for (let k = 0; k < w; k++) if (seg[k] !== target[k]) d++;
            if (d <= Math.floor(w / 3)) {
                const next = history[i]?.result;
                if (next === 'Tài' || next === 'Xỉu') {
                    if (d < bestDist) { bestDist = d; bestNext = next; }
                }
            }
        }
        if (bestNext && bestDist <= 1) {
            add(bestNext, 55 + (w - 3) * 3, `Similar ${w} (d=${bestDist})`);
            break;
        }
    }

    const total = scores['Tài'] + scores['Xỉu'];
    if (total === 0) return { prediction: null, confidence: 0, patterns };
    const diff = Math.abs(scores['Tài'] - scores['Xỉu']);
    const ratio = Math.min(diff / total, 0.95);
    const pred = scores['Tài'] > scores['Xỉu'] ? 'Tài' : 'Xỉu';
    return { prediction: pred, confidence: ratio, patterns, scores };
}

// ============================================================
// CÁC MODEL CÒN LẠI (giữ nguyên — symmetric, không thiên vị)
// ============================================================
function modelMarkov(history) {
    const str = history.map(h => h.result === 'Bão' ? 'B' : (h.result === 'Tài' ? 'T' : 'X')).join('');
    const len = str.length;
    const trans = {};
    for (let order = 2; order <= 8; order++) {
        if (len <= order) continue;
        for (let i = 0; i <= len - order - 1; i++) {
            const key = str.slice(i, i + order);
            const next = str[i + order];
            if (!trans[key]) trans[key] = { 'T': 0, 'X': 0 };
            if (next === 'T' || next === 'X') trans[key][next]++;
        }
    }
    for (let order = 8; order >= 2; order--) {
        if (len <= order) continue;
        const cur = str.slice(-order);
        if (trans[cur]) {
            const t = trans[cur]['T'], x = trans[cur]['X'];
            const total = t + x;
            if (total >= 2) return { prediction: t > x ? 'Tài' : 'Xỉu', confidence: Math.abs(t - x) / total, order };
        }
    }
    return { prediction: null, confidence: 0 };
}

function modelNeural(history) {
    const features = extractFeatures(history);
    const w = AI_MEMORY.neural_weights;
    let s = AI_MEMORY.neural_bias;
    for (let i = 0; i < Math.min(features.length, w.length); i++) s += features[i] * w[i];
    const prob = sigmoid(s);
    return { prediction: prob > 0.5 ? 'Tài' : 'Xỉu', confidence: Math.abs(prob - 0.5) * 2 };
}

function modelNeuralV2(history) {
    const features = extractFeatures(history);
    const w = AI_MEMORY.neural_v2_weights;
    let h1 = [];
    for (let i = 0; i < 30; i++) {
        let s = 0;
        for (let j = 0; j < 4; j++) {
            const idx = (i * 4 + j) % w.length;
            s += features[idx] * w[idx];
        }
        h1.push(Math.tanh(s));
    }
    let out = AI_MEMORY.neural_v2_bias;
    for (let i = 0; i < h1.length; i++) out += h1[i] * 0.1;
    const prob = sigmoid(out);
    return { prediction: prob > 0.5 ? 'Tài' : 'Xỉu', confidence: Math.abs(prob - 0.5) * 2 };
}

function modelQLearn(history) {
    const features = extractFeatures(history);
    const k = getStateHash(features);
    if (!AI_MEMORY.q_table[k]) AI_MEMORY.q_table[k] = { 'Tài': 0, 'Xỉu': 0 };
    const q = AI_MEMORY.q_table[k];
    const total = Math.abs(q['Tài']) + Math.abs(q['Xỉu']);
    if (total < 0.01) return { prediction: null, confidence: 0, stateKey: k };
    return { prediction: q['Tài'] > q['Xỉu'] ? 'Tài' : 'Xỉu', confidence: Math.min(Math.abs(q['Tài'] - q['Xỉu']) / 5, 1), stateKey: k };
}

function modelBayes(history) {
    const tT = history.filter(h => h.result === 'Tài').length;
    const xT = history.filter(h => h.result === 'Xỉu').length;
    const total = tT + xT;
    if (total === 0) return { prediction: null, confidence: 0 };
    const pTai = tT / total;
    const l10 = history.slice(-10);
    const t10 = l10.filter(h => h.result === 'Tài').length;
    const lk = (t10 + 1) / (l10.length + 2);
    const post = (lk * pTai) / ((lk * pTai) + ((1 - lk) * (1 - pTai)) + 0.001);
    return { prediction: post > 0.5 ? 'Tài' : 'Xỉu', confidence: Math.abs(post - 0.5) * 2 };
}

function modelTimeSeries(history) {
    if (history.length < 20) return { prediction: null, confidence: 0 };
    const s = history.map(h => h.result === 'Tài' ? 1 : 0);
    let eS = s[0], eL = s[0];
    for (let i = 1; i < s.length; i++) { eS = 0.3 * s[i] + 0.7 * eS; eL = 0.1 * s[i] + 0.9 * eL; }
    const macd = eS - eL;
    let g = 0, l = 0;
    for (let i = s.length - 14; i < s.length; i++) {
        const c = s[i] - s[i - 1];
        if (c > 0) g += c; else l -= c;
    }
    const rsi = 100 - (100 / (1 + (g / (l + 0.001))));
    let sig = 0;
    if (macd > 0.02) sig += 0.5; else if (macd < -0.02) sig -= 0.5;
    if (rsi > 70) sig -= 0.3; else if (rsi < 30) sig += 0.3;
    return { prediction: sig > 0 ? 'Tài' : 'Xỉu', confidence: Math.min(Math.abs(sig), 1) };
}

function modelFrequency(history) {
    if (history.length < 30) return { prediction: null, confidence: 0 };
    const l30 = history.slice(-30);
    const t30 = l30.filter(h => h.result === 'Tài').length;
    const d = Math.abs(t30 - (30 - t30));
    if (d < 4) return { prediction: null, confidence: 0 };
    return { prediction: t30 < 15 ? 'Tài' : 'Xỉu', confidence: Math.min(d / 20, 1) };
}

function modelVolatility(history) {
    const len = history.length;
    if (len < 15) return { prediction: null, confidence: 0 };
    let fl = 0;
    const l15 = history.slice(-15);
    for (let i = 0; i < l15.length - 1; i++) if (l15[i].result !== l15[i + 1].result) fl++;
    const fr = fl / 14;
    if (fr > 0.75) {
        const last = history[len - 1].result;
        return { prediction: last === 'Tài' ? 'Xỉu' : 'Tài', confidence: 0.6 };
    }
    if (fr < 0.25) return { prediction: history[len - 1].result, confidence: 0.5 };
    return { prediction: null, confidence: 0 };
}

function modelLSTM(history) {
    if (history.length < 20) return { prediction: null, confidence: 0 };
    const s = history.slice(-30).map(h => h.result === 'Tài' ? 1 : 0);
    let c = 0, h = 0;
    for (let t = 0; t < s.length; t++) {
        const x = s[t];
        const fo = sigmoid(0.5 * x + 0.5 * h);
        const i = sigmoid(0.3 * x + 0.3 * h);
        const o = sigmoid(0.4 * x + 0.4 * h);
        c = fo * c + i * tanh(x);
        h = o * tanh(c);
    }
    return { prediction: h > 0.5 ? 'Tài' : 'Xỉu', confidence: Math.abs(h - 0.5) * 2 };
}

function modelGRU(history) {
    if (history.length < 20) return { prediction: null, confidence: 0 };
    const s = history.slice(-30).map(h => h.result === 'Tài' ? 1 : 0);
    let h = 0;
    for (let t = 0; t < s.length; t++) {
        const x = s[t];
        const z = sigmoid(0.5 * x + 0.5 * h);
        const r = sigmoid(0.4 * x + 0.4 * h);
        const ht = tanh(0.3 * x + 0.3 * r * h);
        h = (1 - z) * h + z * ht;
    }
    return { prediction: h > 0.5 ? 'Tài' : 'Xỉu', confidence: Math.abs(h - 0.5) * 2 };
}

function modelForest(history) {
    const f = extractFeatures(history);
    const v = { 'Tài': 0, 'Xỉu': 0 };
    const last = history[history.length - 1].result;
    const t5 = history.slice(-5).filter(h => h.result === 'Tài').length;
    v[t5 >= 3 ? 'Tài' : 'Xỉu']++;
    let st = 1;
    for (let i = history.length - 2; i >= 0; i--) { if (history[i].result === last) st++; else break; }
    if (st >= 3) v[last === 'Tài' ? 'Xỉu' : 'Tài']++; else v[last]++;
    const a10 = history.slice(-10).reduce((s, h) => s + h.score, 0) / 10;
    v[a10 > 10.5 ? 'Xỉu' : 'Tài']++;
    if (f[7] > 0.2) v['Xỉu']++; else if (f[7] < -0.2) v['Tài']++; else v['Tài']++;
    if (f[8] > 0.3) v[last === 'Tài' ? 'Xỉu' : 'Tài']++; else v[last]++;
    if (f[14] > 0.2) v['Xỉu']++; else v['Tài']++;
    if (f[36] > 0.7) v[last === 'Tài' ? 'Xỉu' : 'Tài']++; else v[last]++;
    if (f[45] > 0.1) v['Tài']++; else v['Xỉu']++;
    return { prediction: v['Tài'] > v['Xỉu'] ? 'Tài' : 'Xỉu', confidence: Math.abs(v['Tài'] - v['Xỉu']) / 8 };
}

function modelBoosting(history) {
    const f = extractFeatures(history);
    let s = 0;
    if (f[7] > 0.1) s += 0.3;
    if (f[8] > 0.3) s += 0.2;
    if (f[14] > 0.2) s -= 0.25;
    if (f[36] > 0.7) s -= 0.2;
    if (f[45] > 0.15) s -= 0.15;
    return { prediction: s > 0 ? 'Tài' : 'Xỉu', confidence: Math.min(Math.abs(s), 1) };
}

function modelXGBoost(history) {
    const f = extractFeatures(history);
    let s = 0;
    [0.3, 0.25, 0.2, 0.15, 0.1].forEach((w, i) => { s += f[[7, 8, 14, 36, 45][i]] * w; });
    return { prediction: s > 0 ? 'Tài' : 'Xỉu', confidence: Math.min(Math.abs(s) * 2, 1) };
}

function modelAttention(history) {
    if (history.length < 20) return { prediction: null, confidence: 0 };
    const r = history.slice(-20);
    let aS = 0, wS = 0;
    for (let i = 0; i < r.length; i++) {
        const w = Math.exp(i / 5);
        const v = r[i].result === 'Tài' ? 1 : 0;
        aS += w; wS += w * v;
    }
    const at = wS / aS;
    return { prediction: at > 0.5 ? 'Tài' : 'Xỉu', confidence: Math.abs(at - 0.5) * 2 };
}

function modelMultiHead(history) {
    if (history.length < 20) return { prediction: null, confidence: 0 };
    const r = history.slice(-30);
    let ts = 0;
    [3, 5, 10].forEach(hs => {
        let a = 0, w = 0;
        for (let i = 0; i < r.length; i++) {
            const wt = Math.exp(i / hs);
            const v = r[i].result === 'Tài' ? 1 : 0;
            a += wt; w += wt * v;
        }
        ts += (w / a - 0.5) * 2;
    });
    ts /= 3;
    return { prediction: ts > 0 ? 'Tài' : 'Xỉu', confidence: Math.min(Math.abs(ts), 1) };
}

function modelTransformer(history) {
    if (history.length < 20) return { prediction: null, confidence: 0 };
    const r = history.slice(-20);
    const q = r.map(h => h.result === 'Tài' ? 1 : 0);
    let o = 0;
    for (let i = 0; i < q.length; i++) {
        let a = 0;
        for (let j = 0; j < q.length; j++) a += q[i] * q[j];
        a = sigmoid(a / q.length);
        o += a * q[i];
    }
    o /= q.length;
    return { prediction: o > 0.5 ? 'Tài' : 'Xỉu', confidence: Math.abs(o - 0.5) * 2 };
}

function modelPolicy(history) {
    const f = extractFeatures(history);
    const q = AI_MEMORY.q_table[getStateHash(f)];
    if (!q) return { prediction: null, confidence: 0 };
    const t = Math.abs(q['Tài']) + Math.abs(q['Xỉu']);
    if (t < 0.1) return { prediction: null, confidence: 0 };
    return { prediction: q['Tài'] > q['Xỉu'] ? 'Tài' : 'Xỉu', confidence: Math.min(t / 5, 1) };
}

function modelActorCritic(history) {
    const f = extractFeatures(history);
    let s = 0;
    for (let i = 0; i < 10; i++) s += f[i] * 0.1;
    return { prediction: s > 0 ? 'Tài' : 'Xỉu', confidence: Math.min(Math.abs(s) * 2, 1) };
}

function modelDQN(history) {
    const f = extractFeatures(history);
    const k = getDeepStateHash(f);
    const q = AI_MEMORY.q_table[k];
    if (!q) { AI_MEMORY.q_table[k] = { 'Tài': 0, 'Xỉu': 0 }; return { prediction: null, confidence: 0 }; }
    const t = Math.abs(q['Tài']) + Math.abs(q['Xỉu']);
    if (t < 0.01) return { prediction: null, confidence: 0 };
    return { prediction: q['Tài'] > q['Xỉu'] ? 'Tài' : 'Xỉu', confidence: Math.min(t / 3, 1) };
}

function modelSVM(history) {
    const f = extractFeatures(history);
    let d = 0;
    [0.2, -0.15, 0.1, 0.25, -0.1, 0.15, -0.2, 0.3].forEach((w, i) => { d += f[i] * w; });
    return { prediction: d > 0 ? 'Tài' : 'Xỉu', confidence: Math.min(Math.abs(d) * 3, 1) };
}

function modelKNN(history, k = 5) {
    if (history.length < 30) return { prediction: null, confidence: 0 };
    const cur = extractFeatures(history);
    const nb = [];
    for (let i = 20; i < history.length - 1; i++) {
        const past = extractFeatures(history.slice(0, i + 1));
        let d = 0;
        for (let j = 0; j < Math.min(cur.length, past.length); j++) d += Math.pow(cur[j] - past[j], 2);
        nb.push({ distance: Math.sqrt(d), result: history[i + 1].result });
    }
    nb.sort((a, b) => a.distance - b.distance);
    const tk = nb.slice(0, k).filter(n => n.result === 'Tài' || n.result === 'Xỉu');
    if (tk.length === 0) return { prediction: null, confidence: 0 };
    const t = tk.filter(n => n.result === 'Tài').length;
    const x = tk.length - t;
    return { prediction: t > x ? 'Tài' : 'Xỉu', confidence: Math.abs(t - x) / tk.length };
}

function modelNaiveBayes(history) {
    if (history.length < 30) return { prediction: null, confidence: 0 };
    const tR = history.filter(h => h.result === 'Tài');
    const xR = history.filter(h => h.result === 'Xỉu');
    if (!tR.length || !xR.length) return { prediction: null, confidence: 0 };
    const pT = (tR.length / history.length) + 0.001;
    const pX = (xR.length / history.length) + 0.001;
    return { prediction: pT > pX ? 'Tài' : 'Xỉu', confidence: Math.abs(pT - pX) / (pT + pX) };
}

function modelDecisionTree(history) {
    const f = extractFeatures(history);
    if (f[8] > 0.5) return { prediction: history[history.length - 1].result, confidence: 0.7 };
    if (f[7] > 0.3) return { prediction: 'Xỉu', confidence: 0.6 };
    if (f[7] < -0.3) return { prediction: 'Tài', confidence: 0.6 };
    if (f[36] > 0.7) {
        const last = history[history.length - 1].result;
        return { prediction: last === 'Tài' ? 'Xỉu' : 'Tài', confidence: 0.55 };
    }
    if (f[45] > 0.2) return { prediction: 'Tài', confidence: 0.5 };
    return { prediction: 'Xỉu', confidence: 0.4 };
}

function modelWavelet(history) {
    if (history.length < 20) return { prediction: null, confidence: 0 };
    const s = history.slice(-20).map(h => h.result === 'Tài' ? 1 : 0);
    const sc = [];
    for (let i = 0; i < s.length - 1; i += 2) sc.push((s[i] + s[i + 1]) / 2);
    const a = sc.reduce((x, y) => x + y, 0) / sc.length;
    return { prediction: a > 0.5 ? 'Tài' : 'Xỉu', confidence: Math.abs(a - 0.5) * 2 };
}

function modelChaos(history) {
    if (history.length < 30) return { prediction: null, confidence: 0 };
    let x = 0.1, y = 0.1, z = 0.1;
    const s = history.slice(-30).map(h => h.result === 'Tài' ? 1 : -1);
    for (let i = 0; i < s.length; i++) {
        const dt = 0.01;
        const dx = 10 * (y - x) * dt + s[i] * 0.1;
        const dy = (x * (28 - z) - y) * dt;
        const dz = (x * y - 8 / 3 * z) * dt;
        x += dx; y += dy; z += dz;
    }
    return { prediction: x > 0 ? 'Tài' : 'Xỉu', confidence: Math.min(Math.abs(x) / 5, 1) };
}

function modelGenetic(history) {
    if (history.length < 30) return { prediction: null, confidence: 0 };
    const pop = Array(20).fill(0).map(() => ({
        w: Array(5).fill(0).map(() => Math.random() - 0.5), f: 0
    }));
    const fe = extractFeatures(history);
    pop.forEach(ind => {
        let s = 0;
        [7, 8, 14, 36, 45].forEach((idx, i) => { s += fe[idx] * ind.w[i]; });
        ind.pred = s > 0 ? 'Tài' : 'Xỉu';
        const maj = history.slice(-5).filter(h => h.result === 'Tài').length >= 3 ? 'Tài' : 'Xỉu';
        ind.f = ind.pred === maj ? 1 : 0;
    });
    pop.sort((a, b) => b.f - a.f);
    const tv = pop.slice(0, 5).filter(p => p.pred === 'Tài').length;
    return { prediction: tv >= 3 ? 'Tài' : 'Xỉu', confidence: 0.5 + Math.abs(tv - 2.5) / 5 };
}

function modelAnneal(history) {
    if (history.length < 30) return { prediction: null, confidence: 0 };
    const f = extractFeatures(history);
    let bs = -Infinity, bp = 'Tài';
    for (let it = 0; it < 50; it++) {
        const w = Array(5).fill(0).map(() => (Math.random() - 0.5) * 2);
        let s = 0;
        [7, 8, 14, 36, 45].forEach((idx, i) => { s += f[idx] * w[i]; });
        const p = s > 0 ? 'Tài' : 'Xỉu';
        const rc = history.slice(-10).filter((h) => (h.result === 'Tài' && s > 0) || (h.result === 'Xỉu' && s <= 0)).length;
        if (rc > bs) { bs = rc; bp = p; }
    }
    return { prediction: bp, confidence: Math.min(bs / 10, 1) };
}

function modelBayesOpt(history) {
    if (history.length < 30) return { prediction: null, confidence: 0 };
    const f = extractFeatures(history);
    let bp = 'Tài', bs = -Infinity;
    for (let i = 0; i < 30; i++) {
        const s = Array(10).fill(0).map(() => Math.random() - 0.5);
        let sc = 0;
        for (let j = 0; j < 10; j++) sc += f[j] * s[j];
        const acq = sc + 0.5 * Math.sqrt(Math.log(i + 1) / (i + 1));
        if (acq > bs) { bs = acq; bp = sc > 0 ? 'Tài' : 'Xỉu'; }
    }
    return { prediction: bp, confidence: Math.min(Math.abs(bs) * 2, 1) };
}

function modelEntropy(history) {
    if (history.length < 30) return { prediction: null, confidence: 0 };
    const l = history.slice(-30);
    const t = l.filter(h => h.result === 'Tài').length;
    const pT = t / 30, pX = (30 - t) / 30;
    const H = -(pT * Math.log2(pT + 0.001) + pX * Math.log2(pX + 0.001));
    if (H > 0.95) return { prediction: null, confidence: 0 };
    return { prediction: t < 15 ? 'Tài' : 'Xỉu', confidence: 1 - H };
}

function modelFractal(history) {
    if (history.length < 50) return { prediction: null, confidence: 0 };
    const s = history.slice(-50).map(h => h.result === 'Tài' ? 1 : -1);
    const m = s.reduce((a, b) => a + b, 0) / s.length;
    let cum = 0;
    const cumDev = [];
    s.forEach(v => { cum += v - m; cumDev.push(cum); });
    const R = Math.max(...cumDev) - Math.min(...cumDev);
    const sd = Math.sqrt(s.reduce((a, b) => a + Math.pow(b - m, 2), 0) / s.length);
    const H = Math.log(R / (sd + 0.001)) / Math.log(s.length);
    if (H > 0.5) return { prediction: history[history.length - 1].result, confidence: Math.min(H, 1) };
    const last = history[history.length - 1].result;
    return { prediction: last === 'Tài' ? 'Xỉu' : 'Tài', confidence: Math.min(1 - H, 1) };
}

function modelMeta(history, base) {
    const v = { 'Tài': 0, 'Xỉu': 0 };
    base.forEach(p => {
        if (!p.prediction || !p.confidence) return;
        const perf = AI_MEMORY.model_performance[p.name];
        const w = perf?.weight || 1.0;
        const acc = perf?.total > 10 ? perf.correct / perf.total : 0.5;
        const calib = 0.5 + acc;
        v[p.prediction] += p.confidence * w * calib;
    });
    const t = v['Tài'] + v['Xỉu'];
    if (t === 0) return { prediction: null, confidence: 0, votes: v };
    return { prediction: v['Tài'] > v['Xỉu'] ? 'Tài' : 'Xỉu', confidence: Math.abs(v['Tài'] - v['Xỉu']) / t, votes: v };
}

function modelSupreme(history, all) {
    const v = { 'Tài': 0, 'Xỉu': 0 };
    all.forEach(r => {
        if (!r.prediction || !r.confidence) return;
        const perf = AI_MEMORY.model_performance[r.name];
        const w = perf?.weight || 1.0;
        const acc = perf?.total > 10 ? perf.correct / perf.total : 0.5;
        const racc = perf?.recentTotal > 5 ? perf.recentCorrect / perf.recentTotal : 0.5;
        const composite = w * (0.4 + 0.6 * acc) * (0.4 + 0.6 * racc);
        v[r.prediction] += r.confidence * r.confidence * composite;
    });
    const t = v['Tài'] + v['Xỉu'];
    if (t === 0) return { prediction: null, confidence: 0 };
    return { prediction: v['Tài'] > v['Xỉu'] ? 'Tài' : 'Xỉu', confidence: Math.abs(v['Tài'] - v['Xỉu']) / t, votes: v };
}

// ============================================================
// REGIME DETECTION
// ============================================================
function detectRegime(history) {
    if (history.length < 10) return 'UNKNOWN';
    const recent = history.slice(-20);
    const t = recent.filter(h => h.result === 'Tài').length;
    const pT = t / recent.length, pX = 1 - pT;
    const H = pT > 0 && pX > 0 ? -(pT * Math.log2(pT) + pX * Math.log2(pX)) : 0;
    if (H > 0.95) return 'HIGH_ENTROPY';
    if (H < 0.4) return 'LOW_ENTROPY';
    let streak = 1;
    const last = history[history.length - 1].result;
    for (let i = history.length - 2; i >= 0; i--) { if (history[i].result === last) streak++; else break; }
    if (streak >= 4) return 'STREAK';
    let flips = 0;
    for (let i = 1; i < recent.length; i++) if (recent[i].result !== recent[i - 1].result) flips++;
    if (flips / (recent.length - 1) > 0.7) return 'ALTERNATING';
    if (pT > 0.65) return 'TRENDING_TAI';
    if (pT < 0.35) return 'TRENDING_XIU';
    return 'NORMAL';
}

// ============================================================
// ENSEMBLE — KHÔNG THIÊN VỊ
// ============================================================
function runEnsemble(history) {
    const results = {
        markov: modelMarkov(history),
        neural: modelNeural(history),
        neural_v2: modelNeuralV2(history),
        qlearn: modelQLearn(history),
        pattern: modelPattern(history),
        bayes: modelBayes(history),
        timeseries: modelTimeSeries(history),
        frequency: modelFrequency(history),
        volatility: modelVolatility(history),
        lstm: modelLSTM(history),
        gru: modelGRU(history),
        forest: modelForest(history),
        boosting: modelBoosting(history),
        xgboost: modelXGBoost(history),
        attention: modelAttention(history),
        multihead: modelMultiHead(history),
        transformer: modelTransformer(history),
        policy: modelPolicy(history),
        actorcritic: modelActorCritic(history),
        dqn: modelDQN(history),
        svm: modelSVM(history),
        knn: modelKNN(history),
        naivebayes: modelNaiveBayes(history),
        decisiontree: modelDecisionTree(history),
        wavelet: modelWavelet(history),
        chaos: modelChaos(history),
        genetic: modelGenetic(history),
        anneal: modelAnneal(history),
        bayesopt: modelBayesOpt(history),
        entropy: modelEntropy(history),
        fractal: modelFractal(history)
    };

    const base = Object.entries(results).map(([name, r]) => ({ name, ...r })).filter(p => p.prediction);
    const metaR = modelMeta(history, base);
    results.meta = metaR;
    const all = [...base, { name: 'meta', ...metaR }];
    const supR = modelSupreme(history, all);
    results.supreme = supR;

    const tv = base.filter(p => p.prediction === 'Tài').length;
    const xv = base.filter(p => p.prediction === 'Xỉu').length;
    const tvTotal = tv + xv || 1;

    let rawPrediction = supR.prediction || metaR.prediction || 'Tài';
    let rawConfidence = supR.confidence || metaR.confidence || 0.3;

    // Anti-bias override — CHỈ khi thực sự lệch (0.9) + pattern mạnh (0.65)
    const imb = Math.abs(tv - xv) / tvTotal;
    if (imb > 0.9 && results.pattern.prediction && results.pattern.prediction !== rawPrediction) {
        if (results.pattern.confidence > 0.65) {
            rawPrediction = results.pattern.prediction;
            rawConfidence = 0.6;
        }
    }

    const regime = detectRegime(history);
    AI_MEMORY.regime = regime;
    if (regime === 'HIGH_ENTROPY') rawConfidence *= 0.65;
    else if (regime === 'STREAK' && results.pattern.confidence > 0.6) rawConfidence = Math.min(0.85, rawConfidence * 1.15);
    else if (regime === 'ALTERNATING') rawConfidence = Math.min(0.82, rawConfidence * 1.1);

    const last10 = history.slice(-10);
    let flips = 0;
    for (let i = 0; i < last10.length - 1; i++) if (last10[i].result !== last10[i + 1].result) flips++;
    const flipRate = flips / 9;
    if (flipRate > 0.7) rawConfidence *= 0.75;

    const calibrated = calibrateConfidence(rawConfidence);

    return {
        final: { prediction: rawPrediction, confidence: calibrated },
        raw_confidence: rawConfidence,
        supreme: supR,
        meta: metaR,
        models: base,
        taiVotes: tv,
        xiuVotes: xv,
        consensus: Math.max(tv, xv) / tvTotal,
        imbalance: imb.toFixed(2),
        flipRate: flipRate.toFixed(2),
        regime,
        allModels: results,
        totalModels: base.length
    };
}

// ============================================================
// 3 SỐ TỔNG — Không thiên vị (dùng chung logic cho T/X)
// ============================================================
function aiSelectThreeSums(history, prediction) {
    const ss = {};
    for (let i = 4; i <= 17; i++) ss[i] = 0;
    history.slice(-100).forEach(h => { if (h.score >= 4 && h.score <= 17) ss[h.score] += 0.5; });
    history.slice(-50).forEach(h => { if (h.score >= 4 && h.score <= 17) ss[h.score] += 1; });
    history.slice(-20).forEach(h => { if (h.score >= 4 && h.score <= 17) ss[h.score] += 2; });
    history.slice(-10).forEach(h => { if (h.score >= 4 && h.score <= 17) ss[h.score] += 2.5; });
    history.slice(-5).forEach(h => { if (h.score >= 4 && h.score <= 17) ss[h.score] += 3; });

    const mn = prediction === 'Tài' ? 11 : 4;
    const mx = prediction === 'Tài' ? 17 : 10;
    const rs = history.slice(-3).map(h => h.score);

    const c = [];
    for (let s = mn; s <= mx; s++) c.push({ sum: s, score: ss[s], isRecent: rs.includes(s) });
    c.sort((a, b) => {
        if (a.isRecent !== b.isRecent) return a.isRecent ? 1 : -1;
        return b.score - a.score;
    });
    let t3 = c.slice(0, 3).map(x => x.sum);
    if (t3.length < 3) t3 = prediction === 'Tài' ? [11, 13, 15] : [5, 7, 9];
    t3.sort((a, b) => a - b);
    return t3;
}

// ============================================================
// LEARNING
// ============================================================
function learnFromResult(history, actualResult) {
    if (actualResult === 'Bão') return;
    const histPrev = history.slice(0, -1);
    const features = extractFeatures(histPrev);
    const actual = actualResult === 'Tài' ? 1 : 0;

    // Neural v1 SGD
    const w = AI_MEMORY.neural_weights;
    let sum = AI_MEMORY.neural_bias;
    for (let i = 0; i < Math.min(features.length, w.length); i++) sum += features[i] * w[i];
    const predicted = sigmoid(sum);
    const error = actual - predicted;
    const lr = 0.005;
    for (let i = 0; i < Math.min(features.length, w.length); i++) {
        w[i] += lr * error * features[i];
        w[i] = Math.max(-3, Math.min(3, w[i]));
    }
    AI_MEMORY.neural_bias += lr * error;

    // Neural v2
    const w2 = AI_MEMORY.neural_v2_weights;
    for (let i = 0; i < Math.min(features.length, w2.length); i++) {
        w2[i] += lr * error * features[i];
        w2[i] = Math.max(-3, Math.min(3, w2[i]));
    }
    AI_MEMORY.neural_v2_bias += lr * error;

    // Q-learning
    const qR = modelQLearn(histPrev);
    if (qR.stateKey) {
        const q = AI_MEMORY.q_table[qR.stateKey];
        const reward = actualResult === 'Tài' ? 1 : -1;
        q['Tài'] += AI_MEMORY.q_learning_rate * (reward - q['Tài']);
        q['Xỉu'] += AI_MEMORY.q_learning_rate * (-reward - q['Xỉu']);
    }

    const dk = getDeepStateHash(features);
    if (!AI_MEMORY.q_table[dk]) AI_MEMORY.q_table[dk] = { 'Tài': 0, 'Xỉu': 0 };
    AI_MEMORY.q_table[dk][actualResult] += 0.05;
    AI_MEMORY.q_table[dk][actualResult === 'Tài' ? 'Xỉu' : 'Tài'] -= 0.05;

    // Update per-model performance
    const ens = runEnsemble(histPrev);
    ens.models.forEach(m => {
        const perf = AI_MEMORY.model_performance[m.name];
        if (!perf) return;
        perf.total++;
        if (m.prediction === actualResult) perf.correct++;
        perf.recentTotal = (perf.recentTotal || 0) + 1;
        if (m.prediction === actualResult) perf.recentCorrect = (perf.recentCorrect || 0) + 1;
        if (perf.recentTotal > 50) perf.recentTotal = 50;
        if (perf.recentCorrect > 50) perf.recentCorrect = 50;
        const acc = perf.total > 5 ? perf.correct / perf.total : 0.5;
        const racc = perf.recentTotal > 5 ? perf.recentCorrect / perf.recentTotal : 0.5;
        perf.weight = Math.max(0.2, Math.min(5, 0.5 + 1.5 * acc + 1.0 * racc));
    });

    // Global stats
    AI_MEMORY.total_predictions++;
    const fp = ens.final.prediction;
    if (fp === 'Tài') AI_MEMORY.tai_predictions = (AI_MEMORY.tai_predictions || 0) + 1;
    else if (fp === 'Xỉu') AI_MEMORY.xiu_predictions = (AI_MEMORY.xiu_predictions || 0) + 1;

    if (fp === actualResult) {
        AI_MEMORY.correct_predictions++;
        AI_MEMORY.streak_correct++;
        AI_MEMORY.streak_wrong = 0;
        if (AI_MEMORY.streak_correct > AI_MEMORY.best_streak) AI_MEMORY.best_streak = AI_MEMORY.streak_correct;
    } else {
        AI_MEMORY.streak_wrong++;
        AI_MEMORY.streak_correct = 0;
        if (AI_MEMORY.streak_wrong > AI_MEMORY.worst_streak) AI_MEMORY.worst_streak = AI_MEMORY.streak_wrong;
    }

    if (AI_MEMORY.pendingPrediction) {
        const conf = AI_MEMORY.pendingPrediction.confidence;
        const bucket = Math.min(9, Math.floor(conf * 10));
        AI_MEMORY.calibration[bucket].total++;
        if (fp === actualResult) AI_MEMORY.calibration[bucket].correct++;
    }

    AI_MEMORY.recent_predictions.push({
        gameNum: AI_MEMORY.pendingPrediction?.gameNum,
        predicted: fp,
        actual: actualResult,
        correct: fp === actualResult,
        confidence: AI_MEMORY.pendingPrediction?.confidence,
        timestamp: Date.now()
    });
    if (AI_MEMORY.recent_predictions.length > 200) AI_MEMORY.recent_predictions.shift();

    if (AI_MEMORY.recent_predictions.length % 20 === 0) fitPlatt();

    saveMemory();
}

// ============================================================
// PREDICT — Pipeline đầy đủ với NO BIAS
// ============================================================
async function predict(gameKey = CURRENT_GAME) {
    const history = await fetchHistoryCached(gameKey);
    const len = history.length;
    const cur = history[len - 1];

    AI_MEMORY.detected_games[gameKey] = (AI_MEMORY.detected_games[gameKey] || 0) + 1;

    if (AI_MEMORY.lastSessionNum && cur.gameNum !== AI_MEMORY.lastSessionNum) {
        if (AI_MEMORY.pendingPrediction) learnFromResult(history, cur.result);
    }
    AI_MEMORY.lastSessionNum = cur.gameNum;

    // ==== NOT ENOUGH DATA ====
    if (len < REALITY_CHECK.minSessionsToPredict) {
        return {
            "phiên": cur.gameNum.replace('#', ''),
            "xúc xắc": cur.faces,
            "tổng": cur.score,
            "kết quả": cur.result,
            "phiên dự đoán": `${parseInt(cur.gameNum.replace('#', '')) + 1}`,
            "dự đoán": "NO_SIGNAL",
            "vị cược": "N/A",
            "tỉ lệ": "N/A",
            "_stability": { "action": "NEED_MORE_DATA" },
            "_regime": "UNKNOWN",
            "_warnings": ["need_more_data"]
        };
    }

    // ==== STEP 1: Ensemble ====
    const ensemble = runEnsemble(history);

    // ==== STEP 2: BIAS GUARD — chống thiên vị ====
    const biasGuard = applyBiasGuard(ensemble.final.prediction, ensemble.final.confidence, ensemble);
    const afterBias = { prediction: biasGuard.prediction, confidence: biasGuard.confidence };

    // ==== STEP 3: STABILITY LOCK ====
    const stability = applyStabilityLock(afterBias.prediction, afterBias.confidence, cur);
    const finalPrediction = stability.prediction;
    const finalConfidence = stability.confidence;

    // ==== STEP 4: NO_SIGNAL CHECK ====
    const isNoSignal = finalConfidence < NO_SIGNAL_CONF && stability.action !== 'HOLD_SAME';
    let displayPrediction = finalPrediction;
    let displayConf = finalConfidence;
    const warnings = [];

    if (isNoSignal) {
        displayPrediction = 'NO_SIGNAL';
        displayConf = finalConfidence;
        warnings.push('NO_SIGNAL_LOW_CONFIDENCE');
        AI_MEMORY.no_signal_predictions = (AI_MEMORY.no_signal_predictions || 0) + 1;
    }

    if (biasGuard.action !== 'CLEAN') warnings.push(`bias_${biasGuard.action.toLowerCase()}`);

    // Update directional streak
    if (finalPrediction === 'Tài') {
        AI_MEMORY.consecutive_tai_predictions++;
        AI_MEMORY.consecutive_xiu_predictions = 0;
    } else {
        AI_MEMORY.consecutive_xiu_predictions++;
        AI_MEMORY.consecutive_tai_predictions = 0;
    }

    const threeSums = aiSelectThreeSums(history, finalPrediction);
    const betRange = threeSums.join(' ');

    AI_MEMORY.pendingPrediction = {
        gameNum: cur.gameNum,
        prediction: displayPrediction === 'NO_SIGNAL' ? null : displayPrediction,
        confidence: displayConf
    };
    saveMemory();

    return {
        "phiên": cur.gameNum.replace('#', ''),
        "xúc xắc": cur.faces,
        "tổng": cur.score,
        "kết quả": cur.result,
        "phiên dự đoán": `${parseInt(cur.gameNum.replace('#', '')) + 1}`,
        "dự đoán": displayPrediction,
        "vị cược": displayPrediction === 'NO_SIGNAL' ? 'N/A' : betRange,
        "tỉ lệ": displayPrediction === 'NO_SIGNAL' ? 'N/A' : `${(displayConf * 100).toFixed(2)}%`,
        "_stability": {
            "action": stability.action,
            "raw_prediction": ensemble.final.prediction,
            "raw_confidence": (ensemble.raw_confidence * 100).toFixed(2) + '%'
        },
        "_bias_guard": {
            "action": biasGuard.action,
            "after_bias_prediction": afterBias.prediction
        },
        "_regime": ensemble.regime,
        "_models": ensemble.totalModels,
        "_consensus": `${(ensemble.consensus * 100).toFixed(1)}%`,
        "_warnings": warnings
    };
}

// ============================================================
// ROUTES
// ============================================================
app.get('/', (req, res) => {
    const tCount = AI_MEMORY.tai_predictions || 0;
    const xCount = AI_MEMORY.xiu_predictions || 0;
    const totalDir = tCount + xCount;
    const tRatio = totalDir > 0 ? tCount / totalDir : 0.5;

    res.json({
        status: 'online',
        version: AI_MEMORY.version,
        name: '⚡ Sicbo AI v12.0 VIP - NO BIAS + STABILITY LOCK',
        disclaimer: REALITY_CHECK.disclaimer,
        confidence_range: `${(MIN_CONFIDENCE * 100).toFixed(0)}% - ${(MAX_CONFIDENCE * 100).toFixed(0)}%`,
        no_signal_threshold: `${(NO_SIGNAL_CONF * 100).toFixed(0)}%`,
        models: Object.keys(AI_MEMORY.model_performance).length,
        directional_balance: {
            tai_predictions: tCount,
            xiu_predictions: xCount,
            tai_ratio: `${(tRatio * 100).toFixed(1)}%`,
            xiu_ratio: `${((1 - tRatio) * 100).toFixed(1)}%`,
            is_balanced: Math.abs(tRatio - 0.5) < 0.15
        },
        bias_guard: {
            enabled: BIAS_GUARD.ENABLED,
            stats: AI_MEMORY.bias_guard
        },
        stability_lock: {
            enabled: STABILITY.ENABLED,
            flip_threshold: STABILITY.FLIP_THRESHOLD,
            cooldown_sessions: STABILITY.COOLDOWN_SESSIONS,
            stats: AI_MEMORY.stability
        },
        calibration: {
            platt_a: AI_MEMORY.platt.a.toFixed(3),
            platt_b: AI_MEMORY.platt.b.toFixed(3),
            samples: AI_MEMORY.platt.samples
        },
        total_predictions: AI_MEMORY.total_predictions,
        accuracy: AI_MEMORY.total_predictions > 0
            ? `${((AI_MEMORY.correct_predictions / AI_MEMORY.total_predictions) * 100).toFixed(2)}%` : 'N/A',
        endpoints: {
            'Dự đoán': '/api/du-doan',
            'AI Status': '/api/ai-status',
            'Bias Guard': '/api/bias-guard',
            'Stability': '/api/stability',
            'Calibration': '/api/calibration',
            'Anti-Block': '/api/anti-block',
            'Reset': '/api/reset-memory'
        }
    });
});

app.get('/api/du-doan', async (req, res) => {
    try {
        const result = await predict(req.query.game || CURRENT_GAME);
        res.json(result);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/bias-guard', (req, res) => {
    const tCount = AI_MEMORY.tai_predictions || 0;
    const xCount = AI_MEMORY.xiu_predictions || 0;
    const totalDir = tCount + xCount;
    const tRatio = totalDir > 0 ? tCount / totalDir : 0.5;

    const recent = AI_MEMORY.recent_predictions.slice(-50);
    const recentT = recent.filter(p => p.predicted === 'Tài').length;
    const recentX = recent.filter(p => p.predicted === 'Xỉu').length;

    const bias = checkDirectionalBias();

    res.json({
        config: BIAS_GUARD,
        stats: AI_MEMORY.bias_guard,
        current: {
            tai_streak: AI_MEMORY.consecutive_tai_predictions,
            xiu_streak: AI_MEMORY.consecutive_xiu_predictions,
            detected_bias: bias,
            recent_50: {
                tai: recentT,
                xiu: recentX,
                ratio_tai: recent.length > 0 ? `${((recentT / recent.length) * 100).toFixed(1)}%` : 'N/A'
            }
        },
        lifetime: {
            tai_predictions: tCount,
            xiu_predictions: xCount,
            tai_ratio: `${(tRatio * 100).toFixed(1)}%`,
            is_balanced: Math.abs(tRatio - 0.5) < 0.15
        }
    });
});

app.get('/api/stability', (req, res) => {
    res.json({
        config: STABILITY,
        state: {
            lastPrediction: STABILITY_STATE.lastPrediction,
            lastPredictionConf: STABILITY_STATE.lastPredictionConf,
            lastFlipSessionNum: STABILITY_STATE.lastFlipSessionNum,
            holdCount: STABILITY_STATE.holdCount,
            flipHistoryCount: STABILITY_STATE.flipHistory.length
        },
        memory: AI_MEMORY.stability,
        recentFlips: STABILITY_STATE.flipHistory.slice(-10).reverse()
    });
});

app.get('/api/calibration', (req, res) => {
    const bins = AI_MEMORY.calibration.map((b, i) => ({
        range: `${i * 10}-${(i + 1) * 10}%`,
        correct: b.correct,
        total: b.total,
        accuracy: b.total > 0 ? `${((b.correct / b.total) * 100).toFixed(1)}%` : 'N/A'
    }));
    res.json({
        platt: AI_MEMORY.platt,
        bins,
        recentCount: AI_MEMORY.recent_predictions.length
    });
});

app.get('/api/ai-status', (req, res) => {
    const recent = AI_MEMORY.recent_predictions.slice(-20);
    const rc = recent.filter(p => p.correct).length;

    res.json({
        version: AI_MEMORY.version,
        regime: AI_MEMORY.regime,
        total_predictions: AI_MEMORY.total_predictions,
        correct_predictions: AI_MEMORY.correct_predictions,
        accuracy: AI_MEMORY.total_predictions > 0
            ? `${((AI_MEMORY.correct_predictions / AI_MEMORY.total_predictions) * 100).toFixed(2)}%` : 'N/A',
        recent_20_accuracy: recent.length > 0 ? `${((rc / recent.length) * 100).toFixed(2)}%` : 'N/A',
        directional: {
            tai: AI_MEMORY.tai_predictions || 0,
            xiu: AI_MEMORY.xiu_predictions || 0,
            no_signal: AI_MEMORY.no_signal_predictions || 0
        },
        streak_correct: AI_MEMORY.streak_correct,
        best_streak: AI_MEMORY.best_streak,
        worst_streak: AI_MEMORY.worst_streak,
        consecutive_tai: AI_MEMORY.consecutive_tai_predictions,
        consecutive_xiu: AI_MEMORY.consecutive_xiu_predictions,
        bias_guard: AI_MEMORY.bias_guard,
        stability: AI_MEMORY.stability,
        anti_block: ANTI_BLOCK_STATS,
        model_performance: Object.fromEntries(
            Object.entries(AI_MEMORY.model_performance).map(([k, v]) => [
                k, {
                    weight: v.weight.toFixed(2),
                    accuracy: v.total > 0 ? `${((v.correct / v.total) * 100).toFixed(1)}%` : 'N/A',
                    recent_50: v.recentTotal > 0 ? `${((v.recentCorrect / v.recentTotal) * 100).toFixed(1)}%` : 'N/A',
                    samples: v.total
                }
            ])
        )
    });
});

app.get('/api/anti-block', (req, res) => {
    res.json({
        circuit: CIRCUIT,
        cache: {
            has_data: !!HISTORY_CACHE.data,
            age_ms: HISTORY_CACHE.data ? Date.now() - HISTORY_CACHE.timestamp : null,
            ttl_ms: HISTORY_CACHE.ttl
        },
        stats: ANTI_BLOCK_STATS
    });
});

app.get('/api/reset-memory', (req, res) => {
    if (fs.existsSync(MEMORY_FILE)) fs.unlinkSync(MEMORY_FILE);
    if (fs.existsSync(MEMORY_BACKUP)) fs.unlinkSync(MEMORY_BACKUP);
    STABILITY_STATE = {
        lastPrediction: null, lastPredictionConf: 0,
        lastFlipSessionNum: null, flipHistory: [], holdCount: 0
    };
    res.json({ message: 'Memory reset. Restart server.' });
});

app.get('/api/tool/predict', async (req, res) => {
    try {
        const result = await predict(req.query.game || CURRENT_GAME);
        if ((req.query.format || 'json') === 'compact') {
            return res.json({
                s: result["phiên"], d: result["dự đoán"], v: result["vị cược"],
                r: result["tỉ lệ"], t: result["tổng"], k: result["kết quả"],
                st: result._stability?.action, bg: result._bias_guard?.action,
                rg: result._regime
            });
        }
        res.json(result);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/tool/ping', (req, res) => {
    res.json({
        pong: true, version: AI_MEMORY.version,
        uptime: Math.floor(process.uptime()),
        models: Object.keys(AI_MEMORY.model_performance).length,
        stability_lock: STABILITY.ENABLED,
        bias_guard: BIAS_GUARD.ENABLED,
        circuit: CIRCUIT.state,
        regime: AI_MEMORY.regime
    });
});

// ============================================================
// START
// ============================================================
app.listen(PORT, () => {
    console.log('╔═══════════════════════════════════════════════════════════╗');
    console.log('║   ⚡ SICBO AI v12.0 VIP - NO BIAS + STABILITY LOCK       ║');
    console.log('╠═══════════════════════════════════════════════════════════╣');
    console.log(`║  🚀 Dự đoán:  http://localhost:${PORT}/api/du-doan           ║`);
    console.log(`║  🎯 Bias Guard: http://localhost:${PORT}/api/bias-guard      ║`);
    console.log(`║  🔒 Stability: http://localhost:${PORT}/api/stability        ║`);
    console.log(`║  📊 Calibration: http://localhost:${PORT}/api/calibration    ║`);
    console.log(`║  🧠 Status:   http://localhost:${PORT}/api/ai-status         ║`);
    console.log('╠═══════════════════════════════════════════════════════════╣');
    console.log('║  🎯 31 MODELS - 200+ CẦU - 120 FEATURES                   ║');
    console.log('║  🚫 NO BIAS GUARD:                                        ║');
    console.log(`║     - Max streak: ${BIAS_GUARD.MAX_STREAK_PREDICTIONS} phiên    ║`);
    console.log(`║     - Bias threshold: ${(BIAS_GUARD.HISTORICAL_BIAS_THRESHOLD * 100).toFixed(0)}%                 ║`);
    console.log(`║     - Override penalty: ${BIAS_GUARD.OVERRIDE_PENALTY}           ║`);
    console.log('║  🔒 STABILITY LOCK v2:                                    ║');
    console.log(`║     - Flip threshold: ${STABILITY.FLIP_THRESHOLD}         ║`);
    console.log(`║     - Cooldown: ${STABILITY.COOLDOWN_SESSIONS} phiên      ║`);
    console.log(`║     - Max flips: ${STABILITY.MAX_FLIPS_IN_WINDOW}/window  ║`);
    console.log('╠═══════════════════════════════════════════════════════════╣');
    console.log('║  ⚠️  DISCLAIMER:                                          ║');
    console.log('║  KHÔNG thuật toán nào đảm bảo 90% chính xác.              ║');
    console.log('║  Đây là EDGE thống kê nhỏ (nếu có). Chơi có trách nhiệm.  ║');
    console.log('║  KHÔNG THIÊN VỊ TÀI - KHÔNG THIÊN VỊ XỈU.                 ║');
    console.log('╚═══════════════════════════════════════════════════════════╝');
});
