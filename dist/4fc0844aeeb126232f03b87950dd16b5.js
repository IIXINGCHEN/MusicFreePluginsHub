"use strict";

const axios = require("axios");

const UNM_PLUGIN_VERSION = "2.0.0"; // New version for unm.js with Meting-like API
const pageSize = 30; // Default items per page for search/playlist
const METING_API_BASE = "https://music-api.gdstudio.xyz/api.php"; // Base URL remains the same
const DEFAULT_METING_SERVER = "netease"; // Default server for Meting API calls
// Supported servers by the provided Meting API description
const VALID_METING_SERVERS = ["netease", "tencent", "kugou", "kuwo", "baidu", "pyncmd"];


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
function sanitizeString(str, defaultVal = "") {
    if (typeof str === 'string') {
        return str.replace(/\0/g, '').trim();
    }
    return defaultVal;
}

// --- API Call Helper for Meting-style Endpoints ---
async function callMetingApi(endpointPath, params = {}) {
    // endpointPath example: "search", "playlist/12345"
    // params example: { q: "keyword", server: "netease" }
    try {
        const url = `${METING_API_BASE}/${endpointPath}`;
        const response = await axios.get(url, { params, timeout: 10000 });
        if (response.status === 200 && response.data) {
            // Assuming API returns JSON. If it's sometimes text (like lyric), handle appropriately.
            // The provided Meting spec suggests JSON for list/object types.
            // If URL fields have escaped slashes
            if (response.data.url && typeof response.data.url === 'string') {
                 response.data.url = response.data.url.replace(/\\\//g, '/');
            }
            if (response.data.cover && typeof response.data.cover === 'string') { // For playlist cover
                 response.data.cover = response.data.cover.replace(/\\\//g, '/');
            }
            return response.data;
        }
        return null;
    } catch (error) {
        // console.error(`Meting API Call Error to ${endpointPath}:`, error.message, "Params:", params);
        return null;
    }
}

// --- User Config Handling ---
let currentEnvConfig = {
    PROXY_URL: null,
    METING_SERVER: DEFAULT_METING_SERVER, // Changed from GDSTUDIO_SOURCE
};
function getUserConfig() {
    let config = { ...currentEnvConfig }; 
    if (typeof global !== 'undefined' && global.lx && global.lx.env && typeof global.lx.env.getUserVariables === 'function') {
        const userVars = global.lx.env.getUserVariables();
        if (userVars && typeof userVars === 'object') {
            if (userVars.PROXY_URL && isValidUrl(userVars.PROXY_URL)) {
                config.PROXY_URL = userVars.PROXY_URL;
            }
            if (userVars.METING_SERVER && VALID_METING_SERVERS.includes(String(userVars.METING_SERVER).toLowerCase())) {
                config.METING_SERVER = String(userVars.METING_SERVER).toLowerCase();
            }
        }
    }
    return config;
}

function applyProxy(url, proxyUrl) { /* ... (same as before, no change needed) ... */ 
    if (proxyUrl && isValidUrl(proxyUrl) && url && isValidUrl(url) && 
        (url.includes("kuwo.cn") || url.includes("migu.cn") || url.includes("music.163.com") || url.includes("isure.stream.qqmusic.qq.com") || url.includes("qq.com"))) { // Added qq.com for tencent
        const httpRemovedUrl = url.replace(/^http[s]?:\/\//, "");
        return proxyUrl.replace(/\/$/, "") + "/" + httpRemovedUrl;
    }
    return url;
}

// --- Internal Formatting ---
// Formats song data from Meting API (search or song endpoint)
function internalFormatMusicItem(apiTrackData, server) {
    if (!apiTrackData || typeof apiTrackData !== 'object' || !apiTrackData.id) {
        return null; 
    }
    const id = String(apiTrackData.id); // Meting API usually uses 'id'
    const title = sanitizeString(apiTrackData.name || apiTrackData.title, "Unknown Title");
    
    let artists = "Unknown Artist";
    // Meting API's /song/{id} might return `artist: ["artist1", "artist2"]`
    // Meting API's /search might return `artist: "artist1 & artist2"` or an array
    if (Array.isArray(apiTrackData.artist)) {
        artists = apiTrackData.artist.map(a => sanitizeString(a)).filter(Boolean).join('&') || "Unknown Artist";
    } else if (apiTrackData.artist) {
        artists = sanitizeString(String(apiTrackData.artist)); // Ensure it's a string
    }

    const album = sanitizeString(apiTrackData.album, "Unknown Album");
    // Meting API's /song/{id} might provide pic URL directly, or pic_id for /picture endpoint
    // Search results from Meting usually don't have direct artwork URL.
    let artwork = "";
    if (isValidUrl(apiTrackData.pic)) artwork = apiTrackData.pic;
    else if (isValidUrl(apiTrackData.cover)) artwork = apiTrackData.cover; // Some endpoints use 'cover'

    // Duration: Meting API might not provide this in search or song details directly.
    // If it does, it's usually in milliseconds or seconds. Assuming milliseconds if 'duration' field.
    const duration = parseInt(apiTrackData.duration || 0, 10) || 0; 

    return {
        id: id, title: title, artist: artists, album: album, artwork: artwork, duration: duration,
        _pic_id: apiTrackData.pic_id || apiTrackData.pic, // Store pic_id or URL if available for /picture
        _lyric_id: apiTrackData.lyric_id || id,          // Lyric ID often same as track ID
        _source: server || apiTrackData.source,         // Explicitly pass server or use from data
        qualities: {}, content: 0, rawLrc: "",
    };
}

// Formats sheet/playlist data from Meting API /playlist/{id}
function internalFormatSheetItem(apiSheetData, server) {
    if (!apiSheetData || typeof apiSheetData !== 'object' || !apiSheetData.id) {
        return { id: "unknown", title: "Unknown Playlist", artwork: "", worksNum: 0, description: "", artist: "" };
    }
    return {
        id: String(apiSheetData.id),
        title: sanitizeString(apiSheetData.name, "Playlist"),
        // Meting /playlist often has `creator` object or `artist_name` for creator
        artist: sanitizeString(apiSheetData.creator ? apiSheetData.creator.nickname : apiSheetData.artist_name, ""), 
        artwork: isValidUrl(apiSheetData.cover) ? apiSheetData.cover : (apiSheetData.cover_img_url || ""),
        description: sanitizeString(apiSheetData.description, ""),
        worksNum: parseInt(apiSheetData.track_count || (apiSheetData.songs ? apiSheetData.songs.length : 0), 10) || 0,
        playCount: parseInt(apiSheetData.play_count, 10) || 0,
        _source: server,
    };
}

// --- Exported Core Functions ---

async function search(query, page = 1, type = "music") {
    if (typeof query !== 'string' || !query.trim()) return Promise.resolve({ isEnd: true, data: [], error: "Invalid search query." });
    if (typeof page !== 'number' || page < 1) page = 1; // Meting search may not support page for all servers
    if (type !== "music") return Promise.resolve({ isEnd: true, data: [], error: `Search type "${type}" not supported.` });

    const userCfg = getUserConfig();
    const server = userCfg.METING_SERVER;
    // Meting search endpoint: /search?q={keyword}&server={platform}&limit={num}
    // Note: Meting API's search might not support pagination via 'page' param directly.
    // It might return all results or only a fixed number based on 'limit'.
    // We assume for now 'limit' works like pageSize and 'page' is ignored or handled by server.
    const searchData = await callMetingApi("search", { 
        q: query, 
        server: server,
        limit: pageSize 
        // type: 'song' // Some Meting instances might support type in search
    });

    if (searchData && Array.isArray(searchData)) { // Standard Meting search returns an array of songs
        const formattedResults = searchData.map(track => internalFormatMusicItem(track, server)).filter(item => item !== null);
        return Promise.resolve({
            isEnd: formattedResults.length < pageSize, // Approximation of isEnd
            data: formattedResults,
        });
    }
    return Promise.resolve({ isEnd: true, data: [], error: "Search API request failed or returned invalid data." });
}

async function getMusicInfo(musicItem) {
    if (!musicItem || typeof musicItem !== 'object' || !musicItem.id || typeof musicItem.id !== 'string') {
        return Promise.resolve(internalFormatMusicItem({ id: "unknown", name: "Error: Invalid musicItem input" }, null));
    }

    const userCfg = getUserConfig();
    const server = musicItem._source || userCfg.METING_SERVER; // Use source from item or default
    const track_id = musicItem.id;

    const songData = await callMetingApi(`song/${track_id}`, { server: server });

    if (songData && songData.id) { // songData from /song/{id} is usually an object, not array
        let formatted = internalFormatMusicItem(songData, server);
        // If artwork was not directly in songData.pic, try to get it using picture endpoint
        if (!formatted.artwork && (songData.pic_id || songData.album_id || songData.pic)) { // pic_id might be under 'album_id' or 'pic' could be an ID
            const picIdToTry = songData.pic_id || songData.album_id || songData.pic; // Guessing pic_id location
            if (picIdToTry && !isValidUrl(picIdToTry)) { // If it's an ID, not a URL
                 const picData = await callMetingApi(`picture/${picIdToTry}`, {server: server});
                 if (picData && isValidUrl(picData.url)) {
                    formatted.artwork = picData.url;
                 }
            }
        }
        return Promise.resolve(formatted);
    }
    // Fallback if /song/{id} fails, use info from musicItem if available
    return Promise.resolve(internalFormatMusicItem({ ...musicItem, name: musicItem.title || `Track ${track_id} (Info limited)` }, server));
}

async function getMediaSource(musicItem, quality) {
    if (!musicItem || typeof musicItem !== 'object' || !musicItem.id || typeof musicItem.id !== 'string') {
        return Promise.resolve({ error: "Invalid musicItem input." });
    }
    if (typeof quality !== 'string') quality = "standard";
    
    const userCfg = getUserConfig();
    const server = musicItem._source || userCfg.METING_SERVER;
    const track_id = musicItem.id;

    let bitrateApiValue; // Meting API uses specific bitrate numbers
    switch (quality.toLowerCase()) {
        case "low": bitrateApiValue = 128000; break;
        case "standard": bitrateApiValue = 320000; break;
        case "high": bitrateApiValue = 999000; break; // FLAC or highest
        case "super": bitrateApiValue = 999000; break; // Hi-Res or highest
        default: bitrateApiValue = 320000;
    }

    // Meting endpoint: /url/{id}?server={platform}&bitrate={br}
    const urlData = await callMetingApi(`url/${track_id}`, { 
        server: server, 
        bitrate: bitrateApiValue 
    });

    if (urlData && isValidUrl(urlData.url)) {
        const PROXY_URL = userCfg.PROXY_URL; 
        return Promise.resolve({
            url: applyProxy(urlData.url, PROXY_URL),
            // Meting /url endpoint might provide size in bytes or KB, or not at all. Assuming bytes if 'size' field.
            size: parseInt(urlData.size, 10) || 0, 
            quality: quality, // Return the requested abstract quality key
            // br: urlData.br, // Actual bitrate from Meting if needed
        });
    }
    return Promise.resolve({ error: "Failed to get media source or invalid URL returned." });
}

async function getLyric(musicItem) {
    if (!musicItem || typeof musicItem !== 'object' || (!musicItem.id && !musicItem._lyric_id)) {
        return Promise.resolve({ rawLrc: "", tlyric: "", error: "Invalid musicItem input." });
    }
    
    const userCfg = getUserConfig();
    const server = musicItem._source || userCfg.METING_SERVER;
    const lyric_id_to_use = musicItem._lyric_id || musicItem.id;

    if (!lyric_id_to_use) return Promise.resolve({ rawLrc: "", tlyric: "", error: "Lyric ID missing." });

    // Meting endpoint: /lyric/{id}?server={platform}
    const lyricData = await callMetingApi(`lyric/${lyric_id_to_use}`, { server: server });

    if (lyricData && (typeof lyricData.lyric === 'string' || typeof lyricData.tlyric === 'string')) {
        return Promise.resolve({
            rawLrc: sanitizeString(lyricData.lyric),
            translateLrc: sanitizeString(lyricData.tlyric), // Meting has 'tlyric' for translation
        });
    }
    return Promise.resolve({ rawLrc: "", tlyric: "", error: "Lyric not found or API error." });
}

// --- Playlist/Sheet Functions ---
async function getMusicSheetInfo(sheetQuery, page = 1) {
    // sheetQuery is typically an object like { id: "playlist_id" }
    const sheet_id = typeof sheetQuery === 'object' ? sheetQuery.id : sheetQuery;
    if (!sheet_id || typeof sheet_id !== 'string') {
        return Promise.resolve({ isEnd: true, sheetItem: internalFormatSheetItem({id: "unknown"}), musicList: [], error: "Invalid sheet ID." });
    }

    const userCfg = getUserConfig();
    const server = userCfg.METING_SERVER; // Use configured server for playlists

    // Meting endpoint: /playlist/{id}?server={platform}
    const playlistData = await callMetingApi(`playlist/${sheet_id}`, { server: server });

    if (playlistData && playlistData.id && Array.isArray(playlistData.songs)) {
        const sheetItem = internalFormatSheetItem(playlistData, server);
        const musicList = playlistData.songs.map(track => internalFormatMusicItem(track, server)).filter(item => item !== null);
        
        // Meting /playlist usually returns all tracks, pagination for songs within playlist is uncommon via this endpoint.
        return Promise.resolve({
            isEnd: true, // Assume all tracks are returned
            sheetItem: sheetItem,
            musicList: musicList,
        });
    }
    return Promise.resolve({ isEnd: true, sheetItem: internalFormatSheetItem({id: sheet_id}), musicList: [], error: "Failed to fetch playlist details." });
}

async function importMusicSheet(urlLike) {
    if (typeof urlLike !== 'string' || !urlLike.trim()) {
        return Promise.resolve([]); // Return empty list for invalid URL
    }

    // Try to parse Netease playlist ID (example)
    let sheetId = null;
    const neteasePlaylistMatch = urlLike.match(/playlist[\/?\?\&]id=(\d+)/i);
    if (neteasePlaylistMatch && neteasePlaylistMatch[1]) {
        sheetId = neteasePlaylistMatch[1];
    }
    // Add parsers for other platform playlist URLs if needed and if Meting server supports them by ID

    if (!sheetId) {
        return Promise.resolve([]); // Not a recognized playlist URL for ID extraction
    }
    
    // Call getMusicSheetInfo to fetch and format
    const result = await getMusicSheetInfo({ id: sheetId });
    return Promise.resolve(result.musicList || []); // Return only the musicList array
}

// Stubbed functions for less critical features (can be implemented later if Meting API supports)
async function getTopLists() { return Promise.resolve([]); }
async function getTopListDetail(topListItem) { 
    if(topListItem && topListItem.id) {
        const result = await getMusicSheetInfo(topListItem); // Treat top list as a sheet
        return Promise.resolve({ ...result, topListItem: result.sheetItem });
    }
    return Promise.resolve({isEnd: true, sheetItem: {}, musicList: []});
}
async function getRecommendSheetTags() { return Promise.resolve({ pinned: [], data: [] }); }
async function getRecommendSheetsByTag(tag, page) { return Promise.resolve({ isEnd: true, data: [] });}


// --- Module Exports ---
module.exports = {
    platform: "unm (Meting API)", // Updated platform name
    version: UNM_PLUGIN_VERSION,
    cacheControl: "no-store", 
    
    userVariables: [
        { 
            key: "METING_SERVER", 
            name: "Meting API 音源 (server)", 
            hint: `选择数据源 (可选: ${VALID_METING_SERVERS.join(', ')}). 默认: ${DEFAULT_METING_SERVER}` 
        },
        { 
            key: "PROXY_URL", 
            name: "反代URL (可选)", 
            hint: "例如: https://yourproxy.com (代理部分音源链接)" 
        }
    ],
    hints: { 
        general: `unm源 (基于Meting API, 默认音源: ${DEFAULT_METING_SERVER}). 歌单功能已启用。`
    },
    supportedSearchType: ["music"],

    // Core functions
    search,
    getMusicInfo,
    getMediaSource,
    getLyric,

    // Playlist/Sheet functions
    importMusicSheet,
    getMusicSheetInfo, 
    
    // Other stubbed functions (matching original Netease module structure)
    getTopLists,       
    getTopListDetail,  
    getRecommendSheetTags,
    getRecommendSheetsByTag,
    // getAlbumInfo, getArtistWorks, getMusicComments can be added as stubs or implemented if needed
};
