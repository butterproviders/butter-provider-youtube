'use strict';

var GenericProvider = require('butter-provider');
var querystring = require('querystring');
var Q = require('q');
var inherits = require('util').inherits;
var _ = require('lodash');
var moment = require('moment');

var URL = 'https://media.youtube.de/public';

var YouTube = function (args) {
    YouTube.super_.call(this);

    var that = this;
    console.error ('args', args)
    this.channel = args.channel; //&& delete(args.channel);
    this.apiKey  = args.apiKey;  //&& delete(args.apiKey);
    this.regex   = {}

    Object.keys(args).forEach(function (k) {
        var m = k.match('(.*)Regex');

        if (! m)
            return;

        that.regex[m[1]] = new RegExp(args[k])
    })

    this.API = require('node-youtubeapi-simplifier');

    this.API.setup(this.apiKey || 'AIzaSyARQAHCYNuS7qi3mUxu0pgc4FjEBkOrx3U')
    this.playlists = this.API.playlistFunctions.getPlaylistsForUser(this.channel)
        .then(function (playlists) {
            return _.filter(playlists, function (p) {
                var found = _.map(that.regex, function (regex, field) {
                    var val = p[field];

                    if (!val)
                        return false

                    return val.match(regex)?true:false;
                })
                return found.indexOf(true) > -1
            })
        })

    this.channel = this.API.channelFunctions.getDetailsForUser(this.channel);
};

inherits(YouTube, GenericProvider);

YouTube.prototype.config = {
    name: 'youtube',
    uniqueId: 'imdb_id',
    tabName: 'YouTube',
    type: 'tvshow',
};

YouTube.prototype.queryTorrents = function (filters) {
    var params = {};
    var genres = '';
    params.sort = 'seeds';
    params.limit = '50';

    if (filters.keywords) {
        params.keywords = filters.keywords.replace(/\s/g, '% ');
    }

    if (filters.genre) {
        //            filters.genres.forEach(function(g) {
        //                genres += '&genre[]='+g;
        //            });
        //            genres = genres.substring(0, genres.length - 1);
        //            win.info('genres', genres);
        params.genre = filters.genres[0];
    }

    if (filters.order) {
        params.order = filters.order;
    }

    if (filters.sorter && filters.sorter !== 'popularity') {
        params.sort = filters.sorter;
    }

    return (Promise.all([this.playlists, this.channel]))
        .then(function (data) {
            return {
                playlists: data[0],
                channel: data[1]
            }
        })
        .catch(function (err) {
            console.error ('youtube', 'error', err)
        })
};

var getBestThumb = function (th) {
    var res = ['maxres', 'high', 'standard', 'medium', 'default']

    while (res.length) {
        var r = res.shift();
        if (th[r])
            return th[r].url
    }
}

var formatForButter = function(data) {
    var channel = data.channel,
        playlists = data.playlists;

    var id = channel.channelId;
    var updated = moment(channel.publishedAt);
    var year = updated.year();
    var img = channel.avatar.high.url;

    return {
        results: [{
        type: 'show',
        _id: id,
        imdb_id: 'youtube-' + id,
        tvdb_id: 'youtube-' + id,
        title: channel.title,
        year: year,
        images: {
            banner: img,
            fanart: img,
            poster: img,
        },
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
        }],
        hasMore: false
    }
}

var generateEventTorrents = function(event) {
    return event
}

var formatEventForButter = function(event, idx) {
    var date = moment(event.date);
    return {
        torrents: generateEventTorrents(event),
        watched: {
            watched: false,
        },
        first_aired: date.unix(),
        date_based: false,
        overview: event.description,
        title: event.title,
        episode: idx,
        season: 1,
        tvdb_id: event.slug,
    }
}

var formatDetailForButter = function(bulk) {
    var id = bulk.id,
    data = bulk.data,
    old_data = bulk.old_data;

    var updated = moment(data.updated)

    var ret =  _.extend (old_data, {
        synopsis: data.title,
        country: "",
        network: "YouTube Media",
        status: "finished",
        num_seasons: 1,
        runtime: 30,
        last_updated: updated.unix(),
        __v: 0,
        genres: ["Event", "Conference"],
        episodes: data.events.map(formatEventForButter)
    })

    console.error (ret)
    return ret;
}

// Single element query
var queryTorrent = function (torrent_id, old_data, debug) {
    return deferRequest(URL + '/conferences/' + old_data._id)
        .then(function (data) {
            return {
                id: torrent_id,
                data: data,
                old_data: old_data
            }
        })
};

YouTube.prototype.extractIds = function (items) {
    return _.pluck(items.results, 'imdb_id');
};

YouTube.prototype.fetch = function (filters) {
    return this.queryTorrents(filters)
        .then(formatForButter);
};

YouTube.prototype.detail = function (torrent_id, old_data, debug) {
    return queryTorrent(torrent_id, old_data, debug)
        .then(formatDetailForButter);
};

module.exports = YouTube;
