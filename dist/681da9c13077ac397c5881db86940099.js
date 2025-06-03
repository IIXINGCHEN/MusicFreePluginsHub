"use strict";

const axios = require("axios");

const PYNCPLAYER_VERSION = "1.2.6"; // Will be compared against remote manifest
const pageSize = 20;

const METING_API_BASE = "https://meting-api.imixc.top";
const API_ENDPOINTS = {
    search: "/api.php/search",
    song: "/api.php/song/{id}",
    playlist: "/api.php/playlist/{id}",
    artist: "/api.php/artist/{id}",
    album: "/api.php/album/{id}",
    lyric: "/api.php/lyric/{id}",
    url: "/api.php/url/{id}",
    picture: "/api.php/picture/{id}",
    // status: "/api.php/status", (For future use)
    // health: "/api.php/health" (For future use)
};
const DEFAULT_METING_SOURCE = "pyncmd";
const VALID_METING_SOURCES = ["netease", "tencent", "kugou", "kuwo", "baidu", "pyncmd"];

// URL for the remote version manifest (User needs to host this JSON file)
const REMOTE_VERSION_MANIFEST_URL = ""; // Placeholder URL

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
    if (typeof str === 'number') {
        return String(str).trim();
    }
    return defaultVal;
}

// --- API Call Helper ---
async function callMetingApi(endpointWithPath, params = {}) {
    try {
        const fullUrl = METING_API_BASE + endpointWithPath;
        const response = await axios.get(fullUrl, { params, timeout: 8000 });

        if (response.status === 200 && response.data && typeof response.data === 'object') {
            if (response.data.success === true) {
                const apiData = response.data.data;
                if (apiData && typeof apiData === 'object' && Array.isArray(apiData.results)) {
                    return apiData.results;
                }
                if (Array.isArray(apiData)) {
                    return apiData;
                }
                // Handle case where apiData is a single object (e.g. for /album/{id} or /artist/{id} if they don't return arrays)
                if (apiData && typeof apiData === 'object' && Object.keys(apiData).length > 0) {
                    return [apiData]; // Wrap single object in array for consistency, or let consumer handle
                }
                return [];
            } else {
                return { error: response.data.error || "API request failed with no specific error message." };
            }
        }
        return { error: `Invalid API response status: ${response.status} or malformed response body.` };
    } catch (error) {
        let errorMessage = "Network error or API unreachable.";
        if (error.isAxiosError) {
            if (error.response) {
                const apiErrorMsg = (error.response.data && typeof error.response.data.error === 'string') ? error.response.data.error : JSON.stringify(error.response.data);
                errorMessage = `API request failed with status ${error.response.status}: ${apiErrorMsg || error.response.statusText}`;
            } else if (error.request) {
                errorMessage = "No response received from API. Check network or API server status.";
            } else {
                errorMessage = error.message || "Axios request setup error.";
            }
        } else {
             errorMessage = error.message || "An unknown error occurred during the API call.";
        }
        return { error: errorMessage };
    }
}

// --- User Config Handling ---
function getUserConfig() {
    if (typeof global !== 'undefined' && global.lx && global.lx.env && typeof global.lx.env.getUserVariables === 'function') {
        const userVars = global.lx.env.getUserVariables();
        const config = { PROXY_URL: null, METING_SOURCE: DEFAULT_METING_SOURCE };
        if (userVars && typeof userVars === 'object') {
            if (userVars.PROXY_URL && isValidUrl(userVars.PROXY_URL)) {
                config.PROXY_URL = userVars.PROXY_URL;
            }
            if (userVars.METING_SOURCE && VALID_METING_SOURCES.includes(String(userVars.METING_SOURCE).toLowerCase())) {
                config.METING_SOURCE = String(userVars.METING_SOURCE).toLowerCase();
            }
        }
        return config;
    }
    return { PROXY_URL: null, METING_SOURCE: DEFAULT_METING_SOURCE }; // Fallback if no global.lx.env
}

function applyProxy(url, proxyUrl) {
    if (proxyUrl && isValidUrl(proxyUrl) && url && isValidUrl(url) &&
        (url.includes("kuwo.cn") || url.includes("music.163.com"))) {
        const httpRemovedUrl = url.replace(/^http[s]?:\/\//, "");
        return proxyUrl.replace(/\/$/, "") + "/" + httpRemovedUrl;
    }
    return url;
}

// --- Internal Formatting ---
function formatArtistName(artistData) {
    if (Array.isArray(artistData)) {
        return artistData.map(a => sanitizeString(typeof a === 'object' && a.name ? a.name : a)).filter(Boolean).join('&');
    }
    return sanitizeString(typeof artistData === 'object' && artistData.name ? artistData.name : artistData, "Unknown Artist");
}

function generateArtworkUrl(picId, source, size = 400) {
    if (!picId) return "";
    // Assuming picId itself is not a URL but an ID that needs to be used with the picture API
    const userCfg = getUserConfig(); // Get current source if needed, though API takes it as param
    const picSource = source || userCfg.METING_SOURCE; // Use item's source or default
    
    let endpoint = API_ENDPOINTS.picture.replace("{id}", String(picId));
    // Note: API_ENDPOINTS.picture might not need {id} if picId is already the full ID path part
    // Assuming picId is just the ID, not part of path yet.
    // If picId can sometimes be a full URL, add a check here.
    if (isValidUrl(String(picId))) return sanitizeString(String(picId)); // If picId is already a URL

    return `${METING_API_BASE}${endpoint}?server=${picSource}&size=${size}`;
}


function internalFormatMusicItem(apiTrackData, sourceFromServer = null) {
    if (!apiTrackData || typeof apiTrackData !== 'object' || !apiTrackData.id) {
        return null;
    }
    const itemSource = apiTrackData.source || sourceFromServer || DEFAULT_METING_SOURCE;
    const picId = apiTrackData.pic_id || apiTrackData.album_pic_id || apiTrackData.cover_id; // Common ID names for picture

    return {
        id: String(apiTrackData.id),
        title: sanitizeString(apiTrackData.name, "Unknown Title"),
        artist: formatArtistName(apiTrackData.artist),
        album: sanitizeString(apiTrackData.album_name || apiTrackData.album, "Unknown Album"),
        artwork: picId ? generateArtworkUrl(picId, itemSource) : sanitizeString(apiTrackData.picture || apiTrackData.pic, ""), // Fallback to direct picture URL if no ID
        duration: parseInt(apiTrackData.duration || 0, 10) || 0,
        _lyric_id: apiTrackData.lyric_id ? String(apiTrackData.lyric_id) : String(apiTrackData.id),
        _source: itemSource,
        _album_id: apiTrackData.album_id ? String(apiTrackData.album_id) : null, // Store album_id if available
        _artist_ids: Array.isArray(apiTrackData.artist) ? apiTrackData.artist.map(a => a.id).filter(Boolean) : [], // Store artist_ids
        qualities: {},
        content: 0,
        rawLrc: ""
    };
}

function formatAlbumItem(apiAlbumData, sourceFromServer = null) {
    if (!apiAlbumData || typeof apiAlbumData !== 'object' || !apiAlbumData.id) {
        return null;
    }
    const itemSource = apiAlbumData.source || sourceFromServer || DEFAULT_METING_SOURCE;
    const picId = apiAlbumData.pic_id || apiAlbumData.cover_id;

    return {
        id: String(apiAlbumData.id),
        title: sanitizeString(apiAlbumData.name, "Unknown Album"),
        artist: formatArtistName(apiAlbumData.artist),
        artwork: picId ? generateArtworkUrl(picId, itemSource) : sanitizeString(apiAlbumData.picture || apiAlbumData.pic, ""),
        description: sanitizeString(apiAlbumData.description, ""),
        date: sanitizeString(apiAlbumData.publish_date || apiAlbumData.time, ""),
        worksNum: parseInt(apiAlbumData.song_count || apiAlbumData.size || 0, 10),
        content: 4
    };
}

function formatArtistItem(apiArtistData, sourceFromServer = null) {
    if (!apiArtistData || typeof apiArtistData !== 'object' || !apiArtistData.id) {
        return null;
    }
    const itemSource = apiArtistData.source || sourceFromServer || DEFAULT_METING_SOURCE;
    const picId = apiArtistData.pic_id || apiArtistData.cover_id;

    return {
        id: String(apiArtistData.id),
        name: sanitizeString(apiArtistData.name, "Unknown Artist"),
        artwork: picId ? generateArtworkUrl(picId, itemSource) : sanitizeString(apiArtistData.picture || apiArtistData.pic, ""),
        description: sanitizeString(apiArtistData.description, ""),
        worksNum: parseInt(apiArtistData.song_count || apiArtistData.album_size || 0, 10),
        content: 5
    };
}

function formatPlaylistItem(apiPlaylistData, sourceFromServer = null) {
    if (!apiPlaylistData || typeof apiPlaylistData !== 'object' || !apiPlaylistData.id) {
        return null;
    }
    const itemSource = apiPlaylistData.source || sourceFromServer || DEFAULT_METING_SOURCE;
    const picId = apiPlaylistData.pic_id || apiPlaylistData.cover_id || apiPlaylistData.coverImgId;

    const tracks = Array.isArray(apiPlaylistData.songs)
        ? apiPlaylistData.songs.map(track => internalFormatMusicItem(track, itemSource)).filter(item => item !== null)
        : (Array.isArray(apiPlaylistData.tracks) // Some APIs use 'tracks' key
            ? apiPlaylistData.tracks.map(track => internalFormatMusicItem(track, itemSource)).filter(item => item !== null)
            : []);

    return {
        id: String(apiPlaylistData.id),
        title: sanitizeString(apiPlaylistData.name, "Unknown Playlist"),
        creator: sanitizeString(apiPlaylistData.creator?.nickname || apiPlaylistData.creator, "Unknown Creator"),
        artwork: picId ? generateArtworkUrl(picId, itemSource) : sanitizeString(apiPlaylistData.picture || apiPlaylistData.coverImgUrl || apiPlaylistData.pic, ""),
        description: sanitizeString(apiPlaylistData.description, ""),
        worksNum: tracks.length || parseInt(apiPlaylistData.song_count || apiPlaylistData.trackCount || 0, 10),
        content: 2,
        tracks: tracks,
        _source: itemSource, // Add source to playlist item itself
    };
}

// --- Exported Core Functions ---
async function search(query, page = 1, type = "music") {
    if (typeof query !== 'string' || !query.trim()) {
        return Promise.resolve({ isEnd: true, data: [], error: "Invalid search query." });
    }
    if (typeof page !== 'number' || page < 1) page = 1;

    if (type !== "music") {
        return Promise.resolve({ isEnd: true, data: [], error: `Search for type "${type}" is not supported via this general search.` });
    }

    const userCfg = getUserConfig();
    const source = userCfg.METING_SOURCE; // Default is now pyncmd
    const limit = pageSize;
    const fetchLimit = limit * page;

    const apiParams = { q: query, server: source, limit: fetchLimit };
    const searchData = await callMetingApi(API_ENDPOINTS.search, apiParams);

    if (searchData.error) return Promise.resolve({ isEnd: true, data: [], error: searchData.error });
    if (!Array.isArray(searchData)) return Promise.resolve({ isEnd: true, data: [], error: "Invalid data format from API search." });
    
    const offset = (page - 1) * limit;
    const slicedData = searchData.slice(offset, offset + limit);

    const formattedResults = slicedData
        .map(item => internalFormatMusicItem(item, source)) // Pass source for pic URL generation
        .filter(item => item !== null);

    return Promise.resolve({
        isEnd: slicedData.length < limit || (offset + slicedData.length) >= searchData.length,
        data: formattedResults
    });
}

async function getMusicInfo(musicItem) {
    if (!musicItem || typeof musicItem !== 'object' || !musicItem.id || typeof musicItem.id !== 'string') {
        return Promise.resolve(internalFormatMusicItem({ id: "unknown", name: "Error: Invalid musicItem input" }));
    }

    const userCfg = getUserConfig();
    const source = musicItem._source || userCfg.METING_SOURCE;
    const apiParams = { server: source };
    const endpointPath = API_ENDPOINTS.song.replace("{id}", musicItem.id);
    const songDataArray = await callMetingApi(endpointPath, apiParams);

    if (songDataArray.error) return Promise.resolve(internalFormatMusicItem({ id: musicItem.id, name: `Error: ${songDataArray.error}` }));
    if (!Array.isArray(songDataArray) || songDataArray.length === 0) return Promise.resolve(internalFormatMusicItem({ id: musicItem.id, name: "Error: Song not found" }));

    return Promise.resolve(internalFormatMusicItem(songDataArray[0], source));
}

async function getMediaSource(musicItem, quality) {
    if (!musicItem || typeof musicItem !== 'object' || !musicItem.id || typeof musicItem.id !== 'string') {
        return Promise.resolve({ error: "Invalid musicItem input." });
    }
    if (typeof quality !== 'string') quality = "standard";

    const userCfg = getUserConfig();
    const source = musicItem._source || userCfg.METING_SOURCE;
    let bitrate;
    switch (quality.toLowerCase()) {
        case "low": bitrate = "128"; break;
        case "standard": bitrate = "320"; break;
        case "high": bitrate = "999"; break; // Assuming '999' for highest available / lossless
        case "super": bitrate = "999"; break;
        default: bitrate = "320";
    }

    const apiParams = { server: source, bitrate: bitrate };
    const endpointPath = API_ENDPOINTS.url.replace("{id}", musicItem.id);
    const urlDataArray = await callMetingApi(endpointPath, apiParams);

    if (urlDataArray.error) return Promise.resolve({ error: urlDataArray.error });
    if (!Array.isArray(urlDataArray) || urlDataArray.length === 0 || !urlDataArray[0].url) {
        return Promise.resolve({ error: "Failed to get media source." });
    }
    
    const urlDataItem = urlDataArray[0];
    return Promise.resolve({
        url: applyProxy(sanitizeString(urlDataItem.url), userCfg.PROXY_URL),
        size: urlDataItem.size ? parseInt(urlDataItem.size, 10) : 0,
        quality: quality,
        br: urlDataItem.br || null
    });
}

async function getLyric(musicItem) {
    if (!musicItem || typeof musicItem !== 'object' || (!musicItem.id && !musicItem._lyric_id)) {
        return Promise.resolve({ rawLrc: "", translateLrc: "", error: "Invalid musicItem input." });
    }

    const userCfg = getUserConfig();
    const source = musicItem._source || userCfg.METING_SOURCE;
    const lyricIdToFetch = musicItem._lyric_id || musicItem.id;

    const apiParams = { server: source };
    const endpointPath = API_ENDPOINTS.lyric.replace("{id}", lyricIdToFetch);
    const lyricDataArray = await callMetingApi(endpointPath, apiParams);

    if (lyricDataArray.error) return Promise.resolve({ rawLrc: "", translateLrc: "", error: lyricDataArray.error });
    if (!Array.isArray(lyricDataArray) || lyricDataArray.length === 0) {
        return Promise.resolve({ rawLrc: "", translateLrc: "", error: "Lyric not found." });
    }

    const lyricDataItem = lyricDataArray[0];
    return Promise.resolve({
        rawLrc: sanitizeString(lyricDataItem.lyric || lyricDataItem.lrc || ""),
        translateLrc: sanitizeString(lyricDataItem.tlyric || lyricDataItem.translation || "")
    });
}

async function updatePlugin() {
    try {
        const response = await axios.get(REMOTE_VERSION_MANIFEST_URL, { timeout: 5000 });
        if (response.status === 200 && response.data) {
            const manifest = response.data;
            if (manifest.latestVersion && manifest.latestVersion !== PYNCPLAYER_VERSION) {
                return {
                    updateAvailable: true,
                    currentVersion: PYNCPLAYER_VERSION,
                    latestVersion: sanitizeString(manifest.latestVersion),
                    message: `新版本 ${manifest.latestVersion} 可用!`,
                    releaseNotesUrl: manifest.releaseNotesUrl ? sanitizeString(manifest.releaseNotesUrl) : undefined,
                    downloadUrl: manifest.downloadUrl ? sanitizeString(manifest.downloadUrl) : undefined,
                };
            }
            return { updateAvailable: false, currentVersion: PYNCPLAYER_VERSION, message: "插件已是最新版本。" };
        }
        return { updateAvailable: false, currentVersion: PYNCPLAYER_VERSION, message: "无法检查更新: 无效的清单响应。", error: "Invalid manifest response" };
    } catch (error) {
        return {
            updateAvailable: false,
            currentVersion: PYNCPLAYER_VERSION,
            message: "无法检查更新: 网络错误。",
            error: error.message
        };
    }
}

function sharePlugin(item, type = "music") {
    if (!item || typeof item !== "object" || !item.id || !["music", "album", "artist", "playlist"].includes(type)) {
        return Promise.resolve({ error: "无效的分享项目或类型。" });
    }

    const userCfg = getUserConfig(); // Not strictly needed if item._source is reliable
    const source = item._source || userCfg.METING_SOURCE || DEFAULT_METING_SOURCE;
    const itemId = String(item.id);
    let shareUrl = "";
    const title = sanitizeString(item.title || item.name, "未知项目");

    // Map plugin type to platform-specific type for URL construction
    let platformType = type === "music" ? "song" : type; 

    if (source === 'pyncmd') {
        return Promise.resolve({ error: "通过URL分享对于pyncmd源当前不被支持。" });
    } else if (source === 'netease') {
        if (type === 'artist') platformType = 'artist'; // Netease uses 'artist'
        else if (type === 'playlist') platformType = 'playlist';
        else if (type === 'album') platformType = 'album';
        else platformType = 'song';
        shareUrl = `https://music.163.com/#/${platformType}?id=${itemId}`;
    } else if (source === 'tencent') {
        // Tencent QQ Music URL structures can vary. This is a common one for songs.
        // Playlists: https://y.qq.com/n/ryqq/playlist/YOUR_PLAYLIST_DISMID
        // Albums: https://y.qq.com/n/ryqq/albumDetail/YOUR_ALBUM_MID
        // Songs: https://y.qq.com/n/ryqq/songDetail/YOUR_SONG_MID
        // Artists: https://y.qq.com/n/ryqq/singer/YOUR_SINGER_MID
        // Assuming itemId is the respective MID or DISMID.
        if (type === 'music') shareUrl = `https://y.qq.com/n/ryqq/songDetail/${itemId}`;
        else if (type === 'album') shareUrl = `https://y.qq.com/n/ryqq/albumDetail/${itemId}`;
        else if (type === 'playlist') shareUrl = `https://y.qq.com/n/ryqq/playlist/${itemId}`; // Or playsquare if it's a 'dissid'
        else if (type === 'artist') shareUrl = `https://y.qq.com/n/ryqq/singer/${itemId}`;
        else return Promise.resolve({ error: `不支持为腾讯音乐源分享类型 "${type}"。` });
    } else {
        return Promise.resolve({ error: `分享功能暂未对 "${source}" 源实现。` });
    }

    if (!shareUrl) { // Should be caught by earlier conditions
         return Promise.resolve({ error: `无法为 "${source}" 源和类型 "${type}" 生成分享链接。` });
    }

    return Promise.resolve({ shareUrl, title, source });
}

async function importMusicSheet(urlOrId) {
    const userCfg = getUserConfig();
    let source = null;
    let id = null;

    if (isValidUrl(urlOrId)) {
        const urlObj = new URL(urlOrId);
        const hostname = urlObj.hostname.toLowerCase();
        if (hostname.includes("music.163.com")) {
            source = "netease";
            id = urlObj.searchParams.get('id') || urlOrId.match(/playlist\/(\d+)/i)?.[1] || urlOrId.match(/album\/(\d+)/i)?.[1] || urlOrId.match(/#playlist\?id=(\d+)/i)?.[1];
        } else if (hostname.includes("y.qq.com")) {
            source = "tencent";
            id = urlOrId.match(/playlist\/([0-9]+)/i)?.[1] || urlOrId.match(/playsquare\/([a-zA-Z0-9_]+)\.html/i)?.[1] || urlOrId.match(/id=([0-9]+)/i)?.[1] || urlObj.searchParams.get('id') || urlOrId.match(/\/([0-9]+)\.html/i)?.[1] || urlOrId.match(/dissid=([0-9]+)/i)?.[1];
        } else if (hostname.includes("kuwo.cn")) {
            source = "kuwo";
            id = urlOrId.match(/playlist_detail\/([0-9]+)/i)?.[1] || urlOrId.match(/playlist\/([0-9]+)/i)?.[1] || urlOrId.match(/album\/([0-9]+)/i)?.[1];
        } else if (hostname.includes("kugou.com")) {
            source = "kugou";
            id = urlOrId.match(/special\/single\/([0-9]+)/i)?.[1] || urlOrId.match(/album\/single\/([0-9]+)/i)?.[1] || urlOrId.match(/#hash=([a-zA-Z0-9]+)/i)?.[1] || urlObj.searchParams.get('id') || urlOrId.match(/special\/([0-9]+)/i)?.[1];
        } else {
            return Promise.resolve({ error: "不支持的歌单源或无法识别的URL格式。" });
        }
        if (!id) return Promise.resolve({ error: "无法从URL中提取歌单ID。" });
    } else if (userCfg.METING_SOURCE === 'pyncmd' && typeof urlOrId === 'string' && urlOrId.trim() !== '') {
        // Input is not a valid URL, and current source is pyncmd. Assume urlOrId is a pyncmd playlist ID.
        source = 'pyncmd';
        id = urlOrId.trim();
    } else {
        return Promise.resolve({ error: "无效的歌单URL或ID。" });
    }

    if (!source || !id) { // Should be caught by above logic
        return Promise.resolve({ error: "无法确定歌单来源或ID。" });
    }

    const apiParams = { server: source };
    const endpointPath = API_ENDPOINTS.playlist.replace("{id}", id);
    const playlistDataArray = await callMetingApi(endpointPath, apiParams);

    if (playlistDataArray.error) return Promise.resolve({ error: playlistDataArray.error });
    if (!Array.isArray(playlistDataArray) || playlistDataArray.length === 0) return Promise.resolve({ error: "歌单未找到或API错误。" });

    const playlistItem = formatPlaylistItem(playlistDataArray[0], source); // Pass source
    if (!playlistItem) return Promise.resolve({ error: "格式化歌单数据失败。" });
    
    return Promise.resolve(playlistItem); // Return the full playlist item
}

// --- Module Exports ---
module.exports = {
    platform: "Meting API v2.0.0",
    version: PYNCPLAYER_VERSION,
    cacheControl: "no-store",
    userVariables: [
        { key: "METING_SOURCE", name: "Meting 音乐源", hint: `默认音乐源 (可选: ${VALID_METING_SOURCES.join(', ')})。默认: ${DEFAULT_METING_SOURCE}` },
        { key: "PROXY_URL", name: "代理服务器 URL (可选)", hint: "例如: https://yourproxy.com (代理特定音乐源链接)" }
    ],
    hints: {
        general: "由 Meting API v2.0.0 强力驱动 (Pyncmd 增强版)。支持多音乐源，音乐搜索，歌单导入等。",
        importMusicSheet: [
            "支持网易云、QQ、酷我、酷狗的歌单链接。",
            "若默认源为pyncmd，可直接输入pyncmd歌单ID。"
        ]
    },
    supportedSearchType: ["music"],
    search,
    getMusicInfo,
    getMediaSource,
    getLyric,
    importMusicSheet,
    updatePlugin,
    sharePlugin
};
