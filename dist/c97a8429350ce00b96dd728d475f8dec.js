var $8zHUo$axios = require("axios");


function $parcel$interopDefault(a) {
  return a && a.__esModule ? a.default : a;
}

function $parcel$defineInteropFlag(a) {
  Object.defineProperty(a, '__esModule', {value: true, configurable: true});
}

function $parcel$export(e, n, v, s) {
  Object.defineProperty(e, n, {get: v, set: s, enumerable: true, configurable: true});
}

$parcel$defineInteropFlag(module.exports);

$parcel$export(module.exports, "default", () => $882b6d93070905b3$export$2e2bcd8739ae039);

// Meting API 配置
const $882b6d93070905b3$var$METING_API_BASE = 'https://meting-api.imixc.top/api.php';
// 支持的平台配置
const $882b6d93070905b3$var$PLATFORMS = {
    pyncmd: 'pyncmd',
    netease: 'netease',
    tencent: 'tencent',
    kugou: 'kugou',
    kuwo: 'kuwo',
    baidu: 'baidu' // 百度音乐
};
// 默认平台优先级（用于备选）
const $882b6d93070905b3$var$PLATFORM_PRIORITY = [
    $882b6d93070905b3$var$PLATFORMS.pyncmd,
    $882b6d93070905b3$var$PLATFORMS.netease,
    $882b6d93070905b3$var$PLATFORMS.tencent,
    $882b6d93070905b3$var$PLATFORMS.kugou
];
// API 工具函数
const $882b6d93070905b3$var$MetingAPI = {
    // 基础请求函数
    async request (endpoint, params = {}) {
        try {
            const url = `${$882b6d93070905b3$var$METING_API_BASE}${endpoint}`;
            const response = await (0, ($parcel$interopDefault($8zHUo$axios))).get(url, {
                params: params,
                timeout: 10000,
                headers: {
                    'User-Agent': 'MusicFree-Plugin/1.0.0'
                }
            });
            if (response.data?.success) return response.data.data;
            else throw new Error(response.data?.error || "\u8BF7\u6C42\u5931\u8D25");
        } catch (error) {
            console.error("Meting API \u8BF7\u6C42\u5931\u8D25:", error);
            throw error;
        }
    },
    // 搜索
    async search (keyword, server, limit = 20) {
        return this.request('/search', {
            q: keyword,
            server: server,
            limit: limit
        });
    },
    // 获取歌曲详情
    async song (id, server) {
        return this.request(`/song/${id}`, {
            server: server
        });
    },
    // 获取播放链接
    async url (id, server, bitrate = '320') {
        return this.request(`/url/${id}`, {
            server: server,
            bitrate: bitrate
        });
    },
    // 获取歌词
    async lyric (id, server) {
        return this.request(`/lyric/${id}`, {
            server: server
        });
    },
    // 获取专辑信息
    async album (id, server) {
        return this.request(`/album/${id}`, {
            server: server
        });
    },
    // 获取艺术家信息
    async artist (id, server) {
        return this.request(`/artist/${id}`, {
            server: server
        });
    },
    // 获取歌单信息
    async playlist (id, server) {
        return this.request(`/playlist/${id}`, {
            server: server
        });
    }
};
// 数据转换工具函数
const $882b6d93070905b3$var$DataConverter = {
    // 转换音乐项目
    convertMusicItem (item, platform) {
        // 数据验证和清理
        if (!item || !item.id && !item.song_id) throw new Error("\u97F3\u4E50\u9879\u76EE\u7F3A\u5C11\u5FC5\u8981\u7684 ID \u5B57\u6BB5");
        // 处理艺术家信息
        let artistName = '';
        if (Array.isArray(item.artist)) artistName = item.artist.map((a)=>a.name || a).join(', ');
        else if (typeof item.artist === 'object' && item.artist?.name) artistName = item.artist.name;
        else artistName = String(item.artist || '');
        // 处理专辑信息
        let albumName = '';
        let albumArtwork = '';
        if (typeof item.album === 'object' && item.album) {
            albumName = item.album.name || '';
            albumArtwork = item.album.pic || item.album.cover || '';
        } else albumName = String(item.album || '');
        return {
            id: item.id || item.song_id,
            platform: platform,
            title: String(item.name || item.title || ''),
            artist: artistName,
            album: albumName,
            artwork: item.pic || item.cover || albumArtwork || '',
            duration: item.duration ? Math.floor(Number(item.duration) / 1000) : undefined,
            url: item.url || '',
            lrc: item.lrc || '',
            rawLrc: item.lyric || ''
        };
    },
    // 转换专辑项目
    convertAlbumItem (item, platform) {
        // 数据验证
        if (!item || !item.id && !item.album_id) throw new Error("\u4E13\u8F91\u9879\u76EE\u7F3A\u5C11\u5FC5\u8981\u7684 ID \u5B57\u6BB5");
        // 处理艺术家信息
        let artistName = '';
        if (typeof item.artist === 'object' && item.artist?.name) artistName = item.artist.name;
        else artistName = String(item.artist || '');
        return {
            id: item.id || item.album_id,
            platform: platform,
            title: String(item.name || item.title || ''),
            artist: artistName,
            artwork: item.pic || item.cover || '',
            description: String(item.description || ''),
            worksNum: Number(item.song_count || 0),
            createAt: item.publishTime ? new Date(item.publishTime).getTime() : undefined
        };
    },
    // 转换艺术家项目
    convertArtistItem (item, platform) {
        // 数据验证
        if (!item || !item.id && !item.artist_id) throw new Error("\u827A\u672F\u5BB6\u9879\u76EE\u7F3A\u5C11\u5FC5\u8981\u7684 ID \u5B57\u6BB5");
        return {
            id: item.id || item.artist_id,
            platform: platform,
            name: String(item.name || ''),
            avatar: item.pic || item.avatar || '',
            description: String(item.description || item.brief || ''),
            fans: Number(item.follow_count || 0),
            worksNum: Number(item.song_count || item.album_count || 0)
        };
    },
    // 转换歌单项目
    convertSheetItem (item, platform) {
        // 数据验证
        if (!item || !item.id && !item.playlist_id) throw new Error("\u6B4C\u5355\u9879\u76EE\u7F3A\u5C11\u5FC5\u8981\u7684 ID \u5B57\u6BB5");
        // 处理创建者信息
        let creatorName = '';
        if (typeof item.creator === 'object' && item.creator?.name) creatorName = item.creator.name;
        else creatorName = String(item.creator || '');
        return {
            id: item.id || item.playlist_id,
            platform: platform,
            title: String(item.name || item.title || ''),
            artist: creatorName,
            artwork: item.pic || item.cover || '',
            description: String(item.description || ''),
            worksNum: Number(item.song_count || item.track_count || 0),
            playCount: Number(item.play_count || 0),
            createAt: item.create_time ? new Date(item.create_time).getTime() : undefined
        };
    }
};
// 注意：不要使用async () => {}，hermes不支持异步箭头函数
const $882b6d93070905b3$var$search = async function(query, page, type) {
    try {
        const limit = 20;
        const offset = (page - 1) * limit;
        // 使用多源聚合平台进行搜索
        let searchResults = [];
        let platform = $882b6d93070905b3$var$PLATFORMS.pyncmd;
        try {
            searchResults = await $882b6d93070905b3$var$MetingAPI.search(query, platform, limit);
        } catch (error) {
            // 如果多源聚合失败，尝试网易云
            console.warn("\u591A\u6E90\u805A\u5408\u641C\u7D22\u5931\u8D25\uFF0C\u5C1D\u8BD5\u7F51\u6613\u4E91:", error);
            platform = $882b6d93070905b3$var$PLATFORMS.netease;
            searchResults = await $882b6d93070905b3$var$MetingAPI.search(query, platform, limit);
        }
        if (!Array.isArray(searchResults)) return {
            isEnd: true,
            data: []
        };
        // 根据搜索类型转换数据
        let convertedData = [];
        switch(type){
            case 'music':
                convertedData = searchResults.filter((item)=>item && (item.id || item.song_id)).map((item)=>{
                    try {
                        return $882b6d93070905b3$var$DataConverter.convertMusicItem(item, platform);
                    } catch (error) {
                        console.warn("\u8F6C\u6362\u97F3\u4E50\u9879\u76EE\u5931\u8D25:", error, item);
                        return null;
                    }
                }).filter((item)=>item !== null);
                break;
            case 'album':
                convertedData = searchResults.filter((item)=>item && (item.type === 'album' || item.album_id || item.id)).map((item)=>{
                    try {
                        return $882b6d93070905b3$var$DataConverter.convertAlbumItem(item, platform);
                    } catch (error) {
                        console.warn("\u8F6C\u6362\u4E13\u8F91\u9879\u76EE\u5931\u8D25:", error, item);
                        return null;
                    }
                }).filter((item)=>item !== null);
                break;
            case 'artist':
                convertedData = searchResults.filter((item)=>item && (item.type === 'artist' || item.artist_id || item.id)).map((item)=>{
                    try {
                        return $882b6d93070905b3$var$DataConverter.convertArtistItem(item, platform);
                    } catch (error) {
                        console.warn("\u8F6C\u6362\u827A\u672F\u5BB6\u9879\u76EE\u5931\u8D25:", error, item);
                        return null;
                    }
                }).filter((item)=>item !== null);
                break;
            case 'sheet':
                convertedData = searchResults.filter((item)=>item && (item.type === 'playlist' || item.playlist_id || item.id)).map((item)=>{
                    try {
                        return $882b6d93070905b3$var$DataConverter.convertSheetItem(item, platform);
                    } catch (error) {
                        console.warn("\u8F6C\u6362\u6B4C\u5355\u9879\u76EE\u5931\u8D25:", error, item);
                        return null;
                    }
                }).filter((item)=>item !== null);
                break;
            default:
                return {
                    isEnd: true,
                    data: []
                };
        }
        // 分页处理
        const startIndex = offset;
        const endIndex = startIndex + limit;
        const paginatedData = convertedData.slice(startIndex, endIndex);
        return {
            isEnd: paginatedData.length < limit || convertedData.length <= endIndex,
            data: paginatedData
        };
    } catch (error) {
        console.error("\u641C\u7D22\u5931\u8D25:", error);
        return {
            isEnd: true,
            data: []
        };
    }
};
// 获取音乐播放源
const $882b6d93070905b3$var$getMediaSource = async function(musicItem, quality) {
    try {
        if (!musicItem.id || !musicItem.platform) return null;
        // 尝试多个平台获取播放链接
        const platforms = [
            musicItem.platform,
            ...$882b6d93070905b3$var$PLATFORM_PRIORITY.filter((p)=>p !== musicItem.platform)
        ];
        for (const platform of platforms)try {
            const urlResult = await $882b6d93070905b3$var$MetingAPI.url(String(musicItem.id), platform, quality === 'super' ? '320' : quality === 'high' ? '192' : quality === 'standard' ? '128' : '96');
            if (urlResult && urlResult.url) return {
                url: urlResult.url,
                quality: quality,
                headers: {
                    'Referer': 'https://music.163.com/',
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                }
            };
        } catch (error) {
            console.warn(`\u{5E73}\u{53F0} ${platform} \u{83B7}\u{53D6}\u{64AD}\u{653E}\u{94FE}\u{63A5}\u{5931}\u{8D25}:`, error);
            continue;
        }
        return null;
    } catch (error) {
        console.error("\u83B7\u53D6\u64AD\u653E\u6E90\u5931\u8D25:", error);
        return null;
    }
};
// 获取歌词
const $882b6d93070905b3$var$getLyric = async function(musicItem) {
    try {
        if (!musicItem.id || !musicItem.platform) return null;
        // 优先使用网易云获取歌词（歌词质量较好）
        const lyricPlatforms = [
            $882b6d93070905b3$var$PLATFORMS.netease,
            musicItem.platform,
            ...$882b6d93070905b3$var$PLATFORM_PRIORITY.filter((p)=>p !== musicItem.platform && p !== $882b6d93070905b3$var$PLATFORMS.netease)
        ];
        for (const platform of lyricPlatforms)try {
            const lyricResult = await $882b6d93070905b3$var$MetingAPI.lyric(String(musicItem.id), platform);
            if (lyricResult && (lyricResult.lrc || lyricResult.lyric)) return {
                lrc: lyricResult.lrc || lyricResult.lyric || '',
                rawLrc: lyricResult.lrc || lyricResult.lyric || ''
            };
        } catch (error) {
            console.warn(`\u{5E73}\u{53F0} ${platform} \u{83B7}\u{53D6}\u{6B4C}\u{8BCD}\u{5931}\u{8D25}:`, error);
            continue;
        }
        return null;
    } catch (error) {
        console.error("\u83B7\u53D6\u6B4C\u8BCD\u5931\u8D25:", error);
        return null;
    }
};
// 获取专辑信息
const $882b6d93070905b3$var$getAlbumInfo = async function(albumItem, page) {
    try {
        if (!albumItem.id || !albumItem.platform) return null;
        const platform = albumItem.platform;
        const albumResult = await $882b6d93070905b3$var$MetingAPI.album(String(albumItem.id), platform);
        if (!albumResult) return null;
        // 转换音乐列表
        let musicList = [];
        if (Array.isArray(albumResult.songs) || Array.isArray(albumResult)) {
            const songs = albumResult.songs || albumResult;
            musicList = songs.map((song)=>$882b6d93070905b3$var$DataConverter.convertMusicItem(song, platform));
        }
        // 分页处理
        const pageSize = 50;
        const startIndex = (page - 1) * pageSize;
        const endIndex = startIndex + pageSize;
        const paginatedMusicList = musicList.slice(startIndex, endIndex);
        return {
            isEnd: musicList.length <= endIndex,
            albumItem: {
                title: albumResult.name || albumItem.title,
                artist: albumResult.artist?.name || albumResult.artist || albumItem.artist,
                artwork: albumResult.pic || albumResult.cover || albumItem.artwork,
                description: albumResult.description || albumItem.description,
                worksNum: musicList.length
            },
            musicList: paginatedMusicList
        };
    } catch (error) {
        console.error("\u83B7\u53D6\u4E13\u8F91\u4FE1\u606F\u5931\u8D25:", error);
        return null;
    }
};
// 获取艺术家作品
const $882b6d93070905b3$var$getArtistWorks = async function(artistItem, page, type) {
    try {
        if (!artistItem.id || !artistItem.platform) return {
            isEnd: true,
            data: []
        };
        const platform = artistItem.platform;
        const artistResult = await $882b6d93070905b3$var$MetingAPI.artist(String(artistItem.id), platform);
        if (!artistResult) return {
            isEnd: true,
            data: []
        };
        let convertedData = [];
        const pageSize = 30;
        if (type === 'music') // 获取艺术家的音乐作品
        {
            if (Array.isArray(artistResult.songs) || Array.isArray(artistResult)) {
                const songs = artistResult.songs || artistResult;
                convertedData = songs.map((song)=>$882b6d93070905b3$var$DataConverter.convertMusicItem(song, platform));
            }
        } else if (type === 'album') // 获取艺术家的专辑作品
        {
            if (Array.isArray(artistResult.albums)) convertedData = artistResult.albums.map((album)=>$882b6d93070905b3$var$DataConverter.convertAlbumItem(album, platform));
        }
        // 分页处理
        const startIndex = (page - 1) * pageSize;
        const endIndex = startIndex + pageSize;
        const paginatedData = convertedData.slice(startIndex, endIndex);
        return {
            isEnd: convertedData.length <= endIndex,
            data: paginatedData
        };
    } catch (error) {
        console.error("\u83B7\u53D6\u827A\u672F\u5BB6\u4F5C\u54C1\u5931\u8D25:", error);
        return {
            isEnd: true,
            data: []
        };
    }
};
// 获取歌单信息
const $882b6d93070905b3$var$getMusicSheetInfo = async function(sheetItem, page) {
    try {
        if (!sheetItem.id || !sheetItem.platform) return null;
        const platform = sheetItem.platform;
        const playlistResult = await $882b6d93070905b3$var$MetingAPI.playlist(String(sheetItem.id), platform);
        if (!playlistResult) return null;
        // 转换音乐列表
        let musicList = [];
        if (Array.isArray(playlistResult.songs) || Array.isArray(playlistResult)) {
            const songs = playlistResult.songs || playlistResult;
            musicList = songs.map((song)=>$882b6d93070905b3$var$DataConverter.convertMusicItem(song, platform));
        }
        // 分页处理
        const pageSize = 50;
        const startIndex = (page - 1) * pageSize;
        const endIndex = startIndex + pageSize;
        const paginatedMusicList = musicList.slice(startIndex, endIndex);
        return {
            isEnd: musicList.length <= endIndex,
            sheetItem: {
                title: playlistResult.name || sheetItem.title,
                artist: playlistResult.creator?.name || playlistResult.creator || sheetItem.artist,
                artwork: playlistResult.pic || playlistResult.cover || sheetItem.artwork,
                description: playlistResult.description || sheetItem.description,
                worksNum: musicList.length,
                playCount: playlistResult.play_count || sheetItem.playCount
            },
            musicList: paginatedMusicList
        };
    } catch (error) {
        console.error("\u83B7\u53D6\u6B4C\u5355\u4FE1\u606F\u5931\u8D25:", error);
        return null;
    }
};
const $882b6d93070905b3$var$pluginInstance = {
    platform: "Meting\u97F3\u4E50\u805A\u5408",
    version: "1.0.0",
    primaryKey: [
        "id",
        "platform"
    ],
    supportedSearchType: [
        "music",
        "album",
        "artist",
        "sheet"
    ],
    cacheControl: "cache",
    search: $882b6d93070905b3$var$search,
    getMediaSource: $882b6d93070905b3$var$getMediaSource,
    getLyric: $882b6d93070905b3$var$getLyric,
    getAlbumInfo: $882b6d93070905b3$var$getAlbumInfo,
    getArtistWorks: $882b6d93070905b3$var$getArtistWorks,
    getMusicSheetInfo: $882b6d93070905b3$var$getMusicSheetInfo
};
var $882b6d93070905b3$export$2e2bcd8739ae039 = $882b6d93070905b3$var$pluginInstance;


//# sourceMappingURL=plugin.js.map
