"use strict";

// Attempt to load critical dependency and set a flag
let unblockMusicMatcher = null;
let UNM_LOAD_ERROR = null;
try {
    unblockMusicMatcher = require("@unblockneteasemusic/server");
    if (!unblockMusicMatcher || typeof unblockMusicMatcher.match !== 'function') {
        throw new Error("@unblockneteasemusic/server loaded but 'match' function is not available.");
    }
} catch (e) {
    UNM_LOAD_ERROR = e;
}

const axios = require("axios");

const PYNCPLAYER_VERSION = "1.0.5"; // Define version directly
const pageSize = 30;

// qualityToBitrate is an internal helper for getMediaSource
const qualityToBitrate = {
    "low": "128",
    "standard": "320",
    "high": "999",
    "super": "999",
};

// --- Internal Helper Functions ---
async function callGDStudioAPI(id, br = "320") {
    try {
        const apiUrl = new URL("https://music-api.gdstudio.xyz/api.php");
        apiUrl.searchParams.append("types", "url");
        apiUrl.searchParams.append("id", id);
        apiUrl.searchParams.append("br", br);
        const response = await axios.get(apiUrl.toString(), { timeout: 8000 });
        if (response.status === 200 && response.data && response.data.url) {
            return {
                url: String(response.data.url).split("?")[0],
                size: response.data.size || 0,
                br: response.data.br || br,
                type: response.data.type,
            };
        }
        return null;
    } catch (error) {
        return null;
    }
}

async function searchGDStudioKuwo(name, page = 1, limit = pageSize) {
    try {
        const apiUrl = new URL("https://music-api.gdstudio.xyz/api.php");
        apiUrl.searchParams.append("types", "search");
        apiUrl.searchParams.append("source", "kuwo");
        apiUrl.searchParams.append("name", name);
        apiUrl.searchParams.append("count", String(limit));
        apiUrl.searchParams.append("pages", String(page));
        const response = await axios.get(apiUrl.toString(), { timeout: 10000 });
        if (response.status === 200 && response.data && Array.isArray(response.data)) {
            return response.data;
        }
        return [];
    } catch (error) {
        return [];
    }
}

let currentEnvConfig = { PROXY_URL: null, UNM_SOURCES: null, music_u: null };
function getUserConfig() {
    // This function would typically be influenced by MusicFree's environment
    // For now, it returns a module-level config object.
    // MusicFree might inject variables via global.lx.env.getUserVariables()
    if (typeof global !== 'undefined' && global.lx && global.lx.env && typeof global.lx.env.getUserVariables === 'function') {
        return { ...currentEnvConfig, ...global.lx.env.getUserVariables() };
    }
    return currentEnvConfig;
}

function applyProxy(url, proxyUrl) {
    if (proxyUrl && url && (url.includes("kuwo.cn") || url.includes("migu.cn") || url.includes("isure.stream.qqmusic.qq.com"))) {
        const httpRemovedUrl = url.replace(/^http[s]?:\/\//, "");
        return proxyUrl.replace(/\/$/, "") + "/" + httpRemovedUrl;
    }
    return url;
}

function internalFormatMusicItem(rawTrackData, dataSourceHint = "unknown") {
    let id = rawTrackData.id || null;
    let title = rawTrackData.name || rawTrackData.title || "Unknown Title";
    let artist = "Unknown Artist";
    let albumName = "Unknown Album";
    let artwork = rawTrackData.pic || rawTrackData.artwork || (rawTrackData.album ? rawTrackData.album.picUrl : null) || "";
    let duration = rawTrackData.dt || rawTrackData.duration || 0;
    let albumId = rawTrackData.al ? rawTrackData.al.id : (rawTrackData.album ? rawTrackData.album.id : null);

    if (rawTrackData.ar && Array.isArray(rawTrackData.ar)) artist = rawTrackData.ar.map(a => a.name).join('&');
    else if (rawTrackData.artists && Array.isArray(rawTrackData.artists)) artist = rawTrackData.artists.map(a => a.name).join('&');
    else if (typeof rawTrackData.artist === 'string') artist = rawTrackData.artist;

    if (rawTrackData.al && rawTrackData.al.name) { albumName = rawTrackData.al.name; if (!artwork && rawTrackData.al.picUrl) artwork = rawTrackData.al.picUrl; }
    else if (rawTrackData.album && typeof rawTrackData.album === 'object' && rawTrackData.album.name) { albumName = rawTrackData.album.name; if (!artwork && rawTrackData.album.picUrl) artwork = rawTrackData.album.picUrl; }
    else if (typeof rawTrackData.album === 'string') albumName = rawTrackData.album;
    
    if (dataSourceHint === "gdkuwo_search") {
        id = String(rawTrackData.id || (rawTrackData.MUSICRID ? String(rawTrackData.MUSICRID).split('_').pop() : null));
        title = rawTrackData.SONGNAME || title; artist = String(rawTrackData.ARTIST || artist).replace(/;/g, '&'); albumName = rawTrackData.ALBUM || albumName;
        duration = rawTrackData.DURATION ? parseInt(rawTrackData.DURATION, 10) * 1000 : duration;
    }
    const qualities = {}; if (id) qualities["standard"] = { size: rawTrackData.size || 0 };
    let content = 0; 
    let rawLrc = rawTrackData.lyric || rawTrackData.lyrics || null;
    
    return {
        id: String(id), artist: artist, title: title, duration: parseInt(duration, 10), album: albumName, artwork: artwork,
        qualities: qualities, albumId: albumId ? String(albumId) : null, content: content, rawLrc: rawLrc,
    };
}

// --- Exported Core Functions ---
async function getMediaSource(musicItem, quality) {
    if (UNM_LOAD_ERROR) return Promise.resolve(false);
    if (!musicItem || !musicItem.id) return Promise.resolve(false);
    const userVars = getUserConfig(); const PROXY_URL = userVars.PROXY_URL; const unmCookie = userVars.music_u;
    let sourceUrl = null; let sourceSize = 0; let actualQualityKey = quality;
    const unmSources = (userVars.UNM_SOURCES && userVars.UNM_SOURCES.split(',')) || ["pyncmd", "kuwo", "bilibili", "migu", "kugou", "qq", "youtube"];
    try {
        const unblockResult = await unblockMusicMatcher.match(musicItem.id, unmSources, unmCookie);
        if (unblockResult && unblockResult.url) { sourceUrl = String(unblockResult.url).split("?")[0]; sourceSize = unblockResult.size || 0; }
    } catch (e) { /* Suppress error */ }
    if (!sourceUrl) {
        const targetBitrate = qualityToBitrate[quality] || "320";
        const gdResult = await callGDStudioAPI(musicItem.id, targetBitrate);
        if (gdResult && gdResult.url) { sourceUrl = gdResult.url; sourceSize = gdResult.size || 0; }
    }
    if (sourceUrl) return Promise.resolve({ url: applyProxy(sourceUrl, PROXY_URL), size: sourceSize, quality: actualQualityKey });
    return Promise.resolve(false);
}

async function getMusicInfo(musicItem) {
    if (UNM_LOAD_ERROR) return Promise.resolve(internalFormatMusicItem({ id: musicItem ? musicItem.id : "unknown", name: `Error: Core component failed (${UNM_LOAD_ERROR.message.substring(0,30)}...)` }));
    if (!musicItem || !musicItem.id) return Promise.resolve(internalFormatMusicItem({ id: musicItem ? musicItem.id : "unknown", name: "Error: Track ID missing" }));
    const userVars = getUserConfig(); const unmCookie = userVars.music_u;
    const unmSources = (userVars.UNM_SOURCES && userVars.UNM_SOURCES.split(',')) || ["pyncmd", "kuwo", "bilibili", "migu", "kugou", "qq", "youtube"];
    let trackData = null;
    try {
        const matchResult = await unblockMusicMatcher.match(musicItem.id, unmSources, unmCookie);
        if (matchResult && (matchResult.url || matchResult.name || matchResult.title)) trackData = { ...matchResult, id: musicItem.id };
    } catch (e) { /* Suppress error */ }
    if (trackData) return Promise.resolve(internalFormatMusicItem(trackData, "unm_match"));
    return Promise.resolve(internalFormatMusicItem({ id: musicItem.id, name: `Track (ID: ${musicItem.id})` }));
}

async function search(query, page = 1, type = "music") {
    if (type !== "music") { // Strictly follow FreeSound example: if type mismatch, do not proceed for that type
        // MusicFree might call search with various types. We only handle 'music'.
        // Returning undefined or empty result for unhandled types.
        return Promise.resolve({ isEnd: true, data: [] }); 
    }
    if (UNM_LOAD_ERROR) { 
         return Promise.resolve({ isEnd: true, data: [internalFormatMusicItem({id: 'err-unm', name: `Search unavailable: UNM Load Error`})] });
    }

    const results = await searchGDStudioKuwo(query, page, pageSize);
    const formattedResults = results.map(track => internalFormatMusicItem(track, "gdkuwo_search"));
    return Promise.resolve({ isEnd: results.length < pageSize, data: formattedResults });
}

async function getLyric(musicItem) {
    if (UNM_LOAD_ERROR) return Promise.resolve({ rawLrc: `Error: Core component failed (${UNM_LOAD_ERROR.message.substring(0,30)}...)` });
    if (!musicItem || !musicItem.id) return Promise.resolve({ rawLrc: "" });
    const userVars = getUserConfig(); const unmCookie = userVars.music_u;
    const unmSources = (userVars.UNM_SOURCES && userVars.UNM_SOURCES.split(',')) || ["pyncmd", "kuwo", "bilibili", "migu", "kugou", "qq", "youtube"];
    let lyric = "";
    try {
        const matchResult = await unblockMusicMatcher.match(musicItem.id, unmSources, unmCookie);
        if (matchResult && (matchResult.lyric || matchResult.lyrics)) lyric = matchResult.lyric || matchResult.lyrics;
    } catch (e) { /* Suppress error */ }
    return Promise.resolve({ rawLrc: lyric });
}

// --- Module Exports (Strictly Aligned with FreeSound example + pyncmd necessities) ---
module.exports = {
    platform: `pyncmd ${UNM_LOAD_ERROR ? `(Core Err!)` : ''}`.trim(),
    version: PYNCPLAYER_VERSION,
    cacheControl: "no-store", 
    
    // Optional but useful for pyncmd:
    // srcUrl: "https://raw.githubusercontent.com/your-repo/pyncmd.js", // Add your actual URL if you host it
    // appVersion: ">0.4.0-alpha.0", // If MusicFree uses this from original module

    // `userVariables` and `hints` are kept because pyncmd functionality relies on them.
    // If these cause parsing errors, they are the next candidates for removal.
    userVariables: [
        { key: "music_u", name: "网易云Cookie (可选)", hint: "MUSIC_U/A. 对pyncmd作用有限." },
        { key: "PROXY_URL", name: "反代URL (可选)", hint: "例如: http://yourproxy.com" },
        { key: "UNM_SOURCES", name: "UNM音源 (可选,CSV)", hint: "例如: pyncmd,kuwo,qq" }
    ],
    hints: {
        // importMusicSheet and importMusicItem hints removed as functions are not exported
    },
    supportedSearchType: ["music"], // pyncmd primarily supports music search

    // Core functions exported:
    search,
    // For pyncmd, these are essential unlike the simple FreeSound:
    getMusicInfo,
    getMediaSource,
    getLyric,

    // `importMusicSheet` and `importMusicItem` are NOT exported to strictly align with FreeSound's simplicity.
    // If MusicFree absolutely requires them for a plugin to be "valid" even if not used by UI,
    // then they would need to be added back as stubs.
};
