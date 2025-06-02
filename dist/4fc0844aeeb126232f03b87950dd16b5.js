"use strict";

const axios = require("axios");

const UNM_PLUGIN_VERSION = "2.1.3"; 
const pageSize = 30; 
const METING_API_HOST = "https://meting-api.imixc.top"; 

const DEFAULT_METING_SERVER = "netease";
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

// --- API Call Helper ---
async function callMetingApi(endpointPathWithApiPrefix, params = {}) {
    try {
        const url = `${METING_API_HOST}${endpointPathWithApiPrefix}`;
        const response = await axios.get(url, { params, timeout: 10000 });
        if (response.status === 200 && response.data) {
            // Recursively unescape slashes in URLs within the response data
            const unescapeSlashes = (data) => {
                if (typeof data === 'string' && (data.startsWith('http:') || data.startsWith('https:'))) {
                    return data.replace(/\\\//g, '/');
                } else if (Array.isArray(data)) {
                    return data.map(unescapeSlashes);
                } else if (typeof data === 'object' && data !== null) {
                    const newData = {};
                    for (const key in data) {
                        newData[key] = unescapeSlashes(data[key]);
                    }
                    return newData;
                }
                return data;
            };
            return unescapeSlashes(response.data);
        }
        return null;
    } catch (error) {
        return null;
    }
}

// --- User Config Handling ---
let currentEnvConfig = {
    PROXY_URL: null,
    METING_SERVER: DEFAULT_METING_SERVER,
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

function applyProxy(url, proxyUrl) {
    if (proxyUrl && isValidUrl(proxyUrl) && url && isValidUrl(url) && 
        (url.includes("kuwo.cn") || url.includes("migu.cn") || url.includes("music.163.com") || url.includes("isure.stream.qqmusic.qq.com") || url.includes("qq.com"))) {
        const httpRemovedUrl = url.replace(/^http[s]?:\/\//, "");
        return proxyUrl.replace(/\/$/, "") + "/" + httpRemovedUrl;
    }
    return url;
}

// --- Internal Formatting ---
function internalFormatMusicItem(apiTrackData, server) {
    if (!apiTrackData || typeof apiTrackData !== 'object' || !apiTrackData.id) {
        return null; 
    }
    const id = String(apiTrackData.id);
    const title = sanitizeString(apiTrackData.name || apiTrackData.title, "Unknown Title");
    let artists = "Unknown Artist";
    if (Array.isArray(apiTrackData.artist)) {
        artists = apiTrackData.artist
            .map(a => (a && typeof a.name === 'string' ? sanitizeString(a.name) : (typeof a === 'string' ? sanitizeString(a) : null)))
            .filter(Boolean).join('&') || "Unknown Artist";
    } else if (apiTrackData.artist && typeof apiTrackData.artist.name === 'string') { // Single artist object
        artists = sanitizeString(apiTrackData.artist.name);
    } else if (typeof apiTrackData.artist === 'string') { // Simple string
         artists = sanitizeString(apiTrackData.artist);
    }

    const album = sanitizeString(apiTrackData.album, "Unknown Album");
    let artwork = ""; // Artwork URL from Meting's /song or /playlist might be direct
    if (isValidUrl(apiTrackData.pic)) artwork = apiTrackData.pic;
    else if (isValidUrl(apiTrackData.cover)) artwork = apiTrackData.cover;
    
    const duration = parseInt(apiTrackData.duration || 0, 10) || 0; 
    
    // For pic_id, Meting search result has 'pic_id'. /song endpoint might have 'pic' as URL or ID.
    const pic_id_from_api = apiTrackData.pic_id || (artwork ? null : (typeof apiTrackData.pic === 'string' && !isValidUrl(apiTrackData.pic) ? apiTrackData.pic : null));
    const lyric_id_from_api = apiTrackData.lyric_id || id; // Lyric ID often same as track ID

    return {
        id: id, title: title, artist: artists, album: album, artwork: artwork, duration: duration,
        _pic_id: pic_id_from_api ? String(pic_id_from_api) : null,
        _lyric_id: String(lyric_id_from_api),
        _source: server || sanitizeString(apiTrackData.source),
        qualities: {}, content: 0, rawLrc: "",
    };
}

function internalFormatSheetItem(playlistId, playlistApiResponse, server) {
    let sheetName = `Playlist ${playlistId}`; 
    let coverImgUrl = ""; let creatorName = ""; let description = "";
    let trackCount = 0; let playCount = 0;

    // Based on your provided /playlist/{id} JSON for song list:
    // Playlist metadata (name, cover, etc.) is NOT in that specific response structure.
    // It only contains `playlist_id` and `playlist_info` (the songs).
    // So, we rely on playlistId and count songs from `playlist_info`.
    if (playlistApiResponse && playlistApiResponse.data) {
        if (playlistApiResponse.data.playlist_id) { // Confirm ID matches
             // sheetName might be passed via sheetQuery in getMusicSheetInfo if UI provides it
        }
        if (Array.isArray(playlistApiResponse.data.playlist_info)) {
            trackCount = playlistApiResponse.data.playlist_info.length;
        }
    }
    // If Meting API's /playlist/{id} response *did* include top-level playlist metadata:
    // e.g., if playlistApiResponse was { id: "...", name: "...", cover: "...", songs: [] }
    // then you would parse it here:
    // if (playlistApiResponse && playlistApiResponse.id) {
    //     sheetName = sanitizeString(playlistApiResponse.name, `Playlist ${playlistId}`);
    //     coverImgUrl = isValidUrl(playlistApiResponse.cover) ? playlistApiResponse.cover : "";
    //     creatorName = sanitizeString(playlistApiResponse.creator_name, ""); // Fictional field
    //     description = sanitizeString(playlistApiResponse.description, "");
    //     trackCount = Array.isArray(playlistApiResponse.songs) ? playlistApiResponse.songs.length : 0;
    //     playCount = parseInt(playlistApiResponse.play_count, 10) || 0;
    // }

    return {
        id: String(playlistId), title: sheetName, artist: creatorName, artwork: coverImgUrl,
        description: description, worksNum: trackCount, playCount: playCount, _source: server,
    };
}

function internalFormatAlbumItem(apiAlbumData, server) {
    if (!apiAlbumData || typeof apiAlbumData !== 'object' || !apiAlbumData.id) {
        return { id: "unknown", title: "Unknown Album", artist: "", artwork: "", description: "", date: "", worksNum: 0 };
    }
    let artistName = "Unknown Artist";
    if (Array.isArray(apiAlbumData.artist)) {
        artistName = apiAlbumData.artist.map(a => (a && typeof a.name === 'string' ? sanitizeString(a.name) : (typeof a === 'string' ? sanitizeString(a) : null)))
            .filter(Boolean).join('&') || "Unknown Artist";
    } else if (apiAlbumData.artist && typeof apiAlbumData.artist.name === 'string') {
        artistName = sanitizeString(apiAlbumData.artist.name);
    } else if (typeof apiAlbumData.artist === 'string') {
         artistName = sanitizeString(apiAlbumData.artist);
    }
    return {
        id: String(apiAlbumData.id),
        title: sanitizeString(apiAlbumData.name, "Album"),
        artist: artistName,
        artwork: isValidUrl(apiAlbumData.cover || apiAlbumData.pic) ? (apiAlbumData.cover || apiAlbumData.pic) : "",
        description: sanitizeString(apiAlbumData.description || apiAlbumData.desc, ""),
        date: sanitizeString(apiAlbumData.publish_date || apiAlbumData.publishTime, ""),
        worksNum: parseInt(apiAlbumData.song_count || (apiAlbumData.songs ? apiAlbumData.songs.length : 0), 10) || 0,
        _source: server,
    };
}

function internalFormatArtistItem(apiArtistData, server) {
    if (!apiArtistData || typeof apiArtistData !== 'object' || !apiArtistData.id) {
        return { id: "unknown", name: "Unknown Artist", avatar: "", description: "", worksNum: 0 };
    }
    return {
        id: String(apiArtistData.id),
        name: sanitizeString(apiArtistData.name, "Artist"),
        avatar: isValidUrl(apiArtistData.pic || apiArtistData.cover || apiArtistData.avatar) ? (apiArtistData.pic || apiArtistData.cover || apiArtistData.avatar) : "",
        description: sanitizeString(apiArtistData.description || apiArtistData.desc || apiArtistData.briefDesc, ""),
        worksNum: parseInt(apiArtistData.music_size || apiArtistData.song_count || 0, 10) || 0,
        _source: server,
    };
}

// --- Exported Core Functions ---
async function search(query, page = 1, type = "music") {
    if (typeof query !== 'string' || !query.trim()) return Promise.resolve({ isEnd: true, data: [], error: "Invalid search query." });
    if (typeof page !== 'number' || page < 1) page = 1;
    if (type !== "music") return Promise.resolve({ isEnd: true, data: [], error: `Search type "${type}" not supported.` });

    const userCfg = getUserConfig();
    const server = userCfg.METING_SERVER;
    
    const apiResponse = await callMetingApi("/api.php/search", { 
        q: query, 
        server: server,
        limit: pageSize 
    });

    let songsArray = null;
    // Based on the provided JSON for search: apiResponse.data.results
    if (apiResponse && apiResponse.data && Array.isArray(apiResponse.data.results)) {
        songsArray = apiResponse.data.results;
    } else if (apiResponse && Array.isArray(apiResponse)) { // Fallback if API directly returns array (less likely for this spec)
        songsArray = apiResponse;
    }

    if (songsArray && Array.isArray(songsArray)) { 
        const formattedResults = songsArray.map(track => internalFormatMusicItem(track, track.source || server)).filter(item => item !== null);
        const totalResults = (apiResponse.meta && typeof apiResponse.meta.total_results === 'number') ? apiResponse.meta.total_results : null;
        let isEnd = formattedResults.length < pageSize; 
        if (totalResults !== null) { isEnd = (page * pageSize) >= totalResults; }
        
        return Promise.resolve({ isEnd: isEnd, data: formattedResults });
    }
    return Promise.resolve({ isEnd: true, data: [], error: "Search API request failed or returned no parsable song list." });
}

async function getMusicInfo(musicItem) {
    if (!musicItem || typeof musicItem !== 'object' || !musicItem.id || typeof musicItem.id !== 'string') {
        return Promise.resolve(internalFormatMusicItem({ id: "unknown", name: "Error: Invalid musicItem input" }, null));
    }

    const userCfg = getUserConfig();
    const server = musicItem._source || userCfg.METING_SERVER;
    const track_id = musicItem.id;

    const songDataArray = await callMetingApi(`/api.php/song/${track_id}`, { server: server });
    const songData = (Array.isArray(songDataArray) && songDataArray.length > 0) ? songDataArray[0] : songDataArray;

    if (songData && songData.id) {
        let formatted = internalFormatMusicItem(songData, server);
        // Ensure pic_id is from the more detailed songData if available
        const picIdToFetch = songData.pic_id || formatted._pic_id || (isValidUrl(songData.pic) ? null : songData.pic) ;

        if (!formatted.artwork && picIdToFetch && !isValidUrl(picIdToFetch)) { // Fetch only if it's an ID
            const picData = await callMetingApi(`/api.php/picture/${picIdToFetch}`, {server: server});
            if (picData && isValidUrl(picData.url)) {
               formatted.artwork = picData.url;
            }
        } else if (!formatted.artwork && isValidUrl(picIdToFetch)) { // If picIdToFetch was already a URL
            formatted.artwork = picIdToFetch;
        }
        return Promise.resolve(formatted);
    }
    // Fallback: use data from input musicItem if API call fails
    return Promise.resolve(internalFormatMusicItem({ ...musicItem, name: musicItem.title || `Track ${track_id} (Info call failed)` }, server));
}

async function getMediaSource(musicItem, quality) {
    if (!musicItem || typeof musicItem !== 'object' || !musicItem.id || typeof musicItem.id !== 'string') {
        return Promise.resolve({ error: "Invalid musicItem input." });
    }
    if (typeof quality !== 'string') quality = "standard";
    
    const userCfg = getUserConfig();
    const server = musicItem._source || userCfg.METING_SERVER;
    const track_id = musicItem.id;

    let bitrateApiValue; 
    switch (quality.toLowerCase()) {
        case "low": bitrateApiValue = 128000; break;
        case "standard": bitrateApiValue = 320000; break;
        case "high": bitrateApiValue = 999000; break; 
        case "super": bitrateApiValue = 999000; break;
        default: bitrateApiValue = 320000;
    }

    const apiResponse = await callMetingApi(`/api.php/url/${track_id}`, { 
        server: server, 
        bitrate: bitrateApiValue 
    });

    // Parsing based on the provided JSON for /url endpoint
    if (apiResponse && apiResponse.data && apiResponse.data.url_info && isValidUrl(apiResponse.data.url_info.url)) {
        const PROXY_URL = userCfg.PROXY_URL; 
        return Promise.resolve({
            url: applyProxy(apiResponse.data.url_info.url, PROXY_URL),
            size: parseInt(apiResponse.data.url_info.size, 10) || 0, // API provides size in Bytes
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
    const server = musicItem._source || userCfg.METING_SERVER;
    const lyric_id_to_use = musicItem._lyric_id || musicItem.id;

    if (!lyric_id_to_use) return Promise.resolve({ rawLrc: "", tlyric: "", error: "Lyric ID missing." });

    const apiResponse = await callMetingApi(`/api.php/lyric/${lyric_id_to_use}`, { server: server });

    // Parsing based on the provided JSON for /lyric endpoint
    if (apiResponse && apiResponse.data && typeof apiResponse.data.lyric === 'object') {
        return Promise.resolve({
            rawLrc: sanitizeString(apiResponse.data.lyric.lyric),
            translateLrc: sanitizeString(apiResponse.data.lyric.tlyric),
        });
    }
    return Promise.resolve({ rawLrc: "", tlyric: "", error: "Lyric not found or API error." });
}

async function getMusicSheetInfo(sheetQuery, page = 1) {
    const sheet_id = typeof sheetQuery === 'object' ? sheetQuery.id : sheetQuery;
    if (!sheet_id || typeof sheet_id !== 'string') {
        return Promise.resolve({ isEnd: true, sheetItem: internalFormatSheetItem(sheet_id, null, null), musicList: [], error: "Invalid sheet ID." });
    }

    const userCfg = getUserConfig();
    const server = userCfg.METING_SERVER; 

    const playlistApiResponse = await callMetingApi(`/api.php/playlist/${sheet_id}`, { server: server });

    // Parsing based on the provided JSON for /playlist/{id}
    if (playlistApiResponse && playlistApiResponse.data && playlistApiResponse.data.playlist_id === sheet_id) {
        const sheetItem = internalFormatSheetItem(sheet_id, playlistApiResponse, server); 
        let musicList = [];
        
        const tracksArray = playlistApiResponse.data.playlist_info;

        if (Array.isArray(tracksArray)) {
            musicList = tracksArray.map(track => internalFormatMusicItem(track, track.source || server)).filter(item => item !== null);
        }
        
        return Promise.resolve({
            isEnd: true, 
            sheetItem: sheetItem,
            musicList: musicList,
        });
    }
    return Promise.resolve({ isEnd: true, sheetItem: internalFormatSheetItem(sheet_id, null, server), musicList: [], error: "Failed to fetch playlist details or invalid API response." });
}

async function importMusicSheet(urlLike) {
    if (typeof urlLike !== 'string' || !urlLike.trim()) { return Promise.resolve([]); }
    let sheetId = null;
    const neteasePlaylistMatch = urlLike.match(/(?:playlist\?id=|playlist\/|song\/list\?id=|list\?id=)(\d+)/i);
    if (neteasePlaylistMatch && neteasePlaylistMatch[1]) { sheetId = neteasePlaylistMatch[1]; }
    
    if (!sheetId) { return Promise.resolve([]); }
    const result = await getMusicSheetInfo({ id: sheetId });
    return Promise.resolve(result.musicList || []);
}

async function getAlbumInfo(albumItemQuery) {
    const album_id = typeof albumItemQuery === 'object' ? albumItemQuery.id : albumItemQuery;
    if (!album_id || typeof album_id !== 'string') {
        return Promise.resolve({ isEnd: true, albumItem: internalFormatAlbumItem({id: "unknown"}, null), musicList: [], error: "Invalid album ID." });
    }
    const userCfg = getUserConfig();
    const server = (typeof albumItemQuery === 'object' && albumItemQuery._source) || userCfg.METING_SERVER;
    
    const albumApiResponseArray = await callMetingApi(`/api.php/album/${album_id}`, { server: server });
    const albumApiResponse = (Array.isArray(albumApiResponseArray) && albumApiResponseArray.length > 0) ? albumApiResponseArray[0] : albumApiResponseArray;

    if (albumApiResponse && albumApiResponse.id) {
        const albumDetails = internalFormatAlbumItem(albumApiResponse, server);
        let musicList = [];
        const tracksArray = albumApiResponse.songs || albumApiResponse.tracks;
        if (Array.isArray(tracksArray)) {
            musicList = tracksArray.map(track => internalFormatMusicItem(track, server)).filter(item => item !== null);
        }
        return Promise.resolve({ isEnd: true, albumItem: albumDetails, musicList: musicList });
    }
    return Promise.resolve({ isEnd: true, albumItem: internalFormatAlbumItem({id: album_id, name: "Album not found"}, server), musicList: [], error: "Failed to fetch album details." });
}

async function getArtistWorks(artistItemQuery, page = 1, type = "music") {
    const artist_id = typeof artistItemQuery === 'object' ? artistItemQuery.id : artistItemQuery;
     if (!artist_id || typeof artist_id !== 'string') {
        return Promise.resolve({ isEnd: true, artistItem: internalFormatArtistItem({id: "unknown"}, null), data: [], error: "Invalid artist ID." });
    }
    const userCfg = getUserConfig();
    const server = (typeof artistItemQuery === 'object' && artistItemQuery._source) || userCfg.METING_SERVER;
    
    const artistApiResponseArray = await callMetingApi(`/api.php/artist/${artist_id}`, { server: server });
    const artistApiResponse = (Array.isArray(artistApiResponseArray) && artistApiResponseArray.length > 0) ? artistApiResponseArray[0] : artistApiResponseArray;

    if (artistApiResponse && artistApiResponse.id) {
        const artistDetails = internalFormatArtistItem(artistApiResponse, server);
        let worksList = [];
        const tracksArray = artistApiResponse.songs || artistApiResponse.hot_songs || artistApiResponse.tracks; 
        if (type === "music" && Array.isArray(tracksArray)) {
            worksList = tracksArray.map(track => internalFormatMusicItem(track, server)).filter(item => item !== null);
        } 
        return Promise.resolve({ isEnd: true, artistItem: artistDetails, data: worksList });
    }
    return Promise.resolve({ isEnd: true, artistItem: internalFormatArtistItem({id: artist_id, name: "Artist not found"}, server), data: [], error: "Failed to fetch artist details/works." });
}

// Stubbed functions
async function getTopLists() { return Promise.resolve([]); }
async function getTopListDetail(topListItem) { 
    if(topListItem && topListItem.id) {
        const result = await getMusicSheetInfo(topListItem);
        return Promise.resolve({ ...result, topListItem: result.sheetItem });
    }
    return Promise.resolve({isEnd: true, sheetItem: {}, musicList: []});
}
async function getRecommendSheetTags() { return Promise.resolve({ pinned: [], data: [] }); }
async function getRecommendSheetsByTag(tag, page) { return Promise.resolve({ isEnd: true, data: [] });}

// --- Module Exports ---
module.exports = {
    platform: "unm (Meting API)",
    version: UNM_PLUGIN_VERSION,
    srcUrl: "https://raw.githubusercontent.com/IIXINGCHEN/IIXINGCHEN.github.io/refs/heads/main/MusicFree/unm.js",
    cacheControl: "no-store", 
    userVariables: [
        { 
            key: "METING_SERVER", 
            name: "Meting API 音源", 
            hint: `选择数据源 (可选: ${VALID_METING_SERVERS.join(', ')}). 默认: ${DEFAULT_METING_SERVER}` 
        },
        { 
            key: "PROXY_URL", 
            name: "反代URL (可选)", 
            hint: "例如: https://yourproxy.com (代理部分音源链接)" 
        }
    ],
    hints: { 
        general: `unm源 (基于 Meting API: ${METING_API_HOST}/api.php/ , 默认音源: ${DEFAULT_METING_SERVER}).`
    },
    supportedSearchType: ["music", "album", "artist"], // Added album and artist
    search, getMusicInfo, getMediaSource, getLyric,
    importMusicSheet, getMusicSheetInfo, 
    getAlbumInfo, getArtistWorks,
    getTopLists, getTopListDetail, getRecommendSheetTags, getRecommendSheetsByTag,
};
