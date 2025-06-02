"use strict";

const axios = require("axios");
const CryptoJs = require("crypto-js"); // Kept for structural consistency, EAPI not used
const dayjs = require("dayjs"); // For date formatting if needed by format functions
const unblockMusicMatcher = require("@unblockneteasemusic/server"); // Main dependency

const packageJson = { version: "pyncmd-1.0.0" }; // Placeholder for version
const pageSize = 30; // From original module

// 音质参数 (保持与原始模块一致)
const qualityMap = {
    "low": "standard",
    "standard": "exhigh",
    "high": "lossless",
    "super": "hires",
};

// Reverse map for GDStudio or similar if needed
const qualityToBitrate = {
    "low": "128",
    "standard": "320",
    "high": "999", // Assuming 999 for FLAC/lossless on GDStudio
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
        // console.error(`[GDStudio API Call] Error for ID ${id}, BR ${br}:`, error.message);
        return null;
    }
}

async function searchGDStudioKuwo(name, page = 1, limit = pageSize) {
    try {
        const apiUrl = new URL("https://music-api.gdstudio.xyz/api.php");
        apiUrl.searchParams.append("types", "search");
        apiUrl.searchParams.append("source", "kuwo"); // Hardcoded to Kuwo for now
        apiUrl.searchParams.append("name", name);
        apiUrl.searchParams.append("count", String(limit));
        apiUrl.searchParams.append("pages", String(page));

        const response = await axios.get(apiUrl.toString(), { timeout: 10000 });
        if (response.status === 200 && response.data && Array.isArray(response.data)) {
            return response.data; // Returns an array of search results from Kuwo via GDStudio
        }
        return [];
    } catch (error) {
        // console.error(`[GDStudio Kuwo Search] Error for name "${name}":`, error.message);
        return [];
    }
}

// env simulation for userVariables
let env = {
    _userVariables: {
        PROXY_URL: process.env.PROXY_URL || null,
        UNM_SOURCES: process.env.UNM_SOURCES || null,
        // music_u is not actively used by pyncmd's core logic but kept for UNM call
        music_u: process.env.MUSIC_U || null,
    },
    getUserVariables: function() {
        return this._userVariables;
    },
    // Allow updating for tests or external configuration
    setUserVariables: function(vars) {
        this._userVariables = { ...this._userVariables, ...vars };
    }
};

function applyProxy(url, proxyUrl) {
    if (proxyUrl && url && (url.includes("kuwo.cn") || url.includes("migu.cn") || url.includes("isure.stream.qqmusic.qq.com") /* add other domains if needed */) ) {
        const httpRemovedUrl = url.replace(/^http[s]?:\/\//, "");
        return proxyUrl.replace(/\/$/, "") + "/" + httpRemovedUrl;
    }
    return url;
}

// --- MD5 and AES (kept for structure, not used by core pyncmd logic) ---
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

// --- EAPI (Stub - Not used by pyncmd core logic) ---
async function EAPI(path, json = {}) {
    // console.warn(`[EAPI STUB] Called with path: ${path}. This pyncmd module does not use Netease EAPI directly.`);
    // This is a stub. Functions should rely on new data sources.
    if (path === "/api/v3/song/detail") return { songs: [], privileges: [] };
    if (path === "/api/song/lyric") return { lrc: { lyric: "" }, tlyric: { lyric: "" }, klyric: { lyric: "" } };
    return {};
}

// --- Core Formatting Function ---
function formatMusicItem(rawTrackData, dataSourceHint = "unknown") {
    // This function aims to map various input structures (from UNM, GDStudio)
    // to the consistent output format of the original NetEase module.
    // It's a best-effort conversion.

    let id = rawTrackData.id || null;
    let title = rawTrackData.name || rawTrackData.title || "Unknown Title";
    let artist = "Unknown Artist";
    let albumName = "Unknown Album";
    let artwork = rawTrackData.pic || rawTrackData.artwork || (rawTrackData.album ? rawTrackData.album.picUrl : null) || "";
    let duration = rawTrackData.dt || rawTrackData.duration || 0; // Expect ms
    let albumId = rawTrackData.al ? rawTrackData.al.id : (rawTrackData.album ? rawTrackData.album.id : null);

    // Artist parsing (handle 'ar' array or 'artists' array or string)
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
    
    // dataSourceHint specific parsing for GDStudio Kuwo search results
    if (dataSourceHint === "gdkuwo_search") {
        id = String(rawTrackData.id || (rawTrackData.MUSICRID ? String(rawTrackData.MUSICRID).split('_').pop() : null));
        title = rawTrackData.SONGNAME || title;
        artist = String(rawTrackData.ARTIST || artist).replace(/;/g, '&');
        albumName = rawTrackData.ALBUM || albumName;
        duration = rawTrackData.DURATION ? parseInt(rawTrackData.DURATION, 10) * 1000 : duration;
        // artwork might not be directly available or named 'pic' or 'img1v1Url'
    }


    const qualities = {}; // Simplified for pyncmd
    if (id) { // Assume playable if an ID exists
        qualities["standard"] = { size: rawTrackData.size || 0 }; // Placeholder
    }

    // Content: 0 for playable, 1 for locked/VIP. Assume playable from these sources.
    let content = 0;
    if (rawTrackData.fee === 1 || rawTrackData.privilege?.st < 0 || rawTrackData.st < 0 ) {
        // This is a weak check. UNM aims to bypass this.
        // If data explicitly says it's unplayable by Netease rules, reflect it.
        // But if UNM provided it, it's likely playable.
    }
    
    // Lyrics - rawLrc from UNM match result if available
    let rawLrc = rawTrackData.lyric || rawTrackData.lyrics || null;

    return {
        id: String(id), // Ensure ID is string
        artist: artist,
        title: title,
        duration: parseInt(duration, 10), // Ensure duration is integer ms
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
    const unmCookie = userVars.music_u; // For UNM, if it uses it

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
    } catch (e) { /* console.warn(`[pyncmd getMediaSource] UNM failed for ${musicItem.id}: ${e.message}`); */ }

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
        return {
            url: finalUrl,
            size: sourceSize,
            quality: actualQualityKey,
        };
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
        // UNM's match function is the primary source for attempting to get "info"
        // It's expected to return an object with metadata if successful.
        const matchResult = await unblockMusicMatcher.match(musicItem.id, unmSources, unmCookie);
        if (matchResult && (matchResult.url || matchResult.name || matchResult.title)) { // Check for some identifying data
            trackData = { ...matchResult, id: musicItem.id }; // Ensure original ID is preserved/set
        }
    } catch (e) { /* console.warn(`[pyncmd getMusicInfo] UNM failed for ${musicItem.id}: ${e.message}`); */ }

    if (trackData) {
        return formatMusicItem(trackData, "unm_match");
    } else {
        // Fallback: if UNM fails to provide metadata, return minimal info
        // This indicates that while a URL might be findable via getMediaSource, full info isn't.
        // console.warn(`[pyncmd getMusicInfo] Could not retrieve full metadata for ${musicItem.id} via UNM. Returning minimal info.`);
        const minimalInfo = { id: musicItem.id, name: `Track (ID: ${musicItem.id})` };
        // Try to get at least a playable URL to determine 'content' if possible, though getMusicInfo isn't for URL.
        // This is a compromise. Original getMusicInfo would get official Netease metadata.
        return formatMusicItem(minimalInfo);
    }
}

async function search(query, page = 1, type = "music") {
    if (type === "music") {
        const results = await searchGDStudioKuwo(query, page, pageSize);
        const formattedResults = results.map(track => formatMusicItem(track, "gdkuwo_search"));
        return {
            isEnd: results.length < pageSize,
            data: formattedResults,
        };
    } else {
        // console.warn(`[pyncmd search] Type "${type}" is not supported. Only "music" search is available.`);
        return {
            isEnd: true,
            data: [],
        };
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
    } catch (e) { /* console.warn(`[pyncmd getLyric] UNM failed for ${musicItem.id}: ${e.message}`); */ }
    
    // If UNM didn't provide lyric, try calling original EAPI stub (which returns empty)
    // or accept that lyric isn't available. For pyncmd, direct EAPI calls are out.
    if (!lyric) {
        // console.warn(`[pyncmd getLyric] Lyric not found for ${musicItem.id} via UNM.`);
        // The original module calls EAPI /api/song/lyric. We are not doing that.
        // So if UNM doesn't provide it, it's not available via pyncmd.
    }

    return {
        rawLrc: lyric,
        // Original module also had tlyric, klyric, etc. from EAPI. These are not available.
        // For MusicFree, rawLrc is often sufficient.
    };
}

// --- Import Functions (Simplified) ---
async function importMusicSheet(urlLike) {
    // pyncmd cannot fetch full sheet details. This will be very limited.
    // It can only attempt to parse an ID and indicate that sheet import is not fully supported.
    let id = (urlLike.match(/^(\d+)$/) || [])[1];
    if (!id && urlLike.match(/music\.163\.com/i)) {
        id = (urlLike.match(/playlist[\/\?\&]id=(\d+)/i) || [])[2];
    }
    if (id) {
        // console.warn(`[pyncmd importMusicSheet] Importing sheet ID ${id}, but pyncmd has limited sheet support. Will return empty musicList.`);
        // Call getMusicSheetInfo which returns a placeholder.
        const sheetInfo = await getMusicSheetInfo({ id });
        return sheetInfo.musicList; // Which will be an empty array
    }
    return false; // Or an empty array, to match original type (musicList)
}

async function importMusicItem(urlLike) {
    let id = (urlLike.match(/^(\d+)$/) || [])[1];
    if (!id && urlLike.match(/music\.163\.com/i)) {
        id = (urlLike.match(/song[\/\?\&]id=(\d+)/i) || [])[2];
    }
    if (id) {
        return await getMusicInfo({ id }); // This will use our pyncmd getMusicInfo
    }
    return false; // Or a formatted "not found" item
}

// --- Stubbed Functions (for structural consistency) ---
async function getAlbumInfo(albumItem) {
    return {
        isEnd: true,
        albumItem: formatAlbumItemPlaceholder(albumItem.id),
        musicList: [],
    };
}
function formatAlbumItemPlaceholder(id) { // Helper for placeholder
    return {
        id: id, title: `Album (ID: ${id}) Info Not Available via pyncmd`, artist: "", artwork: "",
        description: "", date: "", worksNum: 0, content: 4
    };
}

async function getArtistWorks(artistItem, page, type) {
    return {
        isEnd: true,
        artistItem: formatArtistItemPlaceholder(artistItem.id),
        data: [],
    };
}
function formatArtistItemPlaceholder(id) { // Helper for placeholder
    return {
        id: id, name: `Artist (ID: ${id}) Info Not Available via pyncmd`, avatar: "",
        description: "", worksNum: 0, content: 5
    };
}

async function getMusicSheetInfo(sheet, page = 1) {
    return {
        isEnd: true,
        sheetItem: formatSheetItemPlaceholder(sheet.id),
        musicList: [],
    };
}
function formatSheetItemPlaceholder(id) { // Helper for placeholder
    return {
        id: id, title: `Sheet (ID: ${id}) Info Not Available via pyncmd`, artist: "", artwork: "",
        description: "", worksNum: 0, playCount: 0, content: 2, date: null, createUserId:null, createTime:null
    };
}

async function getTopLists() { return []; }
async function getTopListDetail(topListItem) {
    const sheetInfo = await getMusicSheetInfo(topListItem); // Uses placeholder
    return { ...sheetInfo, topListItem: { ...sheetInfo.sheetItem, content: 3 } };
}
async function getRecommendSheetTags() { return { pinned: [], data: [] }; }
async function getRecommendSheetsByTag(tag, page) { return { isEnd: true, data: [] }; }
async function getMusicComments(musicItem, page = 1) { return { isEnd: true, data: [] }; }

// Format stubs for consistency
function formatAlbumItem(rawAlbumData) { return formatAlbumItemPlaceholder(rawAlbumData.id); }
function formatArtistItem(rawArtistData) { return formatArtistItemPlaceholder(rawArtistData.id); }
function formatSheetItem(rawSheetData) { return formatSheetItemPlaceholder(rawSheetData.id); }
// formatComment is not needed as getMusicComments is fully stubbed

// --- Module Exports (Matching Original Structure) ---
module.exports = {
    platform: "pyncmd (Netease Replacement)", // Clearly indicate it's a replacement
    author: 'Original: , Refactor: AI Assistant',
    version: packageJson.version,
    appVersion: ">0.4.0-alpha.0", // From original
    srcUrl: "local/pyncmd.js", // Placeholder
    cacheControl: "no-store", // From original
    hints: {
        importMusicSheet: [
            "网易云：APP点击分享，然后复制链接",
            "pyncmd源：歌单功能受限，主要用于导入单曲ID。"
        ],
        importMusicItem: [
            "网易云：APP点击分享，然后复制链接",
            "pyncmd源：将尝试获取可播放链接。"
        ]
    },
    userVariables: [
    {
        key: "music_u", // Kept for UNM call, though utility is diminished
        name: "网易云用户Cookie (可选)",
        hint: "MUSIC_U 或 MUSIC_A。pyncmd源主要依赖第三方，此项作用有限，但可能影响特定解锁方式。"
    },
    {
        key: "PROXY_URL",
        name: "反向代理URL (可选)",
        hint: "例如：http://yourproxy.com (用于代理某些音源的播放链接)"
    },
    {
        key: "UNM_SOURCES",
        name: "UNM 音源列表 (可选, 逗号分隔)",
        hint: "例如: pyncmd,kuwo,qq,migu (自定义@unblockneteasemusic/server使用的音源顺序)"
    },
    // `source` (Kuwo白名单) is indirectly handled by GDStudio or UNM if they use Kuwo.
    // Not making it a direct userVariable here as its application is less direct.
    ],
    supportedSearchType: ["music"], // Only "music" is somewhat supported

    // Implemented or partially implemented functions
    search,
    getMusicInfo,
    getMediaSource,
    getLyric,
    importMusicSheet,
    importMusicItem,

    // Stubbed functions for structural compatibility
    getAlbumInfo,
    getArtistWorks,
    getMusicSheetInfo,
    getTopLists,
    getTopListDetail,
    getRecommendSheetTags,
    getRecommendSheetsByTag,
    getMusicComments,

    // Kept for structural compatibility, but effectively stubs/unused by pyncmd core
    // EAPI, // Intentionally not exporting EAPI as it's a non-functional stub
    // formatMusicItem, // These format functions are internal helpers now
    // formatAlbumItem,
    // formatArtistItem,
    // formatSheetItem,

    // test functions (internal, not part of module API)
    _internal: {
        env: env, // Expose env for external configuration if needed
        formatMusicItem: formatMusicItem, // Expose for testing internal formatting
        callGDStudioAPI: callGDStudioAPI,
        searchGDStudioKuwo: searchGDStudioKuwo,
        applyProxy: applyProxy,
        // Expose stubs' formatters if needed for testing their placeholder output
        formatAlbumItemPlaceholder: formatAlbumItemPlaceholder,
        formatArtistItemPlaceholder: formatArtistItemPlaceholder,
        formatSheetItemPlaceholder: formatSheetItemPlaceholder,
    }
};

// --- Optional: Test code (comment out or remove for production) ---
/*
async function runTests() {
    console.log("--- pyncmd Module Test Suite ---");

    // Configure for testing if needed
    // module.exports._internal.env.setUserVariables({ PROXY_URL: "http://myproxy.example.com" });

    const testSongId = "29774193"; // Beyond - 光辉岁月 (example)
    // const testSongId = "1860827039"; // 陈奕迅 - 孤勇者 (example, might be VIP on Netease)

    console.log(`\n[Test 1: getMusicInfo for ID ${testSongId}]`);
    const musicInfo = await module.exports.getMusicInfo({ id: testSongId });
    console.log("Music Info:", JSON.stringify(musicInfo, null, 2));

    if (musicInfo && musicInfo.id) {
        console.log(`\n[Test 2: getMediaSource for ID ${musicInfo.id}, quality 'standard']`);
        const mediaSourceStd = await module.exports.getMediaSource(musicInfo, "standard");
        console.log("Media Source (standard):", mediaSourceStd);

        console.log(`\n[Test 3: getMediaSource for ID ${musicInfo.id}, quality 'high']`);
        const mediaSourceHigh = await module.exports.getMediaSource(musicInfo, "high");
        console.log("Media Source (high):", mediaSourceHigh);

        console.log(`\n[Test 4: getLyric for ID ${musicInfo.id}]`);
        const lyricData = await module.exports.getLyric(musicInfo);
        console.log("Lyric Data (rawLrc length):", lyricData.rawLrc ? lyricData.rawLrc.length : "No lyric found");
        // console.log("Raw Lyric (first 100 chars):", lyricData.rawLrc ? lyricData.rawLrc.substring(0,100) : "");
    } else {
        console.warn("Skipping media source and lyric tests as musicInfo was not fully retrieved.");
    }

    const searchQuery = "Beyond";
    console.log(`\n[Test 5: search for query "${searchQuery}", type 'music']`);
    const searchResults = await module.exports.search(searchQuery, 1, "music");
    console.log("Search Results (first 2 items):", JSON.stringify(searchResults.data.slice(0,2), null, 2));
    console.log("Search isEnd:", searchResults.isEnd);


    console.log(`\n[Test 6: importMusicItem with Netease URL]`);
    const songUrl = "https://music.163.com/#/song?id=29774193";
    const importedItem = await module.exports.importMusicItem(songUrl);
    console.log("Imported Item Info:", JSON.stringify(importedItem, null, 2));

    console.log("\n--- Test Suite Finished ---");
}

// To run tests:
// 1. Ensure @unblockneteasemusic/server is installed: npm install @unblockneteasemusic/server axios crypto-js dayjs
// 2. Save this code as pyncmd.js
// 3. Uncomment the line below and run: node pyncmd.js
// runTests().catch(console.error);
*/
