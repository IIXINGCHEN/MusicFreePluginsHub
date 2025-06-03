const axios = require("axios");

const PYNCPLAYER_VERSION = "1.2.1";
const pageSize = 20;
const GDSTUDIO_API_BASE = "https://music-api.gdstudio.xyz/api.php";
const DEFAULT_GDSTUDIO_SOURCE = "netease";
const VALID_GDSTUDIO_SOURCES = ["netease", "kuwo"];

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

// --- API Call Helper ---
async function callGdApi(params) {
    try {
        const response = await axios.get(GDSTUDIO_API_BASE, { params, timeout: 8000 });
        if (response.status === 200 && response.data && typeof response.data === 'object') {
            if (typeof response.data.url === 'string') {
                response.data.url = response.data.url.replace(/\\\//g, '/');
            }
            return response.data;
        }
        return null;
    } catch (error) {
        return null;
    }
}

// --- User Config Handling ---
let currentEnvConfig = {
    PROXY_URL: null,
    GDSTUDIO_SOURCE: DEFAULT_GDSTUDIO_SOURCE
};

function getUserConfig() {
    let config = { ...currentEnvConfig };
    try {
        if (typeof global !== 'undefined' && global.lx && global.lx.env && typeof global.lx.env.getUserVariables === 'function') {
            const userVars = global.lx.env.getUserVariables();
            if (userVars && typeof userVars === 'object') {
                if (userVars.PROXY_URL && isValidUrl(userVars.PROXY_URL)) {
                    config.PROXY_URL = userVars.PROXY_URL;
                }
                if (userVars.GDSTUDIO_SOURCE && VALID_GDSTUDIO_SOURCES.includes(String(userVars.GDSTUDIO_SOURCE).toLowerCase())) {
                    config.GDSTUDIO_SOURCE = String(userVars.GDSTUDIO_SOURCE).toLowerCase();
                }
            }
        }
    } catch (error) {
        // Fallback to default config
    }
    return config;
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
function internalFormatMusicItem(apiTrackData) {
    if (!apiTrackData || typeof apiTrackData !== 'object') {
        return null;
    }

    const id = String(apiTrackData.id || `temp_${Date.now()}_${Math.random()}`);
    const title = sanitizeString(apiTrackData.name, "Unknown Title");
    let artists = "Unknown Artist";
    if (Array.isArray(apiTrackData.artist)) {
        artists = apiTrackData.artist.map(a => sanitizeString(a)).filter(Boolean).join('&') || "Unknown Artist";
    } else if (apiTrackData.artist) {
        artists = sanitizeString(apiTrackData.artist);
    }

    const album = sanitizeString(apiTrackData.album, "Unknown Album");
    const duration = parseInt(apiTrackData.duration_ms || apiTrackData.duration || 0, 10) || 0;

    return {
        id: id,
        title: title,
        artist: artists,
        album: album,
        artwork: sanitizeString(apiTrackData.artworkUrl, ""),
        duration: duration,
        _pic_id: apiTrackData.pic_id ? String(apiTrackData.pic_id) : null,
        _lyric_id: apiTrackData.lyric_id ? String(apiTrackData.lyric_id) : id,
        _source: apiTrackData.source ? String(apiTrackData.source) : null,
        qualities: {},
        content: 0,
        rawLrc: ""
    };
}

function formatAlbumItem(apiAlbumData) {
    if (!apiAlbumData || typeof apiAlbumData !== 'object' || !apiAlbumData.id) {
        return null;
    }

    const id = String(apiAlbumData.id);
    const title = sanitizeString(apiAlbumData.name, "Unknown Album");
    const artist = sanitizeString(apiAlbumData.artist, "Unknown Artist");

    return {
        id: id,
        title: title,
        artist: artist,
        artwork: sanitizeString(apiAlbumData.artworkUrl, ""),
        _pic_id: apiAlbumData.pic_id ? String(apiAlbumData.pic_id) : null,
        _source: apiAlbumData.source ? String(apiAlbumData.source) : null
    };
}

function formatArtistItem(apiArtistData) {
    if (!apiArtistData || typeof apiArtistData !== 'object' || !apiArtistData.id) {
        return null;
    }

    const id = String(apiArtistData.id);
    const name = sanitizeString(apiArtistData.name, "Unknown Artist");

    return {
        id: id,
        name: name,
        artwork: sanitizeString(apiArtistData.artworkUrl, ""),
        _pic_id: apiArtistData.pic_id ? String(apiArtistData.pic_id) : null,
        _source: apiArtistData.source ? String(apiArtistData.source) : null
    };
}

function formatPlaylistItem(apiPlaylistData) {
    if (!apiPlaylistData || typeof apiPlaylistData !== 'object' || !apiPlaylistData.id) {
        return null;
    }

    const id = String(apiPlaylistData.id);
    const title = sanitizeString(apiPlaylistData.name, "Unknown Playlist");
    const creator = sanitizeString(apiPlaylistData.creator, "Unknown Creator");
    let tracks = [];
    if (Array.isArray(apiPlaylistData.tracks)) {
        tracks = apiPlaylistData.tracks.map(track => internalFormatMusicItem(track)).filter(item => item !== null);
    } else if (Array.isArray(apiPlaylistData.songs)) {
        tracks = apiPlaylistData.songs.map(track => internalFormatMusicItem(track)).filter(item => item !== null);
    }

    return {
        id: id,
        title: title,
        creator: creator,
        artwork: sanitizeString(apiPlaylistData.artworkUrl, ""),
        _pic_id: apiPlaylistData.pic_id ? String(apiPlaylistData.pic_id) : null,
        _source: apiPlaylistData.source ? String(apiPlaylistData.source) : null,
        tracks: tracks
    };
}

async function fetchPlaylistTracks(playlistId, source) {
    const trackData = await callGdApi({
        types: "song",
        source: source,
        id: playlistId
    });
    return Array.isArray(trackData) ? trackData : [];
}

// --- Exported Core Functions ---
async function search(query, page = 1, type = "music") {
    if (typeof query !== 'string' || !query.trim()) {
        return Promise.resolve({ isEnd: true, data: [], error: "Invalid search query." });
    }
    if (typeof page !== 'number' || page < 1) page = 1;
    if (!["music", "album", "artist", "playlist"].includes(type)) {
        return Promise.resolve({ isEnd: true, data: [], error: `Search type "${type}" not supported.` });
    }

    const userCfg = getUserConfig();
    const apiParams = {
        types: "search",
        source: type === "music" ? userCfg.GDSTUDIO_SOURCE : `${userCfg.GDSTUDIO_SOURCE}_${type}`,
        name: query,
        count: pageSize,
        pages: page
    };

    let searchData = await callGdApi(apiParams);
    if (searchData && Array.isArray(searchData)) {
        let formattedResults;
        switch (type) {
            case "music":
                formattedResults = searchData.map(track => internalFormatMusicItem(track)).filter(item => item !== null);
                break;
            case "album":
                formattedResults = searchData.map(album => formatAlbumItem(album)).filter(item => item !== null);
                break;
            case "artist":
                formattedResults = searchData.map(artist => formatArtistItem(artist)).filter(item => item !== null);
                break;
            case "playlist":
                formattedResults = await Promise.all(searchData.map(async playlist => {
                    const formatted = formatPlaylistItem(playlist);
                    if (formatted && formatted.tracks.length === 0) {
                        const tracks = await fetchPlaylistTracks(formatted.id, userCfg.GDSTUDIO_SOURCE);
                        formatted.tracks = tracks.map(track => internalFormatMusicItem(track)).filter(item => item !== null);
                    }
                    return formatted;
                })).filter(item => item !== null);
                break;
        }
        return Promise.resolve({
            isEnd: formattedResults.length < pageSize,
            data: formattedResults
        });
    }

    // Fallback to kuwo if netease fails
    if (userCfg.GDSTUDIO_SOURCE === "netease") {
        apiParams.source = type === "music" ? "kuwo" : `kuwo_${type}`;
        searchData = await callGdApi(apiParams);
        if (searchData && Array.isArray(searchData)) {
            let formattedResults;
            switch (type) {
                case "music":
                    formattedResults = searchData.map(track => internalFormatMusicItem(track)).filter(item => item !== null);
                    break;
                case "album":
                    formattedResults = searchData.map(album => formatAlbumItem(album)).filter(item => item !== null);
                    break;
                case "artist":
                    formattedResults = searchData.map(artist => formatArtistItem(artist)).filter(item => item !== null);
                    break;
                case "playlist":
                    formattedResults = await Promise.all(searchData.map(async playlist => {
                        const formatted = formatPlaylistItem(playlist);
                        if (formatted && formatted.tracks.length === 0) {
                            const tracks = await fetchPlaylistTracks(formatted.id, "kuwo");
                            formatted.tracks = tracks.map(track => internalFormatMusicItem(track)).filter(item => item !== null);
                        }
                        return formatted;
                    })).filter(item => item !== null);
                    break;
            }
            return Promise.resolve({
                isEnd: formattedResults.length < pageSize,
                data: formattedResults
            });
        }
    }

    return Promise.resolve({ isEnd: true, data: [], error: "Search API request failed or returned invalid data." });
}

async function getMusicInfo(musicItem) {
    if (!musicItem || typeof musicItem !== 'object' || !musicItem.id || typeof musicItem.id !== 'string') {
        return Promise.resolve(internalFormatMusicItem({ id: "unknown", title: "Error: Invalid musicItem input" }));
    }

    const userCfg = getUserConfig();
    const source = (musicItem._source && VALID_GDSTUDIO_SOURCES.includes(musicItem._source)) ? musicItem._source : userCfg.GDSTUDIO_SOURCE;
    let finalItemData = { ...musicItem };

    const songData = await callGdApi({
        types: "song",
        source: source,
        id: musicItem.id
    });
    if (songData) {
        finalItemData = { ...finalItemData, ...songData };
    }

    if (!finalItemData.artwork && finalItemData._pic_id) {
        const picData = await callGdApi({
            types: "pic",
            source: source,
            id: finalItemData._pic_id,
            size: 500
        });
        if (picData && isValidUrl(picData.url)) {
            finalItemData.artworkUrl = picData.url;
        }
    }

    const formattedItem = internalFormatMusicItem(finalItemData);
    if (!formattedItem) {
        return Promise.resolve(internalFormatMusicItem({ id: musicItem.id, title: "Error: Failed to process music item." }));
    }
    return Promise.resolve(formattedItem);
}

async function getMediaSource(musicItem, quality) {
    if (!musicItem || typeof musicItem !== 'object' || !musicItem.id || typeof musicItem.id !== 'string') {
        return Promise.resolve({ error: "Invalid musicItem input." });
    }
    if (typeof quality !== 'string') quality = "standard";

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

    let urlData = await callGdApi({
        types: "url",
        source: "netease",
        id: track_id,
        br: bitrate
    });

    if (urlData && isValidUrl(urlData.url)) {
        return Promise.resolve({
            url: applyProxy(urlData.url, userCfg.PROXY_URL),
            size: urlData.size ? parseInt(urlData.size, 10) * 1024 : 0,
            quality
        });
    }

    urlData = await callGdApi({
        types: "url",
        source: "kuwo",
        id: track_id,
        br: bitrate
    });

    if (urlData && isValidUrl(urlData.url)) {
        return Promise.resolve({
            url: applyProxy(urlData.url, userCfg.PROXY_URL),
            size: urlData.size ? parseInt(urlData.size, 10) * 1024 : 0,
            quality
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
    const lyric_id = musicItem._lyric_id || musicItem.id;

    if (!lyric_id) {
        return Promise.resolve({ rawLrc: "", tlyric: "", error: "Lyric ID missing." });
    }

    const lyricData = await callGdApi({
        types: "lyric",
        source: source,
        id: lyric_id
    });

    if (lyricData && (typeof lyricData.lyric === 'string' || typeof lyricData.tlyric === 'string')) {
        return Promise.resolve({
            rawLrc: sanitizeString(lyricData.lyric),
            tlyric: sanitizeString(lyricData.tlyric)
        });
    }
    return Promise.resolve({ rawLrc: "", tlyric: "", error: "Lyric not found or API error." });
}

function updatePlugin() {
    const currentVersion = PYNCPLAYER_VERSION;
    const latestVersion = "1.2.1";
    if (currentVersion !== latestVersion) {
        return {
            updateAvailable: true,
            currentVersion,
            message: `Update available: ${latestVersion}. Please visit music.gdstudio.xyz to download.`
        };
    }
    return {
        updateAvailable: false,
        currentVersion,
        message: "Plugin is up to date."
    };
}

function sharePlugin(item, type = "music") {
    if (!item || typeof item !== "object" || !item.id || !["music", "album", "artist", "playlist"].includes(type)) {
        return Promise.resolve({ error: "Invalid item or type for sharing." });
    }

    const userCfg = getUserConfig();
    const source = (item._source && VALID_GDSTUDIO_SOURCES.includes(item._source)) ? item._source : userCfg.GDSTUDIO_SOURCE;
    const shareUrl = `https://music.gdstudio.xyz/share?type=${type}&source=${source}&id=${item.id}`;
    
    return Promise.resolve({
        shareUrl,
        title: item.title || item.name || "Unknown",
        source
    });
}

async function importMusicSheet(url) {
    if (!isValidUrl(url)) {
        return Promise.resolve({ error: "Invalid playlist URL." });
    }

    const urlObj = new URL(url);
    const id = urlObj.searchParams.get("id");
    const source = urlObj.searchParams.get("source") || DEFAULT_GDSTUDIO_SOURCE;

    if (!id || !VALID_GDSTUDIO_SOURCES.includes(source)) {
        return Promise.resolve({ error: "Invalid playlist ID or source." });
    }

    let playlistData = await callGdApi({
        types: "search",
        source: `${source}_playlist`,
        id: id,
        count: 1,
        pages: 1
    });

    if (playlistData && Array.isArray(playlistData) && playlistData[0]) {
        let formattedPlaylist = formatPlaylistItem(playlistData[0]);
        if (formattedPlaylist && formattedPlaylist.tracks.length === 0) {
            const tracks = await fetchPlaylistTracks(id, source);
            formattedPlaylist.tracks = tracks.map(track => internalFormatMusicItem(track)).filter(item => item !== null);
        }
        if (!formattedPlaylist) {
            return Promise.resolve({ error: "Failed to process playlist data." });
        }
        return Promise.resolve(formattedPlaylist);
    }

    // Fallback to kuwo
    if (source === "netease") {
        playlistData = await callGdApi({
            types: "search",
            source: `kuwo_playlist`,
            id: id,
            count: 1,
            pages: 1
        });
        if (playlistData && Array.isArray(playlistData) && playlistData[0]) {
            let formattedPlaylist = formatPlaylistItem(playlistData[0]);
            if (formattedPlaylist && formattedPlaylist.tracks.length === 0) {
                const tracks = await fetchPlaylistTracks(id, "kuwo");
                formattedPlaylist.tracks = tracks.map(track => internalFormatMusicItem(track)).filter(item => item !== null);
            }
            if (!formattedPlaylist) {
                return Promise.resolve({ error: "Failed to process playlist data." });
            }
            return Promise.resolve(formattedPlaylist);
        }
    }

    return Promise.resolve({ error: "Playlist not found or API error." });
}

// --- Module Exports ---
const pluginExport = {
    platform: "NetEase & Kuwo (GDStudio API)",
    version: PYNCPLAYER_VERSION,
    src: "remote",
    appVersion: "0.0.0",
    author: "GDStudio",
    requires: ["http"],
    userVariables: [
        {
            key: "GDSTUDIO_SOURCE",
            name: "Music Source",
            hint: `Default music source (options: ${VALID_GDSTUDIO_SOURCES.join(', ')}). Default: ${DEFAULT_GDSTUDIO_SOURCE}`
        },
        {
            key: "PROXY_URL",
            name: "Proxy URL (Optional)",
            hint: "e.g., https://yourproxy.com (proxies certain music source links)"
        }
    ],
    hints: {
        {
            general: "Powered by GDStudio API, supports NetEase and Kuwo sources. Supports music, album, songs, and artist types for search and playback."
        },
    supportedSearchTypes: ["music", "album", "artist", "playlists"],
    search,
    getMusicInfo,
    getMediaSource,
    getLyric,
    updatePlugin,
    sharePlugin,
    importMusicSheet
};

module.exports = pluginExport;
export default pluginExport;
