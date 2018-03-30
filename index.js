'use strict';

const Provider = require('butter-provider');
const moment = require('moment');
const API = require('node-youtubeapi-simplifier');
const debug = require('debug')('butter-provider-youtube')

const defaultConfig = {
    name: 'youtube',
    uniqueId: 'ytid',
    tabName: 'YouTube',
    argTypes: {
        channel: Provider.ArgType.STRING,
        apiKey: Provider.ArgType.STRING,
        baseUrl: Provider.ArgType.STRING
    },
    defaults: {
        apiKey: 'AIzaSyARQAHCYNuS7qi3mUxu0pgc4FjEBkOrx3U',
        baseUrl: 'https://media.youtube.de/public'
    }
}

// reimplement flatten to get rid of underscore/lodash
function flatten(e) {
    return e.reduce((a, c) => (a.concat(c)), [])
}

function getBestThumb(th) {
    var res = [
        'maxres',
        'high',
        'standard',
        'medium',
        'default'
    ]

    while (res.length) {
        var r = res.shift();
        if (th[r]) {
            return th[r].url
        }
    }

    return null
}

function formatForButter(data) {
    var channel = data.channel,
        playlists = data.playlists;

    var id = channel.channelId;
    var updated = moment(channel.publishedAt);
    var year = updated.year();
    var img = getBestThumb(channel.avatar);

    return {
        results: [
            {
                type: Provider.ItemType.TVSHOW,
                ytid: id,
                title: channel.title,
                synopsis: channel.description,
                year: year,
                poster: img,
                backdrop: img,
                slug: id,
                rating: {
                    hated: 0,
                    loved: 0,
                    votes: 0,
                    percentage: 0,
                    watching: 0
                },
                num_seasons: playlists.length,
                last_updated: updated.unix()
            }
        ],
        hasMore: false
    }
}

function generatePlaylistTorrents(pl) {
    debug('NOT IMPLEMENTED')

    return pl
}

function formatPlaylistForButter(pl, idx, videos) {
    return videos.map((vid, vidx) => {
        var date = moment(vid.publishedAt);

        return {
            torrents: generatePlaylistTorrents(vid),
            watched: {
                watched: false
            },
            first_aired: date.unix(),
            date_based: false,
            overview: vid.description,
            title: vid.title,
            episode: vidx + 1,
            season: idx + 1,
            tvdb_id: vid.videoId
        }
    })
}

module.exports = class YouTube extends Provider {
    constructor (args, config = defaultConfig) {
        super(args, config)

        this.channel = this.args.channel
        this.apiKey = this.args.apiKey
        this.baseUrl = this.args.baseUrl
        this.regex = {}

        Object.keys(args).forEach((k) => {
            var m = k.match('(.*)Regex');

            if (!m) {
                return;
            }

            this.regex[m[1]] = new RegExp(args[k])
        })

        debug(args, this.channel, this.apiKey);

        this.API = API

        this.API.setup(this.apiKey)
        this.playlists = this.API.playlistFunctions
                             .getPlaylistsForUser(this.channel)
                             .then((playlists) => {
                                 if (Object.keys(this.regex).length < 1) {
                                     return playlists;
                                 }

                                 return playlists.filter((p) => {
                                     var found = Object.keys(this.regex).map((field) => {
                                         var val = p[field];
                                         let regex = this.regex[field]

                                         if (!val) {
                                             return false
                                         }

                                         return val.match(regex) ? true : false;
                                     })

                                     return found.indexOf(true) > -1
                                 })
                             })

        this.channel = this.API.channelFunctions.getDetailsForUser(this.channel);
    }

    queryTorrents (filters = {}) {
        var params = {};
//        var genres = '';
        params.sort = 'seeds';
        params.limit = '50';

        if (filters.genre) {
            /* filters.genres.forEach(function(g) {
               genres += '&genre[]='+g;
               });
               genres = genres.substring(0, genres.length - 1);
               win.info('genres', genres); */
            params.genre = filters.genres[0];
        }

        if (filters.order) {
            params.order = filters.order;
        }

        if (filters.sorter && filters.sorter !== 'popularity') {
            params.sort = filters.sorter;
        }

        if (this.fetchData) {
            return Promise.resolve(this.fetchData);
        }

        return (Promise.all([
            this.playlists,
            this.channel
        ]))
            .then((data) => {
                this.fetchData = {
                    playlists: data[0],
                    channel: data[1]
                }

                return this.fetchData
            })
            .catch((err) => {
                debug('youtube', 'error', err)
            })
    }

    fetch(filters = {}) {
        return this.queryTorrents(filters)
                   .then(formatForButter)
                   .then((data) => {
                       if (!filters.keywords) {
                           return data;
                       }

                       var re = new RegExp(filters.keywords.replace(/\s/g, '\\s+'), 'gi')
                       if (re.match(data.results[0].title)) {
                           return data
                       }

                       return {results: [],
                           hasMore: false}
                   })
    }

    getPlaylistsVideos(playlists) {
        return Promise.all(playlists.map((pl, idx) => this.API.playlistFunctions.getVideosForPlaylist(pl.playlistId)
                       .then((videos) => (formatPlaylistForButter(pl, idx, videos)))))
    }

    detail(id, oldData) {
        var data = this.fetchData
        var updated = moment(oldData.updated)

        return this.getPlaylistsVideos(data.playlists)
                   .then((videos) => Object.assign(oldData, {
                       country: '',
                       network: 'YouTube Media',
                       status: 'finished',
                       num_seasons: data.playlists.length,
                       runtime: 30,
                       last_updated: updated.unix(),
                       __v: 0,
                       genres: ['FIXME'],
                       episodes: flatten(videos)
                   }))
    }
}
