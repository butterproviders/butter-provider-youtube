'use strict';

const Provider = require('butter-provider');
const moment = require('dayjs')
const PicoTube = require('picotube').default
const debug = require('debug')('butter-provider-youtube')

const defaultConfig = {
    name: 'youtube',
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

function getBestThumb(thumbnails) {
    var standardResolutions = [
        'maxres',
        'high',
        'standard',
        'medium',
        'default'
    ]

    while (standardResolutions.length) {
        const resolution = standardResolutions.shift();

        if (thumbnails[resolution]) {
            return thumbnails[resolution].url
        }
    }

    return null
}

function formatForButter({id, title, description, publishedAt, thumbnails, playlists}) {
    const year = publishedAt.split('-')[0]
    const img = getBestThumb(thumbnails)

    return {
        results: [
            {
                type: Provider.ItemType.TVSHOW,
                id: id,
                title: title,
                synopsis: description,
                subtitle: [],
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
                last_updated: publishedAt,
                playlists
            }
        ],
        hasMore: false
    }
}

function generatePlaylistTorrents(pl) {
    debug('NOT IMPLEMENTED')

    return {}
}

const formatPlaylistForButter = (playlist, idx, videos) => {
    console.error(playlist)
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

const mergeSnippet = ({snippet, ...rest}) => Object.assign(rest, snippet)
const extractItems = ({data}) => (data.items.map(mergeSnippet))


module.exports = class YouTube extends Provider {
    constructor (args, config = defaultConfig) {
        super(args, config)

        this.channel = this.args.channel
        this.baseUrl = this.args.baseUrl
        this.regex = {}

        Object.keys(args).forEach((k) => {
            var m = k.match('(.*)Regex');

            if (!m) {
                return;
            }

            this.regex[m[1]] = new RegExp(args[k])
        })

        this.pico = new PicoTube(this.args.apiKey)
        this.playlists = this.pico.channels({
            forUsername: this.channel,
            part: ['snippet']
        }).then(extractItems).then((items) => {
            this.channelInfo = items[0]
            return this.channelInfo
        }).then(channel => this.pico.playlists({
            channelId: channel.id,
            part: ['snippet']
        })).then(extractItems)
                             .then(this.processPlaylists.bind(this))
                             .then(playlists => {
                                 this.playlists = playlists

                                 return playlists
                             })
                             .then(playlists => Object.assign(this.channelInfo, {
                                 playlists
                             }))
    }

    processPlaylists (playlists) {
        if (Object.keys(this.regex).length < 1) {
            return playlists;
        }

        return playlists.filter((playlist) => {
            var found = Object.keys(this.regex).map((field) => {
                var val = playlist.snippet[field];
                let regex = this.regex[field]

                if (!val) {
                    return false
                }

                return val.match(regex) ? true : false;
            })

            return found.indexOf(true) > -1
        })
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

        return this.playlists
                   .catch((err) => {
                       debug('youtube', 'error', err.response.data.error)
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

    detail(id, oldData) {
        var data = this.fetchData
        var updated = moment(oldData.updated)

        return Promise.all(
            this.playlists.map(playlist =>
                this.pico.playlistItems({
                    playlistId: playlist.id,
                    part: ['snippet']
                }).then(extractItems)
                    .then(items => Object.assign(playlist, {items}))
            )
        ).then((playlists) => {
            return Object.assign(oldData, {
                country: '',
                network: 'YouTube Media',
                status: 'finished',
                num_seasons: playlists.length,
                runtime: 30,
                last_updated: updated.unix(),
                __v: 0,
                genres: ['FIXME'],
                seasons: playlists.map(({items, ...playlist}, idx) => (Object.assign(
                    playlist, {order: idx}, {
                        episodes: formatPlaylistForButter(oldData, idx, items)
                    }
                )))
            })
        })
    }
}
