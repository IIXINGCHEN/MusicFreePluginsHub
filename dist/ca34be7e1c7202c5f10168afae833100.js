"use strict";

const axios = require("axios");

const PYNCPLAYER_VERSION = "1.2.1"; // Version bump for security enhancements
const pageSize = 30;
const GDSTUDIO_API_BASE = "https://music-api.gdstudio.xyz/api.php";
const DEFAULT_GDSTUDIO_SOURCE = "kuwo";
const VALID_GDSTUDIO_SOURCES = ["netease", "kuwo", "joox", "tidal", "tencent", "spotify", "ytmusic", "qobuz", "deezer", "migu", "ximalaya"];


// --- Validation Helper Functions ---
function isValidUrl(urlString) {
    if (typeof urlString !== 'string') return false;
    try {
        const url = new URL(urlString);
        return url.protocol === "http:" || url.protocol === "https:";
    } catch (_) {
        return false;
    }
}

// Basic sanitizer: removes null bytes and trims. More aggressive sanitization can break valid content.
function sanitizeString(str, defaultVal = "") {
    if (typeof str === 'string') {
        return str.replace(/\0/g, '').trim(); // Remove null bytes, trim whitespace
    }
    return defaultVal;
}

// --- API Call Helper ---
async function callGdApi(params) {
    try {
        const response = await axios.get(GDSTUDIO_API_BASE, { params, timeout: 8000 });
        if (response.status === 200 && response.data && typeof response.data === 'object') {
            // Basic check that data is an object
            if (typeof response.data.url === 'string') {
                response.data.url = response.data.url.replace(/\\\//g, '/');
            }
            return response.data;
        }
        // console.error("GD API Call Error: Invalid response structure or status", response.status, response.data);
        return null;
    } catch (error) {
        // console.error("GD API Call Exception:", error.message, "Params:", params);
        return null;
    }
}

// --- User Config Handling ---
let currentEnvConfig = {
    PROXY_URL: null,
    GDSTUDIO_SOURCE: DEFAULT_GDSTUDIO_SOURCE,
};

function getUserConfig() {
    let config = { ...currentEnvConfig }; // Start with defaults
    if (typeof global !== 'undefined' && global.lx && global.lx.env && typeof global.lx.env.getUserVariables === 'function') {
        const userVars = global.lx.env.getUserVariables();
        if (userVars && typeof userVars === 'object') {
            if (userVars.PROXY_URL && isValidUrl(userVars.PROXY_URL)) {
                config.PROXY_URL = userVars.PROXY_URL;
            } else if (userVars.PROXY_URL) {
                // console.warn("pyncmd: Invalid PROXY_URL format, ignoring.");
            }

            if (userVars.GDSTUDIO_SOURCE && VALID_GDSTUDIO_SOURCES.includes(String(userVars.GDSTUDIO_SOURCE).toLowerCase())) {
                config.GDSTUDIO_SOURCE = String(userVars.GDSTUDIO_SOURCE).toLowerCase();
            } else if (userVars.GDSTUDIO_SOURCE) {
                // console.warn(`pyncmd: Invalid GDSTUDIO_SOURCE "${userVars.GDSTUDIO_SOURCE}", using default "${DEFAULT_GDSTUDIO_SOURCE}".`);
            }
        }
    }
    return config;
}

function applyProxy(url, proxyUrl) {
    if (proxyUrl && isValidUrl(proxyUrl) && url && isValidUrl(url) && 
        (url.includes("kuwo.cn") || url.includes("migu.cn") || url.includes("music.163.com") || url.includes("isure.stream.qqmusic.qq.com"))) {
        const httpRemovedUrl = url.replace(/^http[s]?:\/\//, "");
        // Ensure proxyUrl doesn't end with a slash if we add one
        return proxyUrl.replace(/\/$/, "") + "/" + httpRemovedUrl;
    }
    return url;
}

// --- Internal Formatting ---
function internalFormatMusicItem(apiTrackData) {
    if (!apiTrackData || typeof apiTrackData !== 'object' || !apiTrackData.id) {
        return null; 
    }

    const id = String(apiTrackData.id);
    const title = sanitizeString(apiTrackData.name, "Unknown Title");
    
    let artists = "Unknown Artist";
    if (Array.isArray(apiTrackData.artist)) {
        artists = apiTrackData.artist.map(a => sanitizeString(a)).filter(Boolean).join('&') || "Unknown Artist";
    } else if (apiTrackData.artist) {
        artists = sanitizeString(apiTrackData.artist);
    }

    const album = sanitizeString(apiTrackData.album, "Unknown Album");
    
    // Artwork is fetched later in getMusicInfo if pic_id is present
    // Duration is often not available directly from search, default to 0
    const duration = parseInt(apiTrackData.duration_ms || apiTrackData.duration || 0, 10) || 0; // Prefer duration_ms if available

    return {
        id: id,
        title: title,
        artist: artists,
        album: album,
        artwork: sanitizeString(apiTrackData.artworkUrl, ""), // If pre-fetched by getMusicInfo from pic_id
        duration: duration,
        _pic_id: apiTrackData.pic_id ? String(apiTrackData.pic_id) : null,
        _lyric_id: apiTrackData.lyric_id ? String(apiTrackData.lyric_id) : id, // Fallback to track_id
        _source: apiTrackData.source ? String(apiTrackData.source) : null,
        qualities: {}, // Simplified
        content: 0, 
        rawLrc: "", 
    };
}

// --- Exported Core Functions ---

async function search(query, page = 1, type = "music") {
    if (typeof query !== 'string' || !query.trim()) return Promise.resolve({ isEnd: true, data: [], error: "Invalid search query." });
    if (typeof page !== 'number' || page < 1) page = 1;
    if (type !== "music") return Promise.resolve({ isEnd: true, data: [], error: `Search type "${type}" not supported.` });

    const userCfg = getUserConfig();
    const apiParams = {
        types: "search",
        source: userCfg.GDSTUDIO_SOURCE,
        name: query,
        count: pageSize,
        pages: page,
    };
    const searchData = await callGdApi(apiParams);

    if (searchData && Array.isArray(searchData)) {
        const formattedResults = searchData.map(track => internalFormatMusicItem(track)).filter(item => item !== null);
        return Promise.resolve({
            isEnd: formattedResults.length < pageSize,
            data: formattedResults,
        });
    }
    return Promise.resolve({ isEnd: true, data: [], error: "Search API request failed or returned invalid data." });
}

async function getMusicInfo(musicItem) {
    if (!musicItem || typeof musicItem !== 'object' || !musicItem.id || typeof musicItem.id !== 'string') {
        return Promise.resolve(internalFormatMusicItem({ id: "unknown", title: "Error: Invalid musicItem input" }));
    }

    const userCfg = getUserConfig();
    // Use source from item if available, otherwise default. Ensure it's valid.
    const source = (musicItem._source && VALID_GDSTUDIO_SOURCES.includes(musicItem._source)) ? musicItem._source : userCfg.GDSTUDIO_SOURCE;
    const pic_id = musicItem._pic_id; // Already validated as string or null by internalFormatMusicItem

    let finalItemData = { ...musicItem }; // Start with a copy

    // Fetch artwork if pic_id exists and artwork isn't already there
    if (!finalItemData.artwork && pic_id) {
        const picData = await callGdApi({
            types: "pic",
            source: source,
            id: pic_id,
        });
        if (picData && isValidUrl(picData.url)) {
            finalItemData.artworkUrl = picData.url; // Store as artworkUrl for internalFormatMusicItem
        }
    }
    
    // Re-format to ensure all fields are sanitized and structured
    const formattedItem = internalFormatMusicItem(finalItemData);
    if (!formattedItem) return Promise.resolve(internalFormatMusicItem({ id: musicItem.id, title: "Error: Failed to process music item." }));
    
    return Promise.resolve(formattedItem);
}

async function getMediaSource(musicItem, quality) {
    if (!musicItem || typeof musicItem !== 'object' || !musicItem.id || typeof musicItem.id !== 'string') {
        return Promise.resolve({ error: "Invalid musicItem input." });
    }
    if (typeof quality !== 'string') quality = "standard"; // Default quality

    const userCfg = getUserConfig();
    const source = (musicItem._source && VALID_GDSTUDIO_SOURCES.includes(musicItem._source)) ? musicItem._source : userCfg.GDSTUDIO_SOURCE;
    const track_id = musicItem.id;

    let bitrate;
    switch (quality.toLowerCase()) {
        case "low": bitrate = "128"; break;
        case "standard": bitrate = "320"; break;
        case "high": bitrate = "999"; break;
        case "super": bitrate = "999"; break;
        default: bitrate = "320";
    }

    const urlData = await callGdApi({
        types: "url",
        source: source,
        id: track_id,
        br: bitrate,
    });

    if (urlData && isValidUrl(urlData.url)) {
        const PROXY_URL = userCfg.PROXY_URL; // Already validated by getUserConfig
        return Promise.resolve({
            url: applyProxy(urlData.url, PROXY_URL),
            size: urlData.size ? parseInt(urlData.size, 10) * 1024 : 0,
            quality: quality,
        });
    }
    return Promise.resolve({ error: "Failed to get media source or invalid URL returned." });
}

async function getLyric(musicItem) {
    if (!musicItem || typeof musicItem !== 'object' || (!musicItem.id && !musicItem._lyric_id)) {
        return Promise.resolve({ rawLrc: "", tlyric: "", error: "Invalid musicItem input." });
    }
    
    const userCfg = getUserConfig();
    const source = (musicItem._source && VALID_GDSTUDIO_SOURCES.includes(musicItem._source)) ? musicItem._source : userCfg.GDSTUDIO_SOURCE;
    const lyric_id = musicItem._lyric_id || musicItem.id; // Already validated string or null

    if (!lyric_id) return Promise.resolve({ rawLrc: "", tlyric: "", error: "Lyric ID missing." });

    const lyricData = await callGdApi({
        types: "lyric",
        source: source,
        id: lyric_id,
    });

    if (lyricData && (typeof lyricData.lyric === 'string' || typeof lyricData.tlyric === 'string')) {
        return Promise.resolve({
            rawLrc: sanitizeString(lyricData.lyric),
            translateLrc: sanitizeString(lyricData.tlyric),
        });
    }
    return Promise.resolve({ rawLrc: "", tlyric: "", error: "Lyric not found or API error." });
}

// --- Module Exports ---
module.exports = {
    platform: "pyncmd (GDStudio API Secure)",
    version: PYNCPLAYER_VERSION,
    cacheControl: "no-store", 
    
    userVariables: [
        { 
            key: "GDSTUDIO_SOURCE", 
            name: "GDStudio 音源", 
            hint: `默认音源 (可选: ${VALID_GDSTUDIO_SOURCES.join(', ')}). 当前稳定: netease, kuwo, joox, tidal. 默认: ${DEFAULT_GDSTUDIO_SOURCE}` 
        },
        { 
            key: "PROXY_URL", 
            name: "反代URL (可选)", 
            hint: "例如: https://yourproxy.com (代理部分音源链接)" 
        }
    ],
    hints: { 
        general: "pyncmd源 (基于GDStudio API). 依赖所选音源的稳定性. 部分音源可能需要代理."
    },
    supportedSearchType: ["music"],

    search,
    getMusicInfo,
    getMediaSource,
    getLyric,
};
