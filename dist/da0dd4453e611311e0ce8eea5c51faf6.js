"use strict";

const axios = require("axios");
const CryptoJs = require("crypto-js");
const dayjs = require("dayjs");
const unblockMusicMatcher = require("@unblockneteasemusic/server");

const packageJson = { version: "pyncmd-1.0.0" }; // Updated version
const pageSize = 30;

const qualityMap = {
    "low": "standard",
    "standard": "exhigh",
    "high": "lossless",
    "super": "hires",
};

const qualityToBitrate = {
    "low": "128",
    "standard": "320",
    "high": "999",
    "super": "999",
};

// --- Helper Functions ---
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

let env = {
    _userVariables: {
        PROXY_URL: process.env.PROXY_URL || null,
        UNM_SOURCES: process.env.UNM_SOURCES || null,
        music_u: process.env.MUSIC_U || null,
    },
    getUserVariables: function() {
        // In a real MusicFree environment, MusicFree provides these.
        // This is a fallback for standalone testing or if MusicFree's mechanism isn't used.
        if (typeof global !== 'undefined' && global.lx && global.lx.env && typeof global.lx.env.getUserVariables === 'function') {
            return { ...this._userVariables, ...global.lx.env.getUserVariables() };
        }
        return this._userVariables;
    },
    // For standalone testing/configuration:
    _configure: function(vars) {
         this._userVariables = { ...this._userVariables, ...vars };
    }
};

function applyProxy(url, proxyUrl) {
    if (proxyUrl && url && (url.includes("kuwo.cn") || url.includes("migu.cn") || url.includes("isure.stream.qqmusic.qq.com"))) {
        const httpRemovedUrl = url.replace(/^http[s]?:\/\//, "");
        return proxyUrl.replace(/\/$/, "") + "/" + httpRemovedUrl;
    }
    return url;
}

// --- MD5 and AES (Kept for structural consistency, not used by core pyncmd logic) ---
function MD5(data) {
    return CryptoJs.MD5(data).toString(CryptoJs.enc.Hex);
}

function AES(data) {
    let key = CryptoJs.enc.Utf8.parse("e82ckenh8dichen8");
    let text = CryptoJs.enc.Utf8.parse(data);
    return CryptoJs.AES.encrypt(text, key, {
        mode: CryptoJs.mode.ECB,
        padding: CryptoJs.pad.Pkcs7
    }).ciphertext.toString(CryptoJs.enc.Hex);
}

// --- EAPI (Stub - Not used by pyncmd core logic, exported for structural consistency) ---
async function EAPI(path, json = {}) {
    if (path === "/api/v3/song/detail") return { songs: [], privileges: [] };
    if (path === "/api/song/lyric") return { lrc: { lyric: "" }, tlyric: { lyric: "" }, klyric: { lyric: "" } };
    return {};
}

// --- Core Formatting Function (Exported for structural consistency) ---
function formatMusicItem(rawTrackData, dataSourceHint = "unknown") {
    let id = rawTrackData.id || null;
    let title = rawTrackData.name || rawTrackData.title || "Unknown Title";
    let artist = "Unknown Artist";
    let albumName = "Unknown Album";
    let artwork = rawTrackData.pic || rawTrackData.artwork || (rawTrackData.album ? rawTrackData.album.picUrl : null) || "";
    let duration = rawTrackData.dt || rawTrackData.duration || 0; // Expect ms
    let albumId = rawTrackData.al ? rawTrackData.al.id : (rawTrackData.album ? rawTrackData.album.id : null);

    if (rawTrackData.ar && Array.isArray(rawTrackData.ar)) {
        artist = rawTrackData.ar.map(a => a.name).join('&');
    } else if (rawTrackData.artists && Array.isArray(rawTrackData.artists)) {
        artist = rawTrackData.artists.map(a => a.name).join('&');
    } else if (typeof rawTrackData.artist === 'string') {
        artist = rawTrackData.artist;
    }

    if (rawTrackData.al && rawTrackData.al.name) {
        albumName = rawTrackData.al.name;
        if (!artwork && rawTrackData.al.picUrl) artwork = rawTrackData.al.picUrl;
    } else if (rawTrackData.album && typeof rawTrackData.album === 'object' && rawTrackData.album.name) {
        albumName = rawTrackData.album.name;
        if (!artwork && rawTrackData.album.picUrl) artwork = rawTrackData.album.picUrl;
    } else if (typeof rawTrackData.album === 'string') {
        albumName = rawTrackData.album;
    }
    
    if (dataSourceHint === "gdkuwo_search") {
        id = String(rawTrackData.id || (rawTrackData.MUSICRID ? String(rawTrackData.MUSICRID).split('_').pop() : null));
        title = rawTrackData.SONGNAME || title;
        artist = String(rawTrackData.ARTIST || artist).replace(/;/g, '&');
        albumName = rawTrackData.ALBUM || albumName;
        duration = rawTrackData.DURATION ? parseInt(rawTrackData.DURATION, 10) * 1000 : duration;
    }

    const qualities = {};
    if (id) {
        qualities["standard"] = { size: rawTrackData.size || 0 };
    }
    let content = 0;    
    let rawLrc = rawTrackData.lyric || rawTrackData.lyrics || null;

    return {
        id: String(id),
        artist: artist,
        title: title,
        duration: parseInt(duration, 10),
        album: albumName,
        artwork: artwork,
        qualities: qualities,
        albumId: albumId ? String(albumId) : null,
        content: content,
        rawLrc: rawLrc,
    };
}

// --- Implemented Core Functions ---
async function getMediaSource(musicItem, quality) {
    if (!musicItem || !musicItem.id) return false;
    const userVars = env.getUserVariables();
    const PROXY_URL = userVars.PROXY_URL;
    const unmCookie = userVars.music_u;
    let sourceUrl = null;
    let sourceSize = 0;
    let actualQualityKey = quality;
    const unmSources = (userVars.UNM_SOURCES && userVars.UNM_SOURCES.split(',')) || ["pyncmd", "kuwo", "bilibili", "migu", "kugou", "qq", "youtube"];

    try {
        const unblockResult = await unblockMusicMatcher.match(musicItem.id, unmSources, unmCookie);
        if (unblockResult && unblockResult.url) {
            sourceUrl = String(unblockResult.url).split("?")[0];
            sourceSize = unblockResult.size || 0;
        }
    } catch (e) { /* Suppress error */ }

    if (!sourceUrl) {
        const targetBitrate = qualityToBitrate[quality] || "320";
        const gdResult = await callGDStudioAPI(musicItem.id, targetBitrate);
        if (gdResult && gdResult.url) {
            sourceUrl = gdResult.url;
            sourceSize = gdResult.size || 0;
        }
    }

    if (sourceUrl) {
        const finalUrl = applyProxy(sourceUrl, PROXY_URL);
        return { url: finalUrl, size: sourceSize, quality: actualQualityKey };
    }
    return false;
}

async function getMusicInfo(musicItem) {
    if (!musicItem || !musicItem.id) {
        return formatMusicItem({ id: musicItem ? musicItem.id : "unknown", name: "Error: Track ID missing" });
    }
    const userVars = env.getUserVariables();
    const unmCookie = userVars.music_u;
    const unmSources = (userVars.UNM_SOURCES && userVars.UNM_SOURCES.split(',')) || ["pyncmd", "kuwo", "bilibili", "migu", "kugou", "qq", "youtube"];
    let trackData = null;

    try {
        const matchResult = await unblockMusicMatcher.match(musicItem.id, unmSources, unmCookie);
        if (matchResult && (matchResult.url || matchResult.name || matchResult.title)) {
            trackData = { ...matchResult, id: musicItem.id };
        }
    } catch (e) { /* Suppress error */ }

    if (trackData) {
        return formatMusicItem(trackData, "unm_match");
    } else {
        return formatMusicItem({ id: musicItem.id, name: `Track (ID: ${musicItem.id})` });
    }
}

async function search(query, page = 1, type = "music") {
    if (type === "music") {
        const results = await searchGDStudioKuwo(query, page, pageSize);
        const formattedResults = results.map(track => formatMusicItem(track, "gdkuwo_search"));
        return { isEnd: results.length < pageSize, data: formattedResults };
    } else {
        return { isEnd: true, data: [] };
    }
}

async function getLyric(musicItem) {
    if (!musicItem || !musicItem.id) return { rawLrc: "" };
    const userVars = env.getUserVariables();
    const unmCookie = userVars.music_u;
    const unmSources = (userVars.UNM_SOURCES && userVars.UNM_SOURCES.split(',')) || ["pyncmd", "kuwo", "bilibili", "migu", "kugou", "qq", "youtube"];
    let lyric = "";
    try {
        const matchResult = await unblockMusicMatcher.match(musicItem.id, unmSources, unmCookie);
        if (matchResult && (matchResult.lyric || matchResult.lyrics)) {
            lyric = matchResult.lyric || matchResult.lyrics;
        }
    } catch (e) { /* Suppress error */ }
    return { rawLrc: lyric };
}

async function importMusicSheet(urlLike) {
    let id = (urlLike.match(/^(\d+)$/) || [])[1];
    if (!id && urlLike.match(/music\.163\.com/i)) {
        id = (urlLike.match(/playlist[\/\?\&]id=(\d+)/i) || [])[2];
    }
    if (id) {
        const sheetInfo = await getMusicSheetInfo({ id });
        return sheetInfo.musicList; // Will be an empty array from stub
    }
    return []; // Return empty array for consistency if parsing fails
}

async function importMusicItem(urlLike) {
    let id = (urlLike.match(/^(\d+)$/) || [])[1];
    if (!id && urlLike.match(/music\.163\.com/i)) {
        id = (urlLike.match(/song[\/\?\&]id=(\d+)/i) || [])[2];
    }
    if (id) {
        return await getMusicInfo({ id });
    }
    // Return a formatted "not found" item to match original behavior better than just false
    return formatMusicItem({ id: "not_found", name: "Track not found from URL" });
}

// --- Placeholder Formatting Functions (Exported for structural consistency) ---
function formatAlbumItem(albumDataOrId) {
    const id = typeof albumDataOrId === 'object' ? albumDataOrId.id : albumDataOrId;
    return {
        id: id, title: `Album (ID: ${id}) Info Not Available`, artist: "", artwork: "",
        description: "", date: "", worksNum: 0, content: 4
    };
}
function formatArtistItem(artistDataOrId) {
    const id = typeof artistDataOrId === 'object' ? artistDataOrId.id : artistDataOrId;
    return {
        id: id, name: `Artist (ID: ${id}) Info Not Available`, avatar: "",
        description: "", worksNum: 0, content: 5
    };
}
function formatSheetItem(sheetDataOrId) {
    const id = typeof sheetDataOrId === 'object' ? sheetDataOrId.id : sheetDataOrId;
    return {
        id: id, title: `Sheet (ID: ${id}) Info Not Available`, artist: "", artwork: "",
        description: "", worksNum: 0, playCount: 0, content: 2, date: null, createUserId:null, createTime:null
    };
}
function formatComment(commentData) { // Exported for structural consistency
    return {
        id: commentData.commentId || null,
        nickName: (commentData.user && commentData.user.nickname) || "User",
        avatar: (commentData.user && commentData.user.avatarUrl) || "",
        comment: commentData.content || "",
        like: commentData.likedCount || 0,
        createAt: commentData.time || 0,
        location: (commentData.ipLocation && commentData.ipLocation.location) || "",
        replies: [], // Stub replies
        content: 6
    };
}

// --- Stubbed Data Functions (Exported for structural consistency) ---
async function getAlbumInfo(albumItem) {
    return { isEnd: true, albumItem: formatAlbumItem(albumItem.id), musicList: [] };
}
async function getArtistWorks(artistItem, page, type) {
    return { isEnd: true, artistItem: formatArtistItem(artistItem.id), data: [] };
}
async function getMusicSheetInfo(sheet, page = 1) {
    return { isEnd: true, sheetItem: formatSheetItem(sheet.id), musicList: [] };
}
async function getTopLists() { return []; }
async function getTopListDetail(topListItem) {
    const sheetInfo = await getMusicSheetInfo(topListItem);
    return { ...sheetInfo, topListItem: { ...(sheetInfo.sheetItem), content: 3 } };
}
async function getRecommendSheetTags() { return { pinned: [], data: [] }; }
async function getRecommendSheetsByTag(tag, page) { return { isEnd: true, data: [] }; }
async function getMusicComments(musicItem, page = 1) { return { isEnd: true, data: [] }; }

// --- Module Exports ---
module.exports = {
    platform: "pyncmd (Netease Replacement)",
    author: 'Original: , Refactor: AI Assistant',
    version: packageJson.version,
    appVersion: ">0.4.0-alpha.0",
    srcUrl: "local/pyncmd.js", // Should be updated if hosted
    cacheControl: "no-store",
    hints: {
        importMusicSheet: ["网易云：APP点击分享，然后复制链接", "pyncmd源：歌单功能受限，主要用于解析单曲ID。"],
        importMusicItem: ["网易云：APP点击分享，然后复制链接", "pyncmd源：将尝试获取可播放链接。"]
    },
    userVariables: [
        { key: "music_u", name: "网易云用户Cookie (可选)", hint: "MUSIC_U 或 MUSIC_A。pyncmd源作用有限，但可能影响特定解锁。" },
        { key: "PROXY_URL", name: "反向代理URL (可选)", hint: "例如：http://yourproxy.com (用于代理音源)" },
        { key: "UNM_SOURCES", name: "UNM 音源列表 (可选, 逗号分隔)", hint: "例如: pyncmd,kuwo,qq (自定义UNM音源顺序)" }
    ],
    supportedSearchType: ["music"],

    // Core implemented functions
    search,
    getMusicInfo,
    getMediaSource,
    getLyric,
    importMusicSheet,
    importMusicItem,

    // Stubbed data functions
    getAlbumInfo,
    getArtistWorks,
    getMusicSheetInfo,
    getTopLists,
    getTopListDetail,
    getRecommendSheetTags,
    getRecommendSheetsByTag,
    getMusicComments,

    // Exported for structural consistency with original module
    EAPI,
    formatMusicItem,
    formatAlbumItem,
    formatArtistItem,
    formatSheetItem,
    formatComment,
};
