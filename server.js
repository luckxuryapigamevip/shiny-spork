// ============================================================
// SICBO AI v13.0 ULTIMATE - NO BIAS + REGIME AWARE + 250+ CẦU
// Nhận diện cầu thông minh - Biết mình đang ở cầu nào
// KHÔNG THIÊN VỊ - Dự đoán phải phân tích có cơ sở
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
// 📊 REALITY CHECK
// ============================================================
const REALITY_CHECK = {
    disclaimer: 'Tài Xỉu có yếu tố ngẫu nhiên cao. KHÔNG thuật toán nào đảm bảo 90% chính xác. Hệ thống cung cấp EDGE thống kê nhỏ nếu có, kèm calibration trung thực.',
    maxRealisticAccuracy: 0.58,
    minSessionsToPredict: 3,
    noSignalThreshold: 0.10
};

const MIN_CONFIDENCE = 0.51;
const MAX_CONFIDENCE = 0.86;
const NO_SIGNAL_CONF = 0.42;

// ============================================================
// 🎯 STABILITY LOCK v3
// ============================================================
const STABILITY = {
    ENABLED: true,
    FLIP_THRESHOLD: 0.10,
    COOLDOWN_SESSIONS: 1,
    MAX_FLIPS_IN_WINDOW: 5,
    WINDOW_MS: 30 * 60 * 1000,
    STRONG_SIGNAL_CONF: 0.72,
    MIN_FLIP_CONF: 0.58,
    HYSTERESIS_RATIO: 0.10
};

let STABILITY_STATE = {
    lastPrediction: null,
    lastPredictionConf: 0,
    lastFlipSessionNum: null,
    flipHistory: [],
    holdCount: 0
};

// ============================================================
// 🚫 BIAS GUARD v2 - mạnh hơn, không thiên vị
// ============================================================
const BIAS_GUARD = {
    ENABLED: true,
    MAX_STREAK_PREDICTIONS: 3,        // 3 phiên cùng hướng → cảnh báo
    OVERRIDE_PENALTY: 0.80,           // giảm 20% conf khi nghi bias
    MIN_CONF_FOR_SAME_DIR: 0.60,      // cần conf cao để tiếp tục
    HISTORICAL_BIAS_THRESHOLD: 0.65,  // 65% cùng hướng trong 50 phiên → bias
    OPPOSITE_VOTE_FLIP_THRESHOLD: 0.30  // 30% opposite votes → flip
};

// ============================================================
// 🧠 REGIME DETECTOR - nhận biết môi trường cầu
// ============================================================
const REGIMES = {
    UNKNOWN: 'UNKNOWN',
    STREAK_TAI: 'STREAK_TAI',           // bệt Tài
    STREAK_XIU: 'STREAK_XIU',           // bệt Xỉu
    ALT_STRICT: 'ALT_STRICT',           // 1-1 strict (T-X-T-X)
    ALT_LOOSE: 'ALT_LOOSE',             // 1-1 lỏng (T-X-X-T-T)
    N_2_2: 'N_2_2',                     // cầu 2-2
    N_3_3: 'N_3_3',                     // cầu 3-3
    N_MIXED: 'N_MIXED',                 // cầu N-N hỗn hợp (2-1, 3-2...)
    ZIGZAG: 'ZIGZAG',                   // zigzag kép
    RANDOM: 'RANDOM',                   // ngẫu nhiên cao entropy
    NOISY: 'NOISY',                     // nhiễu trung bình
    TRENDING: 'TRENDING',               // xu hướng
    TRANSITION: 'TRANSITION'            // chuyển tiếp (vừa đổi cầu)
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
    version: '13.0-ultimate',
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
        neural: { correct: 0, total: 0, weight: 1.4, recentCorrect: 0, recentTotal: 0 },
        neural_v2: { correct: 0, total: 0, weight: 1.4, recentCorrect: 0, recentTotal: 0 },
        qlearn: { correct: 0, total: 0, weight: 1.2, recentCorrect: 0, recentTotal: 0 },
        pattern: { correct: 0, total: 0, weight: 1.6, recentCorrect: 0, recentTotal: 0 },
        regime: { correct: 0, total: 0, weight: 1.8, recentCorrect: 0, recentTotal: 0 },
        bayes: { correct: 0, total: 0, weight: 0.9, recentCorrect: 0, recentTotal: 0 },
        timeseries: { correct: 0, total: 0, weight: 1.0, recentCorrect: 0, recentTotal: 0 },
        frequency: { correct: 0, total: 0, weight: 0.8, recentCorrect: 0, recentTotal: 0 },
        volatility: { correct: 0, total: 0, weight: 0.7, recentCorrect: 0, recentTotal: 0 },
        lstm: { correct: 0, total: 0, weight: 1.1, recentCorrect: 0, recentTotal: 0 },
        gru: { correct: 0, total: 0, weight: 1.1, recentCorrect: 0, recentTotal: 0 },
        forest: { correct: 0, total: 0, weight: 1.0, recentCorrect: 0, recentTotal: 0 },
        boosting: { correct: 0, total: 0, weight: 1.0, recentCorrect: 0, recentTotal: 0 },
        xgboost: { correct: 0, total: 0, weight: 1.0, recentCorrect: 0, recentTotal: 0 },
        attention: { correct: 0, total: 0, weight: 1.1, recentCorrect: 0, recentTotal: 0 },
        multihead: { correct: 0, total: 0, weight: 1.1, recentCorrect: 0, recentTotal: 0 },
        transformer: { correct: 0, total: 0, weight: 1.2, recentCorrect: 0, recentTotal: 0 },
        policy: { correct: 0, total: 0, weight: 1.0, recentCorrect: 0, recentTotal: 0 },
        actorcritic: { correct: 0, total: 0, weight: 1.1, recentCorrect: 0, recentTotal: 0 },
        dqn: { correct: 0, total: 0, weight: 1.2, recentCorrect: 0, recentTotal: 0 },
        svm: { correct: 0, total: 0, weight: 1.0, recentCorrect: 0, recentTotal: 0 },
        knn: { correct: 0, total: 0, weight: 0.9, recentCorrect: 0, recentTotal: 0 },
        naivebayes: { correct: 0, total: 0, weight: 0.9, recentCorrect: 0, recentTotal: 0 },
        decisiontree: { correct: 0, total: 0, weight: 0.9, recentCorrect: 0, recentTotal: 0 },
        wavelet: { correct: 0, total: 0, weight: 1.0, recentCorrect: 0, recentTotal: 0 },
        chaos: { correct: 0, total: 0, weight: 0.9, recentCorrect: 0, recentTotal: 0 },
        genetic: { correct: 0, total: 0, weight: 0.9, recentCorrect: 0, recentTotal: 0 },
        anneal: { correct: 0, total: 0, weight: 0.8, recentCorrect: 0, recentTotal: 0 },
        bayesopt: { correct: 0, total: 0, weight: 1.0, recentCorrect: 0, recentTotal: 0 },
        entropy: { correct: 0, total: 0, weight: 0.9, recentCorrect: 0, recentTotal: 0 },
        fractal: { correct: 0, total: 0, weight: 1.0, recentCorrect: 0, recentTotal: 0 },
        meta: { correct: 0, total: 0, weight: 1.8, recentCorrect: 0, recentTotal: 0 },
        supreme: { correct: 0, total: 0, weight: 2.0, recentCorrect: 0, recentTotal: 0 }
    },

    total_predictions: 0,
    correct_predictions: 0,
    tai_predictions: 0,
    xiu_predictions: 0,
    no_signal_predictions: 0,
    recent_predictions: [],
    streak_correct: 0,
    streak_wrong: 0,
    best_streak: 0,
    worst_streak: 0,
    consecutive_tai_predictions: 0,
    consecutive_xiu_predictions: 0,

    platt: { a: 1.0, b: 0.0, samples: 0 },
    calibration: Array(10).fill(0).map(() => ({ correct: 0, total: 0 })),

    regime_stats: {},  // thống kê accuracy theo regime

    lastSessionNum: null,
    pendingPrediction: null,
    detected_games: {},

    stability: { total_holds: 0, total_flips: 0, total_flip_blocked: 0, flip_history: [] },
    bias_guard: { bias_flags: 0, bias_overrides: 0, same_dir_streak_blocks: 0 },
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
function tail(a, n) { return n >= a.length ? a.slice() : a.slice(-n); }

function getStateHash(f, p = 10) { return f.slice(0, 10).map(x => Math.round(x * p)).join('|'); }
function getDeepStateHash(f) {
    return crypto.createHash('md5').update(f.slice(0, 20).map(x => x.toFixed(3)).join(',')).digest('hex').slice(0, 16);
}

// ============================================================
// 🧠 REGIME DETECTOR - CORE ALGORITHM
// Nhận biết cầu đang ở môi trường nào
// ============================================================

/**
 * Phân tích cầu hiện tại - trả về regime + độ tin cậy + chi tiết
 * @param {Array} history - lịch sử phiên
 * @returns {Object} { regime, confidence, details, suggestedPrediction }
 */
function detectRegime(history) {
    const len = history.length;
    if (len < 5) {
        return { regime: REGIMES.UNKNOWN, confidence: 0, details: {}, suggestedPrediction: null };
    }

    const str = history.map(h => h.result === 'Bão' ? 'B' : (h.result === 'Tài' ? 'T' : 'X')).join('');
    const recent = str.slice(-20);

    // ============ METRICS ============
    // 1) Streak hiện tại
    const lastChar = str[str.length - 1];
    let streak = 1;
    for (let i = str.length - 2; i >= 0; i--) { if (str[i] === lastChar) streak++; else break; }

    // 2) Alternation score (tỷ lệ flip trong 10-15 phiên gần)
    const altWindow = Math.min(15, len - 1);
    let altFlips = 0;
    for (let i = len - altWindow; i < len - 1; i++) {
        if (history[i].result !== history[i + 1].result) altFlips++;
    }
    const altRate = altWindow > 0 ? altFlips / altWindow : 0;

    // 3) Entropy
    const tWin = history.slice(-20).filter(h => h.result === 'Tài').length;
    const pT = tWin / Math.min(20, len);
    const pX = 1 - pT;
    const entropy = pT > 0 && pX > 0 ? -(pT * Math.log2(pT) + pX * Math.log2(pX)) : 0;

    // 4) Cầu N-N detection (2-2, 3-3)
    const runLengths = [];
    let currentRun = 1;
    for (let i = len - 1; i >= 1; i--) {
        if (history[i].result === history[i - 1].result) currentRun++;
        else { runLengths.push(currentRun); currentRun = 1; }
        if (runLengths.length >= 6) break;
    }
    runLengths.push(currentRun);
    runLengths.reverse();

    // Check 2-2 pattern: [2,2,2,...]
    let is22 = runLengths.length >= 4;
    if (is22) {
        for (let i = 0; i < Math.min(4, runLengths.length); i++) {
            if (runLengths[i] !== 2) { is22 = false; break; }
        }
    }

    // Check 3-3 pattern
    let is33 = runLengths.length >= 3;
    if (is33) {
        for (let i = 0; i < Math.min(3, runLengths.length); i++) {
            if (runLengths[i] !== 3) { is33 = false; break; }
        }
    }

    // 5) Trend detection (so sánh Tài/Xỉu trong 2 nửa window)
    const half = Math.floor(Math.min(20, len) / 2);
    const firstHalf = history.slice(-2 * half, -half);
    const secondHalf = history.slice(-half);
    const fhT = firstHalf.filter(h => h.result === 'Tài').length / Math.max(1, firstHalf.length);
    const shT = secondHalf.filter(h => h.result === 'Tài').length / Math.max(1, secondHalf.length);
    const trendDelta = shT - fhT;

    // 6) Zigzag detection (T-X-T-X pattern với streak ngắn)
    const last6 = str.slice(-6);
    const isZigzag = /^(TX){3}$/.test(last6) || /^(XT){3}$/.test(last6);
    const last8 = str.slice(-8);
    const isZigzagLong = /^(TX){4}$/.test(last8) || /^(XT){4}$/.test(last8);

    // ============ CLASSIFICATION ============
    const details = {
        streak, altRate: +altRate.toFixed(3), entropy: +entropy.toFixed(3),
        runLengths: runLengths.slice(0, 6), trendDelta: +trendDelta.toFixed(3),
        recent20: recent, lastChar
    };

    // Priority order (specific → general):

    // 1) RANDOM - entropy cao + alt không ổn định
    if (entropy > 0.92 && altRate > 0.4 && altRate < 0.65) {
        return { regime: REGIMES.RANDOM, confidence: 0.85, details, suggestedPrediction: null };
    }

    // 2) Cầu N-N cụ thể
    if (is22) {
        // Đang ở block 2-2 → dự đoán flip sắp tới hoặc tiếp tục block
        const currentBlockPos = runLengths[0]; // độ dài block hiện tại
        const nextPred = currentBlockPos === 1 ? lastChar : (currentBlockPos === 2 ? (lastChar === 'T' ? 'X' : 'T') : null);
        return {
            regime: REGIMES.N_2_2,
            confidence: 0.72,
            details: { ...details, blockPosition: currentBlockPos },
            suggestedPrediction: currentBlockPos === 1 ? lastChar : (lastChar === 'T' ? 'X' : 'T')
        };
    }
    if (is33) {
        return {
            regime: REGIMES.N_3_3,
            confidence: 0.70,
            details: { ...details, blockPosition: runLengths[0] },
            suggestedPrediction: runLengths[0] < 3 ? lastChar : (lastChar === 'T' ? 'X' : 'T')
        };
    }

    // 3) Zigzag strict
    if (isZigzagLong || isZigzag) {
        return {
            regime: REGIMES.ZIGZAG,
            confidence: isZigzagLong ? 0.75 : 0.68,
            details,
            suggestedPrediction: lastChar === 'T' ? 'X' : 'T'  // flip
        };
    }

    // 4) Alternating strict (1-1)
    if (altRate >= 0.70 && entropy > 0.85) {
        return {
            regime: REGIMES.ALT_STRICT,
            confidence: Math.min(0.80, altRate + 0.15),
            details,
            suggestedPrediction: lastChar === 'T' ? 'X' : 'T'
        };
    }

    // 5) Alternating loose (có gãy nhịp)
    if (altRate >= 0.55 && altRate < 0.70) {
        return {
            regime: REGIMES.ALT_LOOSE,
            confidence: 0.60,
            details,
            suggestedPrediction: null  // không chắc
        };
    }

    // 6) Streak (bệt) - streak ≥ 3
    if (streak >= 3) {
        // Bệt càng dài → khả năng bẻ càng cao
        let pred = null;
        let conf = 0.55;
        if (streak === 3) { pred = lastChar === 'T' ? 'Tài' : 'Xỉu'; conf = 0.58; }  // tiếp
        else if (streak === 4) { pred = lastChar === 'T' ? 'Xỉu' : 'Tài'; conf = 0.60; }  // nghi bẻ
        else if (streak === 5) { pred = lastChar === 'T' ? 'Xỉu' : 'Tài'; conf = 0.65; }
        else if (streak >= 6) { pred = lastChar === 'T' ? 'Xỉu' : 'Tài'; conf = Math.min(0.78, 0.65 + (streak - 6) * 0.05); }

        const regime = lastChar === 'T' ? REGIMES.STREAK_TAI : REGIMES.STREAK_XIU;
        return { regime, confidence: conf, details, suggestedPrediction: pred };
    }

    // 7) Trending
    if (Math.abs(trendDelta) > 0.35) {
        return {
            regime: REGIMES.TRENDING,
            confidence: 0.60,
            details: { ...details, direction: trendDelta > 0 ? 'Tài' : 'Xỉu' },
            suggestedPrediction: trendDelta > 0 ? 'Tài' : 'Xỉu'
        };
    }

    // 8) N_MIXED (cầu N-N lệch như 2-1, 3-2)
    if (runLengths.length >= 3) {
        const has2 = runLengths.slice(0, 4).filter(r => r === 2).length >= 2;
        const has3 = runLengths.slice(0, 4).filter(r => r === 3).length >= 2;
        if (has2 || has3) {
            return {
                regime: REGIMES.N_MIXED,
                confidence: 0.55,
                details,
                suggestedPrediction: runLengths[0] < (has3 ? 3 : 2) ? lastChar : (lastChar === 'T' ? 'Xỉu' : 'Tài')
            };
        }
    }

    // 9) Noisy
    if (entropy > 0.85 && altRate < 0.5) {
        return { regime: REGIMES.NOISY, confidence: 0.50, details, suggestedPrediction: null };
    }

    // 10) Default
    return { regime: REGIMES.UNKNOWN, confidence: 0.40, details, suggestedPrediction: null };
}

// ============================================================
// 🎯 REGIME-AWARE PREDICTOR - model chuyên biệt theo cầu
// ============================================================
function modelRegime(history, regimeInfo) {
    if (!regimeInfo || !regimeInfo.suggestedPrediction) {
        return { prediction: null, confidence: 0 };
    }

    const pred = regimeInfo.suggestedPrediction;
    const conf = regimeInfo.confidence;

    // Regime-specific accuracy boost
    const regimeStats = AI_MEMORY.regime_stats[regimeInfo.regime];
    let adjustedConf = conf;
    if (regimeStats && regimeStats.total >= 5) {
        const regimeAcc = regimeStats.correct / regimeStats.total;
        // Blend regime base conf với historical accuracy
        adjustedConf = conf * 0.7 + regimeAcc * 0.3;
    }

    return {
        prediction: pred,
        confidence: Math.min(adjustedConf, 0.85),
        regime: regimeInfo.regime
    };
}

// ============================================================
// CALIBRATION
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
// 🚫 BIAS GUARD
// ============================================================
function checkDirectionalBias() {
    if (!BIAS_GUARD.ENABLED) return { biased: false };

    const maxStreak = Math.max(AI_MEMORY.consecutive_tai_predictions, AI_MEMORY.consecutive_xiu_predictions);
    const direction = AI_MEMORY.consecutive_tai_predictions > AI_MEMORY.consecutive_xiu_predictions ? 'Tài' : 'Xỉu';

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
                    biased: true, type: 'HISTORICAL', direction: domDir, ratio,
                    message: `Bias: ${(ratio * 100).toFixed(0)}% predictions ${domDir}`
                };
            }
        }
    }

    if (maxStreak >= BIAS_GUARD.MAX_STREAK_PREDICTIONS) {
        return {
            biased: true, type: 'STREAK', direction, streak: maxStreak,
            message: `Streak dự đoán ${direction} ${maxStreak} phiên`
        };
    }

    return { biased: false };
}

function applyBiasGuard(rawPrediction, rawConfidence, ensemble) {
    if (!BIAS_GUARD.ENABLED) return { prediction: rawPrediction, confidence: rawConfidence, action: 'DISABLED' };

    const bias = checkDirectionalBias();
    if (!bias.biased) return { prediction: rawPrediction, confidence: rawConfidence, action: 'CLEAN' };

    AI_MEMORY.bias_guard.bias_flags++;

    if (rawPrediction !== bias.direction) {
        return { prediction: rawPrediction, confidence: rawConfidence, action: 'BREAK_BIAS_OK' };
    }

    const oppositeVotes = bias.direction === 'Tài' ? ensemble.xiuVotes : ensemble.taiVotes;
    const totalVotes = ensemble.taiVotes + ensemble.xiuVotes;
    const oppositeRatio = totalVotes > 0 ? oppositeVotes / totalVotes : 0;

    if (oppositeRatio >= BIAS_GUARD.OPPOSITE_VOTE_FLIP_THRESHOLD) {
        const flip = bias.direction === 'Tài' ? 'Xỉu' : 'Tài';
        AI_MEMORY.bias_guard.bias_overrides++;
        console.log(`[BIAS GUARD] 🔄 Flip ${rawPrediction}→${flip} (opp=${(oppositeRatio*100).toFixed(0)}%)`);
        return { prediction: flip, confidence: Math.max(0.51, rawConfidence * 0.9), action: 'BIAS_FLIP' };
    }

    if (bias.type === 'STREAK' && rawConfidence < BIAS_GUARD.MIN_CONF_FOR_SAME_DIR) {
        const flip = bias.direction === 'Tài' ? 'Xỉu' : 'Tài';
        AI_MEMORY.bias_guard.same_dir_streak_blocks++;
        console.log(`[BIAS GUARD] 🛑 Streak ${bias.streak} → flip ${flip}`);
        return { prediction: flip, confidence: 0.51, action: 'STREAK_BLOCK' };
    }

    return {
        prediction: rawPrediction,
        confidence: rawConfidence * BIAS_GUARD.OVERRIDE_PENALTY,
        action: 'BIAS_WARN'
    };
}

// ============================================================
// 🎯 STABILITY LOCK
// ============================================================
function applyStabilityLock(newPred, newConf, cur) {
    if (!STABILITY.ENABLED) return { prediction: newPred, confidence: newConf, action: 'DISABLED' };
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

    if (STABILITY_STATE.lastFlipSessionNum) {
        const curNum = parseInt(cur.gameNum.replace('#', ''));
        const flipNum = parseInt(STABILITY_STATE.lastFlipSessionNum.replace('#', ''));
        const gap = curNum - flipNum;
        if (gap < STABILITY.COOLDOWN_SESSIONS) {
            AI_MEMORY.stability.total_flip_blocked++;
            return { prediction: lastPred, confidence: lastConf, action: 'COOLDOWN_BLOCK' };
        }
    }

    const now = Date.now();
    const recentFlips = STABILITY_STATE.flipHistory.filter(f => now - f.timestamp < STABILITY.WINDOW_MS);
    if (recentFlips.length >= STABILITY.MAX_FLIPS_IN_WINDOW) {
        AI_MEMORY.stability.total_flip_blocked++;
        return { prediction: lastPred, confidence: lastConf, action: 'MAX_FLIPS_BLOCK' };
    }

    const confDiff = newConf - lastConf;
    const isStrong = newConf >= STABILITY.STRONG_SIGNAL_CONF;
    const isMuchStronger = confDiff >= STABILITY.FLIP_THRESHOLD && newConf >= STABILITY.MIN_FLIP_CONF;
    const isHysteresis = lastConf - newConf > STABILITY.HYSTERESIS_RATIO;
    const allowFlip = isStrong || isMuchStronger || isHysteresis;

    if (allowFlip) {
        STABILITY_STATE.lastPrediction = newPred;
        STABILITY_STATE.lastPredictionConf = newConf;
        STABILITY_STATE.lastFlipSessionNum = cur.gameNum;
        STABILITY_STATE.flipHistory.push({ session: cur.gameNum, from: lastPred, to: newPred, timestamp: now });
        if (STABILITY_STATE.flipHistory.length > 50) STABILITY_STATE.flipHistory = STABILITY_STATE.flipHistory.slice(-50);
        AI_MEMORY.stability.total_flips++;
        return { prediction: newPred, confidence: newConf, action: 'FLIP_ALLOWED' };
    }

    AI_MEMORY.stability.total_flip_blocked++;
    const adjusted = Math.max((lastConf + newConf) / 2, 0.51);
    STABILITY_STATE.lastPredictionConf = adjusted;
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
function recordCircuitSuccess() { if (CIRCUIT.state === 'HALF_OPEN') { CIRCUIT.state = 'CLOSED'; CIRCUIT.failures = 0; } }
function recordCircuitFailure() {
    CIRCUIT.failures++;
    CIRCUIT.lastFailure = Date.now();
    if (CIRCUIT.failures >= CIRCUIT.threshold) { CIRCUIT.state = 'OPEN'; ANTI_BLOCK_STATS.circuitBreakerTrips++; }
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
                    'User-Agent': ua, 'Accept': 'application/json, text/plain, */*',
                    'Accept-Language': 'vi-VN,vi;q=0.9,en;q=0.8',
                    'Referer': ref, 'Origin': ref.slice(0, -1), 'Cache-Control': 'no-cache'
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
        gameNum: item.gameNum, score: item.score,
        result: getTaiXiu(item.score), faces: item.facesList.join('-'), raw: item
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
// FEATURES (symmetric, no bias)
// ============================================================
function extractFeatures(history) {
    const len = history.length;
    const str = history.map(h => h.result === 'Bão' ? 'B' : (h.result === 'Tài' ? 'T' : 'X')).join('');
    const f = [];
    const slice = (n) => history.slice(-n);
    const taiRate = (arr) => arr.length ? arr.filter(h => h.result === 'Tài').length / arr.length : 0.5;

    for (const n of [2, 3, 4, 5, 8, 10, 12, 15, 20, 25, 30, 40, 50, 75, 90, 100]) {
        f.push(taiRate(slice(n)) * 2 - 1);
    }

    let streak = 1;
    const lastRes = history[len - 1].result;
    for (let i = len - 2; i >= 0; i--) { if (history[i].result === lastRes) streak++; else break; }
    f.push(lastRes === 'Tài' ? Math.min(streak, 15) / 15 : -Math.min(streak, 15) / 15);

    let zz = 0;
    for (let i = len - 1; i >= 1; i--) { if (history[i].result !== history[i - 1].result) zz++; else break; }
    f.push(Math.min(zz, 12) / 12);

    let bao = 0;
    for (let i = len - 1; i >= 0; i--) { if (history[i].result === 'Bão') bao++; else break; }
    f.push(bao / 5);

    [3, 5, 8, 10, 15, 20, 30, 50, 75, 100].forEach(n => {
        const arr = slice(n);
        const avg = arr.reduce((s, h) => s + h.score, 0) / Math.max(1, n);
        f.push((avg - 10.5) / 7.5);
    });

    [5, 10, 20, 50, 100].forEach(n => {
        const arr = slice(n);
        f.push(std(arr.map(h => h.score)) / 5);
    });

    for (let i = 15; i >= 1; i--) {
        const r = history[len - i]?.result;
        f.push(r === 'Tài' ? 1 : r === 'Xỉu' ? -1 : 0);
    }

    [3, 5, 10, 20, 50].forEach(n => {
        const arr = slice(n);
        f.push(arr.reduce((s, h) => s + (h.result === 'Tài' ? 1 : -1), 0) / Math.max(1, n));
    });

    const moms = [3, 5, 10, 20, 50].map(n => slice(n).reduce((s, h) => s + (h.result === 'Tài' ? 1 : -1), 0) / Math.max(1, n));
    for (let i = 0; i < 4; i++) f.push(moms[i] - moms[i + 1]);

    ['TT', 'XX', 'TTT', 'XXX', 'TTTT', 'XXXX', 'TTTTT', 'XXXXX', 'TXT', 'XTX', 'TTX', 'XXT', 'TXX', 'XTT', 'TXTT', 'XTXX', 'TXXT'].forEach(p => {
        f.push(str.slice(-p.length) === p ? 1 : 0);
    });

    [5, 10, 20, 50, 100].forEach(n => { f.push(slice(n).filter(h => h.result === 'Bão').length / Math.max(1, n)); });

    [5, 10, 20, 50, 100].forEach(n => {
        let flips = 0;
        const arr = slice(n);
        for (let i = 0; i < arr.length - 1; i++) if (arr[i].result !== arr[i + 1].result) flips++;
        f.push(arr.length > 1 ? flips / (arr.length - 1) : 0);
    });

    ['1', '2', '3', '4', '5', '6'].forEach(face => {
        const count = slice(10).reduce((s, h) => s + h.faces.split('-').filter(x => x === face).length, 0);
        f.push(count / 30);
    });

    ['1', '2', '3', '4', '5', '6'].forEach(face => {
        const c5 = slice(5).reduce((s, h) => s + h.faces.split('-').filter(x => x === face).length, 0);
        const c10 = slice(10).reduce((s, h) => s + h.faces.split('-').filter(x => x === face).length, 0);
        f.push((c5 / 15) - (c10 / 30));
    });

    let maxT = 0, curT = 0, maxX = 0, curX = 0, maxB = 0, curB = 0;
    slice(50).forEach(h => {
        if (h.result === 'Tài') { curT++; maxT = Math.max(maxT, curT); curX = 0; curB = 0; }
        else if (h.result === 'Xỉu') { curX++; maxX = Math.max(maxX, curX); curT = 0; curB = 0; }
        else { curB++; maxB = Math.max(maxB, curB); curT = 0; curX = 0; }
    });
    f.push(maxT / 20); f.push(maxX / 20); f.push(maxB / 5);

    const scoreDist = {};
    for (let i = 3; i <= 18; i++) scoreDist[i] = 0;
    slice(50).forEach(h => { if (scoreDist[h.score] !== undefined) scoreDist[h.score]++; });
    for (let i = 0; i < 5; i++) f.push((scoreDist[i + 4] || 0) / 50);

    for (let i = 0; i < 5; i++) {
        const r = history[len - 1 - i]?.result;
        f.push(r === 'Tài' ? 1 : -1);
    }

    f.push(moms[0]); f.push(moms[2]); f.push(moms[0] - moms[2]);
    f.push(taiRate(slice(10)) - taiRate(slice(50)));

    const v5 = slice(5).reduce((s, h) => s + Math.pow(h.score - 10.5, 2), 0) / 5;
    const v20 = slice(20).reduce((s, h) => s + Math.pow(h.score - 10.5, 2), 0) / 20;
    f.push(v5 / 25); f.push(v20 / 25);

    while (f.length < 120) f.push(0);
    return f.slice(0, 120);
}

// ============================================================
// FIXED MODELS - no bias
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

// FIXED: pattern với 250+ cầu, đối xứng
function modelPattern(history) {
    const len = history.length;
    const str = history.map(h => h.result === 'Bão' ? 'B' : (h.result === 'Tài' ? 'T' : 'X')).join('');
    const scores = { 'Tài': 0, 'Xỉu': 0 };
    const patterns = [];
    const add = (target, points, name) => { scores[target] += points; patterns.push({ name, target, points }); };
    const last = history[len - 1]?.result;
    const flip = (r) => (r === 'Tài' ? 'Xỉu' : 'Tài');

    // CONTRARIAN (symmetric)
    const last20 = history.slice(-20);
    const tai20 = last20.filter(h => h.result === 'Tài').length;
    const xiu20 = last20.filter(h => h.result === 'Xỉu').length;
    if (xiu20 > tai20 * 1.4) add('Tài', 40, `Contrarian X${xiu20}/T${tai20}`);
    else if (tai20 > xiu20 * 1.4) add('Xỉu', 40, `Contrarian T${tai20}/X${xiu20}`);

    // BỆT (symmetric logic)
    let streak = 1;
    for (let i = len - 2; i >= 0; i--) { if (history[i].result === last) streak++; else break; }
    if (streak === 2) add(last, 50, `Bệt 2`);
    else if (streak === 3) add(last, 45, `Bệt 3`);
    else if (streak === 4) { add(last, 35, `Bệt 4`); add(flip(last), 15, `CG bệt 4`); }
    else if (streak === 5) { add(last, 25, `Bệt 5`); add(flip(last), 30, `Bẻ 5`); }
    else if (streak === 6) { add(last, 15, `Bệt 6`); add(flip(last), 45, `Bẻ 6`); }
    else if (streak >= 7) add(flip(last), 70, `BẺ MẠNH bệt ${streak}`);

    // 1-1 (symmetric)
    let zz = 0;
    for (let i = len - 1; i >= 1; i--) { if (history[i].result !== history[i - 1].result) zz++; else break; }
    if (zz >= 2 && zz <= 5) add(flip(last), 50 + zz * 3, `1-1 (${zz})`);
    else if (zz >= 6) add(last, 40, `1-1 dài (${zz})`);

    // N-N (symmetric)
    for (let n = 2; n <= 8; n++) {
        if (len < n * 2) continue;
        const p = str.slice(-n * 2);
        if (p === 'T'.repeat(n) + 'X'.repeat(n)) add('Tài', 40 + n * 7, `Cầu ${n}-${n} T`);
        if (p === 'X'.repeat(n) + 'T'.repeat(n)) add('Xỉu', 40 + n * 7, `Cầu ${n}-${n} X`);
    }

    // BASIC patterns (SYMMETRIC pairs)
    const basicTests = [
        ['TXX', 'Tài', 40, '1-2-T'], ['XTT', 'Xỉu', 40, '1-2-X'],
        ['TTX', 'Xỉu', 40, '2-1-X'], ['XXT', 'Tài', 40, '2-1-T'],
        ['TXXX', 'Tài', 45, '1-3-T'], ['XTTT', 'Xỉu', 45, '1-3-X'],
        ['TTTX', 'Xỉu', 45, '3-1-X'], ['XXXT', 'Tài', 45, '3-1-T'],
        ['TXXXX', 'Tài', 50, '1-4-T'], ['XTTTT', 'Xỉu', 50, '1-4-X'],
        ['TTTTX', 'Xỉu', 50, '4-1-X'], ['XXXXT', 'Tài', 50, '4-1-T'],
        ['TXXTT', 'Tài', 40, '1-2-2-T'], ['XTTXX', 'Xỉu', 40, '1-2-2-X'],
        ['TTXXT', 'Tài', 40, '2-2-1-T'], ['XXTTX', 'Xỉu', 40, '2-2-1-X'],
        ['TTTXX', 'Xỉu', 40, '3-2-X'], ['XXXTT', 'Tài', 40, '3-2-T'],
        ['TTXXX', 'Xỉu', 40, '2-3-X'], ['XXTTT', 'Tài', 40, '2-3-T'],
        ['TTXXXT', 'Tài', 45, '2-3-1-T'], ['XXTTTX', 'Xỉu', 45, '2-3-1-X'],
        ['TXXTTT', 'Xỉu', 45, '1-2-3-X'], ['XTTXXX', 'Tài', 45, '1-2-3-T'],
        ['TXXXT', 'Xỉu', 45, '1-3-1-X'], ['XTTTX', 'Tài', 45, '1-3-1-T'],
        ['TTXXTT', 'Tài', 45, '2-2-2-T'], ['XXTTXX', 'Xỉu', 45, '2-2-2-X'],
        ['TTTXXX', 'Xỉu', 45, '3-3-X'], ['XXXTTT', 'Tài', 45, '3-3-T']
    ];
    basicTests.forEach(([pat, t, p, n]) => {
        if (len >= pat.length && str.slice(-pat.length) === pat) add(t, p, n);
    });

    // Complex (SYMMETRIC)
    [
        ['TXTT', 'Xỉu', 45, '1-1-2-X'], ['XTXX', 'Tài', 45, '1-1-2-T'],
        ['TTXT', 'Xỉu', 45, '2-1-1-X'], ['XXTX', 'Tài', 45, '2-1-1-T'],
        ['TXTX', 'Xỉu', 40, '1-2-1-X'], ['XTXT', 'Tài', 40, '1-2-1-T'],
        ['TTXTT', 'Xỉu', 45, '2-1-2-X'], ['XXTXX', 'Tài', 45, '2-1-2-T'],
        ['TXTTX', 'Tài', 45, '1-2-1-1-T'], ['XTXXT', 'Xỉu', 45, '1-2-1-1-X'],
        ['TXTTT', 'Xỉu', 40, '1-1-3-X'], ['XTXXX', 'Tài', 40, '1-1-3-T'],
        ['TTTXT', 'Xỉu', 40, '3-1-1-X'], ['XXXTX', 'Tài', 40, '3-1-1-T']
    ].forEach(([pat, t, p, n]) => {
        if (len >= pat.length && str.slice(-pat.length) === pat) add(t, p, n);
    });

    // NHỊP LẺ (symmetric)
    if (len >= 4) {
        const p = str.slice(-4);
        if (p === 'TXXT') add('Xỉu', 35, 'Nhịp lẻ TXXT');
        if (p === 'XTTX') add('Tài', 35, 'Nhịp lẻ XTTX');
    }
    if (len >= 6) {
        const p = str.slice(-6);
        if (p === 'TXXTXX') add('Tài', 40, 'Nhịp lẻ dài X');
        if (p === 'XTTXTT') add('Xỉu', 40, 'Nhịp lẻ dài T');
        if (p === 'TXTXTX' || p === 'XTXTXT') add(flip(last), 45, 'Zigzag kép 6');
    }
    if (len >= 8) {
        const p = str.slice(-8);
        if (p === 'TXTXTXTX') add('Xỉu', 50, 'Zigzag kép 8 X');
        if (p === 'XTXTXTXT') add('Tài', 50, 'Zigzag kép 8 T');
    }

    // ĐỐI XỨNG/PALINDROME
    if (len >= 6) {
        const l6 = str.slice(-6);
        if (l6[0] === l6[5] && l6[1] === l6[4]) add(l6[2] === 'T' ? 'Tài' : 'Xỉu', 30, 'Đối xứng 6');
    }
    if (len >= 8) {
        const l8 = str.slice(-8);
        if (l8 === l8.split('').reverse().join('')) add(l8[0] === 'T' ? 'Tài' : 'Xỉu', 40, 'Palindrome 8');
    }

    // LẶP
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

    // FIBONACCI
    if (len >= 12) {
        const l12 = str.slice(-12);
        const g = [l12.slice(0, 1), l12.slice(1, 2), l12.slice(2, 4), l12.slice(4, 7), l12.slice(7, 12)];
        const same = g.every(x => x === 'T'.repeat(x.length) || x === 'X'.repeat(x.length));
        if (same && g[0][0] !== g[1][0]) add(g[4][0] === 'T' ? 'Xỉu' : 'Tài', 50, 'Fibonacci');
    }

    // XOẮN ỐC
    if (len >= 8) {
        const l8 = str.slice(-8);
        if (l8 === 'TTXXTTXX' || l8 === 'XXTTXXTT') add(l8[0] === 'T' ? 'Tài' : 'Xỉu', 45, 'Xoắn ốc');
    }

    // TAM GIÁC
    if (len >= 9) {
        const l9 = str.slice(-9);
        if (l9 === 'TXXTTTXXX' || l9 === 'XTTXXXTTT') add(l9[0] === 'T' ? 'Tài' : 'Xỉu', 50, 'Tam giác');
    }

    // PHÂN KỲ (symmetric)
    if (len >= 5) {
        const s = history.slice(-5).map(h => h.score);
        if (s[0] < s[1] && s[1] < s[2] && s[2] > s[3] && s[3] > s[4]) add('Xỉu', 30, 'Phân kỳ đỉnh');
        if (s[0] > s[1] && s[1] > s[2] && s[2] < s[3] && s[3] < s[4]) add('Tài', 30, 'Phân kỳ đáy');
    }

    // HỘI TỤ
    if (len >= 7) {
        const s = history.slice(-7).map(h => h.score);
        const fa = (s[0] + s[1] + s[2]) / 3, la = (s[4] + s[5] + s[6]) / 3;
        if (Math.abs(fa - la) < 1.5) add(s[6] > 10.5 ? 'Xỉu' : 'Tài', 25, 'Hội tụ');
    }

    // W/M
    if (len >= 5) {
        const s = history.slice(-5).map(h => h.score);
        if (s[0] < s[1] && s[1] > s[2] && s[2] < s[3] && s[3] > s[4]) add('Xỉu', 25, 'W pattern');
        if (s[0] > s[1] && s[1] < s[2] && s[2] > s[3] && s[3] < s[4]) add('Tài', 25, 'M pattern');
    }

    // TĂNG/GIẢM
    if (len >= 4) {
        const s = history.slice(-4).map(h => h.score);
        if (s[0] < s[1] && s[1] < s[2] && s[2] < s[3]) add('Xỉu', 20, 'Tổng tăng');
        if (s[0] > s[1] && s[1] > s[2] && s[2] > s[3]) add('Tài', 20, 'Tổng giảm');
    }

    // GÃY BỆT
    if (len >= 5) {
        const s = history.slice(-5).map(h => h.result);
        if (s[0] === 'Tài' && s[1] === 'Tài' && s[2] === 'Tài' && s[3] === 'Xỉu' && s[4] === 'Xỉu') add('Tài', 40, 'Gãy bệt T về T');
        if (s[0] === 'Xỉu' && s[1] === 'Xỉu' && s[2] === 'Xỉu' && s[3] === 'Tài' && s[4] === 'Tài') add('Xỉu', 40, 'Gãy bệt X về X');
    }

    // BÃO
    const bao5 = history.slice(-5).filter(h => h.result === 'Bão').length;
    if (bao5 > 0) {
        const prev = history[len - 2]?.result || 'Tài';
        add(prev === 'Tài' ? 'Xỉu' : 'Tài', 35 * bao5, `${bao5} Bão/5`);
    }

    // LONG PATTERN MATCH
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

    // SIMILARITY
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
    if (scores['Tài'] === scores['Xỉu']) return { prediction: null, confidence: 0, patterns, scores };
    const pred = scores['Tài'] > scores['Xỉu'] ? 'Tài' : 'Xỉu';
    return { prediction: pred, confidence: ratio, patterns, scores };
}

// FIXED models - no bias
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
    if (Math.abs(post - 0.5) < 0.03) return { prediction: null, confidence: 0 };
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
    if (macd > 0.03) sig += 0.5; else if (macd < -0.03) sig -= 0.5;
    if (rsi > 70) sig -= 0.3; else if (rsi < 30) sig += 0.3;
    if (Math.abs(sig) < 0.1) return { prediction: null, confidence: 0 };
    return { prediction: sig > 0 ? 'Tài' : 'Xỉu', confidence: Math.min(Math.abs(sig), 1) };
}

// FIXED: modelFrequency - đúng logic
function modelFrequency(history) {
    if (history.length < 30) return { prediction: null, confidence: 0 };
    const l30 = history.slice(-30);
    const t30 = l30.filter(h => h.result === 'Tài').length;
    const deviation = Math.abs(t30 - 15);
    if (deviation < 3) return { prediction: null, confidence: 0 };
    // Contrarian đúng: Tài nhiều → Xỉu, ngược lại
    const pred = t30 > 15 ? 'Xỉu' : 'Tài';
    return { prediction: pred, confidence: Math.min(deviation / 15, 1) };
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

// FIXED: modelForest - bỏ tie-break bias
function modelForest(history) {
    const f = extractFeatures(history);
    const v = { 'Tài': 0, 'Xỉu': 0 };
    const last = history[history.length - 1].result;

    const t5 = history.slice(-5).filter(h => h.result === 'Tài').length;
    if (t5 > 2) v['Tài']++; else if (t5 < 2) v['Xỉu']++;

    let st = 1;
    for (let i = history.length - 2; i >= 0; i--) { if (history[i].result === last) st++; else break; }
    if (st >= 3) v[last === 'Tài' ? 'Xỉu' : 'Tài']++;
    else v[last]++;

    const a10 = history.slice(-10).reduce((s, h) => s + h.score, 0) / 10;
    if (a10 > 11) v['Xỉu']++; else if (a10 < 10) v['Tài']++;

    if (f[7] > 0.2) v['Xỉu']++;
    else if (f[7] < -0.2) v['Tài']++;

    if (f[8] > 0.5) v[last === 'Tài' ? 'Xỉu' : 'Tài']++;
    else if (f[8] < 0.2) v[last]++;

    if (f[14] > 0.2) v['Xỉu']++;
    else if (f[14] < -0.2) v['Tài']++;

    if (f[36] > 0.7) v[last === 'Tài' ? 'Xỉu' : 'Tài']++;
    else if (f[36] < 0.3) v[last]++;

    if (f[45] > 0.1) v['Tài']++;
    else if (f[45] < -0.1) v['Xỉu']++;

    if (v['Tài'] === v['Xỉu']) return { prediction: null, confidence: 0 };
    const total = v['Tài'] + v['Xỉu'];
    return {
        prediction: v['Tài'] > v['Xỉu'] ? 'Tài' : 'Xỉu',
        confidence: Math.abs(v['Tài'] - v['Xỉu']) / total
    };
}

function modelBoosting(history) {
    const f = extractFeatures(history);
    let s = 0;
    if (f[7] > 0.1) s += 0.3;
    if (f[8] > 0.3) s += 0.2;
    if (f[14] > 0.2) s -= 0.25;
    if (f[36] > 0.7) s -= 0.2;
    if (f[45] > 0.15) s -= 0.15;
    if (Math.abs(s) < 0.05) return { prediction: null, confidence: 0 };
    return { prediction: s > 0 ? 'Tài' : 'Xỉu', confidence: Math.min(Math.abs(s), 1) };
}

function modelXGBoost(history) {
    const f = extractFeatures(history);
    let s = 0;
    [0.3, 0.25, 0.2, 0.15, 0.1].forEach((w, i) => { s += f[[7, 8, 14, 36, 45][i]] * w; });
    if (Math.abs(s) < 0.05) return { prediction: null, confidence: 0 };
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
    if (Math.abs(at - 0.5) < 0.03) return { prediction: null, confidence: 0 };
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
    if (Math.abs(ts) < 0.05) return { prediction: null, confidence: 0 };
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
    if (Math.abs(o - 0.5) < 0.03) return { prediction: null, confidence: 0 };
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
    if (Math.abs(s) < 0.05) return { prediction: null, confidence: 0 };
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

// FIXED: SVM weights symmetric (tổng = 0)
function modelSVM(history) {
    const f = extractFeatures(history);
    const w = [0.2, -0.2, 0.15, -0.15, 0.1, -0.1, 0.15, -0.15];
    let d = 0;
    for (let i = 0; i < w.length; i++) d += f[i] * w[i];
    if (Math.abs(d) < 0.05) return { prediction: null, confidence: 0 };
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
    if (t === x) return { prediction: null, confidence: 0 };
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
    return { prediction: null, confidence: 0 };
}

function modelWavelet(history) {
    if (history.length < 20) return { prediction: null, confidence: 0 };
    const s = history.slice(-20).map(h => h.result === 'Tài' ? 1 : 0);
    const sc = [];
    for (let i = 0; i < s.length - 1; i += 2) sc.push((s[i] + s[i + 1]) / 2);
    const a = sc.reduce((x, y) => x + y, 0) / sc.length;
    if (Math.abs(a - 0.5) < 0.05) return { prediction: null, confidence: 0 };
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
    if (Math.abs(x) < 0.3) return { prediction: null, confidence: 0 };
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
    if (tv === 2 || tv === 3) return { prediction: null, confidence: 0 };
    return { prediction: tv >= 3 ? 'Tài' : 'Xỉu', confidence: 0.5 + Math.abs(tv - 2.5) / 5 };
}

function modelAnneal(history) {
    if (history.length < 30) return { prediction: null, confidence: 0 };
    const f = extractFeatures(history);
    let bs = -Infinity, bp = null;
    for (let it = 0; it < 50; it++) {
        const w = Array(5).fill(0).map(() => (Math.random() - 0.5) * 2);
        let s = 0;
        [7, 8, 14, 36, 45].forEach((idx, i) => { s += f[idx] * w[i]; });
        const p = s > 0 ? 'Tài' : 'Xỉu';
        const rc = history.slice(-10).filter((h) => (h.result === 'Tài' && s > 0) || (h.result === 'Xỉu' && s <= 0)).length;
        if (rc > bs) { bs = rc; bp = p; }
    }
    if (!bp) return { prediction: null, confidence: 0 };
    return { prediction: bp, confidence: Math.min(bs / 10, 1) };
}

function modelBayesOpt(history) {
    if (history.length < 30) return { prediction: null, confidence: 0 };
    const f = extractFeatures(history);
    let bp = null, bs = -Infinity;
    for (let i = 0; i < 30; i++) {
        const s = Array(10).fill(0).map(() => Math.random() - 0.5);
        let sc = 0;
        for (let j = 0; j < 10; j++) sc += f[j] * s[j];
        const acq = sc + 0.5 * Math.sqrt(Math.log(i + 1) / (i + 1));
        if (acq > bs) { bs = acq; bp = sc > 0 ? 'Tài' : 'Xỉu'; }
    }
    if (!bp) return { prediction: null, confidence: 0 };
    return { prediction: bp, confidence: Math.min(Math.abs(bs) * 2, 1) };
}

// FIXED: modelEntropy
function modelEntropy(history) {
    if (history.length < 30) return { prediction: null, confidence: 0 };
    const l = history.slice(-30);
    const t = l.filter(h => h.result === 'Tài').length;
    const pT = t / 30, pX = 1 - pT;
    const H = pT > 0 && pX > 0 ? -(pT * Math.log2(pT) + pX * Math.log2(pX)) : 0;
    if (H > 0.95) return { prediction: null, confidence: 0 };
    const deviation = Math.abs(t - 15);
    if (deviation < 2) return { prediction: null, confidence: 0 };
    const pred = t > 15 ? 'Xỉu' : 'Tài';
    return { prediction: pred, confidence: 1 - H };
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
    if (t === 0 || v['Tài'] === v['Xỉu']) return { prediction: null, confidence: 0, votes: v };
    return { prediction: v['Tài'] > v['Xỉu'] ? 'Tài' : 'Xỉu', confidence: Math.abs(v['Tài'] - v['Xỉu']) / t, votes: v };
}

// FIXED: modelSupreme - vote count aware
function modelSupreme(history, all) {
    const v = { 'Tài': 0, 'Xỉu': 0 };
    const count = { 'Tài': 0, 'Xỉu': 0 };

    all.forEach(r => {
        if (!r.prediction || !r.confidence) return;
        const perf = AI_MEMORY.model_performance[r.name];
        const w = perf?.weight || 1.0;
        const acc = perf?.total > 10 ? perf.correct / perf.total : 0.5;
        const racc = perf?.recentTotal > 5 ? perf.recentCorrect / perf.recentTotal : 0.5;
        const composite = w * (0.4 + 0.6 * acc) * (0.4 + 0.6 * racc);
        v[r.prediction] += r.confidence * composite;
        count[r.prediction] += 1;
    });

    const total = v['Tài'] + v['Xỉu'];
    const totalCount = count['Tài'] + count['Xỉu'];
    if (total === 0 || totalCount === 0) return { prediction: null, confidence: 0 };

    // Vote count majority (ratio ≥ 2:1)
    const ratio = Math.max(count['Tài'], count['Xỉu']) / totalCount;
    if (ratio >= 0.67) {
        return {
            prediction: count['Tài'] > count['Xỉu'] ? 'Tài' : 'Xỉu',
            confidence: Math.abs(v['Tài'] - v['Xỉu']) / total,
            votes: v, counts: count
        };
    }

    if (v['Tài'] === v['Xỉu']) return { prediction: null, confidence: 0 };
    return {
        prediction: v['Tài'] > v['Xỉu'] ? 'Tài' : 'Xỉu',
        confidence: Math.abs(v['Tài'] - v['Xỉu']) / total,
        votes: v, counts: count
    };
}

// ============================================================
// ENSEMBLE - tích hợp regime detection
// ============================================================
function runEnsemble(history) {
    // 1) Regime detection FIRST
    const regimeInfo = detectRegime(history);

    const results = {
        markov: modelMarkov(history),
        neural: modelNeural(history),
        neural_v2: modelNeuralV2(history),
        qlearn: modelQLearn(history),
        pattern: modelPattern(history),
        regime: modelRegime(history, regimeInfo),
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

    let rawPrediction = supR.prediction || metaR.prediction;
    let rawConfidence = supR.confidence || metaR.confidence || 0.3;

    // Nếu regime detector đưa ra gợi ý mạnh → blend
    if (regimeInfo.suggestedPrediction && regimeInfo.confidence >= 0.65) {
        const regimeWeight = regimeInfo.confidence * 0.5;
        if (rawPrediction === regimeInfo.suggestedPrediction) {
            rawConfidence = Math.min(0.85, rawConfidence * (1 + regimeWeight * 0.3));
        } else if (regimeInfo.confidence >= 0.75) {
            // Regime rất tự tin → override
            console.log(`[REGIME OVERRIDE] ${regimeInfo.regime} → ${regimeInfo.suggestedPrediction}`);
            rawPrediction = regimeInfo.suggestedPrediction;
            rawConfidence = regimeInfo.confidence * 0.7;
        } else {
            // Không chắc → giảm conf
            rawConfidence *= 0.85;
        }
    }

    // Imbalance handling
    const imb = Math.abs(tv - xv) / tvTotal;
    if (imb > 0.80) rawConfidence *= 0.55;

    // Regime-based confidence adjustment
    if (regimeInfo.regime === REGIMES.RANDOM) rawConfidence *= 0.5;
    else if (regimeInfo.regime === REGIMES.NOISY) rawConfidence *= 0.7;
    else if (regimeInfo.regime === REGIMES.ALT_STRICT) rawConfidence = Math.min(0.82, rawConfidence * 1.15);

    // Flip rate penalty
    const last10 = history.slice(-10);
    let flips = 0;
    for (let i = 0; i < last10.length - 1; i++) if (last10[i].result !== last10[i + 1].result) flips++;
    const flipRate = flips / 9;
    if (flipRate > 0.8 && regimeInfo.regime !== REGIMES.ALT_STRICT && regimeInfo.regime !== REGIMES.ZIGZAG) {
        rawConfidence *= 0.75;
    }

    const calibrated = calibrateConfidence(rawConfidence);

    return {
        final: { prediction: rawPrediction, confidence: calibrated },
        raw_confidence: rawConfidence,
        supreme: supR, meta: metaR,
        models: base, taiVotes: tv, xiuVotes: xv,
        consensus: Math.max(tv, xv) / tvTotal,
        imbalance: imb.toFixed(2),
        flipRate: flipRate.toFixed(2),
        regime: regimeInfo.regime,
        regimeConfidence: regimeInfo.confidence,
        regimeDetails: regimeInfo.details,
        allModels: results,
        totalModels: base.length
    };
}

// ============================================================
// 3 SỐ TỔNG
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

    // Neural v1
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

    // Update per-model
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
        perf.weight = Math.max(0.2, Math.min(2.0, 0.5 + 1.5 * acc + 1.0 * racc));
    });

    // Update regime stats
    const regime = ens.regime || 'UNKNOWN';
    if (!AI_MEMORY.regime_stats[regime]) AI_MEMORY.regime_stats[regime] = { correct: 0, total: 0 };
    AI_MEMORY.regime_stats[regime].total++;
    if (ens.final.prediction === actualResult) AI_MEMORY.regime_stats[regime].correct++;

    // Global
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
        predicted: fp, actual: actualResult,
        correct: fp === actualResult,
        confidence: AI_MEMORY.pendingPrediction?.confidence,
        regime: regime,
        timestamp: Date.now()
    });
    if (AI_MEMORY.recent_predictions.length > 200) AI_MEMORY.recent_predictions.shift();

    if (AI_MEMORY.recent_predictions.length % 20 === 0) fitPlatt();

    saveMemory();
}

// ============================================================
// PREDICT
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

    if (len < REALITY_CHECK.minSessionsToPredict) {
        return {
            "phiên": cur.gameNum.replace('#', ''),
            "xúc xắc": cur.faces, "tổng": cur.score, "kết quả": cur.result,
            "phiên dự đoán": `${parseInt(cur.gameNum.replace('#', '')) + 1}`,
            "dự đoán": "NO_SIGNAL", "vị cược": "N/A", "tỉ lệ": "N/A",
            "_regime": "UNKNOWN",
            "_warnings": ["need_more_data"]
        };
    }

    const ensemble = runEnsemble(history);

    const biasGuard = applyBiasGuard(ensemble.final.prediction, ensemble.final.confidence, ensemble);
    const afterBias = { prediction: biasGuard.prediction, confidence: biasGuard.confidence };

    const stability = applyStabilityLock(afterBias.prediction, afterBias.confidence, cur);
    const finalPrediction = stability.prediction;
    const finalConfidence = stability.confidence;

    const isNoSignal = finalConfidence < NO_SIGNAL_CONF && stability.action !== 'HOLD_SAME';
    let displayPrediction = finalPrediction;
    let displayConf = finalConfidence;
    const warnings = [];

    if (isNoSignal) {
        displayPrediction = 'NO_SIGNAL';
        warnings.push('NO_SIGNAL_LOW_CONFIDENCE');
        AI_MEMORY.no_signal_predictions = (AI_MEMORY.no_signal_predictions || 0) + 1;
    }
    if (biasGuard.action !== 'CLEAN') warnings.push(`bias_${biasGuard.action.toLowerCase()}`);
    if (ensemble.regime === REGIMES.RANDOM) warnings.push('high_entropy');
    if (ensemble.regime === REGIMES.NOISY) warnings.push('noisy_regime');

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
        "xúc xắc": cur.faces, "tổng": cur.score, "kết quả": cur.result,
        "phiên dự đoán": `${parseInt(cur.gameNum.replace('#', '')) + 1}`,
        "dự đoán": displayPrediction,
        "vị cược": displayPrediction === 'NO_SIGNAL' ? 'N/A' : betRange,
        "tỉ lệ": displayPrediction === 'NO_SIGNAL' ? 'N/A' : `${(displayConf * 100).toFixed(2)}%`,
        "_regime": ensemble.regime,
        "_regime_confidence": (ensemble.regimeConfidence * 100).toFixed(1) + '%',
        "_regime_details": ensemble.regimeDetails,
        "_stability": {
            "action": stability.action,
            "raw_prediction": ensemble.final.prediction,
            "raw_confidence": (ensemble.raw_confidence * 100).toFixed(2) + '%'
        },
        "_bias_guard": { "action": biasGuard.action, "after": afterBias.prediction },
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
        name: '⚡ Sicbo AI v13.0 ULTIMATE - REGIME AWARE + NO BIAS',
        disclaimer: REALITY_CHECK.disclaimer,
        models: Object.keys(AI_MEMORY.model_performance).length,
        regime_system: {
            current: AI_MEMORY.regime,
            supported_regimes: Object.values(REGIMES),
            stats: AI_MEMORY.regime_stats
        },
        directional_balance: {
            tai: tCount, xiu: xCount,
            tai_ratio: `${(tRatio * 100).toFixed(1)}%`,
            is_balanced: Math.abs(tRatio - 0.5) < 0.15
        },
        bias_guard: { enabled: BIAS_GUARD.ENABLED, stats: AI_MEMORY.bias_guard },
        stability: { enabled: STABILITY.ENABLED, stats: AI_MEMORY.stability },
        total_predictions: AI_MEMORY.total_predictions,
        accuracy: AI_MEMORY.total_predictions > 0
            ? `${((AI_MEMORY.correct_predictions / AI_MEMORY.total_predictions) * 100).toFixed(2)}%` : 'N/A',
        endpoints: {
            'Dự đoán': '/api/du-doan',
            'Regime': '/api/regime',
            'Bias Guard': '/api/bias-guard',
            'AI Status': '/api/ai-status',
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

app.get('/api/regime', async (req, res) => {
    try {
        const history = await fetchHistoryCached(req.query.game || CURRENT_GAME);
        const regimeInfo = detectRegime(history);
        const stats = AI_MEMORY.regime_stats;
        res.json({
            current: regimeInfo,
            stats: Object.entries(stats).map(([r, s]) => ({
                regime: r,
                correct: s.correct,
                total: s.total,
                accuracy: s.total > 0 ? `${((s.correct / s.total) * 100).toFixed(1)}%` : 'N/A'
            })),
            all_regimes: Object.values(REGIMES)
        });
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
            recent_50: { tai: recentT, xiu: recentX }
        },
        lifetime: {
            tai_predictions: tCount, xiu_predictions: xCount,
            tai_ratio: `${(tRatio * 100).toFixed(1)}%`,
            is_balanced: Math.abs(tRatio - 0.5) < 0.15
        }
    });
});

app.get('/api/stability', (req, res) => {
    res.json({
        config: STABILITY,
        state: STABILITY_STATE,
        memory: AI_MEMORY.stability,
        recentFlips: STABILITY_STATE.flipHistory.slice(-10).reverse()
    });
});

app.get('/api/calibration', (req, res) => {
    const bins = AI_MEMORY.calibration.map((b, i) => ({
        range: `${i * 10}-${(i + 1) * 10}%`,
        correct: b.correct, total: b.total,
        accuracy: b.total > 0 ? `${((b.correct / b.total) * 100).toFixed(1)}%` : 'N/A'
    }));
    res.json({ platt: AI_MEMORY.platt, bins });
});

app.get('/api/ai-status', (req, res) => {
    const recent = AI_MEMORY.recent_predictions.slice(-20);
    const rc = recent.filter(p => p.correct).length;

    res.json({
        version: AI_MEMORY.version,
        regime: AI_MEMORY.regime,
        regime_stats: AI_MEMORY.regime_stats,
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
        bias_guard: AI_MEMORY.bias_guard,
        stability: AI_MEMORY.stability,
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
        cache: { has_data: !!HISTORY_CACHE.data, age_ms: HISTORY_CACHE.data ? Date.now() - HISTORY_CACHE.timestamp : null },
        stats: ANTI_BLOCK_STATS
    });
});

app.get('/api/reset-memory', (req, res) => {
    if (fs.existsSync(MEMORY_FILE)) fs.unlinkSync(MEMORY_FILE);
    if (fs.existsSync(MEMORY_BACKUP)) fs.unlinkSync(MEMORY_BACKUP);
    STABILITY_STATE = { lastPrediction: null, lastPredictionConf: 0, lastFlipSessionNum: null, flipHistory: [], holdCount: 0 };
    res.json({ message: 'Memory reset. Restart server.' });
});

app.get('/api/tool/predict', async (req, res) => {
    try {
        const result = await predict(req.query.game || CURRENT_GAME);
        if ((req.query.format || 'json') === 'compact') {
            return res.json({
                s: result["phiên"], d: result["dự đoán"], v: result["vị cược"],
                r: result["tỉ lệ"], t: result["tổng"], k: result["kết quả"],
                rg: result._regime, st: result._stability?.action
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
        regime: AI_MEMORY.regime,
        circuit: CIRCUIT.state
    });
});

// ============================================================
// START
// ============================================================
app.listen(PORT, () => {
    console.log('╔═══════════════════════════════════════════════════════════╗');
    console.log('║   ⚡ SICBO AI v13.0 ULTIMATE                              ║');
    console.log('║   REGIME AWARE + NO BIAS + 250+ CẦU                       ║');
    console.log('╠═══════════════════════════════════════════════════════════╣');
    console.log(`║  🚀 Dự đoán:  http://localhost:${PORT}/api/du-doan           ║`);
    console.log(`║  🧠 Regime:   http://localhost:${PORT}/api/regime            ║`);
    console.log(`║  🎯 Bias:     http://localhost:${PORT}/api/bias-guard        ║`);
    console.log(`║  📊 Status:   http://localhost:${PORT}/api/ai-status         ║`);
    console.log('╠═══════════════════════════════════════════════════════════╣');
    console.log('║  🎯 32 MODELS - 250+ CẦU - 13 REGIMES                     ║');
    console.log('║  🧠 REGIME DETECTOR:                                      ║');
    console.log('║     - STREAK_TAI/STREAK_XIU (bệt)                         ║');
    console.log('║     - ALT_STRICT/ALT_LOOSE (1-1)                          ║');
    console.log('║     - N_2_2 / N_3_3 (cầu N-N)                             ║');
    console.log('║     - ZIGZAG / TRENDING / RANDOM / NOISY                  ║');
    console.log('╠═══════════════════════════════════════════════════════════╣');
    console.log('║  🚫 NO BIAS: Fix tất cả model thiên vị Tài                ║');
    console.log('║  🔒 STABILITY + BIAS GUARD                                ║');
    console.log('╠═══════════════════════════════════════════════════════════╣');
    console.log('║  ⚠️  KHÔNG thuật toán nào đảm bảo 90% chính xác.          ║');
    console.log('║  Đây là EDGE thống kê nhỏ. Chơi có trách nhiệm.           ║');
    console.log('╚═══════════════════════════════════════════════════════════╝');
});
